import { el } from './dom.js';
import { LANG, LOCALE, num, t } from './i18n.js';
import { drawQuestions, rank, reasonText } from './picker.js';

const TZ = 'Europe/Stockholm';
const DATE_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const WALK_M_PER_MIN = 80;
const ALLERGENS = ['nuts', 'gluten', 'lactose', 'shellfish', 'egg'];
const FILTER_KEY = 'lunch-filter';
// Short diet labels on each dish; also the diets the filter accepts.
const DIETS = { veg: t('tag.veg'), fish: t('tag.fish'), meat: t('tag.meat') };

function minutesNow() {
  const [h, m] = TIME_FMT.format(new Date()).split(':').map(Number);
  return h * 60 + m;
}

const toMinutes = (t) => {
  const [h, m] = t.split(/[.:]/).map(Number);
  return h * 60 + m;
};

// Live status from an "11.00–13.30" hours string; null when it isn't today's menu.
function status(r, isToday) {
  const [openTime, closeTime] = r.hours.split(/\s*[–-]\s*/);
  if (!isToday || !closeTime) return null;
  const now = minutesNow();
  if (now < toMinutes(openTime)) return { state: 'soon', text: t('status.soon', openTime) };
  const left = toMinutes(closeTime) - now;
  if (left <= 0) return { state: 'closed', text: t('status.closed') };
  if (left <= 30) return { state: 'closing', text: t('status.closing', left) };
  return { state: 'open', text: t('status.open', closeTime) };
}

// The dish's diet as a short text label; an AI guess says so on hover.
function dietTag(d) {
  const label = DIETS[d.diet];
  if (!label) return [];
  const tag = el('span', `tag ${d.diet}`, label);
  if (d.dietByAi) tag.title = t('ai-guess', t(`diet.${d.diet}`));
  return [tag];
}

const VOTER_KEY = 'lunch-voter';
const VOTES_KEY = 'lunch-votes';

// A random id per browser, so a changed vote replaces the old one; it isn't tied to a person.
function voterId() {
  let id = readStored(VOTER_KEY, null);
  if (!id) {
    id = crypto.randomUUID();
    writeStored(VOTER_KEY, id);
  }
  return id;
}

// Today's averages from /ratings.json, keyed "restaurantId\ndish name"; votes made here update it.
const ratings = {};
const ratingKey = (r, d) => `${r.id}\n${d.name}`;

// "★ 4,5 · 2 röster", plus your own vote; "Inga röster än" before anyone has voted.
function summaryText(s, mine) {
  const base = s?.count ? `★ ${num(s.avg)} · ${t('votes', s.count)}` : t('rate.none');
  return mine ? `${base} · ${t('rate.yours', mine)}` : base;
}

// The short "★ 4,5" next to a dish name; empty until someone has voted.
const avgText = (key) => (ratings[key]?.count ? `★ ${num(ratings[key].avg)}` : '');

