// /statistik: the ratings as a slide (KPI row, restaurant ranking, top dishes, votes per day, fun facts) for
// the last two weeks or all time. Charts are plain HTML; every value is labelled or in a table, the tooltip
// only repeats it.
import { el } from './dom.js';
import { LANG, LOCALE, num, t } from './i18n.js';

const DAY_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' });

const votesText = (n) => t('votes', n);
const utcDate = (iso) => new Date(`${iso}T00:00:00Z`);

function isoWeek(iso) {
  const d = utcDate(iso);
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

// Weekdays from..to, so days without votes still get a (zero) column.
function weekdays(from, to) {
  const out = [];
  for (const d = utcDate(from); d <= utcDate(to); d.setUTCDate(d.getUTCDate() + 1)) {
    if (d.getUTCDay() % 6 !== 0) out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// One tooltip for the page; marks call show() on hover and focus.
const tooltip = {
  node: null,
  show(target, lines) {
    this.node ??= document.getElementById('viz-tooltip');
    const [value, ...rest] = lines;
    this.node.replaceChildren(el('strong', null, value), ...rest.map((l) => el('span', null, l)));
    this.node.hidden = false;
    const box = target.getBoundingClientRect();
    const tip = this.node.getBoundingClientRect();
    const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.width / 2), window.innerWidth - tip.width - 8);
    this.node.style.left = `${left + window.scrollX}px`;
    this.node.style.top = `${box.top + window.scrollY - tip.height - 8}px`;
  },
  hide() {
    if (this.node) this.node.hidden = true;
  },
};

function withTooltip(mark, lines) {
  mark.tabIndex = 0;
  mark.setAttribute('aria-label', lines.join(', '));
  mark.addEventListener('pointerenter', () => tooltip.show(mark, lines));
  mark.addEventListener('focus', () => tooltip.show(mark, lines));
  mark.addEventListener('pointerleave', () => tooltip.hide());
  mark.addEventListener('blur', () => tooltip.hide());
  return mark;
}

function card(title, subtitle, ...children) {
  const node = el('article', 'viz-card');
  node.append(el('h3', 'viz-title', title));
  if (subtitle) node.append(el('p', 'viz-subtitle', subtitle));
  node.append(...children);
  return node;
}

function kpi(label, value, note) {
  const tile = el('div', 'kpi');
  tile.append(el('span', 'kpi-label', label), el('span', 'kpi-value', value));
  if (note) tile.append(el('span', 'kpi-note', note));
  return tile;
}

// Horizontal bars on a fixed 0–5 scale, value at the tip, votes after it; table view underneath.
function ranking(restaurants) {
  const list = el('div', 'hbars');
  for (const r of restaurants) {
    const row = el('div', 'hbar-row');
    const track = el('div', 'hbar-track');
    const bar = el('div', 'hbar');
    bar.style.width = `${(r.avg / 5) * 100}%`;
    withTooltip(bar, [`${num(r.avg)} ★`, r.name, votesText(r.votes)]);
    track.append(bar);
    const value = el('span', 'hbar-value', num(r.avg));
    value.append(el('span', 'hbar-votes', votesText(r.votes)));
    row.append(el('span', 'hbar-label', r.name), track, value);
    list.append(row);
  }
  return [
    list,
    tableView(
      [t('stats.restaurant'), t('stats.avg'), t('stats.votes')],
      restaurants.map((r) => [r.name, num(r.avg), r.votes]),
    ),
  ];
}

// Votes per weekday as columns; the busiest day carries its value on the cap.
function perDay(days, from, to, allTime) {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const dates = allTime ? days.map((d) => d.date) : weekdays(from, to);
  const max = Math.max(1, ...dates.map((d) => byDate.get(d)?.votes ?? 0));
  const busiest = dates.reduce(
    (best, d) => ((byDate.get(d)?.votes ?? 0) > (byDate.get(best)?.votes ?? 0) ? d : best),
    dates[0],
  );
  const chart = el('div', 'cols');
  chart.style.setProperty('--n', String(dates.length));
  // About ten date labels, five on a phone, so they never push the chart wider than its card.
  const every = Math.ceil(dates.length / (window.innerWidth < 600 ? 5 : 10));
  dates.forEach((date, i) => {
    const day = byDate.get(date);
    const slot = el('div', 'col-slot');
    const col = el('div', 'col');
    col.style.height = `${((day?.votes ?? 0) / max) * 100}%`;
    if (!day) col.classList.add('empty');
    withTooltip(slot, [
      day ? votesText(day.votes) : t('stats.no-votes'),
      DAY_FMT.format(utcDate(date)),
      ...(day ? [t('stats.day-avg', num(day.avg))] : []),
    ]);
    if (date === busiest && day) slot.append(el('span', 'col-value', String(day.votes)));
    slot.append(col);
    chart.append(slot);
    if (i % every === 0) {
      const label = el('span', 'col-label', SHORT_FMT.format(utcDate(date)));
      label.style.gridColumn = String(i + 1);
      chart.append(label);
    }
  });
  return [
    chart,
    tableView(
      [t('stats.day'), t('stats.votes'), t('stats.avg')],
      days.map((d) => [DAY_FMT.format(utcDate(d.date)), d.votes, num(d.avg)]),
    ),
  ];
}

function tableView(head, rows) {
  const details = el('details', 'table-view');
  details.append(el('summary', 'table-view-toggle', t('stats.as-table')));
  const table = el('table');
  const tr = el('tr');
  for (const h of head) tr.append(el('th', null, h));
  table.append(tr);
  for (const row of rows) {
    const r = el('tr');
    for (const c of row) r.append(el('td', null, String(c)));
    table.append(r);
  }
  details.append(table);
  return details;
}

function topDishes(dishes) {
  const list = el('ol', 'top-dishes');
  for (const d of dishes) {
    const item = el('li');
    const text = el('div', 'top-dish-text');
    text.append(el('span', 'top-dish-name', d.dish), el('span', 'top-dish-place', d.restaurant));
    const score = el('span', 'top-dish-score', `${num(d.avg)} ★`);
    score.append(el('span', 'hbar-votes', votesText(d.votes)));
    item.append(text, score);
    list.append(item);
  }
  return list;
}

// "onsdag 7 okt." / "Wednesday 7 Oct"
const dayName = (iso) => `${WEEKDAY_FMT.format(utcDate(iso))} ${SHORT_FMT.format(utcDate(iso))}`;

function funFacts(data) {
  const facts = el('ul', 'facts');
  const add = (emoji, title, text) => {
    const li = el('li');
    li.append(el('span', 'fact-emoji', emoji));
    const body = el('div');
    body.append(el('strong', null, title), el('span', null, text));
    li.append(body);
    facts.append(li);
  };
  const [winner] = data.restaurants;
  if (winner) add('🏆', t('stats.winner'), t('stats.winner-text', winner.name, num(winner.avg)));
  if (data.divisive) {
    add('⚔️', t('stats.divisive'), t('stats.divisive-text', data.divisive.dish, data.divisive.restaurant));
  }
  const busiest = [...data.days].sort((a, b) => b.votes - a.votes)[0];
  if (busiest) add('🔥', t('stats.busiest'), t('stats.busiest-text', dayName(busiest.date), busiest.votes));
  const happiest = [...data.days].filter((d) => d.votes >= 3).sort((a, b) => b.avg - a.avg)[0];
  if (happiest) add('😋', t('stats.happiest'), t('stats.happiest-text', dayName(happiest.date), num(happiest.avg)));
  return facts;
}

function render(data) {
  const slide = document.getElementById('slide');
  const allTime = data.range === 'all';
  const weeks = [...new Set([isoWeek(data.from), isoWeek(data.to)])].join('–');
  const head = el('div', 'slide-head');
  head.append(
    el(
      'p',
      'slide-kicker',
      `${allTime ? t('stats.all') : t('stats.week', weeks)} · ${SHORT_FMT.format(utcDate(data.from))} – ${SHORT_FMT.format(utcDate(data.to))}`,
    ),
    el('h2', 'slide-title', t('stats.eyebrow')),
  );
  if (!data.totals.votes) {
    slide.replaceChildren(head, el('p', 'notice', t('stats.empty')));
    return;
  }
  const kpis = el('div', 'kpis');
  kpis.append(
    kpi(t('stats.kpi-avg'), `${num(data.totals.avg)} ★`, t('stats.of-5')),
    kpi(t('stats.votes'), String(data.totals.votes)),
    kpi(t('stats.voters'), String(data.totals.voters), t('stats.browsers')),
    kpi(t('stats.dishes-rated'), String(data.totals.dishes)),
  );
  const grid = el('div', 'viz-grid');
  grid.append(
    card(t('stats.restaurants'), t('stats.restaurants-sub'), ...ranking(data.restaurants)),
    card(t('stats.top'), t('stats.top-sub'), topDishes(data.dishes)),
    card(
      t('stats.per-day'),
      allTime ? t('stats.days-with-votes') : t('stats.weekdays'),
      ...perDay(data.days, data.from, data.to, allTime),
    ),
    card(t('stats.facts'), null, funFacts(data)),
  );
  slide.replaceChildren(head, kpis, grid);
}

async function load(range) {
  const slide = document.getElementById('slide');
  slide.setAttribute('aria-busy', 'true');
  try {
    const res = await fetch(`stats.json?range=${range}&lang=${LANG}`);
    if (!res.ok) throw new Error(res.status);
    render(await res.json());
  } catch {
    slide.replaceChildren(el('p', 'notice', t('stats.failed')));
  } finally {
    slide.setAttribute('aria-busy', 'false');
  }
}

for (const button of document.querySelectorAll('[data-range]')) {
  button.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b === button));
    load(button.dataset.range);
  });
}
document.getElementById('present').addEventListener('click', () => {
  document.getElementById('slide').requestFullscreen?.();
});

load('14');
