// Adapter tests against an in-memory store. Contract rules are tested in contract/ (cargo test); signatures and delegations are verified here as the contract would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from './api.js';
import { connectMessage, hex, keysOf, unhex, verifyProof } from './identity.js';

const APP = { origin: 'http://127.0.0.1:7509', path: '/v1/contract/web/AulaApp/' };
const subtle = crypto.subtle;
const verify = async (pk, sig, bytes) => subtle.verify('Ed25519', await subtle.importKey('raw', unhex(pk), 'Ed25519', false, ['verify']), unhex(sig), bytes);

function memoryStore() {
  const nets = new Map();
  return {
    nets,
    async get(id) { return nets.has(id) ? structuredClone(nets.get(id)) : null; },
    async push(id, delta, exists) {
      assert.equal(exists, nets.has(id), 'exists flag must match the network');
      const st = nets.get(id) ?? { records: {} };
      for (const [k, r] of Object.entries(delta.records)) {
        const m = new TextEncoder().encode(`aula1|${id}|${k}|${r.by}|${r.updated_at}|${r.deleted}|${r.data}`);
        if (!r.cert) assert.ok(await verify(r.by, r.sig, m), 'signature ' + k);
        else { // delegated: the persona signed the app key for this app, the app key signed the record
          assert.ok(await verifyProof({ pk: r.by, ...r.cert }), 'certificate ' + k);
          assert.equal(new URL(r.cert.base).pathname, APP.path);
          assert.ok(await verify(r.cert.challenge.split('.')[1], r.sig, m), 'app key signature ' + k);
        }
        if (!st.records[k] || r.updated_at > st.records[k].updated_at) st.records[k] = r;
      }
      nets.set(id, st);
    },
  };
}
const client = (store, extra = {}) => createApi(store, { storage: null, refreshMs: 0, app: APP, ...extra });
const settle = () => new Promise(r => setTimeout(r, 20)); // lets the background refresh land

/** What Viso does for a sign-in: the persona signs the challenge for the return address. */
async function viso(api, name, persona = crypto.getRandomValues(new Uint8Array(32))) {
  const url = new URL(await api.id.visoUrl(name)), challenge = url.searchParams.get('challenge'), ts = Date.now();
  const p = await keysOf(hex(persona));
  const base = decodeURIComponent(url.searchParams.get('return'));
  const priv = await subtle.importKey('pkcs8', unhex('302e020100300506032b657004220420' + hex(persona)), 'Ed25519', false, ['sign']);
  const proof = hex(new Uint8Array(await subtle.sign('Ed25519', priv, connectMessage(unhex(p.pk), base, challenge, ts))));
  return { url, query: new URLSearchParams({ pk: p.pk, challenge, ts: String(ts), sig: proof }), persona: p.pk };
}

