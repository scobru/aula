// A single post: instructions, class comments, the student's work, the teacher's grading.
import { state, h, icon, api, safe, iso, upload, rerender, avatar, menu, attachment, field, dot, bar, KIND_ICON } from './lib.js';
import { t, short, shortDay, local } from './i18n.js';

const KIND = { announcement: 'Announcement', assignment: 'Assignment', quiz: 'Quiz', material: 'Material' };

function thread(items, send, canDelete, label) {
  const input = h('input', { placeholder: label });
  const row = h('form', { class: 'row', hidden: true, onsubmit: safe(async e => { e.preventDefault(); if (input.value.trim()) { await send(input.value); rerender(); } }) }, input, h('button', { class: 'pill' }, t('Send')));
  return h('div', {}, items.map(c => h('div', { class: 'comment' }, avatar(c.author, 32), h('div', { class: 'grow' }, h('b', {}, c.author), ' ', h('small', {}, short(c.created_at)), h('div', { class: 'pre' }, c.body)),
    canDelete?.(c) ? menu([{ label: t('Remove'), danger: true, onclick: async () => { await api('/comments/' + c.id, 'DELETE'); rerender(); } }]) : null)),
  row, h('button', { class: 'text', onclick: e => { row.hidden = false; e.target.hidden = true; input.focus(); } }, icon('announcement', 18), ' ' + label));
}

const quizForm = (pid, quiz) => {
  const picks = quiz.map(() => null);
  return h('div', {}, quiz.map((x, i) => h('fieldset', { class: 'card' }, h('legend', {}, `${i + 1}. ${x.q}`),
    x.options.map((o, j) => h('label', { class: 'opt' }, h('input', { type: 'radio', name: 'q' + i, onchange: () => { picks[i] = j; } }), ' ' + o)))),
  h('button', { class: 'pill', onclick: safe(async () => { if (confirm(t('Submit your answers? You can only do this once.'))) { await api(`/posts/${pid}/quiz`, 'POST', { answers: picks }); rerender(); } }) }, t('Submit answers')));
};
const quizReview = (quiz, answers) => quiz.map((x, i) => h('div', { class: 'card flat' }, h('b', {}, `${i + 1}. ${x.q}`),
  x.options.map((o, j) => h('div', { class: j === x.answer ? 'ok' : j === answers?.[i] ? 'err' : '' }, (j === answers?.[i] ? '(x) ' : '( ) ') + o + (j === x.answer ? ' ✓' : '')))));

function editForm(p) {
  const title = h('input', { value: p.title || '', placeholder: t('Title') }), text = h('textarea', { rows: 3, value: p.body }), topic = h('input', { value: p.topic || '', placeholder: t('Topic (optional)') });
  const due = h('input', { type: 'datetime-local', value: local(p.due) }), pts = h('input', { type: 'number', min: 0, value: p.points ?? '' }), pub = h('input', { type: 'datetime-local', value: local(p.publish_at) });
  return h('div', { class: 'card' }, p.kind !== 'announcement' ? title : null, text, topic, p.kind === 'assignment' || p.kind === 'quiz' ? field(t('Due'), due) : null,
    p.kind === 'assignment' ? field(t('Points'), pts) : null, field(t('Publish later'), pub),
    h('div', { class: 'actions' }, h('button', { class: 'pill', onclick: safe(async () => { await api('/posts/' + p.id, 'PATCH', { title: title.value, body: text.value, topic: topic.value, due: iso(due), points: pts.value === '' ? null : +pts.value, publish_at: iso(pub) }); rerender(); }) }, t('Save'))));
}

function yourWork(d, pid) {
  const p = d.post, s = d.submission, locked = !!s?.returned, late = !s?.submitted_at && p.due && p.due < new Date().toISOString();
  const text = h('textarea', { rows: 5, placeholder: t('Your answer'), value: s?.text ?? '', disabled: locked });
  const saveWork = submit => safe(async () => { await api(`/posts/${pid}/submission`, 'PUT', { text: text.value, submit }); rerender(); });
  const pick = h('input', { type: 'file', multiple: true, hidden: true, onchange: safe(async () => { for (const f of pick.files) await upload(pid, f); rerender(); }) });
  return h('div', { class: 'card work' },
    h('div', { class: 'row' }, h('h3', { class: 'grow' }, t('Your work')), h('small', { class: late ? 'err' : '' }, locked ? t('Returned') : s?.submitted_at ? t('Turned in') : late ? t('Missing') : t('Assigned'))),
    locked && s.grade != null ? h('p', {}, h('b', {}, t('Grade: {g}', { g: s.grade }) + (p.points != null ? ' / ' + p.points : '')), s.feedback && ' — ' + s.feedback) : null,
    text, (s?.files ?? []).map(f => attachment(f, locked ? null : rerender)),
    !locked ? h('div', {}, pick, h('button', { class: 'pill outline wide', onclick: () => pick.click() }, icon('add', 20), t('Add file')),
      h('button', { class: 'pill wide', onclick: saveWork(true) }, s?.submitted_at ? t('Resubmit') : t('Turn in')),
      s?.submitted_at ? h('button', { class: 'text wide', onclick: saveWork(false) }, t('Unsubmit')) : h('button', { class: 'text wide', onclick: saveWork(false) }, t('Save draft'))) : null,
    h('hr'), h('b', {}, t('Private comments')), thread(s?.private ?? [], v => api(`/posts/${pid}/private`, 'POST', { body: v }), null, t('Add private comment')));
}

