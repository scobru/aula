import { t, lang, setLang, when, day, local } from './i18n.js';

const app = document.getElementById('app');
let token = '', me = null;
try { token = localStorage.getItem('aula') || ''; } catch {}

// DOM builder: text always goes in as text nodes, never as HTML
const h = (tag, p = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(p)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : k === 'class' ? (e.className = v) : k.includes('-') ? e.setAttribute(k, v) : (e[k] = v);
  if (e.placeholder && !e.getAttribute('aria-label')) e.setAttribute('aria-label', e.placeholder);
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
};
const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { alert(t(e.message)); } };
const auth = () => (token ? { Authorization: 'Bearer ' + token } : {});
const iso = el => (el.value ? new Date(el.value).toISOString() : null);
const KIND = { announcement: 'Announcement', assignment: 'Assignment', quiz: 'Quiz', material: 'Material' };

async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, {
    method,
    headers: { ...auth(), ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && token) { setToken(''); render(); }
    throw new Error(j.error || r.statusText);
  }
  return j;
}

function setToken(v) {
  token = v;
  try { v ? localStorage.setItem('aula', v) : localStorage.removeItem('aula'); } catch {}
}
const logout = safe(async () => { await api('/logout', 'POST').catch(() => {}); setToken(''); render(); });

