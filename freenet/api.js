// Aula on Freenet: the server's JSON API (`api(url, method, body, token)`), answered from signed records in one contract per class.
// Identity = a local Ed25519 key (one click, backed up by the user), or a Viso (whoiam) persona that delegates a disposable key of this device.
// `store` is { get(id) -> state | null, push(id, delta, exists) } (net.ts on Freenet, a Map in tests). See contract/src/lib.rs for the rules.
import { hex, unhex, newSecret, isSecret, sha256, keysOf, appTag, verifyProof } from './identity.js';

const enc = new TextEncoder();
const NA = 'Not available on Freenet yet';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const str = v => (typeof v === 'string' ? v.trim() : '');
const msg = (id, key, r) => `aula1|${id}|${key}|${r.by}|${r.updated_at}|${r.deleted}|${r.data}`; // must match record_msg in the contract
const J = r => { try { return JSON.parse(r.data); } catch { return {}; } };
const rid = () => hex(crypto.getRandomValues(new Uint8Array(8)));
const VISO_KEY = 'GzHy3jnEtj26EoGqMsBpoawcY378hK9kp91rTcNYiAac'; // the official Viso web contract
const PROOF_MAX_AGE_MS = 10 * 60 * 1000;

// same checks as the server's postFields; duplicated because server.js cannot run in a browser
function postFields(kind, b) {
  const title = str(b.title), body = str(b.body);
  if (kind === 'announcement' ? !body : !title) fail(kind === 'announcement' ? 'Text required' : 'Title required');
  const date = (v, label) => {
    if (v == null || v === '') return null;
    const d = new Date(v);
    return isNaN(d) ? fail('Invalid ' + label) : d.toISOString();
  };
  const points = b.points == null || b.points === '' ? null : Number(b.points);
  if (points != null && !(points >= 0)) fail('Invalid points');
  return {
    title: title || null, body: body.slice(0, 20000), topic: str(b.topic).slice(0, 60) || null,
    due: kind === 'assignment' ? date(b.due, 'due date') : null, publish_at: date(b.publish_at, 'publish date'),
    points: kind === 'assignment' ? points : null,
  };
}

// Where the device key and session are kept. A sandboxed iframe (Freenet web contracts) throws on merely reading localStorage: there they
// go to window.name, which survives reloads (and the Viso round trip) but is readable by pages this tab visits later; log out and "forget" clear it.
// shortcut: window.name for the secret; the proper home is a Freenet identity delegate (what FreeNames uses).
function browserStorage() {
  try { localStorage.getItem('aula-probe'); return localStorage; } catch { /* sandboxed */ }
  if (typeof window === 'undefined') return null;
  const read = () => { try { const j = JSON.parse(window.name); return j?.__aula__ ? j.data : {}; } catch { return {}; } };
  const write = d => { window.name = JSON.stringify({ __aula__: true, data: d }); };
  return { getItem: k => read()[k] ?? null, setItem: (k, v) => write({ ...read(), [k]: v }), removeItem: k => { const d = read(); delete d[k]; write(d); } };
}

