import { el } from './dom.js';

const DATE_FMT = new Intl.DateTimeFormat('sv-SE', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});
const MONTH_FMT = new Intl.DateTimeFormat('sv-SE', { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' });
const ISSUES = 'https://github.com/andreasheige/lunch-app/issues/';

function renderPost(note) {
  const post = el('article', `post ${note.type}`);
  const meta = el('p', 'post-meta');
  const time = el('time', null, DATE_FMT.format(new Date(note.date)));
  time.dateTime = note.date;
  meta.append(el('span', `post-tag ${note.type}`, note.type === 'feat' ? 'Nytt' : 'Fixat'), time);
  post.append(meta, el('h2', 'post-title', note.title));
  if (note.body) post.append(el('p', 'post-body', note.body));
  if (note.issue) {
    const link = el('a', 'post-issue', `Önskemål #${note.issue} ↗`);
    link.href = `${ISSUES}${note.issue}`;
    link.target = '_blank';
    link.rel = 'noopener';
    post.append(link);
  }
  return post;
}

async function main() {
  const container = document.getElementById('notes');
  try {
    const res = await fetch('releases.json');
    if (!res.ok) throw new Error(res.status);
    const notes = await res.json();
    container.replaceChildren();
    if (!notes.length) {
      container.append(el('p', 'notice', 'Inga nyheter än.'));
      return;
    }
    let month = '';
    for (const note of notes) {
      const m = MONTH_FMT.format(new Date(note.date));
      if (m !== month) {
        month = m;
        container.append(el('h2', 'blog-month', m));
      }
      container.append(renderPost(note));
    }
    if (notes.some((n) => n.pending)) {
      container.append(el('p', 'notice', 'Några nyheter skrivs fortfarande om till svenska – ladda om om en stund.'));
    }
  } catch {
    container.replaceChildren(el('p', 'notice', 'Kunde inte hämta nyheterna just nu. Försök igen om en stund.'));
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

main();
