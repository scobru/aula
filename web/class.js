// The class page: Stream, Classwork, People, Grades and Settings.
import { state, h, icon, api, safe, iso, upload, save, rerender, avatar, colorOf, menu, modal, attachment, field, dot, audiencePicker, linkAdder, KIND_ICON } from './lib.js';
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
  const teacher = c.role === 'teacher', cls = c.class, topics = c.topics;
  const slot = h('div'), list = h('div');
  const filter = h('select', { 'aria-label': t('Filter by topic') }, h('option', { value: '' }, t('All topics')), topics.map(x => h('option', { value: x }, x)));
  const open = kind => slot.replaceChildren(composer(cid, kind, topics, students(c), () => slot.replaceChildren()));
  const nameTopic = (title, value, onSubmit) => {
    const name = h('input', { placeholder: t('Topic name'), required: true, value, maxLength: 60 });
    modal(title, name, t('Save'), () => onSubmit(name.value));
  };
  const move = async (i, by) => {
    const names = [...topics];
    [names[i], names[i + by]] = [names[i + by], names[i]];
    await api(`/classes/${cid}/topics/order`, 'PUT', { names });
    rerender();
  };
  const topicMenu = (name, i) => menu([
    { label: t('Rename'), onclick: () => nameTopic(t('Rename topic'), name, async to => { await api(`/classes/${cid}/topics`, 'PATCH', { from: name, to }); rerender(); }) },
    i > 0 && { label: t('Move up'), onclick: () => move(i, -1) },
    i < topics.length - 1 && { label: t('Move down'), onclick: () => move(i, 1) },
    { label: t('Delete'), danger: true, onclick: async () => {
      if (!confirm(t('Delete the topic "{name}"? Its posts stay in Classwork without a topic.', { name }))) return;
      await api(`/classes/${cid}/topics?name=${encodeURIComponent(name)}`, 'DELETE');
      rerender();
    } },
  ]);
  const create = teacher && !cls.archived ? menu([
    ...[['assignment', 'Assignment'], ['quiz', 'Quiz'], ['material', 'Material']].map(([k, n]) => ({ label: t(n), onclick: () => open(k) })),
    { label: t('Topic'), onclick: () => nameTopic(t('Create topic'), '', async name => { await api(`/classes/${cid}/topics`, 'POST', { name }); rerender(); }) },
  ], h('span', { class: 'pill' }, icon('add', 20), t('Create'))) : null;

  const row = p => {
    const m = p.mine, state_ = m ? (m.returned && m.grade != null ? t('Grade: {g}', { g: m.grade }) : m.returned ? t('Returned') : m.submitted_at ? t('Turned in') : null) : null;
    return h('a', { class: 'cw-row', href: '#/p/' + p.id }, h('span', { class: 'ico' }, icon(KIND_ICON[p.kind], 20)), h('span', { class: 'grow' }, p.title),
      h('small', {}, dot([teacher && p.audience && forN(p.audience.length), state_, p.due ? t('Due: {d}', { d: short(p.due) }) : teacher && p.publish_at > new Date().toISOString() ? t('Scheduled: {d}', { d: short(p.publish_at) }) : t('Posted: {d}', { d: shortDay(p.created_at) })])));
  };
  const draw = () => {
    const by = new Map(topics.map(x => [x, []])), loose = [];
    for (const p of c.posts.filter(p => p.kind !== 'announcement' && (!filter.value || p.topic === filter.value))) (by.get(p.topic) ?? loose).push(p);
    const sections = [loose.length && h('section', { class: 'topic' }, loose.map(row)),
      ...topics.filter(x => !filter.value || x === filter.value).map((name, i) => {
        const rows = by.get(name);
        if (!rows.length && !teacher) return null;
        const body = h('div', { class: 'topic-body' }, rows.length ? rows.map(row) : h('p', { class: 'muted' }, t('Nothing here yet.')));
        const fold = h('button', { class: 'icon-btn', 'aria-label': t('Collapse all'), onclick: () => { body.hidden = !body.hidden; fold.classList.toggle('shut', body.hidden); } }, icon('collapse'));
        return h('section', { class: 'topic' }, h('div', { class: 'topic-head' }, h('h2', {}, name), teacher && !cls.archived ? topicMenu(name, topics.indexOf(name)) : null, fold), body);
      })];
    list.replaceChildren(...sections.filter(Boolean));
    if (!list.children.length) list.append(h('p', { class: 'muted' }, t('No classwork yet.')));
  };
  filter.onchange = draw;
  draw();
  return h('div', { class: 'narrow' }, h('div', { class: 'row' }, create), slot,
    h('div', { class: 'row toolbar' }, topics.length ? filter : null, h('span', { class: 'grow' }),
      h('button', { class: 'text', onclick: () => list.querySelectorAll('.topic-body').forEach(b => { b.hidden = true; b.previousSibling?.querySelector('.icon-btn:last-child')?.classList.add('shut'); }) }, t('Collapse all'))), list);
}