// Today's average, your vote and a "Betygsätt" button that opens five star buttons. A click votes (or changes your
// vote) for this dish.
function ratingRow(r, d, date) {
  const row = el('div', 'rating');
  const key = ratingKey(r, d);
  row.dataset.key = key;
  const voteKey = `${date}|${key}`;
  const line = el('p', 'rating-line');
  const summary = el('span', 'rating-summary');
  const toggle = el('button', 'rating-toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  line.append(summary, toggle);
  const stars = el('div', 'stars');
  stars.setAttribute('role', 'group');
  stars.setAttribute('aria-label', t('rate.label', tr(d.name)));
  stars.hidden = true;
  const mine = () => readStored(VOTES_KEY, {})[voteKey] ?? 0;
  const sync = () => {
    const vote = mine();
    summary.textContent = summaryText(ratings[key], vote);
    summary.classList.toggle('has-votes', Boolean(ratings[key]?.count));
    toggle.textContent = stars.hidden ? t(vote ? 'rate.change' : 'rate.open') : t('rate.done');
    toggle.setAttribute('aria-expanded', String(!stars.hidden));
    for (const b of stars.children) {
      const n = Number(b.dataset.stars);
      b.textContent = n <= vote ? '★' : '☆';
      b.setAttribute('aria-pressed', String(n === vote));
    }
    for (const avg of document.querySelectorAll('.dish-avg'))
      if (avg.dataset.key === key) avg.textContent = avgText(key);
  };
  toggle.addEventListener('click', () => {
    stars.hidden = !stars.hidden;
    sync();
    if (!stars.hidden) (stars.querySelector('[aria-pressed="true"]') ?? stars.firstChild).focus();
  });
  for (let i = 1; i <= 5; i++) {
    const b = el('button', 'star', '☆');
    b.type = 'button';
    b.dataset.stars = String(i);
    b.setAttribute('aria-label', t('rate.star', i));
    b.addEventListener('click', async () => {
      const votes = readStored(VOTES_KEY, {});
      const before = votes[voteKey] ?? 0;
      writeStored(VOTES_KEY, { ...votes, [voteKey]: i });
      stars.hidden = true;
      sync();
      toggle.focus();
      try {
        const res = await fetch('rate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ restaurant: r.id, dish: d.name, stars: i, voter: voterId() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        ratings[key] = data;
        sync();
      } catch {
        writeStored(VOTES_KEY, { ...readStored(VOTES_KEY, {}), [voteKey]: before || undefined });
        sync();
        summary.textContent = t('rate.failed');
      }
    });
    stars.append(b);
  }
  row.update = sync;
  sync();
  row.append(line, stars);
  return row;
}

async function fillRatings() {
  try {
    const res = await fetch('ratings.json', { cache: 'no-store' });
    if (!res.ok) return;
    Object.assign(ratings, await res.json());
    for (const row of document.querySelectorAll('.rating')) row.update();
    for (const avg of document.querySelectorAll('.dish-avg')) avg.textContent = avgText(avg.dataset.key);
  } catch {}
}

// A Canva menu loads only on request: the embed keeps polling and sets third-party cookies.
function embedFacade(r) {
  const box = el('div', 'embed-facade');
  const show = el('button', 'embed-show', t('card.embed-show'));
  show.type = 'button';
  show.addEventListener('click', () => {
    const frame = el('iframe', 'embed');
    frame.src = r.embed;
    frame.title = t('card.embed', r.name);
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    box.replaceWith(frame);
  });
  const link = el('a', 'source', t('card.embed-open'));
  link.href = r.embed;
  link.target = '_blank';
  link.rel = 'noopener';
  box.append(el('p', 'embed-note', t('card.embed-note')), show, link);
  return box;
}

const walkMinutes = (r) => Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
// A category that only repeats the diet label ("Kött", "Veg") is left out.
const REPEATS_DIET = /^(kött|fisk|veg|vegetarisk[at]?|vegetariska|grönt)$/i;
const shownCategory = (d) => (d.category && !REPEATS_DIET.test(d.category.trim()) ? tr(d.category) : '');

// "Öppet till 14.00 · 1 min gång · 11.30–14.00" (rows leave the hours out); the status span is kept up to date
// by keepTime.
function placeMeta(r, withHours = true) {
  const meta = el('p', 'place-meta');
  const s = status(r, lunch.isToday);
  if (s) {
    const badge = el('span', `status ${s.state}`, s.text);
    badge.dataset.statusFor = r.id;
    meta.append(badge, ' · ');
  }
  meta.append(el('span', 'walk', t('card.walk', walkMinutes(r))));
  if (withHours) meta.append(' · ', el('span', 'hours', r.hours));
  return meta;
}

function sourceLink(r) {
  const link = el('a', 'source', `${t('card.source')} ↗`);
  link.href = r.url;
  link.target = '_blank';
  link.rel = 'noopener';
  return link;
}

// The filter applied to one place: the dishes to show (dishes without a diet stay, marked unsure, when a diet is
// chosen) and the allergens each one mentions from the flagged list.
function filtered(r) {
  return r.dishes
    .filter((d) => !filter.diets.length || !d.diet || filter.diets.includes(d.diet))
    .map((d) => ({
      d,
      unsure: filter.diets.length > 0 && !d.diet,
      hits: (d.mentions ?? []).filter((a) => filter.allergens.includes(a)),
    }));
}

// Diet label, name and (when flagged) the allergen note: the line every view shows for a dish.
function dishLine(r, { d, unsure, hits }, withAvg) {
  const line = el('span', 'dish-line');
  const name = el('span', 'dish-name');
  name.append(...dietTag(d), tr(d.name));
  line.append(name);
  if (withAvg) {
    const avg = el('span', 'dish-avg', avgText(ratingKey(r, d)));
    avg.dataset.key = ratingKey(r, d);
    line.append(avg);
  }
  if (hits.length) line.append(el('span', 'mentions', t('mentions', allergenNames(hits))));
  if (unsure) line.title = t('filter.unsure');
  return line;
}

// Category, description and rating: what opening a dish shows.
function dishDetails(r, d) {
  const box = el('div', 'dish-details');
  const category = shownCategory(d);
  if (category) box.append(el('span', 'category', category));
  if (d.description) box.append(el('span', 'desc', tr(d.description)));
  if (lunch.rateDate) box.append(ratingRow(r, d, lunch.rateDate));
  return box;
}

// The menu body shared by the views: an error, the Canva facade, or nothing (the view lists the dishes).
function menuIssues(r) {
  if (r.error) return [el('p', 'empty', tr(r.error))];
  if (r.embed) return [embedFacade(r)];
  return [];
}

const CARD_LIMIT = 4;
const expandedCards = new Set();

// View A, "Kort": a card per place, one line per dish; a dish opens (<details>) to its description and rating.
// Long menus show the first four dishes and a "Visa N till" button.
function cardsView() {
  const grid = el('div', 'cards');
  for (const r of lunch.sorted) {
    const card = el('article', 'card');
    card.dataset.id = r.id;
    const head = el('div', 'card-head');
    head.append(el('h2', null, r.name), placeMeta(r));
    if (r.price) head.append(el('p', 'price', tr(r.price)));
    if (r.stale) head.append(el('p', 'badge warn', t('card.stale', r.menuWeek)));
    card.append(head, ...menuIssues(r));
    if (!r.error && !r.embed) {
      const dishes = filtered(r);
      const list = el('ul', 'dish-list');
      const open = expandedCards.has(r.id) || dishes.length <= CARD_LIMIT + 1;
      for (const [i, f] of dishes.entries()) {
        const li = el('li', f.unsure ? 'unsure' : null);
        const details = el('details', 'dish');
        const summary = el('summary');
        summary.append(dishLine(r, f, true));
        details.append(summary, dishDetails(r, f.d));
        li.append(details);
        li.hidden = !open && i >= CARD_LIMIT;
        list.append(li);
      }
      card.append(list);
      if (!dishes.length) card.append(el('p', 'empty', t('filter.none')));
      if (dishes.length > CARD_LIMIT + 1) {
        const more = el('button', 'card-more', open ? t('card.fewer') : t('card.more', dishes.length - CARD_LIMIT));
        more.type = 'button';
        more.setAttribute('aria-expanded', String(open));
        more.addEventListener('click', () => {
          if (open) expandedCards.delete(r.id);
          else expandedCards.add(r.id);
          renderListing();
          document.querySelector(`.card[data-id="${CSS.escape(r.id)}"] .card-more`)?.focus();
        });
        card.append(more);
      }
    }
    card.append(sourceLink(r));
    grid.append(card);
  }
  return grid;
}

let selectedPlace = null;

// One row per place in view B: name, status and walk, a one-line preview of the dishes, and the counts.
function overviewRow(r, dishes, tag) {
  const row = el(tag, 'place-row');
  const text = el('span', 'place-row-text');
  text.append(el('span', 'place-row-name', r.name), placeMeta(r, false));
  const names = dishes.map(({ d }) => tr(d.name)).join(' · ');
  if (names) text.append(el('span', 'place-row-preview', names));
  const counts = el('span', 'place-row-counts');
  const veg = dishes.filter(({ d }) => d.diet === 'veg').length;
  counts.append(el('span', null, t('filter.count', dishes.length)));
  if (veg) counts.append(el('span', 'veg', t('overview.veg', veg)));
  row.append(text, counts);
  return row;
}

// The whole menu of one place, descriptions shown: view B's detail pane (desktop) or opened row (phone).
function placeMenu(r) {
  const menu = el('div', 'place-menu');
  if (r.price) menu.append(el('p', 'price', tr(r.price)));
  if (r.stale) menu.append(el('p', 'badge warn', t('card.stale', r.menuWeek)));
  menu.append(...menuIssues(r));
  if (!r.error && !r.embed) {
    const dishes = filtered(r);
    const list = el('ul', 'menu-list');
    for (const f of dishes) {
      const li = el('li', f.unsure ? 'unsure' : null);
      li.append(dishLine(r, f, false), dishDetails(r, f.d));
      list.append(li);
    }
    menu.append(list);
    if (!dishes.length) menu.append(el('p', 'empty', t('filter.none')));
  }
  menu.append(sourceLink(r));
  return menu;
}

// View B, "Översikt": every place on one row. Wide screens show the chosen place's menu beside the list; on a
// phone a row opens in place (one at a time).
function overviewView() {
  const box = el('div', 'overview');
  const list = el('ul', 'place-list');
  if (wide.matches) {
    selectedPlace ??= lunch.sorted[0]?.id;
    for (const r of lunch.sorted) {
      const li = el('li');
      const row = overviewRow(r, filtered(r), 'button');
      row.type = 'button';
      row.setAttribute('aria-pressed', String(r.id === selectedPlace));
      row.addEventListener('click', () => {
        selectedPlace = r.id;
        renderListing();
        document.querySelector('.place-row[aria-pressed="true"]')?.focus();
      });
      li.append(row);
      list.append(li);
    }
    const r = lunch.sorted.find((x) => x.id === selectedPlace) ?? lunch.sorted[0];
    const detail = el('section', 'place-detail');
    detail.dataset.id = r.id;
    detail.setAttribute('aria-label', r.name);
    detail.append(el('h2', null, r.name), placeMeta(r), placeMenu(r));
    box.append(list, detail);
  } else {
    for (const r of lunch.sorted) {
      const li = el('li');
      const details = el('details', 'place-acc');
      details.name = 'place';
      details.dataset.id = r.id;
      details.open = r.id === selectedPlace;
      details.addEventListener('toggle', () => {
        if (details.open) selectedPlace = r.id;
        else if (selectedPlace === r.id) selectedPlace = null;
      });
      const summary = overviewRow(r, filtered(r), 'summary');
      details.append(summary, placeMenu(r));
      li.append(details);
      list.append(li);
    }
    box.append(list);
  }
  return box;
}

// View C, "Rätter": every dish on its own row with its place, walk and status; a table on wide screens.
function dishesView() {
  const rows = lunch.sorted.flatMap((r) => (r.error || r.embed ? [] : filtered(r).map((f) => ({ r, f }))));
  if (!wide.matches) {
    const list = el('ul', 'dish-rows');
    for (const { r, f } of rows) {
      const li = el('li', f.unsure ? 'unsure' : null);
      li.dataset.id = r.id;
      const details = el('details', 'dish');
      const summary = el('summary');
      const where = el('span', 'dish-where');
      where.append(el('strong', null, r.name), ' · ', placeMeta(r, false));
      summary.append(dishLine(r, f, true), where);
      details.append(summary, dishDetails(r, f.d));
      li.append(details);
      list.append(li);
    }
    return list;
  }
  const table = el('table', 'dish-table');
  const head = el('tr');
  for (const key of ['table.dish', 'table.place', 'table.walk', 'table.status', 'table.rating']) {
    const th = el('th', null, t(key));
    th.scope = 'col';
    head.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  let last = null;
  for (const { r, f } of rows) {
    const tr_ = el('tr', f.unsure ? 'unsure' : null);
    tr_.dataset.id = r.id;
    if (r !== last) tr_.classList.add('first-of-place');
    const dish = el('td');
    dish.append(dishLine(r, f, false));
    if (f.d.description) dish.append(el('span', 'desc', tr(f.d.description)));
    const first = r !== last;
    const s = first && status(r, lunch.isToday);
    const st = el('td', 'status-cell');
    if (s) {
      const badge = el('span', `status ${s.state}`, s.text);
      badge.dataset.statusFor = r.id;
      st.append(badge);
    }
    const avg = el('td', 'dish-avg', avgText(ratingKey(r, f.d)));
    avg.dataset.key = ratingKey(r, f.d);
    const walk = el('td', 'walk-cell', first ? t('card.walk-short', walkMinutes(r)) : '');
    tr_.append(dish, el('td', 'place-cell', first ? r.name : ''), walk, st, avg);
    table.tBodies[0].append(tr_);
    last = r;
  }
  return table;
}

const VIEWS = { cards: cardsView, overview: overviewView, dishes: dishesView };
const VIEW_KEY = 'lunch-view';
const wide = matchMedia('(min-width: 1024px)');
// Cards on phones and overview on wide screens, unless the visitor picked a view.
const currentView = () => {
  const saved = readStored(VIEW_KEY, null);
  return saved in VIEWS ? saved : wide.matches ? 'overview' : 'cards';
};

// Redraws the listing in the current view, with the current filter and today's ratings.
function renderListing() {
  if (!lunch?.sorted) return;
  const view = currentView();
  for (const b of document.querySelectorAll('[data-view]'))
    b.setAttribute('aria-pressed', String(b.dataset.view === view));
  const container = document.getElementById('restaurants');
  container.dataset.view = view;
  container.replaceChildren(...lunch.notices.map((n) => el('p', 'notice', n)), VIEWS[view]());
  updateFilterSummary(filter);
}

function setupViews() {
  for (const b of document.querySelectorAll('[data-view]')) {
    b.addEventListener('click', () => {
      writeStored(VIEW_KEY, b.dataset.view);
      renderListing();
    });
  }
  wide.addEventListener('change', renderListing);
}

const fmtMinutes = (m) => `${Math.floor(m / 60)}.${String(m % 60).padStart(2, '0')}`;

// One sentence on where lunch stands, and a second row when the first places close within half an hour.
function renderHeaderStatus() {
  const line = document.getElementById('lunch-status');
  const soonLine = document.getElementById('lunch-soon');
  soonLine.hidden = true;
  if (!lunch?.isToday || !lunch.data.day) {
    line.textContent = '';
    return;
  }
  const now = minutesNow();
  const spans = lunch.data.restaurants
    .map((r) => r.hours.split(/\s*[–-]\s*/).map((x) => (x ? toMinutes(x) : Number.NaN)))
    .filter(([open, close]) => !Number.isNaN(open) && !Number.isNaN(close));
  const serving = spans.filter(([open, close]) => now >= open && now < close);
  if (serving.length) {
    const latest = Math.max(...serving.map(([, close]) => close));
    line.textContent = t('now.on', fmtMinutes(latest));
    const soon = serving.filter(([, close]) => close - now <= 30 && close < latest);
    if (soon.length) {
      const by = Math.max(...soon.map(([, close]) => close));
      soonLine.textContent = t('now.soon', soon.length, serving.length, fmtMinutes(by));
      soonLine.hidden = false;
    }
  } else if (spans.length && now < Math.min(...spans.map(([open]) => open))) {
    line.textContent = t('now.starts', fmtMinutes(Math.min(...spans.map(([open]) => open))));
  } else {
    line.textContent = t('now.over');
  }
}

// The header sentence and the open/closing statuses follow the time: redrawn on each new minute, and at once
// when the tab is shown again (background tabs' timers are throttled).
function keepTime(isToday) {
  const update = () => {
    renderHeaderStatus();
    for (const badge of document.querySelectorAll('[data-status-for]')) {
      const r = lunch.data.restaurants.find((x) => x.id === badge.dataset.statusFor);
      const s = r && status(r, isToday);
      if (!s) continue;
      badge.className = `status ${s.state}`;
      badge.textContent = s.text;
    }
  };
  const next = () => setTimeout(tick, 60_000 - (Date.now() % 60_000) + 50);
  const tick = () => {
    update();
    next();
  };
  next();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) update();
  });
}

