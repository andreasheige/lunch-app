import { el } from './dom.js';
import { drawQuestions, rank, reasonText } from './picker.js';

const TZ = 'Europe/Stockholm';
const DATE_FMT = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const WALK_M_PER_MIN = 80;
const ALLERGENS = { nuts: 'nötter', gluten: 'gluten', lactose: 'laktos', shellfish: 'skaldjur', egg: 'ägg' };
const FILTER_KEY = 'lunch-filter';
const KINDS = {
  burger: { icon: '🍔', label: 'Burgare' },
  pizza: { icon: '🍕', label: 'Pizza' },
  taco: { icon: '🌮', label: 'Taco' },
  wrap: { icon: '🌯', label: 'Wrap' },
  soup: { icon: '🍲', label: 'Soppa/gryta' },
  curry: { icon: '🍛', label: 'Curry' },
  noodles: { icon: '🍜', label: 'Nudlar' },
  pasta: { icon: '🍝', label: 'Pasta' },
  sushi: { icon: '🍣', label: 'Sushi' },
  sandwich: { icon: '🥪', label: 'Smörgås' },
  dumpling: { icon: '🥟', label: 'Dumplings' },
  pie: { icon: '🥧', label: 'Paj' },
  pancake: { icon: '🥞', label: 'Pannkaka' },
  falafel: { icon: '🧆', label: 'Falafel' },
  salad: { icon: '🥗', label: 'Sallad' },
  wok: { icon: '🥘', label: 'Wok' },
  fish: { icon: '🐟', label: 'Fisk' },
  shellfish: { icon: '🍤', label: 'Skaldjur' },
  chicken: { icon: '🍗', label: 'Kyckling' },
  sausage: { icon: '🌭', label: 'Korv' },
  steak: { icon: '🥩', label: 'Kött' },
  pork: { icon: '🥓', label: 'Fläsk' },
  mince: { icon: '🍖', label: 'Färs' },
  mushroom: { icon: '🍄', label: 'Svamp' },
};
const DIETS = {
  veg: { icon: '🌱', label: 'Vegetariskt' },
  fish: { icon: '🐟', label: 'Fisk' },
  meat: { icon: '🥩', label: 'Kött' },
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
  if (now < toMinutes(openTime)) return { state: 'soon', text: `Öppnar ${openTime}` };
  const left = toMinutes(closeTime) - now;
  if (left <= 0) return { state: 'closed', text: 'Lunchen är slut' };
  if (left <= 20) return { state: 'closing', text: `Stänger om ${left} min` };
  return { state: 'open', text: `Öppet · till ${closeTime}` };
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
  const dietIcon = diet && icon(diet.icon, d.dietByAi ? `${diet.label} (AI-bedömning)` : diet.label);
  const kind = KINDS[d.kind];
  if (!kind) return dietIcon ? [dietIcon] : [];
  return [icon(kind.icon, kind.label), ...(d.diet === 'veg' ? [dietIcon] : [])];
}

