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
  if (left <= 20) return { state: 'closing', text: t('status.closing', left) };
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

// "★ 4,5 · 2 röster", plus your own vote; "Inga röster än" before anyone has voted.
function summaryText(s, mine) {
  const base = s?.count ? `★ ${num(s.avg)} · ${t('votes', s.count)}` : t('rate.none');
  return mine ? `${base} · ${t('rate.yours', mine)}` : base;
}

// One line per dish: today's average and a "Betygsätt" button that opens five star buttons. A click votes (or
// changes your vote) for this dish.
function ratingRow(r, d, date) {
  const row = el('div', 'rating');
  const key = `${r.id}\n${d.name}`;
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
  let stats = null;
  const mine = () => readStored(VOTES_KEY, {})[voteKey] ?? 0;
  const sync = () => {
    const vote = mine();
    summary.textContent = summaryText(stats, vote);
    summary.classList.toggle('has-votes', Boolean(stats?.count));
    toggle.textContent = stars.hidden ? t(vote ? 'rate.change' : 'rate.open') : t('rate.done');
    toggle.setAttribute('aria-expanded', String(!stars.hidden));
    for (const b of stars.children) {
      const n = Number(b.dataset.stars);
      b.textContent = n <= vote ? '★' : '☆';
      b.setAttribute('aria-pressed', String(n === vote));
    }
  };
  toggle.addEventListener('click', () => {
    stars.hidden = !stars.hidden;
    sync();
    if (!stars.hidden) stars.querySelector('[aria-pressed="true"]')?.focus();
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
        stats = data;
        sync();
      } catch {
        writeStored(VOTES_KEY, { ...readStored(VOTES_KEY, {}), [voteKey]: before || undefined });
        sync();
        summary.textContent = t('rate.failed');
      }
    });
    stars.append(b);
  }
  row.update = (s) => {
    stats = s ?? null;
    sync();
  };
  sync();
  row.append(line, stars);
  return row;
}