// Saved per browser; storage can be unavailable (private mode), so failures just mean no memory.
function loadFilter() {
  try {
    const saved = JSON.parse(localStorage.getItem(FILTER_KEY) ?? '{}');
    return {
      diets: (saved.diets ?? []).filter((d) => d in DIETS),
      allergens: (saved.allergens ?? []).filter((a) => ALLERGENS.includes(a)),
    };
  } catch {
    return { diets: [], allergens: [] };
  }
}

function saveFilter(filter) {
  try {
    localStorage.setItem(FILTER_KEY, JSON.stringify(filter));
  } catch {}
}

const allergenNames = (ids) => ids.map((a) => t(`allergen.${a}`).toLocaleLowerCase(LOCALE)).join(', ');

// The filter's counts and summary: dishes per diet on the buttons, the badge, and what the toolbar says.
function updateFilterSummary(filter) {
  const menus = lunch?.sorted?.filter((r) => !r.error && !r.embed) ?? [];
  const all = menus.flatMap((r) => r.dishes);
  const shown = menus.reduce((n, r) => n + filtered(r).length, 0);
  for (const count of document.querySelectorAll('[data-count]')) {
    count.textContent = all.length ? String(all.filter((d) => d.diet === count.dataset.count).length) : '';
  }
  const n = filter.diets.length + filter.allergens.length;
  const badge = document.getElementById('filter-count');
  badge.hidden = n === 0;
  badge.textContent = String(n);
  document.getElementById('filter-clear').disabled = n === 0;
  document.getElementById('filter-done').textContent = t('filter.show', shown);
  const parts = [
    ...filter.diets.map((d) => t(`diet.${d}`)),
    ...(filter.allergens.length ? [t('filter.flagging', allergenNames(filter.allergens))] : []),
  ];
  document.getElementById('filter-summary').textContent = !all.length
    ? ''
    : parts.length
      ? `${parts.join(' · ')} · ${t('filter.count', shown)}`
      : t('filter.all', all.length, lunch.sorted.length);
}

