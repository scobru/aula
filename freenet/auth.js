// Sign-in screen for the Freenet build (web/app.js calls globalThis.AULA_AUTH instead of its username + password form).
// Three ways in: a new local key, a key you saved, or Viso. Whatever the way, `setToken(secret)` is what the UI keeps.
let busy = false;

// inside the node's page the app is a sandboxed iframe: leaving it goes through the shell
const goTo = href => (window.parent !== window ? parent.postMessage({ __freenet_shell__: true, type: 'navigate', href }, '*') : void (location.href = href));

globalThis.AULA_AUTH = (app, { h, t, setToken, rerender, safe, langSelect }) => {
  const id = globalThis.AULA_API.id;
  const enter = sk => {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* keep the query */ }
    busy = false;
    setToken(sk);
    rerender();
  };
  const page = (...kids) => app.replaceChildren(h('main', { class: 'authpage' }, h('div', { class: 'card auth' },
    h('div', { class: 'logo big' }, h('span', { class: 'mark' }, 'A'), 'Aula'), ...kids)));
  const fail = e => { busy = false; try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ } form(e.message); };

  function backup(sk) {
    const copy = h('button', { class: 'pill outline', type: 'button', onclick: () => navigator.clipboard?.writeText(sk).then(() => (copy.textContent = t('Copied')), () => {}) }, t('Copy'));
    page(h('h2', {}, t('Save your key')),
      h('p', {}, t('This key is your identity: whoever has it is you, and nobody can recover it for you. Save it somewhere safe now.')),
      h('div', { class: 'code' }, sk), copy,
      h('button', { class: 'pill wide', type: 'button', onclick: () => enter(sk) }, t('I saved it, continue')));
  }

  function form(error) {
    const name = h('input', { placeholder: t('Name'), autocomplete: 'name' });
    const key = h('input', { placeholder: t('Backup key (64 hex characters)'), autocomplete: 'off', spellcheck: false });
    const need = () => { if (!name.value.trim()) throw new Error(t('Name required')); };
    page(
      error ? h('p', { class: 'err' }, t(error)) : null,
      name,
      h('button', { class: 'pill wide', type: 'button', onclick: safe(async () => { need(); backup(await id.create(name.value)); }) }, t('Create a new identity')),
      h('button', { class: 'pill wide outline', type: 'button', onclick: safe(async () => { need(); goTo(await id.visoUrl(name.value)); }) }, t('Sign in with Viso')),
      h('hr'),
      key,
      h('button', { class: 'pill wide outline', type: 'button', onclick: safe(async () => enter(await id.import(key.value, name.value))) }, t('Use this key')),
      id.hasKey() ? [h('button', { class: 'pill wide outline', type: 'button', onclick: safe(async () => enter(await id.resume())) }, t('Continue with the key saved here')),
        h('a', { href: '#', onclick: e => { e.preventDefault(); if (confirm(t('Remove the saved key from this browser? Make sure you have a copy.'))) { id.forget(); form(); } } }, t('Forget the saved key'))] : null,
      langSelect());
  }

  if (busy) return;
  const q = new URLSearchParams(location.search);
  if (q.has('viso') || q.has('whoiam') || q.has('pk')) { busy = true; page(h('p', { class: 'muted' }, t('Checking Viso…'))); id.finishViso(q).then(enter, fail); return; }
  if (id.saved()) { busy = true; id.resume().then(enter, fail); return; }
  form();
};
