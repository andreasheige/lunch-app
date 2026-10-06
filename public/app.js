const TZ = 'Europe/Stockholm';
const DATE_FMT = new Intl.DateTimeFormat('sv-SE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ });
const TIME_FMT = new Intl.DateTimeFormat('sv-SE', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
const WALK_M_PER_MIN = 80;
const ALLERGENS = { nuts: 'nötter', gluten: 'gluten', lactose: 'laktos', shellfish: 'skaldjur', egg: 'ägg' };
const FILTER_KEY = 'lunch-filter';
const DIETS = {
  veg: { icon: '🌱', label: 'Vegetariskt' },
  fish: { icon: '🐟', label: 'Fisk' },
  meat: { icon: '🥩', label: 'Kött' },
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

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

function renderCard(r, index, isToday) {
  const card = el('article', 'card');
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
      const diet = DIETS[d.diet];
      if (diet) {
        const label = d.dietByAi ? `${diet.label} (AI-bedömning)` : diet.label;
        const icon = el('span', 'diet', diet.icon);
        icon.title = label;
        icon.setAttribute('role', 'img');
        icon.setAttribute('aria-label', label);
        dish.prepend(icon);
      }
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
  document.getElementById('filter-note').hidden = filter.allergens.length === 0;
}

function setupFilter() {
  const filter = loadFilter();
  for (const chip of document.querySelectorAll('.chip')) {
    const [list, value] = chip.dataset.diet ? ['diets', chip.dataset.diet] : ['allergens', chip.dataset.allergen];
    chip.setAttribute('aria-pressed', String(filter[list].includes(value)));
    chip.addEventListener('click', () => {
      filter[list] = filter[list].includes(value) ? filter[list].filter((v) => v !== value) : [...filter[list], value];
      chip.setAttribute('aria-pressed', String(filter[list].includes(value)));
      saveFilter(filter);
      applyFilter(filter);
    });
  }
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
    applyFilter(filter);
    packCards(container);
  } catch {
    container.replaceChildren(el('p', 'notice', 'Kunde inte hämta menyerna just nu. Försök igen om en stund.'));
  } finally {
    container.setAttribute('aria-busy', 'false');
  }
}

const filter = setupFilter();
main();

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