function teacherWork(d, pid) {
  const p = d.post;
  if (p.kind === 'quiz') return h('div', {}, d.quiz ? quizReview(d.quiz, null) : null, h('h3', {}, t('Submissions ({n})', { n: d.submissions.length })),
    d.submissions.map(s => h('div', { class: 'person' }, avatar(s.student), h('span', { class: 'grow' }, s.student), h('b', {}, `${s.grade ?? '-'} / ${p.points}`), h('small', {}, short(s.submitted_at)))));
  const rows = d.submissions.map(s => {
    const grade = h('input', { type: 'number', min: 0, max: p.points ?? '', value: s.grade ?? '', placeholder: t('Grade') });
    const fb = h('input', { placeholder: t('Feedback'), value: s.feedback ?? '' }), ret = h('input', { type: 'checkbox', checked: !!s.returned });
    return h('div', { class: 'card' }, h('div', { class: 'row' }, avatar(s.student), h('h3', { class: 'grow' }, s.student), h('small', {}, s.submitted_at ? dot([t('Turned in {d}', { d: short(s.submitted_at) }), p.due && s.submitted_at > p.due && t('(late)')]) : t('Draft'))),
      h('p', { class: 'pre' }, s.text), s.files.map(f => attachment(f)),
      h('div', { class: 'row' }, grade, fb, h('label', {}, ret, ' ' + t('Returned')),
        h('button', { class: 'pill', onclick: safe(async () => { await api(`/submissions/${s.id}/grade`, 'PUT', { grade: grade.value, feedback: fb.value, return: ret.checked }); rerender(); }) }, t('Save'))),
      h('b', {}, t('Private comments')), thread(s.private, v => api(`/posts/${pid}/private`, 'POST', { body: v, submission: s.id }), null, t('Add private comment')));
  });
  return h('div', {}, h('div', { class: 'row' }, h('h3', { class: 'grow' }, t('Submissions ({n})', { n: rows.length })),
    h('button', { class: 'pill', onclick: safe(async () => { alert(t('{n} returned', { n: (await api(`/posts/${pid}/return`, 'POST')).returned })); rerender(); }) }, t('Return all graded'))),
  rows.length ? rows : h('p', { class: 'muted' }, t('Nothing turned in yet.')));
}

export async function postPage(pid, sub = '', classes) {
  const d = await api('/posts/' + pid), p = d.post, teacher = d.role === 'teacher', graded = p.kind === 'assignment' || p.kind === 'quiz';
  const cls = classes.find(c => c.id === p.class_id);
  const slot = h('div');
  const titleRow = h('div', { class: 'titlerow' }, h('span', { class: 'ico big' }, icon(KIND_ICON[p.kind])), h('h1', { class: 'grow' }, p.title || t('Announcement')),
    teacher ? menu([{ label: t('Edit'), onclick: () => slot.replaceChildren(editForm(p)) },
      { label: t('Delete'), danger: true, onclick: async () => { if (confirm(t('Delete this post?'))) { await api('/posts/' + pid, 'DELETE'); location.hash = '#/c/' + p.class_id; } } }]) : null);
  const info = [h('p', { class: 'by' }, dot([p.author, shortDay(p.created_at), p.topic])),
    h('p', { class: 'by strong' }, bar([p.points != null && t('{n} points', { n: p.points }), p.due && t('Due: {d}', { d: short(p.due) })]))];
  const instructions = h('div', {}, titleRow, info, slot, h('hr'), p.body ? h('p', { class: 'pre' }, p.body) : null, d.files.length ? h('div', { class: 'attachments' }, d.files.map(f => attachment(f))) : null,
    p.kind === 'quiz' && !teacher ? (d.submission?.submitted_at
      ? [h('p', {}, h('b', {}, t('Grade: {g}', { g: d.submission.grade }) + ' / ' + p.points)), quizReview(d.quiz, d.submission.answers)] : quizForm(pid, d.quiz)) : null,
    h('hr'), h('h3', { class: 'subhead' }, icon('people', 22), t('Class comments')),
    thread(d.comments, v => api(`/posts/${pid}/comments`, 'POST', { body: v }), c => teacher || c.user_id === state.me.id, t('Add class comment')));

  const tabs = teacher && graded ? h('div', { class: 'tabbar' }, h('nav', { class: 'tabs' }, [['', 'Instructions'], ['work', 'Student work']].map(([k, n]) => h('a', { href: '#/p/' + pid + (k && '/' + k), class: k === sub ? 'on' : '' }, t(n))))) : null;
  const body = teacher && sub === 'work' ? h('div', { class: 'narrow' }, teacherWork(d, pid))
    : !teacher && p.kind === 'assignment' ? h('div', { class: 'cols post2' }, instructions, yourWork(d, pid)) : h('div', { class: 'narrow' }, instructions);
  return { el: h('div', {}, tabs, h('div', { class: 'page' }, body)), title: cls?.name, sub: cls?.section, back: '#/c/' + p.class_id };
}