async function upload(postId, file) {
  const r = await fetch(`/api/files?post=${postId}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: auth(), body: file });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
}

// downloads need the auth header, so fetch a blob instead of linking
async function save(url, name) {
  const r = await fetch('/api' + url, { headers: auth() });
  if (!r.ok) return alert(t('Download failed'));
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fileLink = (f, onDelete) => h('div', { class: 'row' },
  h('a', { href: '#', onclick: e => { e.preventDefault(); save('/files/' + f.id, f.name); } }, `${f.name} (${Math.ceil(f.size / 1024)} KB)`),
  onDelete && h('button', { class: 'ghost', onclick: safe(async () => { await api('/files/' + f.id, 'DELETE'); onDelete(); }) }, t('Remove')));

const form = (fields, label, onSubmit) => h('form', { class: 'row', onsubmit: safe(async e => { e.preventDefault(); await onSubmit(); }) }, fields, h('button', {}, label));
const field = (label, input) => h('label', { class: 'f' }, label, input);
const meta = (...parts) => h('small', {}, parts.filter(Boolean).join(' · '));

// ---------- auth ----------
function authView() {
  let register = false;
  const draw = () => {
    const name = h('input', { placeholder: t('Name'), hidden: !register, autocomplete: 'name' });
    const username = h('input', { placeholder: t('Username'), required: true, autocomplete: 'username', autocapitalize: 'none' });
    const pw = h('input', { type: 'password', placeholder: t('Password (min 8 characters)'), required: true });
    app.replaceChildren(h('form', {
      class: 'auth',
      onsubmit: safe(async e => {
        e.preventDefault();
        setToken((await api(register ? '/register' : '/login', 'POST', { name: name.value, username: username.value, password: pw.value })).token);
        render();
      }),
    }, h('h1', {}, 'Aula'), name, username, pw,
    h('button', {}, register ? t('Create account') : t('Log in')),
    h('a', { href: '#', onclick: e => { e.preventDefault(); register = !register; draw(); } }, register ? t('Have an account? Log in') : t('New here? Register')),
    langSelect()));
  };
  draw();
}

const langSelect = () => h('select', { 'aria-label': 'Language', onchange: e => { setLang(e.target.value); render(); } },
  [['en', 'English'], ['it', 'Italiano']].map(([v, n]) => h('option', { value: v, selected: v === lang }, n)));

function header(unread) {
  return h('header', {},
    h('a', { class: 'brand', href: '#/' }, 'Aula'),
    h('nav', {}, h('a', { href: '#/' }, t('Classes')), h('a', { href: '#/work' }, t('Work')), h('a', { href: '#/cal' }, t('Calendar'))),
    h('span', { class: 'grow' }),
    h('a', { href: '#/n' }, t('Notifications'), h('b', { class: 'badge', id: 'badge', hidden: !unread }, unread || '')),
    h('a', { href: '#/me' }, me.name), langSelect(), h('button', { class: 'ghost', onclick: logout }, t('Log out')));
}

// ---------- home / work / calendar ----------
async function homeView() {
  const classes = await api('/classes');
  const create = (ph, path, key) => { const i = h('input', { placeholder: ph, required: true }); return form(i, t('Go'), async () => { location.hash = '#/c/' + (await api(path, 'POST', { [key]: i.value })).id; }); };
  const card = c => h('div', { class: 'card' }, h('a', { href: '#/c/' + c.id }, c.name), ' ', h('small', {}, t(c.role === 'teacher' ? 'teacher' : 'student')));
  const active = classes.filter(c => !c.archived), old = classes.filter(c => c.archived);
  return h('main', {},
    h('h2', {}, t('Your classes')), active.length ? active.map(card) : h('p', { class: 'muted' }, t('No classes yet.')),
    old.length ? h('details', {}, h('summary', {}, t('Archived ({n})', { n: old.length })), old.map(card)) : null,
    h('h3', {}, t('Create a class')), create(t('Class name'), '/classes', 'name'),
    h('h3', {}, t('Join with a code')), create(t('Code'), '/join', 'code'));
}

const workItem = x => h('div', { class: 'card' }, h('a', { href: '#/p/' + x.id }, x.title),
  ' ', meta(x.class_name, x.due && t('due {d}', { d: when(x.due) }), x.grade != null && t('Grade: {g}', { g: x.grade }), x.role === 'teacher' && t('{n} to return', { n: x.to_return })));

async function workView() {
  const w = await api('/work'), cut = new Date().toISOString();
  const stu = w.filter(x => x.role === 'student');
  const sections = [
    ['To return', w.filter(x => x.role === 'teacher' && x.to_return > 0)],
    ['Late', stu.filter(x => !x.submitted_at && x.due && x.due < cut)],
    ['To do', stu.filter(x => !x.submitted_at && !(x.due && x.due < cut))],
    ['Done', stu.filter(x => x.submitted_at)],
  ].filter(([, items]) => items.length);
  return h('main', {}, h('h2', {}, t('Work')), sections.length ? sections.map(([n, items]) => h('section', {}, h('h3', {}, t(n)), items.map(workItem))) : h('p', { class: 'muted' }, t('Nothing to do.')));
}

async function calView() {
  const w = (await api('/work')).filter(x => x.due), groups = new Map();
  for (const x of w) { const k = day(x.due); groups.set(k, [...(groups.get(k) || []), x]); }
  return h('main', {}, h('h2', {}, t('Calendar')), groups.size ? [...groups].map(([k, items]) => h('section', {}, h('h3', {}, k), items.map(workItem))) : h('p', { class: 'muted' }, t('No due dates.')));
}

async function notifView() {
  const n = await api('/notifications');
  const T = { post: 'New in {class}: {title}', submitted: '{student} turned in "{title}"', returned: 'Your work "{title}" was returned', comment: '{user} commented on "{title}"', private: '{user} sent a private comment on "{title}"' };
  api('/notifications/read', 'POST').then(() => { const b = document.getElementById('badge'); if (b) b.hidden = true; }).catch(() => {});
  return h('main', {}, h('h2', {}, t('Notifications')), n.items.length ? n.items.map(i => h('div', { class: 'card' + (i.read ? '' : ' unread') },
    h('a', { href: i.link }, t(T[i.kind] || i.kind, i.data)), ' ', h('small', {}, when(i.created_at)))) : h('p', { class: 'muted' }, t('No notifications.')));
}

async function profileView() {
  const name = h('input', { value: me.name, required: true });
  const old = h('input', { type: 'password', placeholder: t('Current password'), required: true });
  const next = h('input', { type: 'password', placeholder: t('New password (min 8 characters)'), required: true });
  return h('main', {}, h('h2', {}, t('Profile')), h('p', { class: 'muted' }, me.username),
    form(name, t('Save'), async () => { await api('/me', 'PUT', { name: name.value }); render(); }),
    h('h3', {}, t('Change password')),
    form([old, next], t('Change password'), async () => { await api('/password', 'POST', { old: old.value, new: next.value }); alert(t('Password changed')); old.value = next.value = ''; }));
}

// ---------- class ----------
async function classView(cid, tab = 'stream') {
  const c = await api('/classes/' + cid), teacher = c.role === 'teacher';
  const tabs = [['stream', 'Stream'], ['people', 'People'], ...(teacher ? [['grades', 'Grades'], ['settings', 'Settings']] : [])];
  const body = await { stream: streamTab, people: peopleTab, grades: gradesTab, settings: settingsTab }[tab](c, cid);
  return h('main', {}, h('h2', {}, c.class.name, c.class.archived ? h('small', {}, ' ' + t('(archived)')) : null),
    h('nav', { class: 'tabs' }, tabs.map(([k, n]) => h('a', { href: '#/c/' + cid + (k === 'stream' ? '' : '/' + k), class: k === tab ? 'on' : '' }, t(n)))), body);
}

function quizBuilder() {
  const box = h('div'), qs = [];
  const add = () => {
    const item = { q: h('input', { placeholder: t('Question') }), opts: h('textarea', { rows: 3, placeholder: t('Options, one per line') }), ans: h('input', { type: 'number', min: 1, value: 1 }) };
    const row = h('div', { class: 'card' }, item.q, item.opts, field(t('Correct option number'), item.ans),
      h('button', { type: 'button', class: 'ghost', onclick: () => { row.remove(); qs.splice(qs.indexOf(item), 1); } }, t('Remove')));
    qs.push(item);
    box.append(row);
  };
  add();
  return {
    el: h('div', {}, box, h('button', { type: 'button', class: 'ghost', onclick: add }, t('Add question'))),
    value: () => qs.map(x => ({ q: x.q.value, options: x.opts.value.split('\n').map(s => s.trim()).filter(Boolean), answer: (+x.ans.value || 1) - 1 })),
  };
}

function composer(cid, topics) {
  const kind = h('select', { 'aria-label': t('Type') }, Object.keys(KIND).map(k => h('option', { value: k }, t(KIND[k]))));
  const title = h('input', { placeholder: t('Title') }), text = h('textarea', { rows: 3, placeholder: t('Text') });
  const topic = h('input', { placeholder: t('Topic (optional)') });
  topic.setAttribute('list', 'topics'); // `list` is read-only as a property
  const due = h('input', { type: 'datetime-local' }), pts = h('input', { type: 'number', min: 0 }), pub = h('input', { type: 'datetime-local' });
  const files = h('input', { type: 'file', multiple: true }), qb = quizBuilder();
  const wraps = { title, due: field(t('Due'), due), pts: field(t('Points'), pts), quiz: qb.el };
  const sync = () => {
    const k = kind.value;
    title.hidden = k === 'announcement';
    wraps.due.hidden = !(k === 'assignment' || k === 'quiz');
    wraps.pts.hidden = k !== 'assignment';
    wraps.quiz.hidden = k !== 'quiz';
  };
  kind.onchange = sync;
  sync();
  const send = safe(async () => {
    const { id } = await api(`/classes/${cid}/posts`, 'POST', {
      kind: kind.value, title: title.value, body: text.value, topic: topic.value, due: iso(due), publish_at: iso(pub),
      points: pts.value === '' ? null : +pts.value, quiz: kind.value === 'quiz' ? qb.value() : undefined,
    });
    for (const f of files.files) await upload(id, f);
    render();
  });
  return h('div', { class: 'card' }, kind, title, text, h('datalist', { id: 'topics' }, topics.map(x => h('option', { value: x }))), topic,
    wraps.due, wraps.pts, field(t('Publish later'), pub), wraps.quiz, files, h('div', { class: 'row' }, h('button', { onclick: send }, t('Post'))));
}

const status = m => (!m ? 'assigned' : m.returned && m.grade != null ? 'Grade: {g}' : m.returned ? 'returned' : m.submitted_at ? 'turned in' : 'draft');

function streamTab(c, cid) {
  const teacher = c.role === 'teacher', topics = [...new Set(c.posts.map(p => p.topic).filter(Boolean))].sort();
  const list = h('div'), filter = h('select', { 'aria-label': t('Topic') }, h('option', { value: '' }, t('All topics')), topics.map(x => h('option', { value: x }, x)));
  const item = p => h('div', { class: 'card' },
    h('h3', {}, h('a', { href: '#/p/' + p.id }, p.title || p.body.slice(0, 80))),
    meta(t(KIND[p.kind]), p.topic, p.author, when(p.created_at), p.due && t('due {d}', { d: when(p.due) }), p.points != null && t('{n} pts', { n: p.points }),
      p.mine !== undefined && (p.kind === 'assignment' || p.kind === 'quiz') && t(status(p.mine), { g: p.mine?.grade }),
      teacher && p.publish_at > new Date().toISOString() && t('scheduled for {d}', { d: when(p.publish_at) }), p.comments > 0 && t('{n} comments', { n: p.comments })),
    p.title ? h('p', { class: 'pre' }, p.body) : null, p.files.map(f => fileLink(f)));
  const draw = () => list.replaceChildren(...c.posts.filter(p => !filter.value || p.topic === filter.value).map(item));
  filter.onchange = draw;
  draw();
  return h('div', {}, teacher && !c.class.archived ? composer(cid, topics) : null, topics.length ? filter : null, list);
}

function peopleTab(c, cid) {
  const del = (p, label, confirmMsg) => h('button', { class: 'ghost', onclick: safe(async () => { if (confirm(confirmMsg)) { await api(`/classes/${cid}/members/${p.id}`, 'DELETE'); location.hash = p.id === me.id ? '#/' : '#/c/' + cid + '/people'; render(); } }) }, label);
  return h('div', {}, c.people.map(p => h('div', { class: 'card row' }, `${p.name} `, h('small', {}, t(p.role)), h('span', { class: 'grow' }),
    p.id === me.id ? (c.class.owner ? null : del(p, t('Leave class'), t('Leave this class?')))
      : c.role === 'teacher' && (p.role === 'student' || c.class.owner) ? del(p, t('Remove'), t('Remove {name} from the class?', { name: p.name })) : null)));
}

async function gradesTab(c, cid) {
  const g = await api(`/classes/${cid}/grades`);
  const cell = x => !x ? '-' : x.grade != null ? x.grade + (x.returned ? '' : '*') : x.submitted ? t('turned in') : '-';
  return h('div', {}, h('div', { class: 'row' }, h('button', { onclick: () => save(`/classes/${cid}/grades.csv`, 'grades.csv') }, t('Download CSV')), h('small', {}, t('* graded but not returned yet'))),
    g.posts.length ? h('div', { class: 'scroll' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('Student')), g.posts.map(p => h('th', {}, h('a', { href: '#/p/' + p.id }, p.title), p.points != null ? ` /${p.points}` : '')))),
      h('tbody', {}, g.rows.map(r => h('tr', {}, h('td', {}, r.name), r.cells.map(x => h('td', {}, cell(x)))))))) : h('p', { class: 'muted' }, t('No assignments yet.')));
}

function settingsTab(c, cid) {
  const name = h('input', { value: c.class.name, required: true }), cl = c.class;
  return h('div', {}, h('div', { class: 'card' }, h('p', {}, t('Student code'), ': ', h('strong', {}, cl.code)), h('p', {}, t('Co-teacher code'), ': ', h('strong', {}, cl.teacher_code))),
    form(name, t('Rename'), async () => { await api('/classes/' + cid, 'PATCH', { name: name.value }); render(); }),
    h('div', { class: 'row' }, h('button', { onclick: safe(async () => { await api('/classes/' + cid, 'PATCH', { archived: !cl.archived }); render(); }) }, cl.archived ? t('Unarchive') : t('Archive')),
      cl.owner ? h('button', { class: 'danger', onclick: safe(async () => { if (confirm(t('Delete this class and everything in it?'))) { await api('/classes/' + cid, 'DELETE'); location.hash = '#/'; } }) }, t('Delete class')) : null));
}

// ---------- post ----------
function thread(items, send, canDelete) {
  const input = h('input', { placeholder: t('Write a comment') });
  return h('div', {}, items.map(c => h('div', { class: 'cm row' }, h('span', { class: 'pre' }, h('strong', {}, c.author + ': '), c.body), h('small', {}, when(c.created_at)),
    canDelete?.(c) ? h('button', { class: 'ghost', onclick: safe(async () => { await api('/comments/' + c.id, 'DELETE'); render(); }) }, t('Remove')) : null)),
  form(input, t('Send'), async () => { if (input.value.trim()) { await send(input.value); render(); } }));
}

const quizForm = (pid, quiz) => {
  const picks = quiz.map(() => null);
  return h('div', {}, quiz.map((x, i) => h('fieldset', { class: 'card' }, h('legend', {}, `${i + 1}. ${x.q}`),
    x.options.map((o, j) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'q' + i, onchange: () => { picks[i] = j; } }), ' ' + o)))),
  h('button', { onclick: safe(async () => { if (confirm(t('Submit your answers? You can only do this once.'))) { await api(`/posts/${pid}/quiz`, 'POST', { answers: picks }); render(); } }) }, t('Submit answers')));
};
const quizReview = (quiz, answers) => quiz.map((x, i) => h('div', { class: 'card' }, h('strong', {}, `${i + 1}. ${x.q}`),
  x.options.map((o, j) => h('div', { class: j === x.answer ? 'ok' : j === answers?.[i] ? 'err' : '' }, (j === answers?.[i] ? '(x) ' : '( ) ') + o + (j === x.answer ? ' ✓' : '')))));

function editForm(p) {
  const title = h('input', { value: p.title || '', placeholder: t('Title') }), text = h('textarea', { rows: 3, value: p.body }), topic = h('input', { value: p.topic || '', placeholder: t('Topic (optional)') });
  const due = h('input', { type: 'datetime-local', value: local(p.due) }), pts = h('input', { type: 'number', min: 0, value: p.points ?? '' }), pub = h('input', { type: 'datetime-local', value: local(p.publish_at) });
  return h('div', { class: 'card' }, p.kind !== 'announcement' ? title : null, text, topic, p.kind === 'assignment' || p.kind === 'quiz' ? field(t('Due'), due) : null,
    p.kind === 'assignment' ? field(t('Points'), pts) : null, field(t('Publish later'), pub),
    h('button', { onclick: safe(async () => { await api('/posts/' + p.id, 'PATCH', { title: title.value, body: text.value, topic: topic.value, due: iso(due), points: pts.value === '' ? null : +pts.value, publish_at: iso(pub) }); render(); }) }, t('Save')));
}

function studentWork(d, pid) {
  const p = d.post, s = d.submission, locked = !!s?.returned;
  const text = h('textarea', { rows: 5, placeholder: t('Your answer'), value: s?.text ?? '', disabled: locked });
  const saveWork = submit => safe(async () => { await api(`/posts/${pid}/submission`, 'PUT', { text: text.value, submit }); render(); });
  const pick = h('input', { type: 'file', multiple: true, onchange: safe(async () => { for (const f of pick.files) await upload(pid, f); render(); }) });
  return h('div', {}, h('h3', {}, t('Your work'), ' ', h('small', {}, s?.submitted_at ? t('turned in {d}', { d: when(s.submitted_at) }) : t('not turned in'))),
    locked && s.grade != null ? h('p', {}, h('strong', {}, t('Grade: {g}', { g: s.grade }) + (p.points != null ? ' / ' + p.points : '')), s.feedback && ' — ' + s.feedback) : null,
    text, (s?.files ?? []).map(f => fileLink(f, locked ? null : render)),
    !locked ? h('div', { class: 'row' }, pick, h('button', { onclick: saveWork(true) }, s?.submitted_at ? t('Resubmit') : t('Turn in')),
      s?.submitted_at ? h('button', { class: 'ghost', onclick: saveWork(false) }, t('Unsubmit')) : h('button', { class: 'ghost', onclick: saveWork(false) }, t('Save draft'))) : null,
    h('h3', {}, t('Private comments')), thread(s?.private ?? [], v => api(`/posts/${pid}/private`, 'POST', { body: v })));
}

function teacherSubmissions(d, pid) {
  const p = d.post;
  const rows = d.submissions.map(s => {
    const grade = h('input', { type: 'number', min: 0, max: p.points ?? '', value: s.grade ?? '', placeholder: t('Grade') });
    const fb = h('input', { placeholder: t('Feedback'), value: s.feedback ?? '' }), ret = h('input', { type: 'checkbox', checked: !!s.returned });
    return h('div', { class: 'card' }, h('h3', {}, s.student), meta(s.submitted_at ? t('turned in {d}', { d: when(s.submitted_at) }) + (p.due && s.submitted_at > p.due ? ' ' + t('(late)') : '') : t('draft')),
      d.quiz ? quizReview(d.quiz, s.answers) : [h('p', { class: 'pre' }, s.text), s.files.map(f => fileLink(f))],
      h('div', { class: 'row' }, grade, fb, h('label', {}, ret, ' ' + t('Returned')),
        h('button', { onclick: safe(async () => { await api(`/submissions/${s.id}/grade`, 'PUT', { grade: grade.value, feedback: fb.value, return: ret.checked }); render(); }) }, t('Save'))),
      p.kind === 'assignment' ? [h('h4', {}, t('Private comments')), thread(s.private, v => api(`/posts/${pid}/private`, 'POST', { body: v, submission: s.id }))] : null);
  });
  return h('div', {}, h('div', { class: 'row' }, h('h3', {}, t('Submissions ({n})', { n: rows.length })),
    h('button', { onclick: safe(async () => { alert(t('{n} returned', { n: (await api(`/posts/${pid}/return`, 'POST')).returned })); render(); }) }, t('Return all graded'))),
  rows.length ? rows : h('p', { class: 'muted' }, t('Nothing turned in yet.')));
}

async function postView(pid) {
  const d = await api('/posts/' + pid), p = d.post, teacher = d.role === 'teacher';
  let editing = false;
  const head = h('div', {}, h('p', {}, h('a', { href: '#/c/' + p.class_id }, t('< Back to class'))),
    h('h2', {}, p.title || t('Announcement')), meta(t(KIND[p.kind]), p.topic, p.due && t('due {d}', { d: when(p.due) }), p.points != null && t('{n} pts', { n: p.points })),
    h('p', { class: 'pre' }, p.body), d.files.map(f => fileLink(f)),
    teacher ? h('div', { class: 'row' }, h('button', { class: 'ghost', onclick: () => { editing = !editing; slot.replaceChildren(...(editing ? [editForm(p)] : [])); } }, t('Edit')),
      h('button', { class: 'ghost', onclick: safe(async () => { if (confirm(t('Delete this post?'))) { await api('/posts/' + pid, 'DELETE'); location.hash = '#/c/' + p.class_id; } }) }, t('Delete'))) : null);
  const slot = h('div');
  let main = null;
  if (p.kind === 'quiz') {
    if (teacher) main = [d.quiz && quizReview(d.quiz, null), h('h3', {}, t('Submissions ({n})', { n: d.submissions.length })), d.submissions.map(s => h('div', { class: 'card' }, `${s.student}: ${s.grade ?? '-'} / ${p.points}`, ' ', h('small', {}, when(s.submitted_at))))];
    else main = d.submission?.submitted_at ? [h('p', {}, h('strong', {}, t('Grade: {g}', { g: d.submission.grade }) + ' / ' + p.points)), quizReview(d.quiz, d.submission.answers)] : quizForm(pid, d.quiz);
  } else if (p.kind === 'assignment') main = teacher ? teacherSubmissions(d, pid) : studentWork(d, pid);
  return h('main', {}, head, slot, main, h('h3', {}, t('Class comments')),
    thread(d.comments, v => api(`/posts/${pid}/comments`, 'POST', { body: v }), c => teacher || c.user_id === me.id));
}

// ---------- shell ----------
async function render() {
  if (!token) return authView();
  const [, kind, id, sub] = location.hash.split('/');
  try {
    me = await api('/me');
    const { unread } = await api('/notifications');
    const views = { c: () => classView(id, sub), p: () => postView(id), work: workView, cal: calView, me: profileView, n: notifView };
    const view = await (views[kind] || homeView)();
    app.replaceChildren(header(unread), view);
  } catch (e) {
    if (token) app.replaceChildren(h('main', {}, h('p', { class: 'err' }, t(e.message)), h('a', { href: '#/' }, t('Home'))));
  }
}
addEventListener('hashchange', render);
// the badge is the only thing refreshed in the background, so typing is never interrupted
setInterval(async () => {
  const b = document.getElementById('badge');
  if (token && b) { const n = await api('/notifications').catch(() => null); if (n) { b.hidden = !n.unread; b.textContent = n.unread || ''; } }
}, 60000);
render();
