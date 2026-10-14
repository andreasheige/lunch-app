// /news and /news/<slug>: the posts are in the HTML (Swedish, as the build wrote them). This filters the list by
// label, and redraws from the live /releases.json in English, or when a post in the HTML was still waiting for its
// text. The markup mirrors pages/news.astro and pages/news/[slug].astro.
import { el } from './dom.js';
import { LANG, LOCALE, t } from './i18n.js';

const DATE_FMT = new Intl.DateTimeFormat(LOCALE, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'Europe/Stockholm',
});
const MONTH_FMT = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'Europe/Stockholm' });
const PULLS = 'https://github.com/andreasheige/lunch-app/pull/';

const kindCount = (post, kind) => post.changes.filter((c) => c.kind === kind).length;
const summaryOf = (post) => post.summary || post.changes.map((c) => c.title).join(', ');

function labels(kinds) {
  const box = el('span', 'news-labels');
  for (const k of kinds) box.append(el('span', `news-label ${k}`, t(`news.kind.${k}`)));
  return box;
}

function time(iso) {
  const node = el('time', null, DATE_FMT.format(new Date(iso)));
  node.dateTime = iso;
  return node;
}

function link(href, text, className) {
  const a = el('a', className, text);
  a.href = href;
  return a;
}

function row(post) {
  const article = el('article', 'news-row');
  article.dataset.kinds = post.kinds.join(' ');
  const body = el('div', 'news-row-body');
  const title = el('h3', post.changes.length >= 4 ? 'news-row-title big' : 'news-row-title');
  title.append(link(`/news/${post.slug}`, post.title));
  const more = el(
    'p',
    'news-row-more',
    post.changes.length > 1 ? t('news.changes', post.changes.length) : t('news.read'),
  );
  more.setAttribute('aria-hidden', 'true');
  body.append(labels(post.kinds), title, el('p', 'news-row-summary', summaryOf(post)), more);
  article.append(time(post.date), body);
  return article;
}

function renderList(container, posts) {
  const nodes = [];
  let section = null;
  let month = '';
  for (const post of posts) {
    const m = MONTH_FMT.format(new Date(post.date));
    if (m !== month) {
      month = m;
      section = el('section', 'news-month');
      section.append(el('h2', 'news-month-title', m));
      nodes.push(section);
    }
    section.append(row(post));
  }
  container.replaceChildren(...(nodes.length ? nodes : [el('p', 'notice', t('news.empty'))]));
}

function renderPost(main, posts, i) {
  const post = posts[i];
  document.title = `${post.title} – Lunchit`;
  const article = el('article');
  article.id = 'news-post';
  const back = el('p');
  back.append(link('/news', t('news.back'), 'news-back'));
  const meta = el('p', 'news-post-meta');
  meta.append(labels(post.kinds), time(post.date));
  article.append(back, meta, el('h1', null, post.title));
  for (const p of post.intro) article.append(el('p', 'news-intro', p));
  for (const kind of post.kinds) {
    const group = el('section', 'news-group');
    const heading = el('h2');
    heading.append(el('span', `news-label ${kind}`, t(`news.kind.${kind}`)));
    const list = el('ul');
    for (const c of post.changes.filter((x) => x.kind === kind)) {
      const li = el('li');
      li.append(el('strong', null, c.title));
      if (c.text) li.append(el('span', null, c.text));
      list.append(li);
    }
    group.append(heading, list);
    article.append(group);
  }

  const facts = el('aside', 'news-facts');
  const fact = (label, value) => {
    const p = el('p');
    p.append(el('span', null, label), value);
    facts.append(p);
  };
  fact(t('news.released'), el('strong', null, DATE_FMT.format(new Date(post.date))));
  fact(
    t('news.changes-label'),
    el('strong', null, post.kinds.map((k) => t(`news.count.${k}`, kindCount(post, k))).join(' · ')),
  );
  if (post.pr) {
    const pr = link(`${PULLS}${post.pr}`, t('news.pr', post.pr));
    pr.rel = 'noopener';
    fact(t('news.built-in'), pr);
  }

  const pager = el('nav', 'news-pager');
  pager.setAttribute('aria-label', t('news.more-posts'));
  const side = (other, cls, key) => {
    if (!other) return el('span');
    const a = link(`/news/${other.slug}`, null, cls);
    a.append(el('span', null, t(key)), el('strong', null, other.title));
    return a;
  };
  pager.append(side(posts[i + 1], 'older', 'news.older'), side(posts[i - 1], 'newer', 'news.newer'));
  main.replaceChildren(article, facts, pager);
}

// Label filter on the list: hides the rows (and months) without that label.
function setupFilters() {
  const buttons = document.querySelectorAll('.news-filters [data-kind]');
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const kind = button.dataset.kind;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b === button));
      for (const section of document.querySelectorAll('.news-month')) {
        let shown = 0;
        for (const r of section.querySelectorAll('.news-row')) {
          r.hidden = kind !== 'all' && !r.dataset.kinds.split(' ').includes(kind);
          if (!r.hidden) shown++;
        }
        section.hidden = shown === 0;
      }
    });
  }
}

async function main() {
  const list = document.getElementById('news-list');
  const post = document.querySelector('main.news-post');
  if (list) setupFilters();
  if (LANG === 'sv' && !document.querySelector('[data-pending]')) return;
  try {
    const res = await fetch(`/releases.json?lang=${LANG}`);
    if (!res.ok) return;
    const posts = await res.json();
    if (list) {
      renderList(list, posts);
      document.querySelector('.news-filters [aria-pressed="true"]')?.click();
    } else if (post) {
      const i = posts.findIndex((p) => p.slug === post.dataset.slug);
      if (i >= 0) renderPost(post, posts, i);
    }
  } catch {
    // The posts in the HTML stay.
  }
}

main();
