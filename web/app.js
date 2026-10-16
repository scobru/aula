import { state, h, icon, api, safe, setToken, rerender, circle, colorOf, avatar, menu, modal, dot, KIND_ICON } from './lib.js';
import { t, lang, setLang, short, day } from './i18n.js';
import { classPage } from './class.js';
import { postPage } from './post.js';

const app = document.getElementById('app');
const mobile = () => innerWidth < 900;
if (!mobile()) document.body.classList.add('side-open');

const langSelect = () => h('select', { 'aria-label': 'Language', onchange: e => { setLang(e.target.value); rerender(); } },
  [['en', 'English'], ['it', 'Italiano']].map(([v, n]) => h('option', { value: v, selected: v === lang }, n)));

// ---------- auth ----------
function authView() {
  let register = false;
  const draw = () => {
    const name = h('input', { placeholder: t('Name'), hidden: !register, autocomplete: 'name' });
    const username = h('input', { placeholder: t('Username'), required: true, autocomplete: 'username', autocapitalize: 'none' });
    const pw = h('input', { type: 'password', placeholder: t('Password (min 8 characters)'), required: true });
    app.replaceChildren(h('main', { class: 'authpage' }, h('form', {
      class: 'card auth',
      onsubmit: safe(async e => {
        e.preventDefault();
        setToken((await api(register ? '/register' : '/login', 'POST', { name: name.value, username: username.value, password: pw.value })).token);
        rerender();
      }),
    }, h('div', { class: 'logo big' }, h('span', { class: 'mark' }, 'A'), 'Aula'), name, username, pw,
    h('button', { class: 'pill wide' }, register ? t('Create account') : t('Log in')),
    h('a', { href: '#', onclick: e => { e.preventDefault(); register = !register; draw(); } }, register ? t('Have an account? Log in') : t('New here? Register')),
    langSelect())));
  };
  draw();
}

// ---------- shell ----------
function sidebar(classes) {
  const hash = location.hash || '#/';
  const link = (href, ico, label) => h('a', { class: 'nav' + (hash === href ? ' on' : ''), href }, icon(ico), h('span', {}, label));
  const cls = c => h('a', { class: 'nav cls' + (hash.startsWith('#/c/' + c.id) ? ' on' : ''), href: '#/c/' + c.id }, circle(c.name, colorOf(c.id), 32),
    h('span', { class: 'two' }, h('b', {}, c.name), c.section ? h('small', {}, c.section) : null));
  const active = classes.filter(c => !c.archived), teaching = active.filter(c => c.role === 'teacher'), enrolled = active.filter(c => c.role === 'student');
  const group = (title, first, list) => list.length ? h('details', { open: true, class: 'group' }, h('summary', {}, icon('people'), h('span', {}, title), icon('collapse')), first, list.map(cls)) : null;
  return h('aside', { class: 'side' }, link('#/', 'home', t('Home')), link('#/cal', 'calendar', t('Calendar')), h('hr'),
    group(t('Teaching'), link('#/work', 'folder', t('To review')), teaching), group(t('Enrolled'), link('#/work', 'assignment', t('To do')), enrolled), h('hr'),
    link('#/archived', 'archive', t('Archived classes')), link('#/me', 'settings', t('Settings')));
}

function header(page, unread) {
  return h('header', { class: 'topbar' },
    h('button', { class: 'icon-btn', 'aria-label': t('Menu'), onclick: () => document.body.classList.toggle('side-open') }, icon('menu')),
    h('a', { class: 'logo', href: '#/' }, h('span', { class: 'mark' }, 'A'), 'Aula'),
    page.title ? [h('span', { class: 'sep' }, '›'), h('a', { class: 'crumb', href: page.back || location.hash }, h('b', {}, page.title), page.sub ? h('small', {}, page.sub) : null)] : null,
    h('span', { class: 'grow' }),
    h('a', { class: 'icon-btn', href: '#/n', 'aria-label': t('Notifications') }, icon('bell'), h('b', { class: 'badge', id: 'badge', hidden: !unread }, unread || '')),
    h('details', { class: 'menu right' }, h('summary', { 'aria-label': t('Account') }, avatar(state.me.name, 36)),
      h('div', { class: 'pop wide' }, h('p', { class: 'who' }, h('b', {}, state.me.name), h('br'), h('small', {}, state.me.username)),
        h('a', { href: '#/me' }, t('Settings')), h('label', { class: 'f' }, t('Language'), langSelect()),
        h('button', { type: 'button', onclick: safe(async () => { await api('/logout', 'POST').catch(() => {}); setToken(''); rerender(); }) }, t('Log out')))));
}

