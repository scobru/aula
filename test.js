import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from './server.js';

const data = fs.mkdtempSync(path.join(os.tmpdir(), 'aula-'));
const server = createServer({ data, maxUpload: 1000 });
let base;
after(() => { server.close(); fs.rmSync(data, { recursive: true, force: true }); });

const call = async (token, method, url, body, raw) => {
  const r = await fetch(base + url, {
    method,
    headers: { ...(token && { Authorization: 'Bearer ' + token }), ...(body && !raw && { 'Content-Type': 'application/json' }) },
    body: raw ? body : body && JSON.stringify(body),
  });
  const type = r.headers.get('content-type') || '';
  return { status: r.status, body: type.includes('json') ? await r.json() : Buffer.from(await r.arrayBuffer()), type };
};
const signup = async name => (await call(null, 'POST', '/api/register', { name, username: name.replace(/\W/g, ''), password: 'password1' })).body.token;
const ok = async (p, status = 200) => { const r = await p; assert.equal(r.status, status, JSON.stringify(r.body)); return r.body; };

let teacher, ann, bob, cid, codes;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', () => { base = `http://127.0.0.1:${server.address().port}`; r(); }));
  [teacher, ann, bob] = [await signup('teacher'), await signup('ann'), await signup('bob')];
  const c = await ok(call(teacher, 'POST', '/api/classes', { name: 'Math' }));
  cid = c.id;
  codes = (await ok(call(teacher, 'GET', `/api/classes/${cid}`))).class;
  await ok(call(ann, 'POST', '/api/join', { code: codes.code.toLowerCase() }));
  await ok(call(bob, 'POST', '/api/join', { code: codes.code }));
});

test('auth: unauthenticated, wrong password, logout, password change', async () => {
  await ok(call(null, 'GET', '/api/classes'), 401);
  await ok(call(null, 'POST', '/api/login', { username: 'ann', password: 'nope' }), 401);
  const t = (await ok(call(null, 'POST', '/api/login', { username: 'bob', password: 'password1' }))).token;
  await ok(call(t, 'POST', '/api/logout'));
  await ok(call(t, 'GET', '/api/me'), 401);
  const c = await signup('carl'), c2 = (await ok(call(null, 'POST', '/api/login', { username: 'carl', password: 'password1' }))).token;
  await ok(call(c, 'POST', '/api/password', { old: 'wrongwrong', new: 'password2' }), 403);
  await ok(call(c, 'POST', '/api/password', { old: 'password1', new: 'password2' }));
  await ok(call(c2, 'GET', '/api/me'), 401); // other sessions die
  await ok(call(c, 'GET', '/api/me'));
  await ok(call(c, 'PUT', '/api/me', { name: 'Carlo' }));
  assert.equal((await call(c, 'GET', '/api/me')).body.name, 'Carlo');
});

test('usernames: validated, unique, case-insensitive', async () => {
  const reg = username => call(null, 'POST', '/api/register', { name: 'X', username, password: 'password1' });
  await ok(reg('no'), 400); await ok(reg('has space'), 400); await ok(reg('bad@mail.com'), 400);
  await ok(reg('Zed_1')); await ok(reg('zed_1'), 409);
  await ok(call(null, 'POST', '/api/login', { username: 'ZED_1', password: 'password1' }));
});

test('membership: codes, roles, co-teacher, leave/remove, owner rules', async () => {
  const dana = await signup('dana'), eve = await signup('eve');
  await ok(call(dana, 'GET', `/api/classes/${cid}`), 404);
  assert.equal((await ok(call(ann, 'GET', `/api/classes/${cid}`))).class.code, undefined);
  await ok(call(dana, 'POST', '/api/join', { code: codes.teacher_code }));
  assert.equal((await ok(call(dana, 'GET', `/api/classes/${cid}`))).role, 'teacher');
  await ok(call(eve, 'POST', '/api/join', { code: codes.code }));
  const people = (await ok(call(teacher, 'GET', `/api/classes/${cid}`))).people;
  const eveId = people.find(p => p.name === 'eve').id, danaId = people.find(p => p.name === 'dana').id, teacherId = people.find(p => p.name === 'teacher').id;
  await ok(call(eve, 'DELETE', `/api/classes/${cid}/members/${danaId}`), 403);
  await ok(call(dana, 'DELETE', `/api/classes/${cid}/members/${teacherId}`), 403, 'owner stays');
  await ok(call(dana, 'DELETE', `/api/classes/${cid}/members/${eveId}`)); // co-teacher removes student
  await ok(call(eve, 'GET', `/api/classes/${cid}`), 404);
  await ok(call(dana, 'DELETE', `/api/classes/${cid}/members/${danaId}`)); // leaves
  await ok(call(dana, 'DELETE', `/api/classes/${cid}`), 404);
});

