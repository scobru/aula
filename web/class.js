// The class page: Stream, Classwork, People, Grades and Settings.
import { state, h, icon, api, safe, iso, upload, save, rerender, avatar, colorOf, menu, attachment, field, dot, audiencePicker, linkAdder, KIND_ICON } from './lib.js';
import { t, short, shortDay } from './i18n.js';

const KIND = { announcement: 'Announcement', assignment: 'Assignment', quiz: 'Quiz', material: 'Material' };
const POSTED = { assignment: '{name} posted a new assignment: {title}', quiz: '{name} posted a new quiz: {title}', material: '{name} posted new material: {title}' };

export async function classPage(cid, sub = '', classes) {
  const c = await api('/classes/' + cid), teacher = c.role === 'teacher';
  const work = sub === '' && !c.class.archived ? (await api('/work')).filter(x => x.class_id === cid) : [];
  const tabs = [['', 'Stream'], ['classwork', 'Classwork'], ['people', 'People'], ['grades', 'Grades']];
  const body = await ({ '': stream, classwork, people, grades, settings: teacher ? settings : stream }[sub] || stream)(c, cid, work);
  const bar = h('div', { class: 'tabbar' },
    h('nav', { class: 'tabs' }, tabs.map(([k, n]) => h('a', { href: '#/c/' + cid + (k && '/' + k), class: k === sub ? 'on' : '' }, t(n)))),
    h('span', { class: 'grow' }),
    h('a', { class: 'icon-btn', href: '#/cal', 'aria-label': t('Calendar') }, icon('calendar')),
    teacher ? h('a', { class: 'icon-btn' + (sub === 'settings' ? ' on' : ''), href: '#/c/' + cid + '/settings', 'aria-label': t('Settings') }, icon('settings')) : null);
  return { el: h('div', {}, bar, h('div', { class: 'page' }, body)), title: c.class.name, sub: c.class.section };
}

// ---------- stream ----------
function stream(c, cid, work) {
  const teacher = c.role === 'teacher', cls = c.class;
  const banner = h('div', { class: 'banner' }, h('h1', {}, cls.name), cls.section ? h('p', {}, cls.section) : null);
  banner.style.backgroundColor = colorOf(cls.id);

  const soon = work.filter(x => x.due && x.due > new Date().toISOString() && !x.submitted_at).slice(0, 3);
  const side = [
    teacher && !cls.archived ? h('div', { class: 'card' }, h('h3', {}, t('Class code')), h('div', { class: 'code' }, cls.code),
      h('button', { class: 'text', onclick: () => navigator.clipboard?.writeText(cls.code) }, t('Copy'))) : null,
    h('div', { class: 'card' }, h('h3', {}, t('Due soon')),
      soon.length ? soon.map(x => h('p', {}, h('small', {}, t('Due {d}', { d: short(x.due) })), h('br'), h('a', { href: '#/p/' + x.id }, x.title)))
        : h('small', {}, t('No work due soon')), h('a', { class: 'more', href: '#/work' }, t('View all'))),
  ];

  const slot = h('div');
  const compose = teacher && !cls.archived ? h('div', { class: 'card pillbar' }, avatar(state.me.name),
    h('button', { class: 'ghost-pill', onclick: () => slot.replaceChildren(announce(cid, students(c), () => slot.replaceChildren())) }, t('Announce something to your class'))) : null;

  const feed = c.posts.map(p => h('article', { class: 'card post' },
    h('div', { class: 'row' }, avatar(p.author), h('div', { class: 'grow' }, h('b', {}, p.author), h('br'), h('small', {}, dot([shortDay(p.created_at), teacher && p.publish_at > new Date().toISOString() && t('Scheduled for {d}', { d: short(p.publish_at) }), teacher && p.audience && forN(p.audience.length)])))),
    p.kind === 'announcement' ? h('p', { class: 'pre' }, p.body)
      : h('a', { class: 'postlink', href: '#/p/' + p.id }, h('span', { class: 'ico' }, icon(KIND_ICON[p.kind], 20)), t(POSTED[p.kind], { name: p.author, title: p.title })),
    p.files.map(f => attachment(f)),
    h('a', { class: 'more', href: '#/p/' + p.id }, p.comments ? t('{n} class comments', { n: p.comments }) : t('Add class comment'))));

  return h('div', {}, banner, h('div', { class: 'cols' }, h('aside', {}, side), h('div', {}, compose, slot, feed.length ? feed : h('p', { class: 'muted' }, t('Nothing posted yet.')))));
}

