// Shared UI helpers: state, DOM builder, API, icons, small components.
import { t } from './i18n.js';

export const state = { token: '', me: null };
try { state.token = localStorage.getItem('aula') || ''; } catch {}

// DOM builder: text always goes in as text nodes, never as HTML
export const h = (tag, p = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(p)) k.startsWith('on') ? e.addEventListener(k.slice(2), v) : k === 'class' ? (e.className = v) : k.includes('-') ? e.setAttribute(k, v) : (e[k] = v);
  if (e.placeholder && !e.getAttribute('aria-label')) e.setAttribute('aria-label', e.placeholder);
  e.append(...kids.flat(Infinity).filter(x => x != null && x !== false));
  return e;
};
export const rerender = () => dispatchEvent(new Event('hashchange'));
export const safe = fn => async (...a) => { try { await fn(...a); } catch (e) { alert(t(e.message)); } };
export const iso = el => (el.value ? new Date(el.value).toISOString() : null);

export function setToken(v) {
  state.token = v;
  try { v ? localStorage.setItem('aula', v) : localStorage.removeItem('aula'); } catch {}
}
const auth = () => (state.token ? { Authorization: 'Bearer ' + state.token } : {});

export async function api(url, method = 'GET', body) {
  const r = await fetch('/api' + url, { method, headers: { ...auth(), ...(body && { 'Content-Type': 'application/json' }) }, body: body && JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    if (r.status === 401 && state.token) { setToken(''); rerender(); }
    throw new Error(j.error || r.statusText);
  }
  return j;
}

export async function upload(postId, file) {
  const r = await fetch(`/api/files?post=${postId}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: auth(), body: file });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
}

// downloads need the auth header, so fetch a blob instead of linking
export async function save(url, name) {
  const r = await fetch('/api' + url, { headers: auth() });
  if (!r.ok) return alert(t('Download failed'));
  const a = h('a', { href: URL.createObjectURL(await r.blob()), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------- icons (Material-style 24px paths) ----------
const PATHS = {
  menu: 'M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z',
  home: 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z',
  calendar: 'M20 3h-1V1h-2v2H7V1H5v2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 18H4V8h16v13z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z',
  assignment: 'M19 3h-4.18C14.4 1.84 13.3 1 12 1s-2.4.84-2.82 2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 0c.55 0 1 .45 1 1s-.45 1-1 1-1-.45-1-1 .45-1 1-1zm2 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z',
  quiz: 'M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z',
  material: 'M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z',
  announcement: 'M21.99 4c0-1.1-.89-2-1.99-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h14l4 4-.01-18zM18 14H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z',
  people: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  more: 'M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  folder: 'M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm0 12H4V8h16v10z',
  archive: 'M20.54 5.23l-1.39-1.68C18.88 3.21 18.47 3 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23C3.17 5.57 3 6.02 3 6.5V19c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5L6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
  bell: 'M12 22c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  clip: 'M16.5 6v11.5c0 2.21-1.79 4-4 4s-4-1.79-4-4V5c0-1.38 1.12-2.5 2.5-2.5s2.5 1.12 2.5 2.5v10.5c0 .55-.45 1-1 1s-1-.45-1-1V6H10v9.5c0 1.38 1.12 2.5 2.5 2.5s2.5-1.12 2.5-2.5V5c0-2.21-1.79-4-4-4S7 2.79 7 5v12.5c0 3.04 2.46 5.5 5.5 5.5s5.5-2.46 5.5-5.5V6h-1.5z',
  expand: 'M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z',
  collapse: 'M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z',
  edit: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
};
export const icon = (name, size = 24) => {
  const NS = 'http://www.w3.org/2000/svg', s = document.createElementNS(NS, 'svg'), p = document.createElementNS(NS, 'path');
  for (const [k, v] of Object.entries({ viewBox: '0 0 24 24', width: size, height: size, fill: 'currentColor', 'aria-hidden': 'true' })) s.setAttribute(k, v);
  p.setAttribute('d', PATHS[name]);
  s.append(p);
  return s;
};

// ---------- small components ----------
const COLORS = ['#1e8e3e', '#1a73e8', '#a142f4', '#e37400', '#d93025', '#12b5cb', '#5f6368', '#c2185b'];
export const colorOf = s => COLORS[[...s].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7) % COLORS.length];

export const circle = (text, color, size = 40, cls = '') => {
  const e = h('span', { class: 'circle ' + cls }, [...text][0]?.toUpperCase() || '?');
  e.style.cssText = `background:${color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.45)}px`;
  return e;
};
export const avatar = (name, size = 40) => circle(name, colorOf(name), size);

// dropdown without JS state: a <details>; app.js closes it on outside click
export const menu = (items, trigger) => h('details', { class: 'menu' },
  h('summary', { class: trigger ? '' : 'icon-btn', 'aria-label': t('Menu') }, trigger ?? icon('more')),
  h('div', { class: 'pop' }, items.filter(Boolean).map(i => h('button', {
    type: 'button', class: i.danger ? 'danger-text' : '',
    onclick: safe(async e => { e.target.closest('details').open = false; await i.onclick(); }),
  }, i.label))));

export function modal(title, body, label, onSubmit) {
  const d = h('dialog', { class: 'modal' }, h('form', { onsubmit: safe(async e => { e.preventDefault(); await onSubmit(); d.close(); }) },
    h('h2', {}, title), body, h('div', { class: 'actions' }, h('button', { type: 'button', class: 'text', onclick: () => d.close() }, t('Cancel')), h('button', { class: 'pill' }, label))));
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

export const attachment = (f, onDelete) => h('div', { class: 'attach' },
  h('a', { href: '#', onclick: e => { e.preventDefault(); save('/files/' + f.id, f.name); } }, h('b', {}, f.name), h('small', {}, `${Math.ceil(f.size / 1024)} KB`)),
  onDelete && h('button', { class: 'icon-btn', 'aria-label': t('Remove'), onclick: safe(async () => { await api('/files/' + f.id, 'DELETE'); onDelete(); }) }, '×'));

export const field = (label, input) => h('label', { class: 'f' }, label, input);
export const dot = parts => parts.filter(Boolean).join(' • ');
export const bar = parts => parts.filter(Boolean).join(' | ');
export const KIND_ICON = { announcement: 'announcement', assignment: 'assignment', quiz: 'quiz', material: 'material' };
