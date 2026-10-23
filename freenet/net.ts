// Aula on Freenet, browser side: talks to the local Freenet node over WebSocket and installs the in-browser API (api.js).
// One contract per class (contract/): parameters = teacher key || salt, state and delta = the same JSON of signed records.
import {
  ContractContainer,
  ContractKey,
  ContractType,
  DeltaUpdate,
  FreenetWsApi,
  GetRequest,
  PutRequest,
  ResponseHandler,
  UpdateData,
  UpdateDataType,
  UpdateRequest,
  WasmContractV1,
} from "@freenetorg/freenet-stdlib";
import { ContractCodeT } from "@freenetorg/freenet-stdlib/common";
import { RelatedContractsT } from "@freenetorg/freenet-stdlib/client-request";
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

const listeners = new Set<(key: string) => void>();
let apiP: Promise<FreenetWsApi> | undefined;
function node(): Promise<FreenetWsApi> {
  return (apiP ??= new Promise((resolve, reject) => {
    const h: ResponseHandler = {
      onContractPut() {},
      onContractGet() {},
      onContractUpdate() {},
      onContractUpdateNotification: (n) => listeners.forEach((fn) => fn(n.key.encode())),
      onContractNotFound() {},
      onDelegateResponse() {},
      onErr: (e) => console.error("Freenet error:", e?.cause || e),
      onOpen: () => resolve(a),
      onClose() {
        apiP = undefined;
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

(globalThis as unknown as Record<string, unknown>).AULA_API = createApi(store, {
  onChange: () => globalThis.dispatchEvent(new Event("hashchange")),
});