test('class flow with local keys: create, join, post, submit, comment, remove', async () => {
  const store = memoryStore(), T = client(store), S = client(store);
  const tt = await T.id.create('Prof Rossi'), st = await S.id.create('Anna');
  const { id, code } = await T('/classes', 'POST', { name: 'Math', section: '3A' }, tt);
  assert.equal(id, code);
  assert.equal(id.length, 112);
  const hw = (await T(`/classes/${id}/posts`, 'POST', { kind: 'assignment', title: 'Homework 1', body: 'do it', due: '2030-01-01T10:00:00Z', points: 10 }, tt)).id;
  await T(`/classes/${id}/posts`, 'POST', { kind: 'announcement', body: 'Hello class' }, tt);

  await assert.rejects(S('/join', 'POST', { code: 'nope' }, st), /No class/);
  assert.deepEqual(await S('/join', 'POST', { code }, st), { id });
  await S('/join', 'POST', { code }, st); // idempotent

  const view = await S(`/classes/${id}`, 'GET', undefined, st);
  assert.equal(view.role, 'student');
  assert.equal(view.class.code, undefined, 'students do not see the code');
  assert.deepEqual(view.people.map(p => [p.name, p.role]), [['Prof Rossi', 'teacher'], ['Anna', 'student']]);
  assert.equal(view.posts.length, 2);
  assert.equal(view.posts.find(p => p.id === hw).mine, null);

  await assert.rejects(S(`/classes/${id}/posts`, 'POST', { kind: 'announcement', body: 'x' }, st), /Teachers only/);
  await S(`/posts/${hw}/submission`, 'PUT', { text: 'my answer', submit: true }, st);
  await S(`/posts/${hw}/comments`, 'POST', { body: 'is Q2 a typo?' }, st);

  await T(`/posts/${hw}`, 'GET', undefined, tt); // starts the refresh
  await settle();
  const tp = await T(`/posts/${hw}`, 'GET', undefined, tt);
  assert.equal(tp.submissions[0].text, 'my answer');
  assert.equal(tp.submissions[0].student, 'Anna');
  assert.equal(tp.comments[0].author, 'Anna');
  assert.equal((await T('/work', 'GET', undefined, tt))[0].to_return, 1);
  assert.equal((await S('/work', 'GET', undefined, st))[0].submitted_at !== null, true);

  await T(`/comments/${tp.comments[0].id}`, 'DELETE', undefined, tt);
  assert.equal((await T(`/posts/${hw}`, 'GET', undefined, tt)).comments.length, 0);

  await assert.rejects(T(`/submissions/x/grade`, 'PUT', {}, tt), /Freenet/);
  await assert.rejects(T(`/classes/${id}/posts`, 'POST', { kind: 'quiz', title: 'q' }, tt), /Freenet/);

  await T(`/classes/${id}/members/${(await S('/me', 'GET', undefined, st)).id}`, 'DELETE', undefined, tt);
  await assert.rejects(S(`/posts/${hw}/submission`, 'PUT', { text: 'late', submit: true }, st), /Not found/);
});

test('Viso teacher and Viso student: every record carries the delegation', async () => {
  const store = memoryStore(), T = client(store), S = client(store);
  const tv = await viso(T, 'Prof Viso');
  const tt = await T.id.finishViso(tv.query);
  assert.equal((await T('/me', 'GET', undefined, tt)).id, tv.persona, 'the persona is the identity, not the app key');
  const { id, code } = await T('/classes', 'POST', { name: 'Viso class' }, tt);
  assert.equal(id.slice(0, 64), tv.persona);
  const hw = (await T(`/classes/${id}/posts`, 'POST', { kind: 'assignment', title: 'HW' }, tt)).id;

  const sv = await viso(S, 'Anna Viso'), st = await S.id.finishViso(sv.query);
  await S('/join', 'POST', { code }, st);
  await S(`/posts/${hw}/submission`, 'PUT', { text: 'viso answer', submit: true }, st);
  assert.ok(Object.values(store.nets.get(id).records).every(r => r.cert), 'all records are delegated');
  await T(`/posts/${hw}`, 'GET', undefined, tt);
  await settle();
  assert.equal((await T(`/posts/${hw}`, 'GET', undefined, tt)).submissions[0].student, 'Anna Viso');
  assert.equal(await T.id.visoUrl('x') !== '', true);
});

test('a local-key student joins a Viso teacher and the other way round', async () => {
  const store = memoryStore(), T = client(store), S = client(store);
  const tt = await T.id.finishViso((await viso(T, 'Prof')).query);
  const { id, code } = await T('/classes', 'POST', { name: 'Mixed' }, tt);
  const st = await S.id.create('Local Anna');
  await S('/join', 'POST', { code }, st);
  await S(`/classes/${id}`, 'GET', undefined, st);
  const view = await T(`/classes/${id}`, 'GET', undefined, tt);
  await settle();
  assert.deepEqual((await T(`/classes/${id}`, 'GET', undefined, tt)).people.map(p => p.name), ['Prof', 'Local Anna']);
  assert.equal(view.role, 'teacher');
});