const students = c => c.people.filter(p => p.role === 'student');
const forN = n => t(n === 1 ? 'For {n} student' : 'For {n} students', { n });

function announce(cid, studentList, done) {
  const text = h('textarea', { rows: 4, placeholder: t('Announce something to your class') });
  const topic = h('input', { placeholder: t('Topic (optional)') });
  const files = h('input', { type: 'file', multiple: true }), aud = audiencePicker(studentList), links = linkAdder();
  return h('div', { class: 'card' }, text, topic, aud.el, files, links.el, h('div', { class: 'actions' }, h('button', { class: 'text', onclick: done }, t('Cancel')),
    h('button', { class: 'pill', onclick: safe(async () => {
      const { id } = await api(`/classes/${cid}/posts`, 'POST', { kind: 'announcement', body: text.value, topic: topic.value, audience: aud.value() });
      for (const f of files.files) await upload(id, f);
      await links.save(id);
      rerender();
    }) }, t('Post'))));
}

// ---------- classwork ----------
function quizBuilder() {
  const box = h('div'), qs = [];
  const add = () => {
    const item = { q: h('input', { placeholder: t('Question') }), opts: h('textarea', { rows: 3, placeholder: t('Options, one per line') }), ans: h('input', { type: 'number', min: 1, value: 1 }) };
    const row = h('div', { class: 'card flat' }, item.q, item.opts, field(t('Correct option number'), item.ans),
      h('button', { type: 'button', class: 'text', onclick: () => { row.remove(); qs.splice(qs.indexOf(item), 1); } }, t('Remove')));
    qs.push(item);
    box.append(row);
  };
  add();
  return {
    el: h('div', {}, box, h('button', { type: 'button', class: 'text', onclick: add }, t('Add question'))),
    value: () => qs.map(x => ({ q: x.q.value, options: x.opts.value.split('\n').map(s => s.trim()).filter(Boolean), answer: (+x.ans.value || 1) - 1 })),
  };
}

function composer(cid, kind, topics, studentList, done) {
  const title = h('input', { placeholder: t('Title') }), text = h('textarea', { rows: 3, placeholder: t('Instructions (optional)') });
  const topic = h('input', { placeholder: t('Topic (optional)') });
  topic.setAttribute('list', 'topics'); // `list` is read-only as a property
  const due = h('input', { type: 'datetime-local' }), pts = h('input', { type: 'number', min: 0 }), pub = h('input', { type: 'datetime-local' });
  const files = h('input', { type: 'file', multiple: true }), qb = quizBuilder(), aud = audiencePicker(studentList), links = linkAdder();
  const send = safe(async () => {
    const { id } = await api(`/classes/${cid}/posts`, 'POST', {
      kind, title: title.value, body: text.value, topic: topic.value, due: iso(due), publish_at: iso(pub),
      points: pts.value === '' ? null : +pts.value, quiz: kind === 'quiz' ? qb.value() : undefined, audience: aud.value(),
    });
    for (const f of files.files) await upload(id, f);
    await links.save(id);
    rerender();
  });
  return h('div', { class: 'card' }, h('h3', {}, t(KIND[kind])), title, text, h('datalist', { id: 'topics' }, topics.map(x => h('option', { value: x }))), topic,
    kind === 'assignment' || kind === 'quiz' ? field(t('Due'), due) : null, kind === 'assignment' ? field(t('Points'), pts) : null, field(t('Publish later'), pub),
    kind === 'quiz' ? qb.el : null, aud.el, files, links.el, h('div', { class: 'actions' }, h('button', { class: 'text', onclick: done }, t('Cancel')), h('button', { class: 'pill', onclick: send }, t('Post'))));
}