async function fillRatings() {
  try {
    const res = await fetch('ratings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const ratings = await res.json();
    for (const row of document.querySelectorAll('.rating')) row.update(ratings[row.dataset.key]);
  } catch {}
}

const walkMinutes = (r) => Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
// A category that only repeats the diet label ("Kött", "Veg") is left out.
const REPEATS_DIET = /^(kött|fisk|veg|vegetarisk[at]?|vegetariska|grönt)$/i;

function renderPlace(r, isToday, rateDate) {
  const place = el('article', 'place');
  place.dataset.id = r.id;

  const head = el('div', 'place-head');
  const walk = el('p', 'walk');
  walk.append(el('span', 'walk-min', String(walkMinutes(r))), el('span', 'walk-unit', t('card.walk-unit')));
  walk.title = t('card.walk', walkMinutes(r));
  const title = el('div', 'place-title');
  title.append(el('h2', null, r.name));
  const meta = el('p', 'place-meta');
  const s = status(r, isToday);
  if (s) meta.append(el('span', `status ${s.state}`, s.text), ' · ');
  meta.append(el('span', 'hours', r.hours), ` · ${r.distance} m`);
  title.append(meta);
  head.append(walk, title);
  place.append(head);
  if (r.price) place.append(el('p', 'price', tr(r.price)));

  if (r.stale) place.append(el('p', 'badge warn', t('card.stale', r.menuWeek)));

  if (r.error) {
    place.append(el('p', 'empty', tr(r.error)));
  } else if (r.embed) {
    const frame = el('iframe', 'embed');
    frame.src = r.embed;
    frame.title = t('card.embed', r.name);
    frame.loading = 'lazy';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    place.append(frame);
  } else {
    const list = el('ul', 'dishes');
    for (const d of r.dishes) {
      const item = el('li');
      if (d.category && !REPEATS_DIET.test(d.category.trim())) item.append(el('span', 'category', tr(d.category)));
      const dish = el('p', 'dish');
      dish.append(...dietTag(d), el('span', 'dish-name', tr(d.name)));
      item.append(dish);
      if (d.description) item.append(el('span', 'desc', tr(d.description)));
      item.dataset.diet = d.diet ?? '';
      item.dataset.mentions = (d.mentions ?? []).join(' ');
      const mentions = el('span', 'mentions');
      mentions.hidden = true;
      item.append(mentions);
      if (rateDate) item.append(ratingRow(r, d, rateDate));
      list.append(item);
    }
    place.append(list);
    const filtered = el('p', 'empty filtered', t('filter.none'));
    filtered.hidden = true;
    place.append(filtered);
  }

  const link = el('a', 'source', `${t('card.source')} ↗`);
  link.href = r.url;
  link.target = '_blank';
  link.rel = 'noopener';
  place.append(link);
  return place;
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
    for (const badge of document.querySelectorAll('#restaurants .place .status')) {
      const r = lunch.data.restaurants.find((x) => x.id === badge.closest('.place').dataset.id);
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

// Diet filter: matching dishes stay, dishes without a diet stay dimmed, the rest hide.
// Allergens only add a "Nämner: …" note; nothing is hidden or called free-from because of them.
function applyFilter(filter) {
  const places = document.querySelectorAll('#restaurants .place');
  for (const place of places) {
    const items = place.querySelectorAll('.dishes li');
    if (!items.length) continue;
    let visible = 0;
    for (const li of items) {
      const diet = li.dataset.diet;
      const active = filter.diets.length > 0;
      li.hidden = active && diet !== '' && !filter.diets.includes(diet);
      li.classList.toggle('unsure', active && diet === '');
      if (li.classList.contains('unsure')) li.title = t('filter.unsure');
      else li.removeAttribute('title');
      if (!li.hidden) visible++;
      const hits = li.dataset.mentions.split(' ').filter((a) => filter.allergens.includes(a));
      const note = li.querySelector('.mentions');
      note.hidden = hits.length === 0;
      note.textContent = hits.length ? t('mentions', allergenNames(hits)) : '';
    }
    place.querySelector('.filtered').hidden = visible > 0;
  }
  const all = [...document.querySelectorAll('#restaurants .dishes li')];
  const shown = all.filter((li) => !li.hidden).length;
  for (const count of document.querySelectorAll('[data-count]')) {
    count.textContent = all.length ? String(all.filter((li) => li.dataset.diet === count.dataset.count).length) : '';
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
      : t('filter.all', all.length, places.length);
}

// On a wide screen the filters sit in a rail beside the menus; narrower, the same panel moves into a bottom
// sheet behind the "Filter" button.
function setupFilter() {
  const filter = loadFilter();
  const panel = document.getElementById('filter-panel');
  const rail = document.getElementById('filter-rail');
  const dialog = document.getElementById('filter-dialog');
  const wide = matchMedia('(min-width: 1024px)');
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
    applyFilter(filter);
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

// (Re)draws the places after any notices, with the current filter and today's ratings.
function renderPlaces(container, sorted, isToday, rateDate) {
  for (const place of container.querySelectorAll('.place')) place.remove();
  container.append(...sorted.map((r) => renderPlace(r, isToday, rateDate)));
  if (rateDate) fillRatings();
  applyFilter(filter);
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
    lunch = { data, isToday };
    renderHeaderStatus();

    container.replaceChildren();
    if (!isToday) {
      container.append(el('p', 'notice', t('notice.old', DATE_FMT.format(new Date(data.date)))));
    }
    if (!data.day) {
      container.append(el('p', 'notice', t('notice.weekend')));
      return;
    }
    // Nearest first; places whose lunch is over move to the end.
    const over = (r) => (status(r, isToday)?.state === 'closed' ? 1 : 0);
    const sorted = [...data.restaurants].sort((a, b) => a.distance - b.distance);
    // Magasin 5 is shown in Indya's place and vice versa; their distances stay as they are.
    const indya = sorted.findIndex((r) => r.id === 'indya');
    const fem = sorted.findIndex((r) => r.id === 'magasinfem');
    if (indya >= 0 && fem >= 0) [sorted[indya], sorted[fem]] = [sorted[fem], sorted[indya]];
    sorted.sort((a, b) => over(a) - over(b));
    const rateDate = isToday && data.day ? data.date : null;
    renderPlaces(container, sorted, isToday, rateDate);
    keepTime(isToday);
    document.getElementById('picker-open').hidden = false;
    if (!en) {
      translating.then((late) => {
        translations = late;
        renderPlaces(container, sorted, isToday, rateDate);
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
    const card = document.querySelector(`.place[data-id="${CSS.escape(r.id)}"]`);
    card?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card?.classList.add('picked');
    setTimeout(() => card?.classList.remove('picked'), 2400);
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
    start();
    dialog.showModal();
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