test('assignment flow: attachments, private comments, grade hidden until returned', async () => {
  await ok(call(ann, 'POST', `/api/classes/${cid}/posts`, { kind: 'announcement', body: 'hi' }), 403);
  const { id: pid } = await ok(call(teacher, 'POST', `/api/classes/${cid}/posts`, { kind: 'assignment', title: 'HW1', body: 'solve', points: 10, topic: 'Algebra' }));
  assert.equal((await ok(call(ann, 'GET', '/api/notifications'))).items.some(n => n.kind === 'post'), true);
  await ok(call(teacher, 'POST', `/api/files?post=${pid}&name=sheet.txt`, 'sheet', true));

  const up = await ok(call(ann, 'POST', `/api/files?post=${pid}&name=my%20work.txt`, 'answer', true));
  await ok(call(ann, 'POST', `/api/files?post=${pid}&name=big`, 'x'.repeat(1001), true), 413);
  await ok(call(ann, 'POST', `/api/posts/${pid}/private`, { body: 'is this right?' }));
  await ok(call(ann, 'PUT', `/api/posts/${pid}/submission`, { text: 'my answer', submit: true }));

  const t = await ok(call(teacher, 'GET', `/api/posts/${pid}`));
  assert.equal(t.submissions.length, 1);
  assert.equal(t.submissions[0].private[0].body, 'is this right?');
  assert.equal((await call(teacher, 'GET', `/api/files/${up.id}`)).body.toString(), 'answer');
  await ok(call(bob, 'GET', `/api/files/${up.id}`), 404);
  assert.equal((await ok(call(bob, 'GET', `/api/posts/${pid}`))).submission, null);

  const sid = t.submissions[0].id;
  await ok(call(teacher, 'POST', `/api/posts/${pid}/private`, { body: 'yes', submission: sid }));
  await ok(call(teacher, 'PUT', `/api/submissions/${sid}/grade`, { grade: 11 }), 400);
  await ok(call(ann, 'PUT', `/api/submissions/${sid}/grade`, { grade: 10 }), 403);
  await ok(call(teacher, 'PUT', `/api/submissions/${sid}/grade`, { grade: 9, feedback: 'good' })); // draft grade
  let mine = (await ok(call(ann, 'GET', `/api/posts/${pid}`))).submission;
  assert.deepEqual([mine.grade, mine.feedback], [null, null], 'hidden before return');
  await ok(call(ann, 'PUT', `/api/posts/${pid}/submission`, { text: 'edit', submit: true })); // still editable
  assert.equal((await ok(call(teacher, 'POST', `/api/posts/${pid}/return`))).returned, 1);
  mine = (await ok(call(ann, 'GET', `/api/posts/${pid}`))).submission;
  assert.deepEqual([mine.grade, mine.feedback], [9, 'good']);
  await ok(call(ann, 'PUT', `/api/posts/${pid}/submission`, { text: 'edit', submit: true }), 409);

  const book = await ok(call(teacher, 'GET', `/api/classes/${cid}/grades`));
  assert.equal(book.rows.find(r => r.name === 'ann').cells[0].grade, 9);
  const work = await ok(call(ann, 'GET', '/api/work'));
  assert.equal(work.find(w => w.id === pid).grade, 9);

  await ok(call(teacher, 'PATCH', `/api/posts/${pid}`, { title: 'HW1 (v2)', topic: 'Calculus' }));
  assert.equal((await ok(call(ann, 'GET', `/api/posts/${pid}`))).post.topic, 'Calculus');
  await ok(call(teacher, 'DELETE', `/api/posts/${pid}`));
  assert.deepEqual(fs.readdirSync(path.join(data, 'files')), [], 'files removed from disk');
});