export function createApi(store, { storage = browserStorage(), onChange = () => {}, refreshMs = 5000, app, viso = VISO_KEY } = {}) {
  const mem = new Map();
  const disk = storage ?? { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const get = (k, d) => { try { return JSON.parse(disk.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => { try { disk.setItem(k, JSON.stringify(v)); } catch {} };
  const del = k => { try { disk.removeItem(k); } catch {} };
  const cache = new Map(), checked = new Map();
  let S = null; // { sk, dev, pk, cert, tag, name, index }

  // the app's own address: delegations and class addresses are bound to its path
  const where = () => app ?? { origin: `${location.protocol}//${location.host}`, path: location.pathname.replace(/[^/]*$/, '') };
  const base = () => where().origin + where().path;

  async function start(sk) {
    if (!isSecret(sk)) fail('Unauthorized', 401);
    const dev = await keysOf(sk), session = get('aula-session', null);
    if (session && session.cert.challenge.split('.')[1] !== dev.pk) fail('Unauthorized', 401); // the device key changed: sign in again
    const pk = session ? session.persona : dev.pk, idx = `aula-classes-${pk}`, name = get('aula-profile', {}).name;
    S = { sk, dev, pk, cert: session?.cert ?? null, tag: await appTag(where().path), name: name || pk.slice(0, 8), index: get(idx, []), save() { set(idx, this.index); } };
    // a teacher's classes have derived addresses, so a new device with the same key finds them again; students rejoin with the code
    for (let i = 0; ; i++) {
      const id = await classId(i);
      if (!(S.index.includes(id) || await load(id))) break;
      if (!S.index.includes(id)) S.index.push(id);
    }
    // a new device has no saved name: take the one already published in the classes
    if (!name) for (const id of S.index) {
      const st = cache.get(id), mine = id.slice(0, 64) === S.pk ? J(st?.records['meta:class'] ?? { data: '{}' }).owner : J(st?.records['member:' + S.pk] ?? { data: '{}' }).name;
      if (mine) { S.name = mine; break; }
    }
    S.save();
    set('aula-profile', { name: S.name });
  }
  const classId = async i => S.pk + hex((await sha256(unhex(S.sk), enc.encode('class'), enc.encode(String(i)))).slice(0, 16)) + S.tag;

  // what the sign-in screen drives; the secret returned is the token the UI keeps
  async function begin(sk, session, name) {
    S = null;
    cache.clear();
    set('aula-key', sk);
    session ? set('aula-session', session) : del('aula-session');
    if (str(name)) set('aula-profile', { name: str(name).slice(0, 100) });
    del('aula-locked');
    await start(sk);
    return sk;
  }
  const identity = {
    /** The device key kept in this browser, unless the user logged out. */
    saved: () => (get('aula-locked', false) ? null : get('aula-key', null)),
    /** Whether there is a key to continue with (after a log out). */
    hasKey: () => !!get('aula-key', null),
    resume: () => begin(get('aula-key', ''), get('aula-session', null), ''),
    create: name => begin(newSecret(), null, name),
    async import(secret, name) {
      const sk = str(secret).replace(/\s/g, '').toLowerCase();
      if (!isSecret(sk)) fail('The key must be 64 hexadecimal characters.');
      return begin(sk, null, name);
    },
    /** The address to send the user to; Viso comes back to this page with ?pk=&challenge=&ts=&sig=. */
    async visoUrl(name) {
      const sk = newSecret(), challenge = `wd1.${(await keysOf(sk)).pk}.${newSecret().slice(0, 32)}`;
      set('aula-pending', { sk, challenge, name: str(name).slice(0, 100) });
      return `${where().origin}/v1/contract/web/${viso}/?connect=v1&challenge=${challenge}&return=${encodeURIComponent(base())}`;
    },
    /** Viso's callback: check it is the sign-in we started, fresh, and signed by the persona; then keep the delegation. */
    async finishViso(q) {
      if (q.get('viso') === 'denied' || q.get('whoiam') === 'denied') fail('You chose not to share a persona.');
      const pending = get('aula-pending', null);
      del('aula-pending'); // one use, whatever happens next
      const proof = { pk: q.get('pk') ?? '', challenge: q.get('challenge') ?? '', ts: Number(q.get('ts')), sig: q.get('sig') ?? '', base: base() };
      if (!pending || proof.challenge !== pending.challenge) fail('This sign-in is unknown or was already used. Start again.');
      if (!Number.isFinite(proof.ts) || Math.abs(Date.now() - proof.ts) > PROOF_MAX_AGE_MS) fail('The proof is too old or the clock is off. Start again.');
      if (!(await verifyProof(proof))) fail('The Viso signature does not verify.');
      const { pk, ...cert } = proof;
      return begin(pending.sk, { persona: pk, cert }, pending.name);
    },
    backup: () => get('aula-key', null),
    forget() { S = null; cache.clear(); ['aula-key', 'aula-session', 'aula-profile', 'aula-pending', 'aula-locked'].forEach(del); },
  };

  const newer = (a, b) => a.updated_at > b.updated_at || (a.updated_at === b.updated_at && a.sig > b.sig);
  function absorb(id, st) {
    const cur = cache.get(id) ?? { records: {} };
    let changed = !cache.has(id);
    for (const [k, r] of Object.entries(st.records ?? {})) if (!cur.records[k] || newer(r, cur.records[k])) { cur.records[k] = r; changed = true; }
    cache.set(id, cur);
    return changed;
  }
  // cached state at once, refreshed from the network in the background (at most every `refreshMs`)
  async function load(id) {
    if (cache.has(id)) {
      if (Date.now() - (checked.get(id) ?? 0) >= refreshMs) {
        checked.set(id, Date.now());
        store.get(id).then(st => st && absorb(id, st) && onChange()).catch(() => {});
      }
      return cache.get(id);
    }
    const st = await store.get(id);
    if (!st) return null;
    checked.set(id, Date.now());
    absorb(id, st);
    return cache.get(id);
  }
  async function write(id, items) {
    const exists = cache.has(id), st = cache.get(id) ?? { records: {} }, delta = { records: {}, updated_at: 0 };
    for (const [key, data, deleted = false] of items) {
      const r = { data: JSON.stringify(data), updated_at: Math.max(Date.now(), (st.records[key]?.updated_at ?? 0) + 1), deleted, by: S.pk, sig: '', cert: S.cert };
      r.sig = await S.dev.sign(msg(id, key, r));
      delta.records[key] = r;
      delta.updated_at = Math.max(delta.updated_at, r.updated_at);
    }
    await store.push(id, delta, exists);
    absorb(id, delta);
  }

  const teacherOf = id => id.slice(0, 64);
  const live = (st, prefix) => Object.entries(st.records).filter(([k, r]) => k.startsWith(prefix) && !r.deleted);
  const roleOf = (id, st) => (S.pk === teacherOf(id) ? 'teacher' : st.records['member:' + S.pk]?.deleted === false ? 'student' : null);
  const metaOf = st => J(st.records['meta:class'] ?? { data: '{}' });
  async function need(id, want) {
    const st = await load(id), role = st && S.index.includes(id) ? roleOf(id, st) : null;
    if (!role) fail('Not found', 404);
    if (want && role !== want) fail('Teachers only', 403);
    return [st, role];
  }
  const nameOf = (id, st, pk) => (pk === teacherOf(id) ? metaOf(st).owner : J(st.records['member:' + pk] ?? { data: '{}' }).name) || pk.slice(0, 8);
  const visible = (p, role) => role === 'teacher' || !p.publish_at || p.publish_at <= new Date().toISOString();

  async function findPost(pid, write = false) {
    await Promise.all(S.index.map(load));
    for (const id of S.index) {
      const rec = cache.get(id)?.records['post:' + pid];
      if (rec && !rec.deleted) {
        const [st, role] = await need(id);
        if (write && metaOf(st).archived) fail('Class is archived', 409);
        if (!visible(J(rec), role)) fail('Not found', 404);
        return { id, st, role, rec, p: { id: pid, ...J(rec) } };
      }
    }
    return fail('Not found', 404);
  }
  const subOf = (id, st, pid, pk) => {
    const r = st.records[`sub:${pid}:${pk}`];
    return r && !r.deleted ? { id: `${pid}:${pk}`, post_id: pid, user_id: pk, student: nameOf(id, st, pk), ...J(r), grade: null, feedback: null, returned: 0, files: [], private: [] } : null;
  };
  const commentsOf = (id, st, pid) => live(st, `cmt:${pid}:`)
    .map(([k, r]) => ({ id: k.split(':')[2], body: J(r).body, created_at: J(r).created_at, user_id: r.by, author: nameOf(id, st, r.by) }))
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const postRow = (id, st, [k, r], role) => {
    const pid = k.slice(5), p = J(r);
    const mine = role === 'student' && p.kind === 'assignment' ? (s => s && { submitted_at: s.submitted_at ?? null, returned: 0, grade: null })(subOf(id, st, pid, S.pk)) ?? null : undefined;
    return { id: pid, ...p, audience: undefined, author: nameOf(id, st, r.by), comments: live(st, `cmt:${pid}:`).length, files: [], mine };
  };
  const classRow = async id => {
    const st = await load(id);
    return st && roleOf(id, st) && { id, name: metaOf(st).name, section: metaOf(st).section ?? null, archived: metaOf(st).archived ? 1 : 0, role: roleOf(id, st) };
  };
  const publishName = async () => {
    for (const id of S.index) {
      const st = await load(id), role = st && roleOf(id, st);
      if (role === 'teacher') await write(id, [['meta:class', { ...metaOf(st), owner: S.name }]]);
      else if (role === 'student') await write(id, [['member:' + S.pk, { name: S.name }]]);
    }
  };

  const routes = [];
  const route = (method, p, fn) => routes.push([method, new RegExp('^' + p.replace(/:\w+/g, '([^/]+)') + '$'), fn]);
  route('POST', '/logout', () => { S = null; cache.clear(); set('aula-locked', true); }); // the key stays in this browser: "forget" removes it
  route('GET', '/me', () => ({ id: S.pk, name: S.name, username: S.pk.slice(0, 12) }));
  route('PUT', '/me', async ({ body }) => {
    const name = str(body.name);
    if (!name) fail('Name required');
    S.name = name;
    set('aula-profile', { name });
    await publishName();
  });
  route('POST', '/password', () => fail('There is no password on Freenet: your key is your identity'));
  route('GET', '/notifications', () => ({ unread: 0, items: [] }));
  route('POST', '/notifications/read', () => {});

  route('GET', '/classes', async () => (await Promise.all(S.index.map(classRow))).filter(Boolean).sort((a, b) => a.archived - b.archived || a.name.localeCompare(b.name)));
  route('POST', '/classes', async ({ body }) => {
    const name = str(body.name);
    if (!name) fail('Class name required');
    let i = 0;
    while (S.index.includes(await classId(i))) i++;
    const id = await classId(i);
    await write(id, [['meta:class', { name, section: str(body.section).slice(0, 100) || null, owner: S.name }]]);
    S.index.push(id);
    S.save();
    return { id, code: id };
  });
  route('POST', '/join', async ({ body }) => {
    const id = str(body.code).toLowerCase();
    if (!/^[0-9a-f]{112}$/.test(id)) fail('No class with that code', 404);
    const st = await load(id);
    if (!st) fail('No class with that code', 404);
    if (metaOf(st).archived) fail('Class is archived', 409);
    if (id.slice(0, 64) !== S.pk && roleOf(id, st) !== 'student') await write(id, [['member:' + S.pk, { name: S.name }]]);
    if (!S.index.includes(id)) { S.index.push(id); S.save(); }
    return { id };
  });
  route('GET', '/classes/:id', async ({ params: [id] }) => {
    const [st, role] = await need(id), m = metaOf(st), teacher = role === 'teacher';
    const people = [{ id: teacherOf(id), name: m.owner || teacherOf(id).slice(0, 8), role: 'teacher' },
      ...live(st, 'member:').map(([k]) => ({ id: k.slice(7), name: nameOf(id, st, k.slice(7)), role: 'student' })).sort((a, b) => a.name.localeCompare(b.name))];
    const posts = live(st, 'post:').filter(([, r]) => visible(J(r), role)).map(e => postRow(id, st, e, role))
      .sort((a, b) => (b.publish_at || b.created_at).localeCompare(a.publish_at || a.created_at));
    return { class: { id, name: m.name, section: m.section ?? null, archived: m.archived ? 1 : 0, owner: teacher, ...(teacher && { code: id }) }, role, people, posts };
  });
  route('PATCH', '/classes/:id', async ({ params: [id], body }) => {
    const [st] = await need(id, 'teacher'), m = metaOf(st), name = 'name' in body ? str(body.name) : m.name;
    if (!name) fail('Class name required');
    await write(id, [['meta:class', { ...m, name, section: 'section' in body ? str(body.section).slice(0, 100) || null : m.section, archived: 'archived' in body ? !!body.archived : m.archived }]]);
  });
  route('DELETE', '/classes/:id', () => fail('A class cannot be deleted on Freenet: archive it instead'));
  route('DELETE', '/classes/:id/members/:uid', async ({ params: [id, uid] }) => {
    const [st, role] = await need(id);
    if (uid === teacherOf(id)) fail('The owner cannot leave; delete the class instead', 403);
    if (uid !== S.pk && role !== 'teacher') fail('Not allowed', 403);
    if (!st.records['member:' + uid] || st.records['member:' + uid].deleted) fail('Not found', 404);
    await write(id, [['member:' + uid, {}, true]]);
    if (uid === S.pk) { S.index = S.index.filter(x => x !== id); S.save(); }
  });

  route('GET', '/work', async () => {
    await Promise.all(S.index.map(load));
    return S.index.flatMap(id => {
      const st = cache.get(id), role = st && roleOf(id, st);
      if (!role || metaOf(st).archived) return [];
      return live(st, 'post:').filter(([, r]) => J(r).kind === 'assignment' && visible(J(r), role)).map(([k, r]) => {
        const pid = k.slice(5), p = J(r), s = role === 'student' ? subOf(id, st, pid, S.pk) : null;
        return { id: pid, kind: p.kind, title: p.title, due: p.due, points: p.points, class_id: id, class_name: metaOf(st).name, role,
          submitted_at: s?.submitted_at ?? null, returned: 0, grade: null,
          to_return: role === 'teacher' ? live(st, `sub:${pid}:`).filter(([, x]) => J(x).submitted_at).length : 0 };
      });
    }).sort((a, b) => (a.due ? 0 : 1) - (b.due ? 0 : 1) || (a.due ?? '').localeCompare(b.due ?? ''));
  });

  route('POST', '/classes/:id/posts', async ({ params: [id], body }) => {
    const [st] = await need(id, 'teacher'), kind = body.kind;
    if (metaOf(st).archived) fail('Class is archived', 409);
    if (kind === 'quiz') fail(NA);
    if (!['announcement', 'assignment', 'material'].includes(kind)) fail('Invalid post type');
    if (body.audience != null) fail(NA);
    const pid = rid();
    await write(id, [['post:' + pid, { kind, ...postFields(kind, body), created_at: new Date().toISOString() }]]);
    return { id: pid };
  });
  route('PATCH', '/posts/:id', async ({ params: [pid], body }) => {
    const { id, role, p } = await findPost(pid, true);
    if (role !== 'teacher') fail('Teachers only', 403);
    if ('audience' in body && body.audience != null) fail(NA);
    const { audience, ...old } = p;
    await write(id, [['post:' + pid, { ...old, ...postFields(p.kind, { ...old, ...body }), id: undefined }]]);
  });
  route('DELETE', '/posts/:id', async ({ params: [pid] }) => {
    const { id, role } = await findPost(pid, true);
    if (role !== 'teacher') fail('Teachers only', 403);
    await write(id, [['post:' + pid, {}, true]]);
  });
  route('GET', '/posts/:id', async ({ params: [pid] }) => {
    const { id, st, role, p } = await findPost(pid), out = { post: { ...p, author: nameOf(id, st, st.records['post:' + pid].by), audience: undefined }, role, files: [], comments: commentsOf(id, st, pid), quiz: null };
    if (role === 'teacher') {
      out.students = live(st, 'member:').map(([k]) => ({ id: k.slice(7), name: nameOf(id, st, k.slice(7)) })).sort((a, b) => a.name.localeCompare(b.name));
      out.submissions = out.students.map(s => subOf(id, st, pid, s.id)).filter(s => s?.submitted_at);
    } else out.submission = subOf(id, st, pid, S.pk);
    return out;
  });
  route('PUT', '/posts/:id/submission', async ({ params: [pid], body }) => {
    const { id, role, p } = await findPost(pid, true);
    if (p.kind !== 'assignment' || role !== 'student') fail('Only students can submit to assignments', 403);
    await write(id, [[`sub:${pid}:${S.pk}`, { text: str(body.text).slice(0, 20000), submitted_at: body.submit ? new Date().toISOString() : null }]]);
  });
  route('POST', '/posts/:id/comments', async ({ params: [pid], body }) => {
    const { id } = await findPost(pid, true), text = str(body.body);
    if (!text) fail('Text required');
    await write(id, [[`cmt:${pid}:${rid()}`, { body: text.slice(0, 5000), created_at: new Date().toISOString() }]]);
  });
  route('DELETE', '/comments/:id', async ({ params: [cid] }) => {
    await Promise.all(S.index.map(load));
    for (const id of S.index) {
      const hit = Object.entries(cache.get(id)?.records ?? {}).find(([k, r]) => k.startsWith('cmt:') && k.endsWith(':' + cid) && !r.deleted);
      if (!hit) continue;
      const [, role] = await need(id);
      if (hit[1].by !== S.pk && role !== 'teacher') fail('Not allowed', 403);
      return write(id, [[hit[0], {}, true]]);
    }
    fail('Not found', 404);
  });
  // grades, returns, private comments, quizzes, files and co-teachers need encryption or chunking first
  for (const [m, p] of [['PUT', '/submissions/:id/grade'], ['POST', '/posts/:id/return'], ['POST', '/posts/:id/private'], ['POST', '/posts/:id/quiz'], ['GET', '/classes/:id/grades'],
    ['GET', '/classes/:id/grades.csv'], ['POST', '/classes/:id/members/:uid/reset'], ['POST', '/links'], ['POST', '/files']]) route(m, p, () => fail(NA));

  const api = async function (url, method = 'GET', body = {}, token = '') {
    if (!S && token) await start(token);
    if (!S) fail('Unauthorized', 401);
    for (const [m, re, fn] of routes) {
      const hit = m === method && re.exec(url.split('?')[0]);
      if (hit) return fn({ params: hit.slice(1).map(decodeURIComponent), body: body ?? {} });
    }
    return fail('Not found', 404);
  };
  api.id = identity;
  return api;
}
