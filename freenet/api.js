// Aula on Freenet: the server's JSON API (`api(url, method, body)`), answered from signed records in one contract per class.
// Identity = Ed25519 key derived from username + password, so the same login on another device is the same person.
// `store` is { get(id) -> state | null, push(id, delta, exists) } (net.ts on Freenet, a Map in tests). See contract/src/lib.rs for the rules.
const enc = new TextEncoder();
const subtle = globalThis.crypto.subtle;
const hex = u8 => [...u8].map(b => b.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from(h.match(/../g) ?? [], b => parseInt(b, 16));
const PKCS8 = '302e020100300506032b657004220420'; // wraps a raw 32-byte Ed25519 seed
const NA = 'Not available on Freenet yet';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const str = v => (typeof v === 'string' ? v.trim() : '');
const sha = async (...parts) => new Uint8Array(await subtle.digest('SHA-256', new Uint8Array(parts.flatMap(p => [...p]))));
const msg = (id, key, r) => `aula1|${id}|${key}|${r.by}|${r.updated_at}|${r.deleted}|${r.data}`; // must match record_msg in the contract
const J = r => { try { return JSON.parse(r.data); } catch { return {}; } };
const rid = () => hex(crypto.getRandomValues(new Uint8Array(8)));

// shortcut: password-derived keys are only as strong as the password (the public key is on the network); upgrade to a stored key or passkey
export async function seedFor(username, password) {
  const base = await subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = enc.encode('aula-freenet|' + username.toLowerCase());
  return hex(new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, base, 256)));
}

async function keysOf(seed) {
  const priv = await subtle.importKey('pkcs8', unhex(PKCS8 + seed), 'Ed25519', true, ['sign']);
  const { x } = await subtle.exportKey('jwk', priv);
  const pk = hex(Uint8Array.from(atob(x.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)));
  return { pk, sign: async m => hex(new Uint8Array(await subtle.sign('Ed25519', priv, enc.encode(m)))) };
}

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

// a sandboxed iframe (Freenet web contracts) throws on merely reading localStorage; then nothing is remembered and you log in again
const browserStorage = () => { try { return globalThis.localStorage; } catch { return null; } };

export function createApi(store, { storage = browserStorage(), onChange = () => {}, refreshMs = 5000 } = {}) {
  const mem = new Map();
  const disk = storage ?? { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  const get = (k, d) => { try { return JSON.parse(disk.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => { try { disk.setItem(k, JSON.stringify(v)); } catch {} };
  const cache = new Map(), checked = new Map();
  let S = null; // { seed, pk, sign, username, name, index }

  async function start(seed, username, name) {
    const k = await keysOf(seed), idx = `aula-classes-${k.pk}`;
    S = { seed, ...k, username, name: name || username, index: get(idx, []), save() { set(idx, this.index); } };
    // a teacher's classes have derived addresses, so a new device finds them again; students rejoin with the code
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
    set('aula-profile', { username: S.username, name: S.name });
  }
  const classId = async i => S.pk + hex((await sha(unhex(S.seed), enc.encode('class'), enc.encode(String(i)))).slice(0, 16));

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
      const r = { data: JSON.stringify(data), updated_at: Math.max(Date.now(), (st.records[key]?.updated_at ?? 0) + 1), deleted, by: S.pk, sig: '' };
      r.sig = await S.sign(msg(id, key, r));
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
  const login = async b => {
    const username = str(b.username).toLowerCase(), password = typeof b.password === 'string' ? b.password : '';
    if (!username || password.length < 8) fail('Username and a password of at least 8 characters required');
    await start(await seedFor(username, password), username, str(b.name) || get('aula-profile', {}).name);
    return { token: S.seed };
  };
  route('POST', '/register', ({ body }) => login(body));
  route('POST', '/login', ({ body }) => login(body));
  route('POST', '/logout', () => { S = null; cache.clear(); });
  route('GET', '/me', () => ({ id: S.pk, name: S.name, username: S.username }));
  route('PUT', '/me', async ({ body }) => {
    const name = str(body.name);
    if (!name) fail('Name required');
    S.name = name;
    set('aula-profile', { username: S.username, name });
    await publishName();
  });
  route('POST', '/password', () => fail('Your password is your key on Freenet: it cannot be changed'));
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
    if (!/^[0-9a-f]{96}$/.test(id)) fail('No class with that code', 404);
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

  return async function api(url, method = 'GET', body = {}, token = '') {
    const path = url.split('?')[0];
    if (!S && token && !/^\/(login|register)$/.test(path)) await start(token, get('aula-profile', {}).username ?? '', get('aula-profile', {}).name);
    if (!S && !/^\/(login|register)$/.test(path)) fail('Unauthorized', 401);
    for (const [m, re, fn] of routes) {
      const hit = m === method && re.exec(path);
      if (hit) return fn({ params: hit.slice(1).map(decodeURIComponent), body: body ?? {} });
    }
    return fail('Not found', 404);
  };
}