function renderCard(r, index, isToday) {
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
  meta.append(el('span', 'walk', `${walk} min gång`), el('span', null, `${r.distance} m`), el('span', null, r.hours));
  card.append(meta);
  if (r.price) card.append(el('p', 'price', r.price));

  if (r.stale) card.append(el('p', 'badge warn', `Menyn gäller vecka ${r.menuWeek} – kan vara inaktuell`));

  if (r.error) {
    card.append(el('p', 'empty', r.error));
  } else if (r.embed) {
    const frame = el('iframe', 'embed');
    frame.src = r.embed;
    frame.title = `Lunchmeny för ${r.name}`;
    frame.loading = 'lazy';
    frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups');
    card.append(frame);
  } else {
    const list = el('ul', 'dishes');
    for (const d of r.dishes) {
      const item = el('li');
      if (d.category) item.append(el('span', 'category', d.category));
      const dish = el('span', 'dish', d.name);
      dish.prepend(...dishIcons(d));
      item.append(dish);
      if (d.description) item.append(el('span', 'desc', d.description));
      item.dataset.diet = d.diet ?? '';
      item.dataset.mentions = (d.mentions ?? []).join(' ');
      const mentions = el('span', 'mentions');
      mentions.hidden = true;
      item.append(mentions);
      list.append(item);
    }
    card.append(list);
    const filtered = el('p', 'empty filtered', 'Inget som matchar filtret.');
    filtered.hidden = true;
    card.append(filtered);
  }

  const link = el('a', 'source');
  link.append(el('span', null, 'Restaurangens sida'), el('span', 'arrow', '↗'));
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
  if (!isLunchDay) now.textContent = 'Nära kontoret';
  else if (m < 11 * 60) now.textContent = `Lunchen börjar 11.00 · klockan är ${TIME_FMT.format(new Date())}`;
  else if (live) now.textContent = 'Lunch serveras nu';
  else now.textContent = 'Lunchen är över för idag';
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
      allergens: (saved.allergens ?? []).filter((a) => a in ALLERGENS),
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
      if (li.classList.contains('unsure')) li.title = 'Okänt om rätten passar filtret';
      else li.removeAttribute('title');
      if (!li.hidden) visible++;
      const hits = li.dataset.mentions.split(' ').filter((a) => filter.allergens.includes(a));
      const note = li.querySelector('.mentions');
      note.hidden = hits.length === 0;
      note.textContent = hits.length ? `Nämner: ${hits.map((a) => ALLERGENS[a]).join(', ')}` : '';
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
    filter.diets.length && all.length ? `Visar ${shown} av ${all.length} rätter` : '';
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

async function main() {
  const container = document.getElementById('restaurants');
  document.getElementById('today').textContent = DATE_FMT.format(new Date());
  try {
    const res = await fetch('lunch.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(res.status);
    const data = await res.json();
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
    const isToday = data.date === today;
    const fetchedAt = new Date(data.fetchedAt);

    document.getElementById('today').textContent = `${DATE_FMT.format(new Date(data.date))} · vecka ${data.week}`;
    document.getElementById('updated').textContent =
      `Uppdaterad ${DATE_FMT.format(fetchedAt)} kl. ${TIME_FMT.format(fetchedAt)}`;
    renderHeaderStatus(isToday && Boolean(data.day));

    container.replaceChildren();
    if (!isToday) {
      container.append(
        el('p', 'notice', `Menyerna har inte uppdaterats idag – visar ${DATE_FMT.format(new Date(data.date))}.`),
      );
    }
    if (!data.day) {
      container.append(el('p', 'notice', 'Ingen lunch idag – det är helg. Välkommen tillbaka på måndag!'));
      return;
    }
    const sorted = [...data.restaurants].sort((a, b) => a.distance - b.distance);
    // Magasin 5 is shown in Indya's place and vice versa; their distances stay as they are.
    const indya = sorted.findIndex((r) => r.id === 'indya');
    const fem = sorted.findIndex((r) => r.id === 'magasinfem');
    if (indya >= 0 && fem >= 0) [sorted[indya], sorted[fem]] = [sorted[fem], sorted[indya]];
    container.append(...sorted.map((r, i) => renderCard(r, i, isToday)));
    lunch = { data, isToday };
    document.getElementById('picker-open').hidden = false;
    applyFilter(filter);
    packCards(container);
  } catch {
    container.replaceChildren(el('p', 'notice', 'Kunde inte hämta menyerna just nu. Försök igen om en stund.'));
  } finally {
    container.setAttribute('aria-busy', 'false');
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
    step.textContent = `Fråga ${answers.length + 1} av ${questions.length}`;
    heading.textContent = q.text;
    const list = el('div', 'picker-answers');
    for (const a of q.answers) {
      list.append(
        button(a.label, 'picker-answer', () => {
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
    });
    shown = 0;
    show();
  };

  const show = () => {
    const pick = ranked[shown];
    step.textContent = shown ? 'Annat förslag' : 'Mitt förslag';
    if (!pick) {
      heading.textContent = ranked.length ? 'Slut på förslag' : 'Inget öppet just nu';
      body.replaceChildren(
        el(
          'p',
          'picker-reason',
          ranked.length
            ? 'Det var alla ställen som passar idag.'
            : 'Lunchen är slut överallt – det får bli matlåda. 🥪',
        ),
        el('div', 'picker-actions'),
      );
      body.lastChild.append(button('Börja om', 'picker-secondary', start));
      return;
    }
    const { restaurant: r, dish: d } = pick;
    heading.textContent = r.name;
    const dish = el('p', 'picker-dish', d.name);
    dish.prepend(...dishIcons(d));
    const walk = Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
    const actions = el('div', 'picker-actions');
    actions.append(
      button('Vi går hit!', 'picker-primary', () => go(r)),
      button('Annat förslag', 'picker-secondary', () => {
        shown++;
        show();
      }),
      button('Börja om', 'picker-secondary', start),
    );
    body.replaceChildren(
      dish,
      ...(d.description ? [el('p', 'picker-desc', d.description)] : []),
      el('p', 'picker-reason', reasonText(pick.why)),
      el('p', 'picker-meta', `${walk} min gång · ${r.hours}`),
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
const REPORT_HEADINGS = { bug: 'Rapportera fel', 'feat-req': 'Önska funktion' };
let turnstileWidget = null;

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
        turnstileWidget ??= turnstile.render('#report-turnstile', { sitekey: TURNSTILE_SITE_KEY, language: 'sv' });
      } catch {
        statusEl.textContent = 'Kunde inte ladda verifieringen. Kontrollera nätverket och försök igen.';
      }
    });
  }
  form.elements.kind.forEach((radio) => {
    radio.addEventListener('change', () => setKind(radio.value));
  });
  document.getElementById('report-cancel').addEventListener('click', () => dialog.close());

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const token = window.turnstile?.getResponse(turnstileWidget);
    if (!token) {
      statusEl.textContent = 'Vänta tills verifieringen är klar.';
      return;
    }
    submit.disabled = true;
    statusEl.textContent = 'Skickar…';
    const fields = Object.fromEntries(new FormData(form));
    try {
      const res = await fetch('report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...fields, token }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? 'Något gick fel. Försök igen.');
      form.reset();
      setKind(fields.kind);
      statusEl.textContent = 'Tack! Rapporten är skickad.';
      // Leave the thank-you visible briefly, then close.
      setTimeout(() => dialog.close(), 1500);
    } catch (err) {
      statusEl.textContent = err instanceof TypeError ? 'Kunde inte nå servern. Försök igen.' : err.message;
    } finally {
      submit.disabled = false;
      window.turnstile?.reset(turnstileWidget);
    }
  });
}

setupReport();
