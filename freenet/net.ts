// Aula on Freenet, browser side: talks to the local Freenet node over WebSocket and installs the in-browser API (api.js).
// One contract per class (contract/): parameters = teacher key || salt, state and delta = the same JSON of signed records.
import {
  ContractContainer,
  ContractKey,
  ContractType,
  DelegateRequest,
  DeltaUpdate,
  FreenetWsApi,
  GetRequest,
  PutRequest,
  ResponseHandler,
  UpdateData,
  UpdateDataType,
  UpdateRequest,
  WasmContractV1,
  type DelegateResponse,
} from "@freenetorg/freenet-stdlib";
import { ApplicationMessageT, ContractCodeT } from "@freenetorg/freenet-stdlib/common";
import {
  ApplicationMessagesT, ClientRequestT, ClientRequestType, DelegateCodeT, DelegateContainerT, DelegateKeyT, DelegateRequestType, DelegateType,
  InboundDelegateMsgT, InboundDelegateMsgType, RegisterDelegateT, RelatedContractsT, WasmDelegateV1T,
} from "@freenetorg/freenet-stdlib/client-request";
import { blake3 } from "@noble/hashes/blake3.js";
import { createApi } from "./api.js";
import "./auth.js";

const TIMEOUT_MS = 15000;
const withTimeout = <T>(p: Promise<T>): Promise<T> =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Freenet request timeout")), TIMEOUT_MS))]);
const hexBytes = (h: string) => Uint8Array.from(h.match(/../g) ?? [], (b) => parseInt(b, 16));

function wsUrl(): URL {
  const loc = globalThis.location;
  const onNode = loc.port === "7509" || loc.pathname.includes("/v1/contract/");
  return new URL(`${loc.protocol === "https:" ? "wss" : "ws"}://${onNode ? loc.host : "127.0.0.1:7509"}/v1/contract/command`);
}

async function retrying<T>(f: () => Promise<T>, tries = 3): Promise<T> {
  for (let i = 1; ; i++) {
    try { return await f(); } catch (e) {
      if (i >= tries || !/closed|timeout/i.test(String(e))) throw e;
      await new Promise((r) => setTimeout(r, 1200));
    }
  }
}

const listeners = new Set<(key: string) => void>();
interface Waiter { resolve(r: DelegateResponse): void; reject(e: Error): void }
const delegateWaiters: Waiter[] = [];
let apiP: Promise<FreenetWsApi> | undefined;
function node(): Promise<FreenetWsApi> {
  return (apiP ??= new Promise((resolve, reject) => {
    const h: ResponseHandler = {
      onContractPut() {},
      onContractGet() {},
      onContractUpdate() {},
      onContractUpdateNotification: (n) => listeners.forEach((fn) => fn(n.key.encode())),
      onContractNotFound() {},
      onDelegateResponse: (r) => delegateWaiters.shift()?.resolve(r),
      onErr: (e) => console.error("Freenet error:", e?.cause || e),
      onOpen: () => resolve(a),
      onClose() {
        apiP = undefined;
        delegateWaiters.splice(0).forEach((w) => w.reject(new Error("socket closed"))); // their replies will never come
        reject(new Error("Freenet WebSocket closed"));
      },
    };
    const a = new FreenetWsApi(wsUrl(), h, "");
  }));
}

let codeP: Promise<{ code: Uint8Array; hash: Uint8Array }> | undefined;
const classCode = () =>
  (codeP ??= (async () => {
    const r = await fetch(new URL("aula_class.wasm", globalThis.location.href));
    if (!r.ok) throw new Error(`Cannot load aula_class.wasm: HTTP ${r.status}`);
    const code = new Uint8Array(await r.arrayBuffer());
    return { code, hash: blake3(code) };
  })());

const keyOf = async (paramsHex: string) => {
  const { hash } = await classCode();
  return new ContractKey(blake3(new Uint8Array([...hash, ...hexBytes(paramsHex)])), hash);
};

/** Store for api.js; the class id is the contract parameters in hex. */
export const store = {
  /** The class state (and subscribes to its changes), or null when it was never published. */
  async get(id: string) {
    const client = await node();
    try {
      const r = await withTimeout(client.get(new GetRequest(await keyOf(id), false, true)));
      return r.state.length ? JSON.parse(new TextDecoder().decode(Uint8Array.from(r.state))) : { records: {} };
    } catch (e) {
      if (/not found/i.test(String(e))) return null;
      throw e;
    }
  },
  /** Send signed records: `exists` false publishes the contract with them as its first state. */
  async push(id: string, delta: unknown, exists: boolean) {
    const client = await node();
    const key = await keyOf(id);
    const bytes = Array.from(new TextEncoder().encode(JSON.stringify(delta)));
    if (exists) {
      await withTimeout(client.update(new UpdateRequest(key, new UpdateData(UpdateDataType.DeltaUpdate, new DeltaUpdate(bytes)))));
      return;
    }
    const { code, hash } = await classCode();
    const contract = new WasmContractV1(new ContractCodeT(Array.from(code), Array.from(hash)), Array.from(hexBytes(id)), key);
    await withTimeout(client.put(new PutRequest(new ContractContainer(ContractType.WasmContractV1, contract), bytes, new RelatedContractsT(), true)));
  },
};