test('Viso callback is checked: unknown, replayed, old, forged and denied sign-ins fail', async () => {
  const store = memoryStore(), A = client(store);
  const ok = await viso(A, 'A');
  await assert.rejects(A.id.finishViso(new URLSearchParams({ ...Object.fromEntries(ok.query), challenge: 'wd1.zz.nonce' })), /not the sign-in started here/);
  const again = await viso(A, 'A'); // the failed attempt burned the pending sign-in
  await A.id.finishViso(again.query);
  await assert.rejects(A.id.finishViso(again.query), /No sign-in is in progress/, 'replay');
  const old = await viso(A, 'A');
  old.query.set('ts', String(Date.now() - 3600_000));
  await assert.rejects(A.id.finishViso(old.query), /too old/);
  const forged = await viso(A, 'A');
  forged.query.set('pk', (await keysOf('11'.repeat(32))).pk);
  await assert.rejects(A.id.finishViso(forged.query), /does not verify/);
  await viso(A, 'A');
  await assert.rejects(A.id.finishViso(new URLSearchParams({ viso: 'denied' })), /chose not to share/);
});

test('same key on a new device finds the teacher classes and the name again', async () => {
  const store = memoryStore(), A = client(store);
  const ta = await A.id.create('Prof Rossi');
  await A('/classes', 'POST', { name: 'One' }, ta);
  await A('/classes', 'POST', { name: 'Two' }, ta);
  const B = client(store); // fresh storage: nothing remembered
  const tb = await B.id.import(` ${ta.toUpperCase()}\n`);
  assert.deepEqual((await B('/classes', 'GET', undefined, tb)).map(c => c.name), ['One', 'Two']);
  assert.equal((await B('/me', 'GET', undefined, tb)).name, 'Prof Rossi');
  await assert.rejects(B.id.import('abc'), /64 hexadecimal/);
});

test('log out keeps the key for "continue", forget removes it', async () => {
  const A = client(memoryStore()), t = await A.id.create('Ada');
  assert.equal(A.id.saved(), t);
  await A('/logout', 'POST', {}, t);
  assert.equal(A.id.saved(), null);
  assert.equal(A.id.hasKey(), true);
  assert.equal(await A.id.resume(), t);
  assert.equal((await A('/me', 'GET', undefined, t)).name, 'Ada');
  await A.id.forget();
  assert.equal(A.id.hasKey(), false);
  await assert.rejects(A('/me'), /Unauthorized/);
});

test('sandboxed iframe: no localStorage and no window, the default storage does not throw', async () => {
  const store = memoryStore(), A = client(store);
  const t = await A.id.create('Prof Rossi');
  await A('/classes', 'POST', { name: 'One' }, t);
  const real = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('sandboxed', 'SecurityError'); } });
  try {
    const B = createApi(store, { refreshMs: 0, app: APP }); // default storage must not throw
    assert.equal((await B('/classes', 'GET', undefined, await B.id.import(t))).length, 1);
  } finally { real ? Object.defineProperty(globalThis, 'localStorage', real) : delete globalThis.localStorage; }
});

// what net.ts hands to createApi: the node's store (identity delegate); `map` is the node's memory, so a "reload" is a new createApi on the same map
const fakeKv = (map = new Map(), { failPut = false } = {}) => async () => ({
  get: async k => map.get(k) ?? null,
  put: async (k, v) => { if (failPut) throw new Error('node said no'); map.set(k, v); },
});