// ---------- pages (each returns { el, title?, sub?, back? }) ----------
const classCard = c => {
  const top = h('div', { class: 'cover' }, h('b', {}, c.name), c.section ? h('small', {}, c.section) : null);
  top.style.backgroundColor = colorOf(c.id);
  return h('a', { class: 'ccard', href: '#/c/' + c.id }, top, h('div', { class: 'role' }, t(c.role === 'teacher' ? 'teacher' : 'student')));
};

function homePage(classes) {
  const join = () => {
    const code = h('input', { placeholder: t('Class code'), required: true, autocapitalize: 'characters' });
    modal(t('Join class'), code, t('Join'), async () => { location.hash = '#/c/' + (await api('/join', 'POST', { code: code.value })).id; });
  };
  const create = () => {
    const name = h('input', { placeholder: t('Class name'), required: true }), section = h('input', { placeholder: t('Section') });
    modal(t('Create class'), [name, section], t('Create'), async () => { location.hash = '#/c/' + (await api('/classes', 'POST', { name: name.value, section: section.value })).id; });
  };
  const active = classes.filter(c => !c.archived);
  return { el: h('main', { class: 'page' },
    h('div', { class: 'row end' }, menu([{ label: t('Join class'), onclick: join }, { label: t('Create class'), onclick: create }], h('span', { class: 'pill outline' }, icon('add', 20), t('Add')))),
    active.length ? h('div', { class: 'grid' }, active.map(classCard)) : h('p', { class: 'muted' }, t('No classes yet.'))) };
}

function archivedPage(classes) {
  const old = classes.filter(c => c.archived);
  return { el: h('main', { class: 'page' }, h('h1', {}, t('Archived classes')), old.length ? h('div', { class: 'grid' }, old.map(classCard)) : h('p', { class: 'muted' }, t('No archived classes.'))) };
}

const workRow = x => h('a', { class: 'cw-row', href: '#/p/' + x.id }, h('span', { class: 'ico' }, icon(KIND_ICON[x.kind], 20)),
  h('span', { class: 'grow' }, x.title, h('br'), h('small', {}, x.class_name)),
  h('small', {}, dot([x.grade != null && t('Grade: {g}', { g: x.grade }), x.role === 'teacher' && t('{n} to return', { n: x.to_return }), x.due && t('Due: {d}', { d: short(x.due) })])));

async function workPage() {
  const w = await api('/work'), cut = new Date().toISOString(), stu = w.filter(x => x.role === 'student');
  const sections = [
    ['To review', w.filter(x => x.role === 'teacher' && x.to_return > 0)],
    ['Missing', stu.filter(x => !x.submitted_at && x.due && x.due < cut)],
    ['Assigned', stu.filter(x => !x.submitted_at && !(x.due && x.due < cut))],
    ['Done', stu.filter(x => x.submitted_at)],
  ].filter(([, items]) => items.length);
  return { el: h('main', { class: 'page narrow' }, h('h1', {}, t('Work')),
    sections.length ? sections.map(([n, items]) => h('section', {}, h('div', { class: 'sechead' }, h('h2', {}, t(n))), items.map(workRow))) : h('p', { class: 'muted' }, t('Nothing to do.'))) };
}

