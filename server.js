#!/usr/bin/env node
// Aula: self-hosted Google Classroom alternative. Node >= 22.5, SQLite file, no dependencies.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(HERE, 'web');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const KINDS = ['announcement', 'assignment', 'quiz', 'material'];
const SESSION_DAYS = 30;

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (message, status = 400) => { throw new HttpError(status, message); };
const str = v => (typeof v === 'string' ? v.trim() : '');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(pw, salt, 64).toString('hex');
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const code = n => Array.from({ length: n }, () => ALPHABET[crypto.randomInt(ALPHABET.length)]).join('');
const postTitle = p => p.title || p.body.slice(0, 60);

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

async function readJson(req) {
  let n = 0;
  const chunks = [];
  for await (const c of req) { if ((n += c.length) > 1e6) bad('Body too large', 413); chunks.push(c); }
  try { return JSON.parse(Buffer.concat(chunks).toString() || '{}') ?? {}; } catch { return bad('Invalid JSON'); }
}

// Quiz = array of {q, options[], answer}; one point per question.
function parseQuiz(v) {
  if (!Array.isArray(v) || v.length < 1 || v.length > 50) bad('A quiz needs 1 to 50 questions');
  return v.map(x => {
    const options = Array.isArray(x?.options) ? x.options.map(str) : [];
    if (!str(x?.q) || options.length < 2 || options.length > 8 || options.some(o => !o) || !Number.isInteger(x.answer) || x.answer < 0 || x.answer >= options.length)
      bad('Each question needs text, 2-8 non-empty options and a valid correct answer');
    return { q: str(x.q), options, answer: x.answer };
  });
}

// Validates the fields shared by create and edit.
function postFields(kind, b) {
  const title = str(b.title), body = str(b.body);
  if (kind === 'announcement' ? !body : !title) bad(kind === 'announcement' ? 'Text required' : 'Title required');
  const date = (v, label) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    return isNaN(d) ? bad('Invalid ' + label) : d.toISOString();
  };
  const points = b.points == null || b.points === '' ? null : Number(b.points);
  if (points != null && !(points >= 0)) bad('Invalid points');
  const graded = kind === 'assignment' || kind === 'quiz';
  return {
    title: title || null, body, topic: str(b.topic).slice(0, 60) || null,
    due: graded ? date(b.due, 'due date') : null,
    publish_at: date(b.publish_at, 'publish date'),
    points: kind === 'assignment' ? points : null,
  };
}

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralize spreadsheet formulas in user-chosen names/titles
  return '"' + s.replace(/"/g, '""') + '"';
};