// On a wide screen the filters sit in a rail beside the menus; narrower, the same panel moves into a bottom
// sheet behind the "Filter" button.
function setupFilter() {
  const filter = loadFilter();
  const panel = document.getElementById('filter-panel');
  const rail = document.getElementById('filter-rail');
  const dialog = document.getElementById('filter-dialog');
  const place = () => {
    if (wide.matches) {
      if (dialog.open) dialog.close();
      rail.append(panel);
    } else dialog.append(panel);
  };
  wide.addEventListener('change', place);
  place();
  document.getElementById('filter-open').addEventListener('click', () => dialog.showModal());
  document.getElementById('filter-close').addEventListener('click', () => dialog.close());
  document.getElementById('filter-done').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  const buttons = document.querySelectorAll('[data-diet], [data-allergen]');
  const listOf = (button) =>
    button.dataset.diet ? ['diets', button.dataset.diet] : ['allergens', button.dataset.allergen];
  const sync = () => {
    for (const button of buttons) {
      const [list, value] = listOf(button);
      button.setAttribute('aria-pressed', String(filter[list].includes(value)));
    }
    saveFilter(filter);
    if (lunch?.sorted) renderListing();
    else updateFilterSummary(filter);
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {
      const [list, value] = listOf(button);
      filter[list] = filter[list].includes(value) ? filter[list].filter((v) => v !== value) : [...filter[list], value];
      sync();
    });
  }
  document.getElementById('filter-clear').addEventListener('click', () => {
    filter.diets = [];
    filter.allergens = [];
    sync();
  });
  sync();
  return filter;
}

