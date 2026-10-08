import { el } from './dom.js';
import { LANG, LOCALE, num, t } from './i18n.js';
import { drawQuestions, rank, reasonText } from './picker.js';

const TZ = 'Europe/Stockholm';
const DATE_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const WALK_M_PER_MIN = 80;
const ALLERGENS = ['nuts', 'gluten', 'lactose', 'shellfish', 'egg'];
const FILTER_KEY = 'lunch-filter';
const KINDS = {
  burger: { icon: '🍔', label: t('kind.burger') },
  pizza: { icon: '🍕', label: t('kind.pizza') },
  taco: { icon: '🌮', label: t('kind.taco') },
  wrap: { icon: '🌯', label: t('kind.wrap') },
  soup: { icon: '🍲', label: t('kind.soup') },
  curry: { icon: '🍛', label: t('kind.curry') },
  noodles: { icon: '🍜', label: t('kind.noodles') },
  pasta: { icon: '🍝', label: t('kind.pasta') },
  sushi: { icon: '🍣', label: t('kind.sushi') },
  sandwich: { icon: '🥪', label: t('kind.sandwich') },
  dumpling: { icon: '🥟', label: t('kind.dumpling') },
  pie: { icon: '🥧', label: t('kind.pie') },
  pancake: { icon: '🥞', label: t('kind.pancake') },
  falafel: { icon: '🧆', label: t('kind.falafel') },
  salad: { icon: '🥗', label: t('kind.salad') },
  wok: { icon: '🥘', label: t('kind.wok') },
  fish: { icon: '🐟', label: t('kind.fish') },
  shellfish: { icon: '🍤', label: t('kind.shellfish') },
  chicken: { icon: '🍗', label: t('kind.chicken') },
  sausage: { icon: '🌭', label: t('kind.sausage') },
  steak: { icon: '🥩', label: t('kind.steak') },
  pork: { icon: '🥓', label: t('kind.pork') },
  mince: { icon: '🍖', label: t('kind.mince') },
  mushroom: { icon: '🍄', label: t('kind.mushroom') },
};
const DIETS = {
  veg: { icon: '🌱', label: t('diet.veg') },
  fish: { icon: '🐟', label: t('diet.fish') },
  meat: { icon: '🥩', label: t('diet.meat') },
};

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

function icon(emoji, label) {
  const node = el('span', 'diet', emoji);
  node.title = label;
  node.setAttribute('role', 'img');
  node.setAttribute('aria-label', label);
  return node;
}