async function calendarPage() {
  const w = (await api('/work')).filter(x => x.due), groups = new Map();
  for (const x of w) { const k = day(x.due); groups.set(k, [...(groups.get(k) || []), x]); }
  return { el: h('main', { class: 'page narrow' }, h('h1', {}, t('Calendar')),
    groups.size ? [...groups].map(([k, items]) => h('section', {}, h('div', { class: 'sechead' }, h('h2', {}, k)), items.map(workRow))) : h('p', { class: 'muted' }, t('No due dates.'))) };
}

async function notificationsPage() {
  const n = await api('/notifications');
  const T = { post: 'New in {class}: {title}', submitted: '{student} turned in "{title}"', returned: 'Your work "{title}" was returned', comment: '{user} commented on "{title}"', private: '{user} sent a private comment on "{title}"' };
  api('/notifications/read', 'POST').then(() => { const b = document.getElementById('badge'); if (b) b.hidden = true; }).catch(() => {});
  return { el: h('main', { class: 'page narrow' }, h('h1', {}, t('Notifications')),
    n.items.length ? n.items.map(i => h('a', { class: 'cw-row' + (i.read ? '' : ' unread'), href: i.link }, h('span', { class: 'grow' }, t(T[i.kind] || i.kind, i.data)), h('small', {}, short(i.created_at))))
      : h('p', { class: 'muted' }, t('No notifications.'))) };
}

function profilePage() {
  const name = h('input', { value: state.me.name, required: true, placeholder: t('Name') });
  const old = h('input', { type: 'password', placeholder: t('Current password'), required: true });
  const next = h('input', { type: 'password', placeholder: t('New password (min 8 characters)'), required: true });
  const form = (fields, label, onSubmit) => h('form', { class: 'card', onsubmit: safe(async e => { e.preventDefault(); await onSubmit(); }) }, fields, h('div', { class: 'actions' }, h('button', { class: 'pill' }, label)));
  return { el: h('main', { class: 'page narrow' }, h('h1', {}, t('Settings')), h('p', { class: 'muted' }, state.me.username),
    form(name, t('Save'), async () => { await api('/me', 'PUT', { name: name.value }); rerender(); }),
    h('h2', {}, t('Change password')),
    form([old, next], t('Change password'), async () => { await api('/password', 'POST', { old: old.value, new: next.value }); alert(t('Password changed')); old.value = next.value = ''; })) };
}

// an invite link: join with the code in the URL, then open the class
async function joinPage(code) {
  const r = await api('/join', 'POST', { code });
  location.replace('#/c/' + r.id);
  return { el: h('main', { class: 'page' }, h('p', { class: 'muted' }, t('Joining…'))) };
}

// ---------- router ----------
async function render() {
  if (!state.token) return authView();
  const [, kind = '', id, sub] = location.hash.split('/');
  try {
    const [me, classes, notes] = await Promise.all([api('/me'), api('/classes'), api('/notifications')]);
    state.me = me;
    const pages = {
      join: () => joinPage(id),
      c: () => classPage(id, sub, classes), p: () => postPage(id, sub, classes), work: workPage, cal: calendarPage, n: notificationsPage, me: profilePage, archived: () => archivedPage(classes),
    };
    const page = await (pages[kind] || (() => homePage(classes)))();
    if (mobile()) document.body.classList.remove('side-open');
    app.replaceChildren(header(page, notes.unread), sidebar(classes), h('div', { class: 'scrim', onclick: () => document.body.classList.remove('side-open') }), h('div', { class: 'content' }, page.el));
  } catch (e) {
    if (state.token) app.replaceChildren(h('main', { class: 'page' }, h('p', { class: 'err' }, t(e.message)), h('a', { href: '#/' }, t('Home'))));
  }
}
addEventListener('hashchange', render);
addEventListener('click', e => document.querySelectorAll('details.menu[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }));
// the badge is the only thing refreshed in the background, so typing is never interrupted
setInterval(async () => {
  const b = document.getElementById('badge');
  if (state.token && b) { const n = await api('/notifications').catch(() => null); if (n) { b.hidden = !n.unread; b.textContent = n.unread || ''; } }
}, 60000);
render();