function classwork(c, cid) {
  const teacher = c.role === 'teacher', cls = c.class;
  const topics = [...new Set(c.posts.map(p => p.topic).filter(Boolean))];
  const slot = h('div'), list = h('div');
  const filter = h('select', { 'aria-label': t('Filter by topic') }, h('option', { value: '' }, t('All topics')), topics.map(x => h('option', { value: x }, x)));
  const open = kind => slot.replaceChildren(composer(cid, kind, topics, students(c), () => slot.replaceChildren()));
  const create = teacher && !cls.archived ? menu([['assignment', 'Assignment'], ['quiz', 'Quiz'], ['material', 'Material']].map(([k, n]) => ({ label: t(n), onclick: () => open(k) })),
    h('span', { class: 'pill' }, icon('add', 20), t('Create'))) : null;

  const row = p => {
    const m = p.mine, state_ = m ? (m.returned && m.grade != null ? t('Grade: {g}', { g: m.grade }) : m.returned ? t('Returned') : m.submitted_at ? t('Turned in') : null) : null;
    return h('a', { class: 'cw-row', href: '#/p/' + p.id }, h('span', { class: 'ico' }, icon(KIND_ICON[p.kind], 20)), h('span', { class: 'grow' }, p.title),
      h('small', {}, dot([teacher && p.audience && forN(p.audience.length), state_, p.due ? t('Due: {d}', { d: short(p.due) }) : teacher && p.publish_at > new Date().toISOString() ? t('Scheduled: {d}', { d: short(p.publish_at) }) : t('Posted: {d}', { d: shortDay(p.created_at) })])));
  };
  const draw = () => {
    const groups = new Map();
    for (const p of c.posts.filter(p => p.kind !== 'announcement' && (!filter.value || p.topic === filter.value))) groups.set(p.topic || '', [...(groups.get(p.topic || '') || []), p]);
    list.replaceChildren(...[...groups].sort(([a], [b]) => (a === '') === (b === '') ? 0 : a === '' ? -1 : 1).map(([topic, items]) =>
      h('details', { class: 'topic', open: true }, topic ? h('summary', {}, h('h2', {}, topic), icon('collapse')) : h('summary', { class: 'plain' }), items.map(row))));
    if (!groups.size) list.append(h('p', { class: 'muted' }, t('No classwork yet.')));
  };
  filter.onchange = draw;
  draw();
  return h('div', { class: 'narrow' }, h('div', { class: 'row' }, create), slot,
    h('div', { class: 'row toolbar' }, topics.length ? filter : null, h('span', { class: 'grow' }),
      h('button', { class: 'text', onclick: () => list.querySelectorAll('details').forEach(d => { d.open = false; }) }, t('Collapse all'))), list);
}

// ---------- people ----------
function people(c, cid) {
  const teacher = c.role === 'teacher', owner = c.class.owner;
  const act = (p, path, method, confirmMsg, after) => async () => {
    if (!confirm(confirmMsg)) return;
    const r = await api(path, method);
    after(r);
  };
  const row = p => {
    const items = [];
    if (p.id === state.me.id) { if (!owner) items.push({ label: t('Leave class'), onclick: act(p, `/classes/${cid}/members/${p.id}`, 'DELETE', t('Leave this class?'), () => { location.hash = '#/'; }) }); }
    else if (teacher && (p.role === 'student' || owner)) {
      if (p.role === 'student') items.push({ label: t('Reset password'), onclick: act(p, `/classes/${cid}/members/${p.id}/reset`, 'POST', t('Reset the password of {name}? They will be signed out everywhere.', { name: p.name }),
        r => alert(t('Username: {u}\nTemporary password: {p}\nTell them to change it in Profile. It is shown only once.', { u: r.username, p: r.password }))) });
      items.push({ label: t('Remove'), danger: true, onclick: act(p, `/classes/${cid}/members/${p.id}`, 'DELETE', t('Remove {name} from the class?', { name: p.name }), rerender) });
    }
    return h('div', { class: 'person' }, avatar(p.name), h('span', { class: 'grow' }, p.name), items.length ? menu(items) : null);
  };
  const section = (role, title, count) => h('section', {}, h('div', { class: 'sechead' }, h('h2', {}, title), count), c.people.filter(p => p.role === role).map(row));
  const students = c.people.filter(p => p.role === 'student').length;
  return h('div', { class: 'narrow' }, section('teacher', t('Teachers')), section('student', t('Students'), h('small', {}, t(students === 1 ? '{n} student' : '{n} students', { n: students }))));
}