// What the dish is (🍔, 🍲 …) when its name says, else its diet; 🌱 always shows for vegetarian dishes.
function dishIcons(d) {
  const diet = DIETS[d.diet];
  const dietIcon = diet && icon(diet.icon, d.dietByAi ? t('ai-guess', diet.label) : diet.label);
  const kind = KINDS[d.kind];
  if (!kind) return dietIcon ? [dietIcon] : [];
  return [icon(kind.icon, kind.label), ...(d.diet === 'veg' ? [dietIcon] : [])];
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

const summaryText = (s) => (s?.count ? `${num(s.avg)} ★ · ${t('votes', s.count)}` : '');

// Five star buttons and today's average; a click votes (or changes your vote) for this dish.
function ratingRow(r, d, date) {
  const row = el('div', 'rating');
  const key = `${r.id}\n${d.name}`;
  row.dataset.key = key;
  const stars = el('div', 'stars');
  stars.setAttribute('role', 'group');
  stars.setAttribute('aria-label', t('rate.label', tr(d.name)));
  const voteKey = `${date}|${key}`;
  // data-show is what's lit: the hovered star while pointing, else your vote.
  const setValue = (n) => {
    stars.dataset.value = String(n);
    stars.dataset.show = String(n);
    for (const b of stars.children) b.setAttribute('aria-pressed', String(Number(b.dataset.stars) === n));
  };
  const summary = el('span', 'rating-summary');
  for (let i = 1; i <= 5; i++) {
    const b = el('button', 'star', '★');
    b.type = 'button';
    b.dataset.stars = String(i);
    b.setAttribute('aria-label', t('rate.star', i));
    b.addEventListener('pointerenter', () => {
      stars.dataset.show = String(i);
    });
    b.addEventListener('click', async () => {
      const votes = readStored(VOTES_KEY, {});
      const before = votes[voteKey] ?? 0;
      setValue(i);
      writeStored(VOTES_KEY, { ...votes, [voteKey]: i });
      try {
        const res = await fetch('rate', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ restaurant: r.id, dish: d.name, stars: i, voter: voterId() }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        summary.textContent = summaryText(data);
      } catch {
        setValue(before);
        writeStored(VOTES_KEY, { ...readStored(VOTES_KEY, {}), [voteKey]: before || undefined });
        summary.textContent = t('rate.failed');
      }
    });
    stars.append(b);
  }
  stars.addEventListener('pointerleave', () => {
    stars.dataset.show = stars.dataset.value;
  });
  setValue(readStored(VOTES_KEY, {})[voteKey] ?? 0);
  row.append(stars, summary);
  return row;
}

async function fillRatings() {
  try {
    const res = await fetch('ratings.json', { cache: 'no-store' });
    if (!res.ok) return;
    const ratings = await res.json();
    for (const row of document.querySelectorAll('.rating')) {
      row.querySelector('.rating-summary').textContent = summaryText(ratings[row.dataset.key]);
    }
  } catch {}
}

function renderCard(r, index, isToday, rateDate) {
  const card = el('article', 'card');
  card.dataset.id = r.id;
  card.style.setProperty('--i', index);

  const top = el('div', 'card-top');
  top.append(el('span', 'idx', String(index + 1).padStart(2, '0')));
  const s = status(r, isToday);
  if (s) top.append(el('span', `status ${s.state}`, s.text));
  card.append(top);

  card.append(el('h2', null, r.name));

  const meta = el('p', 'meta');
  const walk = Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
  meta.append(el('span', 'walk', t('card.walk', walk)), el('span', null, `${r.distance} m`), el('span', null, r.hours));
  card.append(meta);
  if (r.price) card.append(el('p', 'price', tr(r.price)));

  if (r.stale) card.append(el('p', 'badge warn', t('card.stale', r.menuWeek)));

  if (r.error) {
    card.append(el('p', 'empty', tr(r.error)));
  } else if (r.embed) {
    const frame = el('iframe', 'embed');
    frame.src = r.embed;
    frame.title = t('card.embed', r.name);
    frame.loading = 'lazy';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    card.append(frame);
  } else {
    const list = el('ul', 'dishes');
    for (const d of r.dishes) {
      const item = el('li');
      if (d.category) item.append(el('span', 'category', tr(d.category)));
      const dish = el('span', 'dish', tr(d.name));
      dish.prepend(...dishIcons(d));
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
    card.append(list);
    const filtered = el('p', 'empty filtered', t('filter.none'));
    filtered.hidden = true;
    card.append(filtered);
  }

  const link = el('a', 'source');
  link.append(el('span', null, t('card.source')), el('span', 'arrow', '↗'));
  link.href = r.url;
  link.target = '_blank';
  link.rel = 'noopener';
  card.append(link);
  return card;
}

function renderHeaderStatus(isLunchDay) {
  const now = document.getElementById('now');
  const m = minutesNow();
  const live = isLunchDay && m >= 11 * 60 && m < 14 * 60;
  if (!isLunchDay) now.textContent = t('hero.near');
  else if (m < 11 * 60) now.textContent = t('now.starts', TIME_FMT.format(new Date()));
  else if (live) now.textContent = t('now.live');
  else now.textContent = t('now.over');
  document.body.classList.toggle('live', live);
}

// Matches main.masonry in style.css: 4px grid rows, plus the 16px gap below each card.
const ROW_PX = 4;
const GAP_PX = 16;

function packCards(container) {
  container.classList.add('masonry');
  const observer = new ResizeObserver((entries) => {
    for (const { target } of entries)
      target.style.gridRowEnd = `span ${Math.ceil((target.offsetHeight + GAP_PX) / ROW_PX)}`;
  });
  for (const child of container.children) observer.observe(child);
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

// Diet filter: matching dishes stay, dishes without a diet stay dimmed, the rest hide.
// Allergens only add a "Nämner: …" note; nothing is hidden or called free-from because of them.
function applyFilter(filter) {
  for (const card of document.querySelectorAll('#restaurants .card')) {
    const items = card.querySelectorAll('.dishes li');
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
      note.textContent = hits.length
        ? t('mentions', hits.map((a) => t(`allergen.${a}`).toLocaleLowerCase(LOCALE)).join(', '))
        : '';
    }
    card.querySelector('.filtered').hidden = visible > 0;
  }
  const count = document.getElementById('allergen-count');
  count.hidden = filter.allergens.length === 0;
  count.textContent = String(filter.allergens.length);
  const active = filter.diets.length > 0 || filter.allergens.length > 0;
  document.getElementById('filter-clear').hidden = !active;
  const all = document.querySelectorAll('#restaurants .dishes li');
  const shown = [...all].filter((li) => !li.hidden).length;
  document.getElementById('filter-summary').textContent =
    filter.diets.length && all.length ? t('filter.summary', shown, all.length) : '';
}

function setupFilter() {
  const filter = loadFilter();
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
  // The allergen menu closes on a click outside it or Escape, like other dropdowns.
  const menu = document.querySelector('.allergen-menu');
  document.addEventListener('click', (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.open) {
      menu.open = false;
      menu.querySelector('summary').focus();
    }
  });
  sync();
  return filter;
}

// (Re)draws the cards after any notices, with the current filter and today's ratings.
function renderCards(container, sorted, isToday, rateDate) {
  for (const card of container.querySelectorAll('.card')) card.remove();
  container.append(...sorted.map((r, i) => renderCard(r, i, isToday, rateDate)));
  if (rateDate) fillRatings();
  applyFilter(filter);
  packCards(container);
}

async function main() {
  const container = document.getElementById('restaurants');
  document.getElementById('today').textContent = DATE_FMT.format(new Date());
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

    document.getElementById('today').textContent = t('today', DATE_FMT.format(new Date(data.date)), data.week);
    document.getElementById('updated').textContent = t(
      'updated',
      DATE_FMT.format(fetchedAt),
      TIME_FMT.format(fetchedAt),
    );
    renderHeaderStatus(isToday && Boolean(data.day));

    container.replaceChildren();
    if (!isToday) {
      container.append(el('p', 'notice', t('notice.old', DATE_FMT.format(new Date(data.date)))));
    }
    if (!data.day) {
      container.append(el('p', 'notice', t('notice.weekend')));
      return;
    }
    const sorted = [...data.restaurants].sort((a, b) => a.distance - b.distance);
    // Magasin 5 is shown in Indya's place and vice versa; their distances stay as they are.
    const indya = sorted.findIndex((r) => r.id === 'indya');
    const fem = sorted.findIndex((r) => r.id === 'magasinfem');
    if (indya >= 0 && fem >= 0) [sorted[indya], sorted[fem]] = [sorted[fem], sorted[indya]];
    const rateDate = isToday && data.day ? data.date : null;
    renderCards(container, sorted, isToday, rateDate);
    lunch = { data, isToday };
    document.getElementById('picker-open').hidden = false;
    if (!en) {
      translating.then((late) => {
        translations = late;
        renderCards(container, sorted, isToday, rateDate);
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
    dish.prepend(...dishIcons(d));
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
    const card = document.querySelector(`.card[data-id="${CSS.escape(r.id)}"]`);
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