test('node-kept store: the key, the session and a pending Viso sign-in survive reloads', async () => {
  const store = memoryStore(), node = new Map(), page = new Map(); // `page` = what the tab could keep (window.name)
  const tab = () => ({ getItem: k => page.get(k) ?? null, setItem: (k, v) => page.set(k, v), removeItem: k => page.delete(k) });
  const open = async () => { const a = client(store, { kv: fakeKv(node), storage: tab() }); await a.ready; return a; };
  const A = await open();
  const sk = await A.id.create('Ada');
  assert.equal(page.has('aula-key'), false, 'the secret is not left in the page');
  const B = await open(); // reload
  assert.equal(B.id.saved(), sk);
  assert.equal((await B('/me', 'GET', undefined, sk)).name, 'Ada');
  // the redirect to Viso loses the page: the pending sign-in has to come back from the node
  const v = await viso(B, 'Ada V');
  const C = await open();
  const token = await C.id.finishViso(v.query);
  assert.equal((await C('/me', 'GET', undefined, token)).id, v.persona);
  const D = await open();
  assert.equal(D.id.saved(), token);
  assert.equal((await D('/me', 'GET', undefined, token)).id, v.persona, 'the delegation is remembered');
  await D.id.forget();
  assert.equal((await open()).id.hasKey(), false);
});

test('node-kept store: a key written before the node answered is moved into it', async () => {
  const node = new Map(), old = new Map([['aula-key', JSON.stringify('ab'.repeat(32))]]);
  const A = client(memoryStore(), { kv: fakeKv(node), storage: { getItem: k => old.get(k) ?? null, setItem: (k, v) => old.set(k, v), removeItem: k => old.delete(k) } });
  await A.ready;
  assert.equal(A.id.saved(), 'ab'.repeat(32));
  assert.equal(JSON.parse(node.get('aula-state'))['aula-key'], JSON.stringify('ab'.repeat(32)));
  assert.equal(old.has('aula-key'), false);
});

test('node-kept store: a node that refuses writes fails loudly, a node without delegate falls back to the tab', async () => {
  const bad = client(memoryStore(), { kv: fakeKv(new Map(), { failPut: true }) });
  await bad.ready;
  await assert.rejects(bad.id.create('Ada'), /Could not save this to the Freenet node \(node said no\)/);
  const late = client(memoryStore(), { kv: async () => ({ get: async () => null, put: async (k, v) => { if (JSON.parse(v)['aula-pending']) throw new Error('full'); } }) }); // only the pending sign-in is refused
  await late.ready;
  await assert.rejects(late.id.visoUrl('Ada'), /Could not save this to the Freenet node/);
  const none = client(memoryStore(), { kv: async () => { throw new Error('no delegate support'); } });
  await none.ready;
  assert.equal(none.id.saved(), null);
  assert.equal(none.id.saved() === null && (await none.id.create('Ada')).length, 64);
});

test('node-kept store: a reload rewrites nothing, a failed read never overwrites the saved key, the first delegate layout is migrated', async () => {
  const store = memoryStore(), node = new Map(); let puts = 0;
  const counted = async () => { const k = await fakeKv(node)(); return { get: k.get, put: (key, v) => { puts++; return k.put(key, v); } }; };
  const A = client(store, { kv: counted }); await A.ready;
  const sk = await A.id.create('Ada');
  await A('/classes', 'POST', { name: 'One' }, sk);
  const before = puts, saved = node.get('aula-state');
  const B = client(store, { kv: counted }); await B.ready;
  assert.equal(await B.id.resume(), sk);
  assert.equal((await B('/classes', 'GET', undefined, sk)).length, 1);
  assert.equal(puts, before, 'resuming a known identity writes nothing');
  assert.equal(node.get('aula-state'), saved);
  // the node does not answer the read: its state must be left alone, the tab takes over
  const C = client(store, { kv: async () => ({ get: async () => { throw new Error('delegate timeout'); }, put: async () => { puts++; } }) });
  await C.ready;
  assert.equal(await C.id.create('Other'), C.id.backup());
  assert.equal(puts, before, 'nothing was written to a node whose state could not be read');
  // the first delegate version kept one entry per key
  const old = new Map([['aula-key', JSON.stringify('cd'.repeat(32))], ['aula-profile', JSON.stringify({ name: 'Old' })]]);
  const D = client(store, { kv: fakeKv(old) }); await D.ready;
  assert.equal(D.id.saved(), 'cd'.repeat(32));
  assert.equal(JSON.parse(old.get('aula-state'))['aula-key'], JSON.stringify('cd'.repeat(32)));
});