async function main() {
  const container = document.getElementById('restaurants');
  const heading = document.getElementById('today');
  heading.textContent = DATE_FMT.format(new Date());
  try {
    const translating = fetchTranslations();
    const res = await fetch('lunch.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    // The first English visit of the day waits on the model; show the menus after a short wait regardless and
    // swap the texts in when they come.
    const en = await Promise.race([translating, new Promise((resolve) => setTimeout(resolve, TRANSLATION_WAIT_MS))]);
    if (en) translations = en;
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const isToday = data.date === today;
    const fetchedAt = new Date(data.fetchedAt);

    heading.textContent = DATE_FMT.format(new Date(data.date));
    document.getElementById('week').textContent = t('week', data.week);
    document.getElementById('updated').textContent = t(
      'updated',
      DATE_FMT.format(fetchedAt),
      TIME_FMT.format(fetchedAt),
    );
    const notices = isToday ? [] : [t('notice.old', DATE_FMT.format(new Date(data.date)))];
    if (!data.day) notices.push(t('notice.weekend'));
    // Nearest first; places whose lunch is over move to the end.
    const over = (r) => (status(r, isToday)?.state === 'closed' ? 1 : 0);
    const sorted = [...data.restaurants].sort((a, b) => a.distance - b.distance);
    // Magasin 5 is shown in Indya's place and vice versa; their distances stay as they are.
    const indya = sorted.findIndex((r) => r.id === 'indya');
    const fem = sorted.findIndex((r) => r.id === 'magasinfem');
    if (indya >= 0 && fem >= 0) [sorted[indya], sorted[fem]] = [sorted[fem], sorted[indya]];
    sorted.sort((a, b) => over(a) - over(b));
    lunch = {
      data,
      isToday,
      sorted: data.day ? sorted : [],
      notices,
      rateDate: isToday && data.day ? data.date : null,
    };
    renderHeaderStatus();
    renderListing();
    if (!data.day) return;
    if (lunch.rateDate) fillRatings();
    keepTime(isToday);
    document.getElementById('picker-open').hidden = false;
    if (!en) {
      translating.then((late) => {
        translations = late;
        renderListing();
      });
    }
  } catch {
    container.replaceChildren(el('p', 'notice', t('notice.failed')));
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

// English for the menu texts (sv → en), in English only; the data itself stays Swedish, since ratings and the
// picker key on it. A missing translation shows the Swedish.
let translations = {};
const TRANSLATION_WAIT_MS = 3000;
const tr = (text) => (text ? (translations[text] ?? text) : text);

async function fetchTranslations() {
  if (LANG === 'sv') return {};
  try {
    const res = await fetch('translations.json');
    return res.ok ? await res.json() : {};
  } catch {
    return {};
  }
}

let lunch = null;
const filter = setupFilter();
setupViews();
main();

const HISTORY_KEY = 'lunch-history';
const LAST_QUESTIONS_KEY = 'lunch-picker-last';

// Per-browser memory like the filter; unavailable storage just means no history.
function readStored(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function setupPicker() {
  const dialog = document.getElementById('picker-dialog');
  const step = document.getElementById('picker-step');
  const heading = document.getElementById('picker-heading');
  const body = document.getElementById('picker-body');
  let questions = [];
  let answers = [];
  let ranked = [];
  let shown = 0;

  const button = (label, className, onClick) => {
    const b = el('button', className, label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  };

  const ask = () => {
    const q = questions[answers.length];
    step.textContent = t('picker.step', answers.length + 1, questions.length);
    heading.textContent = LANG === 'en' ? q.textEn : q.text;
    const list = el('div', 'picker-answers');
    for (const a of q.answers) {
      list.append(
        button(LANG === 'en' ? a.labelEn : a.label, 'picker-answer', () => {
          answers.push(a);
          if (answers.length < questions.length) ask();
          else suggest();
        }),
      );
    }
    body.replaceChildren(list);
    list.querySelector('button').focus();
  };

  const suggest = () => {
    const { data, isToday } = lunch;
    ranked = rank(data, answers, {
      history: readStored(HISTORY_KEY, []),
      visible: (d) => !filter.diets.length || !d.diet || filter.diets.includes(d.diet),
      isOpen: (r) => status(r, isToday)?.state !== 'closed',
      lang: LANG,
    });
    shown = 0;
    show();
  };

  const show = () => {
    const pick = ranked[shown];
    step.textContent = shown ? t('picker.other') : t('picker.mine');
    if (!pick) {
      heading.textContent = ranked.length ? t('picker.out') : t('picker.nothing');
      body.replaceChildren(
        el('p', 'picker-reason', ranked.length ? t('picker.all-shown') : t('picker.lunchbox')),
        el('div', 'picker-actions'),
      );
      body.lastChild.append(button(t('picker.restart'), 'picker-secondary', start));
      return;
    }
    const { restaurant: r, dish: d } = pick;
    heading.textContent = r.name;
    const dish = el('p', 'picker-dish', tr(d.name));
    dish.prepend(...dietTag(d));
    const walk = Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
    const actions = el('div', 'picker-actions');
    actions.append(
      button(t('picker.go'), 'picker-primary', () => go(r)),
      button(t('picker.other'), 'picker-secondary', () => {
        shown++;
        show();
      }),
      button(t('picker.restart'), 'picker-secondary', start),
    );
    body.replaceChildren(
      dish,
      ...(d.description ? [el('p', 'picker-desc', tr(d.description))] : []),
      el('p', 'picker-reason', reasonText(pick.why, LANG)),
      el('p', 'picker-meta', t('picker.meta', walk, r.hours)),
      actions,
    );
    actions.firstChild.focus();
  };

  // Logs the visit (so it counts as recent next time) and shows the restaurant's card.
  const go = (r) => {
    const history = readStored(HISTORY_KEY, []).filter((h) => !(h.id === r.id && h.date === lunch.data.date));
    writeStored(HISTORY_KEY, [...history, { id: r.id, date: lunch.data.date }].slice(-60));
    dialog.close();
    selectedPlace = r.id;
    renderListing();
    const target = document.querySelector(`#restaurants [data-id="${CSS.escape(r.id)}"]`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    target?.classList.add('picked');
    setTimeout(() => target?.classList.remove('picked'), 2400);
  };

  const start = () => {
    questions = drawQuestions(readStored(LAST_QUESTIONS_KEY, []), filter.diets.length > 0);
    writeStored(
      LAST_QUESTIONS_KEY,
      questions.map((q) => q.id),
    );
    answers = [];
    ask();
  };

  document.getElementById('picker-open').addEventListener('click', () => {
    if (!lunch) return;
    // Open first: showModal() focuses the close button, start() then moves focus to the first answer.
    dialog.showModal();
    start();
  });
  document.getElementById('picker-close').addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

setupPicker();

const TURNSTILE_SITE_KEY = '0x4AAAAAAFKi3fMo2SvxOuOp';
const REPORT_HEADINGS = { bug: t('report.bug'), 'feat-req': t('report.feat') };
let turnstileWidget = null;

// The server's errors are Swedish; in English, say the same thing by status.
const serverError = (status, message) =>
  LANG === 'sv' && message
    ? message
    : t({ 429: 'report.too-many', 403: 'report.verify-failed', 413: 'report.too-long' }[status] ?? 'report.error');

// Loads Turnstile on first use, so visitors who never open the form don't fetch it.
function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.onload = () => resolve(window.turnstile);
    script.onerror = reject;
    document.head.append(script);
  });
}

function setupReport() {
  const dialog = document.getElementById('report-dialog');
  const form = document.getElementById('report-form');
  const statusEl = document.getElementById('report-status');
  const submit = document.getElementById('report-submit');
  const setKind = (kind) => {
    form.elements.kind.value = kind;
    document.getElementById('report-heading').textContent = REPORT_HEADINGS[kind];
  };

  for (const button of document.querySelectorAll('[data-report]')) {
    button.addEventListener('click', async () => {
      setKind(button.dataset.report);
      statusEl.textContent = '';
      dialog.showModal();
      try {
        const turnstile = await loadTurnstile();
        turnstileWidget ??= turnstile.render('#report-turnstile', { sitekey: TURNSTILE_SITE_KEY, language: LANG });
      } catch {
        statusEl.textContent = t('report.turnstile-failed');
      }
    });
  }
  form.elements.kind.forEach((radio) => {
    radio.addEventListener('change', () => setKind(radio.value));
  });
  document.getElementById('report-cancel').addEventListener('click', () => dialog.close());
  // An email address means "mejla mig": the consent box must be ticked, and ticking it needs an address.
  const syncNotify = () => {
    form.elements.notify.required = form.elements.email.value.trim() !== '';
    form.elements.email.required = form.elements.notify.checked;
  };
  form.elements.email.addEventListener('input', syncNotify);
  form.elements.notify.addEventListener('change', syncNotify);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const token = window.turnstile?.getResponse(turnstileWidget);
    if (!token) {
      statusEl.textContent = t('report.wait');
      return;
    }
    submit.disabled = true;
    statusEl.textContent = t('report.sending');
    const fields = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch('report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(serverError(res.status, data.error));
      form.reset();
      syncNotify();
      setKind(fields.kind);
      statusEl.textContent = t('report.thanks');
      // Leave the thank-you visible briefly, then close.
      setTimeout(() => dialog.close(), 1500);
    } catch (err) {
      statusEl.textContent = err instanceof TypeError ? t('report.offline') : err.message;
    } finally {
      submit.disabled = false;
      window.turnstile?.reset(turnstileWidget);
    }
  });
}

setupReport();

// "Lägg till på hemskärmen": Chrome & co. have their own install prompt (beforeinstallprompt); iOS has none, so
// there the link shows the Share → Lägg till på hemskärmen steps. Hidden once running from the home screen.
function setupInstall() {
  const link = document.getElementById('install');
  const dialog = document.getElementById('install-dialog');
  let installPrompt = null;
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    installPrompt = event;
    link.hidden = false;
  });
  window.addEventListener('appinstalled', () => {
    link.hidden = true;
  });
  // navigator.standalone only exists in iOS/iPadOS WebKit: false in the browser, true from the home screen.
  if (navigator.standalone === false && navigator.maxTouchPoints > 0) link.hidden = false;

  document.getElementById('install-open').addEventListener('click', async () => {
    if (!installPrompt) {
      dialog.showModal();
      return;
    }
    // A prompt can only be shown once; the browser fires a new beforeinstallprompt if it may ask again.
    const shown = installPrompt;
    installPrompt = null;
    link.hidden = true;
    await shown.prompt();
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

setupInstall();
