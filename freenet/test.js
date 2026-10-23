// Adapter tests against an in-memory store. Contract rules are tested in contract/ (cargo test); signatures are verified here as the contract would.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, seedFor } from './api.js';

const unhex = h => Uint8Array.from(h.match(/../g), b => parseInt(b, 16));

function memoryStore() {
  const nets = new Map();
  return {
    nets,
    async get(id) { return nets.has(id) ? structuredClone(nets.get(id)) : null; },
    async push(id, delta, exists) {
      assert.equal(exists, nets.has(id), 'exists flag must match the network');
      const st = nets.get(id) ?? { records: {} };
      for (const [k, r] of Object.entries(delta.records)) {
        const pub = await crypto.subtle.importKey('raw', unhex(r.by), 'Ed25519', false, ['verify']);
        const m = `aula1|${id}|${k}|${r.by}|${r.updated_at}|${r.deleted}|${r.data}`;
        assert.ok(await crypto.subtle.verify('Ed25519', pub, unhex(r.sig), new TextEncoder().encode(m)), 'signature ' + k);
        if (!st.records[k] || r.updated_at > st.records[k].updated_at) st.records[k] = r;
      }
      nets.set(id, st);
    },
  };
}
const client = store => createApi(store, { storage: null, refreshMs: 0 });
const settle = () => new Promise(r => setTimeout(r, 20)); // lets the background refresh land
const login = async (api, username, name) => (await api('/register', 'POST', { username, name, password: 'correct horse' })).token;

test('class flow: create, join, post, submit, comment, remove', async () => {
  const store = memoryStore(), T = client(store), S = client(store);
  const tt = await login(T, 'prof', 'Prof Rossi'), st = await login(S, 'anna', 'Anna');
  const { id, code } = await T('/classes', 'POST', { name: 'Math', section: '3A' }, tt);
  assert.equal(id, code);
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

test('same username and password on a new device finds the teacher classes again', async () => {
  const store = memoryStore(), A = client(store);
  const ta = await login(A, 'prof', 'Prof');
  await A('/classes', 'POST', { name: 'One' }, ta);
  await A('/classes', 'POST', { name: 'Two' }, ta);
  const B = client(store); // fresh storage: nothing remembered
  await B('/login', 'POST', { username: 'PROF', password: 'correct horse' });
  assert.deepEqual((await B('/classes')).map(c => c.name), ['One', 'Two']);
  await assert.rejects(B('/login', 'POST', { username: 'prof', password: 'short' }), /8 characters/);
});

test('username is case-insensitive, password is not', async () => {
  assert.equal(await seedFor('prof', 'correct horse'), await seedFor('Prof', 'correct horse'));
  assert.notEqual(await seedFor('prof', 'correct horse'), await seedFor('prof', 'correct horsf'));
});