export function createServer({
  data = process.env.AULA_DATA || './data',
  registration = process.env.AULA_REGISTRATION || 'open',
  maxUpload = +process.env.AULA_MAX_UPLOAD || 25e6,
} = {}) {
  const filesDir = path.join(data, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const db = new DatabaseSync(path.join(data, 'aula.db'));
  const q = (sql, ...a) => db.prepare(sql).all(...a);
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const run = (sql, ...a) => db.prepare(sql).run(...a);
  const tx = fn => { db.exec('BEGIN'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };
  const rmFiles = ids => ids.forEach(f => fs.rmSync(path.join(filesDir, f), { force: true }));

  const existing = one("SELECT 1 x FROM sqlite_master WHERE name='users'"), version = one('PRAGMA user_version').user_version;
  if (existing && version < 2) throw new Error(`${data}/aula.db is a 0.1 database; the schema changed, delete it (no migration, 0.1 was never released)`);
  if (existing && version === 2) db.exec('ALTER TABLE users RENAME COLUMN email TO username'); // 0.2 -> 0.3: old emails keep working as usernames at login
  db.exec(`
    PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT NOT NULL, username TEXT NOT NULL UNIQUE, salt TEXT NOT NULL, pw TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS classes(id TEXT PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE, teacher_code TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS members(class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('teacher','student')), PRIMARY KEY(class_id, user_id));
    CREATE TABLE IF NOT EXISTS posts(id TEXT PRIMARY KEY, class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT, body TEXT NOT NULL DEFAULT '', due TEXT, points REAL, topic TEXT, publish_at TEXT, quiz TEXT, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL, text TEXT NOT NULL DEFAULT '', submitted_at TEXT, grade REAL, feedback TEXT, returned INTEGER NOT NULL DEFAULT 0, UNIQUE(post_id, user_id));
    CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY, name TEXT NOT NULL, size INTEGER NOT NULL, user_id TEXT NOT NULL, post_id TEXT REFERENCES posts(id) ON DELETE CASCADE, submission_id TEXT REFERENCES submissions(id) ON DELETE CASCADE);
    CREATE TABLE IF NOT EXISTS comments(id TEXT PRIMARY KEY, post_id TEXT NOT NULL REFERENCES posts(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS private_comments(id TEXT PRIMARY KEY, submission_id TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, body TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS notifications(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL, data TEXT NOT NULL, link TEXT, created_at TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS posts_class ON posts(class_id);
    CREATE INDEX IF NOT EXISTS subs_post ON submissions(post_id);
    CREATE INDEX IF NOT EXISTS notif_user ON notifications(user_id, created_at);
    PRAGMA user_version=3;
  `);

  // role of the user in the class; write=true also refuses archived classes
  function needRole(classId, uid, want, write = false) {
    const r = one('SELECT m.role, c.archived FROM members m JOIN classes c ON c.id=m.class_id WHERE m.class_id=? AND m.user_id=?', classId, uid);
    if (!r) bad('Not found', 404);
    if (want && r.role !== want) bad('Teachers only', 403);
    if (write && r.archived) bad('Class is archived', 409);
    return r.role;
  }
  function postOf(pid, uid, write = false) {
    const p = one('SELECT * FROM posts WHERE id=?', pid);
    if (!p) bad('Not found', 404);
    const role = needRole(p.class_id, uid, undefined, write);
    if (role === 'student' && p.publish_at && p.publish_at > now()) bad('Not found', 404); // still scheduled
    return [p, role];
  }
  const filesOf = (col, v) => q(`SELECT id, name, size FROM files WHERE ${col}=?`, v);
  const mySubmission = (pid, uid) => one('SELECT * FROM submissions WHERE post_id=? AND user_id=?', pid, uid);
  const members = (cid, role) => q('SELECT user_id FROM members WHERE class_id=?' + (role ? ' AND role=?' : ''), ...(role ? [cid, role] : [cid])).map(r => r.user_id);
  // shortcut: notifications are created at post time; a scheduled post notifies nobody when it goes live
  const notify = (uids, kind, data, link) => new Set(uids).forEach(u =>
    run('INSERT INTO notifications(id, user_id, kind, data, link, created_at) VALUES(?,?,?,?,?,?)', id(), u, kind, JSON.stringify(data), link, now()));
  // students never see a grade or feedback before the teacher returns it
  const mask = s => ({ ...s, grade: s.returned ? s.grade : null, feedback: s.returned ? s.feedback : null });
  const getClass = cid => one('SELECT * FROM classes WHERE id=?', cid);
  const classFiles = cid => q('SELECT id FROM files WHERE post_id IN (SELECT id FROM posts WHERE class_id=?) OR submission_id IN (SELECT s.id FROM submissions s JOIN posts p ON p.id=s.post_id WHERE p.class_id=?)', cid, cid).map(f => f.id);

  // shortcut: in-memory login throttle, resets on restart; move to the DB if you run several instances
  const fails = new Map();
  const routes = [];
  const route = (method, p, fn, open = false) => routes.push([method, new RegExp('^' + p.replace(/:\w+/g, '([^/]+)') + '$'), fn, open]);

  const newSession = userId => {
    const token = crypto.randomBytes(32).toString('hex');
    run('INSERT INTO sessions(token, user_id, created_at) VALUES(?,?,?)', sha(token), userId, now());
    return { token };
  };

  // ---------- account ----------
  route('POST', '/api/register', async ({ json }) => {
    if (registration === 'closed') bad('Registration is closed', 403);
    const b = await json(), name = str(b.name), username = str(b.username).toLowerCase();
    if (!name || !/^[a-z0-9._-]{3,32}$/.test(username) || typeof b.password !== 'string' || b.password.length < 8) bad('Name, username (3-32 letters, digits, . _ -) and password (min 8 chars) required');
    const salt = crypto.randomBytes(16).toString('hex'), uid = id();
    try { run('INSERT INTO users(id, name, username, salt, pw) VALUES(?,?,?,?,?)', uid, name, username, salt, hashPw(b.password, salt)); }
    catch { bad('Username already taken', 409); }
    return newSession(uid);
  }, true);

  route('POST', '/api/login', async ({ json }) => {
    const b = await json(), username = str(b.username).toLowerCase();
    const f = fails.get(username);
    if (f && f.n >= 10 && Date.now() - f.t < 9e5) bad('Too many attempts, try again later', 429);
    const u = one('SELECT * FROM users WHERE username=?', username);
    if (!u || typeof b.password !== 'string' || !same(hashPw(b.password, u.salt), u.pw)) {
      const cur = f && Date.now() - f.t < 9e5 ? f : { n: 0, t: Date.now() };
      fails.set(username, { n: cur.n + 1, t: cur.t });
      bad('Invalid username or password', 401);
    }
    fails.delete(username);
    return newSession(u.id);
  }, true);

  route('POST', '/api/logout', ({ tok }) => { run('DELETE FROM sessions WHERE token=?', sha(tok)); });
  route('GET', '/api/me', ({ user }) => ({ id: user.id, name: user.name, username: user.username }));

  route('PUT', '/api/me', async ({ user, json }) => {
    const name = str((await json()).name);
    if (!name) bad('Name required');
    run('UPDATE users SET name=? WHERE id=?', name, user.id);
  });

  route('POST', '/api/password', async ({ user, tok, json }) => {
    const b = await json();
    if (typeof b.old !== 'string' || !same(hashPw(b.old, user.salt), user.pw)) bad('Wrong current password', 403);
    if (typeof b.new !== 'string' || b.new.length < 8) bad('Password must be at least 8 characters');
    const salt = crypto.randomBytes(16).toString('hex');
    run('UPDATE users SET salt=?, pw=? WHERE id=?', salt, hashPw(b.new, salt), user.id);
    run('DELETE FROM sessions WHERE user_id=? AND token<>?', user.id, sha(tok)); // other devices must log in again
  });

  // sets a random password and signs the user out everywhere; returns it so a human can pass it on
  function tempPassword(uid) {
    const pw = code(10), salt = crypto.randomBytes(16).toString('hex');
    run('UPDATE users SET salt=?, pw=? WHERE id=?', salt, hashPw(pw, salt), uid);
    run('DELETE FROM sessions WHERE user_id=?', uid);
    return pw;
  }

  // ---------- notifications ----------
  route('GET', '/api/notifications', ({ user }) => ({
    unread: one('SELECT COUNT(*) n FROM notifications WHERE user_id=? AND read=0', user.id).n,
    items: q('SELECT id, kind, data, link, created_at, read FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50', user.id).map(n => ({ ...n, data: JSON.parse(n.data) })),
  }));
  route('POST', '/api/notifications/read', ({ user }) => { run('UPDATE notifications SET read=1 WHERE user_id=?', user.id); });

  // ---------- classes ----------
  route('GET', '/api/classes', ({ user }) => q(
    'SELECT c.id, c.name, c.archived, m.role FROM classes c JOIN members m ON m.class_id=c.id WHERE m.user_id=? ORDER BY c.archived, c.name', user.id));

  route('POST', '/api/classes', async ({ user, json }) => {
    const name = str((await json()).name);
    if (!name) bad('Class name required');
    for (let i = 0; i < 5; i++) {
      const cid = id(), c = code(6), tc = code(8); // different lengths: a join code can never match both columns
      try {
        tx(() => {
          run('INSERT INTO classes(id, name, code, teacher_code, owner_id) VALUES(?,?,?,?,?)', cid, name, c, tc, user.id);
          run("INSERT INTO members(class_id, user_id, role) VALUES(?,?,'teacher')", cid, user.id);
        });
        return { id: cid, code: c };
      } catch { /* code collision: retry */ }
    }
    return bad('Could not allocate a class code', 500);
  });

  route('POST', '/api/join', async ({ user, json }) => {
    const k = str((await json()).code).toUpperCase();
    const c = one('SELECT id, teacher_code, archived FROM classes WHERE code=? OR teacher_code=?', k, k);
    if (!c) bad('No class with that code', 404);
    if (c.archived) bad('Class is archived', 409);
    if (k === c.teacher_code) run("INSERT INTO members(class_id, user_id, role) VALUES(?,?,'teacher') ON CONFLICT(class_id, user_id) DO UPDATE SET role='teacher'", c.id, user.id);
    else run("INSERT OR IGNORE INTO members(class_id, user_id, role) VALUES(?,?,'student')", c.id, user.id);
    return { id: c.id };
  });

  route('GET', '/api/classes/:id', ({ user, params: [cid] }) => {
    const role = needRole(cid, user.id), c = getClass(cid), teacher = role === 'teacher';
    const cls = { id: c.id, name: c.name, archived: c.archived, owner: c.owner_id === user.id, ...(teacher && { code: c.code, teacher_code: c.teacher_code }) };
    const people = q('SELECT u.id, u.name, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.class_id=? ORDER BY m.role DESC, u.name', cid);
    const posts = q(`SELECT p.id, p.kind, p.title, p.body, p.due, p.points, p.topic, p.publish_at, p.created_at, u.name author,
        (SELECT COUNT(*) FROM comments x WHERE x.post_id=p.id) comments
      FROM posts p JOIN users u ON u.id=p.user_id
      WHERE p.class_id=? AND (? OR p.publish_at IS NULL OR p.publish_at<=?) ORDER BY COALESCE(p.publish_at, p.created_at) DESC`, cid, teacher ? 1 : 0, now())
      .map(p => ({
        ...p,
        files: filesOf('post_id', p.id),
        mine: !teacher && (p.kind === 'assignment' || p.kind === 'quiz')
          ? one('SELECT submitted_at, returned, CASE WHEN returned=1 THEN grade END grade FROM submissions WHERE post_id=? AND user_id=?', p.id, user.id) ?? null : undefined,
      }));
    return { class: cls, role, people, posts };
  });

  route('PATCH', '/api/classes/:id', async ({ user, params: [cid], json }) => {
    needRole(cid, user.id, 'teacher');
    const b = await json(), c = getClass(cid);
    const name = 'name' in b ? str(b.name) : c.name;
    if (!name) bad('Class name required');
    run('UPDATE classes SET name=?, archived=? WHERE id=?', name, 'archived' in b ? (b.archived ? 1 : 0) : c.archived, cid);
  });

  route('DELETE', '/api/classes/:id', ({ user, params: [cid] }) => {
    needRole(cid, user.id, 'teacher');
    if (getClass(cid).owner_id !== user.id) bad('Only the class owner can delete it', 403);
    const ids = classFiles(cid);
    run('DELETE FROM classes WHERE id=?', cid);
    rmFiles(ids);
  });

  // a member leaves, or a teacher removes someone (only the owner can remove another teacher)
  route('DELETE', '/api/classes/:id/members/:uid', ({ user, params: [cid, uid] }) => {
    const role = needRole(cid, user.id), c = getClass(cid);
    const target = one('SELECT role FROM members WHERE class_id=? AND user_id=?', cid, uid);
    if (!target) bad('Not found', 404);
    if (uid === c.owner_id) bad('The owner cannot leave; delete the class instead', 403);
    if (uid !== user.id && (role !== 'teacher' || (target.role === 'teacher' && c.owner_id !== user.id))) bad('Not allowed', 403);
    run('DELETE FROM members WHERE class_id=? AND user_id=?', cid, uid);
  });

  // A teacher can reset a student's password only if the student belongs to no class that teacher
  // does not teach: otherwise one teacher could take over an account that other teachers' classes rely on.
  route('POST', '/api/classes/:id/members/:uid/reset', ({ user, params: [cid, uid] }) => {
    needRole(cid, user.id, 'teacher');
    const target = one('SELECT u.username, m.role FROM members m JOIN users u ON u.id=m.user_id WHERE m.class_id=? AND m.user_id=?', cid, uid);
    if (!target) bad('Not found', 404);
    if (target.role !== 'student' || uid === user.id) bad('Only students can be reset', 403);
    if (one("SELECT 1 x FROM members m WHERE m.user_id=? AND NOT EXISTS (SELECT 1 FROM members t WHERE t.class_id=m.class_id AND t.user_id=? AND t.role='teacher')", uid, user.id))
      bad('This student is also in classes you do not teach', 403);
    return { username: target.username, password: tempPassword(uid) };
  });

  route('GET', '/api/classes/:id/grades', ({ user, params: [cid] }) => {
    needRole(cid, user.id, 'teacher');
    return gradebook(cid);
  });

  route('GET', '/api/classes/:id/grades.csv', ({ user, params: [cid], res }) => {
    needRole(cid, user.id, 'teacher');
    const g = gradebook(cid);
    const lines = [['Student', ...g.posts.map(p => p.points != null ? `${p.title} (${p.points})` : p.title)], ...g.rows.map(r => [r.name, ...r.cells.map(c => !c ? '' : c.grade != null ? c.grade : c.submitted ? 'turned in' : '')])];
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="grades.csv"', 'X-Content-Type-Options': 'nosniff' });
    res.end(lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n');
    return res;
  });

  function gradebook(cid) {
    const posts = q("SELECT id, title, kind, points FROM posts WHERE class_id=? AND kind IN ('assignment','quiz') ORDER BY COALESCE(publish_at, created_at)", cid);
    const subs = new Map(q('SELECT s.post_id, s.user_id, s.submitted_at, s.grade, s.returned FROM submissions s JOIN posts p ON p.id=s.post_id WHERE p.class_id=?', cid).map(s => [s.post_id + s.user_id, s]));
    const rows = q("SELECT u.id, u.name FROM members m JOIN users u ON u.id=m.user_id WHERE m.class_id=? AND m.role='student' ORDER BY u.name", cid).map(st => ({
      id: st.id, name: st.name,
      cells: posts.map(p => { const s = subs.get(p.id + st.id); return s ? { submitted: !!s.submitted_at, grade: s.grade, returned: !!s.returned } : null; }),
    }));
    return { posts, rows };
  }

  // every assignment/quiz across my active classes: feeds the to-do list, the review list and the calendar
  route('GET', '/api/work', ({ user }) => q(`
    SELECT p.id, p.kind, p.title, p.due, p.points, p.class_id, c.name class_name, m.role,
      s.submitted_at, s.returned, CASE WHEN s.returned=1 THEN s.grade END grade,
      (SELECT COUNT(*) FROM submissions x WHERE x.post_id=p.id AND x.submitted_at IS NOT NULL AND x.returned=0) to_return
    FROM posts p JOIN classes c ON c.id=p.class_id
      JOIN members m ON m.class_id=c.id AND m.user_id=?
      LEFT JOIN submissions s ON s.post_id=p.id AND s.user_id=m.user_id
    WHERE c.archived=0 AND p.kind IN ('assignment','quiz') AND (m.role='teacher' OR p.publish_at IS NULL OR p.publish_at<=?)
    ORDER BY p.due IS NULL, p.due`, user.id, now()));

  // ---------- posts ----------
  route('POST', '/api/classes/:id/posts', async ({ user, params: [cid], json }) => {
    needRole(cid, user.id, 'teacher', true);
    const b = await json(), kind = b.kind;
    if (!KINDS.includes(kind)) bad('Invalid post type');
    const f = postFields(kind, b), quiz = kind === 'quiz' ? parseQuiz(b.quiz) : null;
    if (quiz) f.points = quiz.length;
    const pid = id();
    run('INSERT INTO posts(id, class_id, user_id, kind, title, body, due, points, topic, publish_at, quiz, created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
      pid, cid, user.id, kind, f.title, f.body, f.due, f.points, f.topic, f.publish_at, quiz && JSON.stringify(quiz), now());
    if (!f.publish_at || f.publish_at <= now()) notify(members(cid, 'student'), 'post', { class: getClass(cid).name, title: postTitle(f) }, '#/p/' + pid);
    return { id: pid };
  });

  route('PATCH', '/api/posts/:id', async ({ user, params: [pid], json }) => {
    const [p, role] = postOf(pid, user.id, true);
    if (role !== 'teacher') bad('Teachers only', 403);
    const f = postFields(p.kind, { title: p.title, body: p.body, due: p.due, points: p.points, topic: p.topic, publish_at: p.publish_at, ...(await json()) });
    if (p.kind === 'quiz') f.points = p.points; // quiz points = question count, fixed
    run('UPDATE posts SET title=?, body=?, due=?, points=?, topic=?, publish_at=? WHERE id=?', f.title, f.body, f.due, f.points, f.topic, f.publish_at, pid);
  });

  route('DELETE', '/api/posts/:id', ({ user, params: [pid] }) => {
    const [, role] = postOf(pid, user.id, true);
    if (role !== 'teacher') bad('Teachers only', 403);
    const ids = q('SELECT id FROM files WHERE post_id=? OR submission_id IN (SELECT id FROM submissions WHERE post_id=?)', pid, pid).map(f => f.id);
    run('DELETE FROM posts WHERE id=?', pid);
    rmFiles(ids);
  });

  route('GET', '/api/posts/:id', ({ user, params: [pid] }) => {
    const [{ quiz: quizRaw, ...post }, role] = postOf(pid, user.id);
    const quiz = quizRaw ? JSON.parse(quizRaw) : null;
    const comments = q('SELECT c.id, c.body, c.created_at, c.user_id, u.name author FROM comments c JOIN users u ON u.id=c.user_id WHERE c.post_id=? ORDER BY c.created_at', pid);
    const out = { post, role, files: filesOf('post_id', pid), comments };
    const shape = s => ({
      ...s, files: filesOf('submission_id', s.id), answers: quiz && s.text ? JSON.parse(s.text) : undefined,
      private: q('SELECT c.id, c.body, c.created_at, c.user_id, u.name author FROM private_comments c JOIN users u ON u.id=c.user_id WHERE c.submission_id=? ORDER BY c.created_at', s.id),
    });
    if (role === 'teacher') {
      out.quiz = quiz;
      // drafts stay private to the student until turned in, unless the student wrote to the teacher
      out.submissions = q(`SELECT s.*, u.name student FROM submissions s JOIN users u ON u.id=s.user_id WHERE s.post_id=?
        AND (s.submitted_at IS NOT NULL OR EXISTS(SELECT 1 FROM private_comments x WHERE x.submission_id=s.id)) ORDER BY u.name`, pid).map(shape);
    } else {
      const s = mySubmission(pid, user.id);
      out.submission = s ? shape(mask(s)) : null;
      out.quiz = quiz && (s?.submitted_at ? quiz : quiz.map(({ answer, ...rest }) => rest));
    }
    return out;
  });

  // ---------- submissions ----------
  route('PUT', '/api/posts/:id/submission', async ({ user, params: [pid], json }) => {
    const [p, role] = postOf(pid, user.id, true);
    if (p.kind !== 'assignment' || role !== 'student') bad('Only students can submit to assignments', 403);
    const old = mySubmission(pid, user.id);
    if (old?.returned) bad('Already returned', 409);
    const b = await json();
    run('INSERT INTO submissions(id, post_id, user_id, text, submitted_at) VALUES(?,?,?,?,?) ON CONFLICT(post_id, user_id) DO UPDATE SET text=excluded.text, submitted_at=excluded.submitted_at',
      id(), pid, user.id, str(b.text), b.submit ? now() : null);
    if (b.submit && !old?.submitted_at) notify(members(p.class_id, 'teacher'), 'submitted', { student: user.name, title: postTitle(p) }, '#/p/' + pid);
  });

  route('POST', '/api/posts/:id/quiz', async ({ user, params: [pid], json }) => {
    const [p, role] = postOf(pid, user.id, true);
    if (p.kind !== 'quiz' || role !== 'student') bad('Only students can take a quiz', 403);
    if (mySubmission(pid, user.id)?.submitted_at) bad('Already submitted', 409);
    const quiz = JSON.parse(p.quiz), a = (await json()).answers;
    if (!Array.isArray(a) || a.length !== quiz.length || a.some((x, i) => x !== null && !(Number.isInteger(x) && x >= 0 && x < quiz[i].options.length))) bad('Invalid answers');
    const score = a.reduce((n, x, i) => n + (x === quiz[i].answer), 0);
    run('INSERT INTO submissions(id, post_id, user_id, text, submitted_at, grade, returned) VALUES(?,?,?,?,?,?,1) ON CONFLICT(post_id, user_id) DO UPDATE SET text=excluded.text, submitted_at=excluded.submitted_at, grade=excluded.grade, returned=1',
      id(), pid, user.id, JSON.stringify(a), now(), score);
    notify(members(p.class_id, 'teacher'), 'submitted', { student: user.name, title: postTitle(p) }, '#/p/' + pid);
    return { score, total: quiz.length };
  });

  route('PUT', '/api/submissions/:id/grade', async ({ user, params: [sid], json }) => {
    const s = one('SELECT s.user_id, s.post_id, p.class_id, p.points, p.title, p.body FROM submissions s JOIN posts p ON p.id=s.post_id WHERE s.id=?', sid);
    if (!s) bad('Not found', 404);
    needRole(s.class_id, user.id, 'teacher', true);
    const b = await json(), grade = b.grade == null || b.grade === '' ? null : Number(b.grade);
    if (grade !== null && !(grade >= 0 && (s.points == null || grade <= s.points))) bad('Invalid grade');
    const ret = b.return ? 1 : 0;
    run('UPDATE submissions SET grade=?, feedback=?, returned=? WHERE id=?', grade, str(b.feedback) || null, ret, sid);
    if (ret) notify([s.user_id], 'returned', { title: postTitle(s) }, '#/p/' + s.post_id);
  });

  route('POST', '/api/posts/:id/return', ({ user, params: [pid] }) => {
    const [p, role] = postOf(pid, user.id, true);
    if (role !== 'teacher') bad('Teachers only', 403);
    const rows = q('SELECT user_id FROM submissions WHERE post_id=? AND submitted_at IS NOT NULL AND grade IS NOT NULL AND returned=0', pid);
    run('UPDATE submissions SET returned=1 WHERE post_id=? AND submitted_at IS NOT NULL AND grade IS NOT NULL AND returned=0', pid);
    notify(rows.map(r => r.user_id), 'returned', { title: postTitle(p) }, '#/p/' + pid);
    return { returned: rows.length };
  });

  // ---------- comments ----------
  route('POST', '/api/posts/:id/comments', async ({ user, params: [pid], json }) => {
    const [p] = postOf(pid, user.id, true), body = str((await json()).body);
    if (!body) bad('Text required');
    run('INSERT INTO comments(id, post_id, user_id, body, created_at) VALUES(?,?,?,?,?)', id(), pid, user.id, body.slice(0, 5000), now());
    if (p.user_id !== user.id) notify([p.user_id], 'comment', { user: user.name, title: postTitle(p) }, '#/p/' + pid);
  });

  route('DELETE', '/api/comments/:id', ({ user, params: [cmid] }) => {
    const c = one('SELECT c.user_id, p.class_id FROM comments c JOIN posts p ON p.id=c.post_id WHERE c.id=?', cmid);
    if (!c) bad('Not found', 404);
    const role = needRole(c.class_id, user.id, undefined, true);
    if (c.user_id !== user.id && role !== 'teacher') bad('Not allowed', 403);
    run('DELETE FROM comments WHERE id=?', cmid);
  });

  // private thread between one student and the teachers, on that student's submission
  route('POST', '/api/posts/:id/private', async ({ user, params: [pid], json }) => {
    const [p, role] = postOf(pid, user.id, true), b = await json(), body = str(b.body);
    if (p.kind !== 'assignment') bad('Not an assignment', 403);
    if (!body) bad('Text required');
    let s;
    if (role === 'student') {
      run('INSERT OR IGNORE INTO submissions(id, post_id, user_id) VALUES(?,?,?)', id(), pid, user.id);
      s = mySubmission(pid, user.id);
    } else {
      s = one('SELECT * FROM submissions WHERE id=? AND post_id=?', b.submission, pid);
      if (!s) bad('Not found', 404);
    }
    run('INSERT INTO private_comments(id, submission_id, user_id, body, created_at) VALUES(?,?,?,?,?)', id(), s.id, user.id, body.slice(0, 5000), now());
    notify(role === 'student' ? members(p.class_id, 'teacher') : [s.user_id], 'private', { user: user.name, title: postTitle(p) }, '#/p/' + pid);
  });

  // ---------- files ----------
  // Upload = raw request body. Teacher: attaches to the post. Student: attaches to their own submission.
  route('POST', '/api/files', async ({ user, url, req }) => {
    const name = str(url.searchParams.get('name')).slice(0, 200) || 'file';
    const [p, role] = postOf(url.searchParams.get('post'), user.id, true);
    if (Number(req.headers['content-length']) > maxUpload) bad('File too large', 413);
    let sid = null;
    if (role === 'student') {
      if (p.kind !== 'assignment') bad('Not an assignment', 403);
      const s = mySubmission(p.id, user.id);
      if (s?.returned) bad('Already returned', 409);
      sid = s?.id ?? id();
      if (!s) run('INSERT INTO submissions(id, post_id, user_id) VALUES(?,?,?)', sid, p.id, user.id);
    }
    const fid = id(), dest = path.join(filesDir, fid);
    let size = 0;
    try {
      await pipeline(req, async function* (src) {
        for await (const c of src) { if ((size += c.length) > maxUpload) bad('File too large', 413); yield c; }
      }, fs.createWriteStream(dest));
    } catch (e) { fs.rmSync(dest, { force: true }); throw e; }
    run('INSERT INTO files(id, name, size, user_id, post_id, submission_id) VALUES(?,?,?,?,?,?)', fid, name, size, user.id, sid ? null : p.id, sid);
    return { id: fid, name, size };
  });

  const fileAccess = (fid, uid, write) => {
    const f = one('SELECT f.*, s.user_id sub_user, s.post_id sub_post FROM files f LEFT JOIN submissions s ON s.id=f.submission_id WHERE f.id=?', fid);
    if (!f) bad('Not found', 404);
    const [, role] = postOf(f.post_id || f.sub_post, uid, write);
    if (f.submission_id && role === 'student' && f.sub_user !== uid) bad('Not found', 404);
    return f;
  };

  route('GET', '/api/files/:id', ({ user, params: [fid], res }) => {
    const f = fileAccess(fid, user.id);
    // octet-stream + attachment: an uploaded .html can never run in our origin
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': f.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name).replace(/'/g, '%27')}`,
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(path.join(filesDir, f.id)).pipe(res);
    return res;
  });

  route('DELETE', '/api/files/:id', ({ user, params: [fid] }) => {
    const f = fileAccess(fid, user.id, true);
    if (f.user_id !== user.id) bad('Not your file', 403);
    if (f.submission_id && one('SELECT returned FROM submissions WHERE id=?', f.submission_id).returned) bad('Already returned', 409);
    run('DELETE FROM files WHERE id=?', fid);
    rmFiles([fid]);
  });

  function serveStatic(pathname, res) {
    const f = path.join(WEB, pathname === '/' ? 'index.html' : pathname);
    if (!f.startsWith(WEB + path.sep) || !MIME[path.extname(f)] || !fs.existsSync(f)) bad('Not found', 404);
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(f)],
      'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'",
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(fs.readFileSync(f));
  }

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      if (!url.pathname.startsWith('/api/')) return serveStatic(url.pathname, res);
      for (const [method, re, fn, open] of routes) {
        const m = method === req.method && re.exec(url.pathname);
        if (!m) continue;
        const tok = (req.headers.authorization || '').replace(/^Bearer /, '');
        const user = tok ? one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.created_at>?', sha(tok), new Date(Date.now() - SESSION_DAYS * 864e5).toISOString()) : undefined;
        if (!user && !open) bad('Login required', 401);
        const out = await fn({ user, tok, url, req, res, params: m.slice(1).map(decodeURIComponent), json: () => readJson(req) });
        return out === res ? undefined : sendJson(res, 200, out ?? { ok: true });
      }
      bad('Not found', 404);
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
      if (!res.headersSent) sendJson(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
      else res.destroy();
    }
  });
  // for the operator: `node server.js reset-password <username>` (also the only way to recover a teacher)
  server.resetPassword = username => {
    const u = one('SELECT id FROM users WHERE username=?', str(username).toLowerCase());
    return u ? tempPassword(u.id) : null;
  };
  return server;
}

if (fs.realpathSync(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  const port = +process.env.PORT || 8788, host = process.env.HOST || '127.0.0.1', server = createServer();
  if (process.argv[2] === 'reset-password') {
    const pw = server.resetPassword(process.argv[3]);
    console.log(pw ? `New password for ${process.argv[3]}: ${pw}` : `No user named ${process.argv[3]}`);
    process.exit(pw ? 0 : 1);
  }
  server.listen(port, host, () => console.log(`Aula on http://${host}:${port}`));
}