// ---------- grades ----------
async function grades(c, cid) {
  if (c.role === 'teacher') {
    const g = await api(`/classes/${cid}/grades`);
    const cell = x => !x ? '-' : x.grade != null ? x.grade + (x.returned ? '' : '*') : x.submitted ? t('Turned in') : '-';
    return h('div', {}, h('div', { class: 'row' }, h('button', { class: 'pill', onclick: () => save(`/classes/${cid}/grades.csv`, 'grades.csv') }, t('Download CSV')), h('small', {}, t('* graded but not returned yet'))),
      g.posts.length ? h('div', { class: 'scroll card flat' }, h('table', {}, h('thead', {}, h('tr', {}, h('th', {}, t('Student')), g.posts.map(p => h('th', {}, h('a', { href: '#/p/' + p.id }, p.title), p.points != null ? ` /${p.points}` : '')))),
        h('tbody', {}, g.rows.map(r => h('tr', {}, h('td', {}, r.name), r.cells.map(x => h('td', {}, cell(x)))))))) : h('p', { class: 'muted' }, t('No assignments yet.')));
  }
  const mine = c.posts.filter(p => p.kind === 'assignment' || p.kind === 'quiz');
  return h('div', { class: 'narrow' }, mine.length ? mine.map(p => h('a', { class: 'cw-row', href: '#/p/' + p.id }, h('span', { class: 'ico' }, icon(KIND_ICON[p.kind], 20)), h('span', { class: 'grow' }, p.title),
    h('b', {}, p.mine?.returned && p.mine.grade != null ? `${p.mine.grade}${p.points != null ? '/' + p.points : ''}` : '-'))) : h('p', { class: 'muted' }, t('No assignments yet.')));
}

// ---------- settings ----------
function settings(c, cid) {
  const cls = c.class, name = h('input', { value: cls.name, required: true, placeholder: t('Class name') }), section = h('input', { value: cls.section || '', placeholder: t('Section') });
  return h('div', { class: 'narrow' }, h('h2', {}, t('Settings')),
    h('form', { class: 'card', onsubmit: safe(async e => { e.preventDefault(); await api('/classes/' + cid, 'PATCH', { name: name.value, section: section.value }); rerender(); }) }, name, section, h('div', { class: 'actions' }, h('button', { class: 'pill' }, t('Save')))),
    h('div', { class: 'card' }, h('p', {}, t('Student code'), ': ', h('strong', {}, cls.code)), cls.teacher_code ? h('p', {}, t('Co-teacher code'), ': ', h('strong', {}, cls.teacher_code)) : null),
    h('div', { class: 'row' }, h('button', { class: 'pill', onclick: safe(async () => { await api('/classes/' + cid, 'PATCH', { archived: !cls.archived }); rerender(); }) }, cls.archived ? t('Unarchive') : t('Archive')),
      cls.owner ? h('button', { class: 'pill danger', onclick: safe(async () => { if (confirm(t('Delete this class and everything in it?'))) { await api('/classes/' + cid, 'DELETE'); location.hash = '#/'; } }) }, t('Delete class')) : null));
}