console.info("Aula: page loaded"); // seen again after every click = the node's page reloads on navigation

// ---------------------------------------------------------------- identity delegate
// A small module kept by the node, one store per calling web app (FreeNames' identity delegate, see delegate/README.md). It keeps the key,
// the session and the pending Viso sign-in across reloads and the redirect to Viso, even inside the sandboxed page that has no storage.
// Same plumbing as FreeNames' ui/src/lib.ts: every delegate request gets one response without an id, so they go one at a time.
let delegateChain: Promise<unknown> = Promise.resolve();
function sendDelegate(req: DelegateRequest, timeoutMs = 8000): Promise<DelegateResponse> {
  const run = async () => {
    let waiter!: Waiter;
    const reply = new Promise<DelegateResponse>((resolve, reject) => {
      waiter = { resolve, reject };
      delegateWaiters.push(waiter);
      setTimeout(() => {
        const i = delegateWaiters.indexOf(waiter);
        if (i >= 0) { delegateWaiters.splice(i, 1); reject(new Error("delegate timeout")); }
      }, timeoutMs);
    });
    const a = (await node()) as unknown as { sendRequest(r: ClientRequestT): void }; // the SDK has no delegate method yet
    a.sendRequest(new ClientRequestT(ClientRequestType.DelegateRequest, req));
    return reply;
  };
  const p = delegateChain.then(run);
  delegateChain = p.catch(() => {});
  return p;
}

/** Hand the delegate's wasm to the node (idempotent) and return its key: blake3(blake3(wasm)) for empty parameters. */
async function registerDelegate(wasmUrl: string): Promise<DelegateKeyT> {
  const r = await fetch(wasmUrl);
  if (!r.ok) throw new Error(`Cannot load identity.wasm: HTTP ${r.status}`);
  const code = new Uint8Array(await r.arrayBuffer());
  const codeHash = blake3(code);
  const key = new DelegateKeyT(Array.from(blake3(codeHash)), Array.from(codeHash));
  const wasm = new WasmDelegateV1T([], new DelegateCodeT(Array.from(code), Array.from(codeHash)), key);
  const container = new DelegateContainerT(DelegateType.WasmDelegateV1, wasm);
  // the node ignores cipher and nonce (secrets use a node-side key) but still checks their sizes
  await sendDelegate(new DelegateRequest(DelegateRequestType.RegisterDelegate, new RegisterDelegateT(container, new Array(32).fill(0), new Array(24).fill(0))));
  return key;
}

async function messageDelegate(key: DelegateKeyT, payload: object): Promise<Record<string, unknown>> {
  const bytes = Array.from(new TextEncoder().encode(JSON.stringify(payload)));
  const msg = new InboundDelegateMsgT(InboundDelegateMsgType.common_ApplicationMessage, new ApplicationMessageT(bytes, [], false));
  const r = await sendDelegate(new DelegateRequest(DelegateRequestType.ApplicationMessages, new ApplicationMessagesT(key, [], [msg])));
  // duck-typed: bundlers can duplicate the SDK classes, which breaks instanceof
  const m = r.values.map((v) => v.inbound).find((x) => Array.isArray((x as ApplicationMessageT | null)?.payload)) as ApplicationMessageT | undefined;
  if (!m) throw new Error("empty delegate reply");
  const out = JSON.parse(new TextDecoder().decode(new Uint8Array(m.payload)));
  if (out.err) throw new Error(out.err);
  return out;
}

/** The node's key/value store for this app, or throws when the node has no delegate support (api.js then keeps the key in the tab). */
async function delegateKv() {
  const key = await retrying(() => registerDelegate(new URL("identity.wasm", globalThis.location.href).href));
  const call = (payload: object) => retrying(() => messageDelegate(key, payload)); // get and put are safe to repeat
  return {
    get: async (k: string) => ((await call({ op: "get", key: k })).value as string | null) ?? null,
    put: async (k: string, v: string) => { await call({ op: "put", key: k, value: v }); },
  };
}

(globalThis as unknown as Record<string, unknown>).AULA_API = createApi(store, {
  kv: delegateKv,
  onChange: () => globalThis.dispatchEvent(new Event("hashchange")),
});