// ---------- people ----------
function people(c, cid) {
  const teacher = c.role === 'teacher', owner = c.class.owner;
  const act = (path, method, confirmMsg, after) => async () => {
    if (!confirm(confirmMsg)) return;
    after(await api(path, method));
  };
  const tempPw = r => t('Username: {u}\nTemporary password: {p}\nTell them to change it in Profile. It is shown only once.', { u: r.username, p: r.password });
  const row = (p, pick) => {
    const items = [];
    if (p.id === state.me.id) { if (!owner) items.push({ label: t('Leave class'), onclick: act(`/classes/${cid}/members/${p.id}`, 'DELETE', t('Leave this class?'), () => { location.hash = '#/'; }) }); }
    else if (teacher && (p.role === 'student' || owner)) {
      if (p.role === 'student') items.push({ label: t('Reset password'), onclick: act(`/classes/${cid}/members/${p.id}/reset`, 'POST', t('Reset the password of {name}? They will be signed out everywhere.', { name: p.name }), r => alert(tempPw(r))) });
      items.push({ label: t('Remove'), danger: true, onclick: act(`/classes/${cid}/members/${p.id}`, 'DELETE', t('Remove {name} from the class?', { name: p.name }), rerender) });
    }
    return h('div', { class: 'person' }, pick, avatar(p.name), h('span', { class: 'grow' }, p.name), items.length ? menu(items) : null);
  };

  // students join by code; there is no email to send an invitation to, so "invite" shows the code and a link
  const invite = (title, code) => {
    const link = `${location.origin}${location.pathname}#/join/${code}`;
    modal(title, [h('p', {}, t('Share this code, or send the link')), h('div', { class: 'code' }, code), h('small', {}, link)], t('Copy link'), () => navigator.clipboard?.writeText(link));
  };
  const inviteBtn = (title, code) => teacher && !c.class.archived
    ? h('button', { class: 'icon-btn', 'aria-label': title, title, onclick: () => invite(title, code) }, icon('person_add')) : null;

  const teachers = c.people.filter(p => p.role === 'teacher'), everyone = c.people.filter(p => p.role === 'student');
  const teachersEl = h('section', {}, h('div', { class: 'sechead' }, h('h2', {}, t('Teachers')), inviteBtn(t('Invite teachers'), c.class.teacher_code)), teachers.map(p => row(p)));

  let desc = false;
  const selected = new Set(), boxes = new Map(), head = h('div', { class: 'person tools' }), list = h('div');
  const bulk = (label, danger, confirmMsg, fn) => ({ label, danger, onclick: async () => {
    if (!selected.size || !confirm(confirmMsg(selected.size))) return;
    await fn([...selected]);
    rerender();
  } });
  const drawHead = () => {
    const all = h('input', { type: 'checkbox', 'aria-label': t('Select all'), checked: selected.size > 0 && selected.size === everyone.length, onchange: e => {
      selected.clear();
      if (e.target.checked) everyone.forEach(p => selected.add(p.id));
      boxes.forEach((b, id) => { b.checked = selected.has(id); });
      drawHead();
    } });
    const actions = teacher && selected.size ? menu([
      bulk(t('Reset password'), false, n => t('Reset the password of {n} students? They will be signed out everywhere.', { n }), async ids => {
        const lines = [];
        for (const id of ids) {
          const name = everyone.find(p => p.id === id).name;
          try { const r = await api(`/classes/${cid}/members/${id}/reset`, 'POST'); lines.push(`${name}: ${r.username} / ${r.password}`); }
          catch (e) { lines.push(`${name}: ${t(e.message)}`); }
        }
        alert(t('Temporary passwords (shown only once):') + '\n' + lines.join('\n'));
      }),
      bulk(t('Remove'), true, n => t('Remove {n} students from the class?', { n }), async ids => { for (const id of ids) await api(`/classes/${cid}/members/${id}`, 'DELETE'); }),
    ], h('span', { class: 'pill outline' }, t('Actions'), icon('expand', 18)))
      : teacher ? h('span', { class: 'pill outline off' }, t('Actions'), icon('expand', 18)) : null;
    head.replaceChildren(teacher ? all : null, actions, h('span', { class: 'grow' }),
      h('button', { class: 'text', onclick: () => { desc = !desc; drawList(); } }, desc ? 'Z–A' : 'A–Z'));
  };
  const drawList = () => {
    boxes.clear();
    const sorted = [...everyone].sort((a, b) => a.name.localeCompare(b.name) * (desc ? -1 : 1));
    list.replaceChildren(...sorted.map(p => {
      const pick = teacher ? h('input', { type: 'checkbox', 'aria-label': p.name, checked: selected.has(p.id), onchange: e => { e.target.checked ? selected.add(p.id) : selected.delete(p.id); drawHead(); } }) : null;
      if (pick) boxes.set(p.id, pick);
      return row(p, pick);
    }));
    drawHead();
  };
  drawList();
  const studentsEl = h('section', {}, h('div', { class: 'sechead' }, h('h2', {}, t('Students')), h('small', {}, t(everyone.length === 1 ? '{n} student' : '{n} students', { n: everyone.length })),
    inviteBtn(t('Invite students'), c.class.code)), head, list);
  return h('div', { class: 'narrow' }, teachersEl, studentsEl);
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
    h('div', { class: 'card' }, h('p', {}, t('Student code'), ': ', h('strong', {}, cls.code)), h('p', {}, t('Co-teacher code'), ': ', h('strong', {}, cls.teacher_code))),
    h('div', { class: 'row' }, h('button', { class: 'pill', onclick: safe(async () => { await api('/classes/' + cid, 'PATCH', { archived: !cls.archived }); rerender(); }) }, cls.archived ? t('Unarchive') : t('Archive')),
      cls.owner ? h('button', { class: 'pill danger', onclick: safe(async () => { if (confirm(t('Delete this class and everything in it?'))) { await api('/classes/' + cid, 'DELETE'); location.hash = '#/'; } }) }, t('Delete class')) : null));
}