test('quiz: auto-graded, answers hidden until submitted, single attempt', async () => {
  const quiz = [{ q: '2+2', options: ['3', '4'], answer: 1 }, { q: '3+3', options: ['6', '7', '8'], answer: 0 }];
  await ok(call(teacher, 'POST', `/api/classes/${cid}/posts`, { kind: 'quiz', title: 'Q1', quiz: [{ q: 'x', options: ['a'], answer: 0 }] }), 400);
  const { id: pid } = await ok(call(teacher, 'POST', `/api/classes/${cid}/posts`, { kind: 'quiz', title: 'Q1', quiz }));
  const before = await ok(call(ann, 'GET', `/api/posts/${pid}`));
  assert.equal(before.quiz.some(x => 'answer' in x), false, 'no answer key before submitting');
  await ok(call(ann, 'POST', `/api/posts/${pid}/quiz`, { answers: [1] }), 400);
  assert.deepEqual(await ok(call(ann, 'POST', `/api/posts/${pid}/quiz`, { answers: [1, 2] })), { score: 1, total: 2 });
  await ok(call(ann, 'POST', `/api/posts/${pid}/quiz`, { answers: [1, 0] }), 409);
  const after = await ok(call(ann, 'GET', `/api/posts/${pid}`));
  assert.equal(after.submission.grade, 1);
  assert.equal(after.quiz[0].answer, 1);
});

test('scheduled posts are hidden from students; comments; archive makes class read-only', async () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  const { id: pid } = await ok(call(teacher, 'POST', `/api/classes/${cid}/posts`, { kind: 'material', title: 'Later', publish_at: future }));
  await ok(call(ann, 'GET', `/api/posts/${pid}`), 404);
  assert.equal((await ok(call(ann, 'GET', `/api/classes/${cid}`))).posts.some(p => p.id === pid), false);
  assert.equal((await ok(call(teacher, 'GET', `/api/classes/${cid}`))).posts.some(p => p.id === pid), true);
  await ok(call(teacher, 'PATCH', `/api/posts/${pid}`, { publish_at: null }));
  await ok(call(ann, 'POST', `/api/posts/${pid}/comments`, { body: 'thanks' }));
  const view = await ok(call(ann, 'GET', `/api/posts/${pid}`));
  assert.equal(view.comments.length, 1);
  await ok(call(bob, 'DELETE', `/api/comments/${view.comments[0].id}`), 403);
  assert.equal((await ok(call(teacher, 'GET', '/api/notifications'))).items.some(n => n.kind === 'comment'), true, 'post author is notified');
});

test('archive and delete class', async () => {
  const { id } = await ok(call(teacher, 'POST', '/api/classes', { name: 'Old' }));
  const { class: c } = await ok(call(teacher, 'GET', `/api/classes/${id}`));
  await ok(call(ann, 'POST', '/api/join', { code: c.code }));
  await ok(call(teacher, 'PATCH', `/api/classes/${id}`, { archived: true }));
  await ok(call(teacher, 'POST', `/api/classes/${id}/posts`, { kind: 'announcement', body: 'x' }), 409);
  await ok(call(bob, 'POST', '/api/join', { code: c.code }), 409);
  await ok(call(ann, 'DELETE', `/api/classes/${id}`), 403);
  await ok(call(teacher, 'PATCH', `/api/classes/${id}`, { archived: false }));
  await ok(call(teacher, 'DELETE', `/api/classes/${id}`));
  await ok(call(ann, 'GET', `/api/classes/${id}`), 404);
});

test('grades csv neutralizes formulas', async () => {
  const f = await signup('=cmd');
  await ok(call(f, 'POST', '/api/join', { code: codes.code }));
  const r = await call(teacher, 'GET', `/api/classes/${cid}/grades.csv`);
  assert.match(r.type, /text\/csv/);
  assert.match(r.body.toString(), /"'=cmd"/);
});

test('static files and path traversal', async () => {
  assert.equal((await call(null, 'GET', '/')).status, 200);
  assert.equal((await call(null, 'GET', '/../server.js')).status, 404);
});

test('0.2 database (email column) migrates; old email still logs in as username', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aula-mig-'));
  const old = new DatabaseSync(path.join(dir, 'aula.db'));
  const salt = 'ab'.repeat(16);
  old.exec(`CREATE TABLE users(id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, pw TEXT NOT NULL); PRAGMA user_version=2;`);
  old.prepare('INSERT INTO users VALUES(?,?,?,?,?)').run('u1', 'Old', 'old@x.org', salt, crypto.scryptSync('password1', salt, 64).toString('hex'));
  old.close();
  const s = createServer({ data: dir });
  await new Promise(r => s.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${s.address().port}/api/login`, { method: 'POST', body: JSON.stringify({ username: 'old@x.org', password: 'password1' }) });
  assert.equal(r.status, 200);
  s.close(); fs.rmSync(dir, { recursive: true, force: true });
});
