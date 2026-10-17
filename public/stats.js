// /stats: six views of the lunch data. Overview (the story: headline, league, plate wall) and Analytics (charts and
// a sortable table) are about the ratings; Dashboard, Graph (ingredient network) and Visuals are about the menus,
// today's from /lunch.json and earlier days from /stats.json's menu history. History (/history.json, fetched when
// the tab opens) is the latest week's menus and the dishes that keep coming back. The numbers come from statsdata.js.
// Colours: diet and star scales are CSS variables in stats.css (validated with the dataviz rules); every mark also
// carries its number or label, and charts have a table view.
import { el } from './dom.js';
import { LANG, LOCALE, num, t } from './i18n.js';
import {
  dietCounts,
  INGREDIENTS,
  ingredientGraph,
  layoutGraph,
  league,
  priceOf,
  QUALIFY,
  weekVotes,
} from './statsdata.js';

const DAY_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const SHORT_FMT = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', timeZone: 'UTC' });
const WEEKDAY_FMT = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' });
const TABS = ['overview', 'analytics', 'dashboard', 'graph', 'visuals', 'history'];
const TAB_KEY = 'lunch-stats-tab';
const WALK_M_PER_MIN = 80;
const DIETS = ['veg', 'fish', 'meat', 'none'];
const SVG = 'http://www.w3.org/2000/svg';

const utcDate = (iso) => new Date(`${iso}T00:00:00Z`);
const votesText = (n) => t('votes', n);
const starClass = (avg) => `s${Math.min(5, Math.max(1, Math.round(avg)))}`;
const walkOf = (r) => Math.max(1, Math.round(r.distance / WALK_M_PER_MIN));
const svg = (tag, attrs = {}) => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
};

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

const state = {
  range: '14',
  tab: readTab(),
  stats: null,
  lunch: null,
  tr: {},
  selected: null,
  table: { key: 'avg', dir: -1 },
  dietTab: 'all',
  allDishes: false,
  history: undefined,
};

// A link to /stats#history (the home page's weekend recap) opens that tab.
function readTab() {
  const hash = location.hash.slice(1);
  if (TABS.includes(hash)) return hash;
  try {
    const saved = localStorage.getItem(TAB_KEY);
    return TABS.includes(saved) ? saved : 'overview';
  } catch {
    return 'overview';
  }
}

// Menu texts in English when the page is (translations.json); the data stays Swedish.
const tr = (text) => (text ? (state.tr[text] ?? text) : text);

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
  mark.setAttribute('role', 'img');
  mark.setAttribute('aria-label', lines.join(', '));
  mark.addEventListener('pointerenter', () => tooltip.show(mark, lines));
  mark.addEventListener('focus', () => tooltip.show(mark, lines));
  mark.addEventListener('pointerleave', () => tooltip.hide());
  mark.addEventListener('blur', () => tooltip.hide());
  return mark;
}

function card(title, subtitle, ...children) {
  const node = el('section', 'viz-card');
  node.append(el('h3', 'viz-title', title));
  if (subtitle) node.append(el('p', 'viz-subtitle', subtitle));
  node.append(...children);
  return node;
}

function kpi(label, value, note, delta) {
  const tile = el('div', 'kpi');
  tile.append(el('span', 'kpi-label', label), el('span', 'kpi-value', value));
  if (note || delta) {
    const line = el('span', 'kpi-note');
    if (delta)
      line.append(
        el('span', `kpi-delta ${delta.startsWith('-') || delta.startsWith('−') ? 'down' : 'up'}`, delta),
        ' ',
      );
    if (note) line.append(note);
    tile.append(line);
  }
  return tile;
}

function tableView(head, rows) {
  const details = el('details', 'table-view');
  details.append(el('summary', 'table-view-toggle', t('stats.as-table')));
  const table = el('table');
  const tr_ = el('tr');
  for (const h of head) tr_.append(el('th', null, h));
  table.append(tr_);
  for (const row of rows) {
    const r = el('tr');
    for (const c of row) r.append(el('td', null, String(c)));
    table.append(r);
  }
  details.append(table);
  return details;
}

const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0');
const period = (s) =>
  s.range === 'all' ? t('stats.all') : t('stats.week', [...new Set([isoWeek(s.from), isoWeek(s.to)])].join('–'));

// A filled score dot / plate: colour from the star scale, the number on it.
function scoreMark(avg, className, lines) {
  const mark = el('span', `${className} ${starClass(avg)}`, num(avg).replace(/[,.]0$/, ''));
  return lines ? withTooltip(mark, lines) : mark;
}

// ---- Overview: headline, big numbers, league, best and worst, plate wall ----

function overviewView() {
  const s = state.stats;
  if (!s.totals.votes) return [el('p', 'notice', t('stats.empty'))];
  const rows = league(s);
  const [leader] = rows;
  const byAvg = [...s.rated].sort((a, b) => b.avg - a.avg || b.votes - a.votes);
  const best = byAvg[0];
  const worst = byAvg.length > 1 ? byAvg.at(-1) : null;

  const head = el('header', 'story-head');
  head.append(
    el('p', 'story-kicker', `${period(s)} · ${t('stats.votes-from', s.totals.votes, s.totals.voters)}`),
    el('h2', 'story-headline', t('stats.headline', leader.name, period(s))),
    el(
      'p',
      'story-dek',
      t('stats.dek', s.totals.votes, num(s.totals.avg), best ? best.dish : '', best ? num(best.avg) : ''),
    ),
  );
  const numbers = el('div', 'big-numbers');
  for (const [value, label] of [
    [String(s.totals.votes), t('stats.votes').toLowerCase()],
    [String(s.totals.voters), t('stats.people')],
    [String(s.totals.dishes), t('stats.dishes-rated').toLowerCase()],
    [num(s.totals.avg), t('stats.avg-stars')],
  ]) {
    const n = el('div', 'big-number');
    n.append(el('span', 'big-value', value), el('span', 'big-label', label));
    numbers.append(n);
  }

  const table = el('table', 'league');
  const headRow = el('tr');
  for (const [text, cls] of [
    ['#', 'pos'],
    [t('stats.restaurant'), null],
    [t('stats.form'), 'form'],
    [t('stats.votes'), 'num'],
    [t('stats.avg'), 'num'],
  ]) {
    const th = el('th', cls, text);
    th.scope = 'col';
    headRow.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(headRow);
  rows.forEach((r, i) => {
    const row = el('tr', r.qualified ? null : 'unqualified');
    const name = el('td');
    name.append(
      el('span', 'league-name', r.name),
      el('span', 'league-note', r.qualified ? t('stats.qualified') : t('stats.needs', QUALIFY - r.votes)),
    );
    const form = el('td', 'form');
    for (const f of r.form)
      form.append(scoreMark(f.avg, 'form-dot', [num(f.avg), DAY_FMT.format(utcDate(f.date)), votesText(f.votes)]));
    row.append(
      el('td', 'pos', String(i + 1)),
      name,
      form,
      el('td', 'num', String(r.votes)),
      el('td', 'num league-avg', num(r.avg)),
    );
    table.tBodies[0].append(row);
  });
  const missing = (state.lunch?.restaurants ?? []).filter((r) => !s.restaurants.some((x) => x.id === r.id));
  const leagueCard = card(t('stats.league'), t('stats.league-sub', QUALIFY), table);
  if (missing.length) {
    const note = el('p', 'league-missing', `${t('stats.not-yet')}: ${missing.map((r) => r.name).join(', ')}. `);
    const link = el('a', null, t('stats.rate-today'));
    link.href = '/';
    note.append(link);
    leagueCard.append(note);
  }

  const side = el('div', 'story-side');
  if (best) {
    const c = el('div', 'highlight best');
    c.append(
      el('span', 'highlight-kicker', t('stats.best')),
      el('span', 'highlight-title', best.dish),
      el('span', 'highlight-meta', `${best.restaurant} · ★ ${num(best.avg)} · ${votesText(best.votes)}`),
    );
    side.append(c);
  }
  if (worst && worst.avg < best.avg) {
    const c = el('div', 'highlight worst');
    c.append(
      el('span', 'highlight-kicker', t('stats.worst')),
      el('span', 'highlight-title', worst.dish),
      el('span', 'highlight-meta', `${worst.restaurant} · ★ ${num(worst.avg)} · ${votesText(worst.votes)}`),
    );
    side.append(c);
  }
  const split = el('div', 'story-split');
  split.append(leagueCard, side);

  const wall = el('div', 'plates');
  for (const d of byAvg.slice(0, 18)) {
    const plate = el('figure', 'plate');
    const size = Math.min(110, 52 + d.votes * 14);
    const mark = scoreMark(d.avg, 'plate-mark', [`★ ${num(d.avg)}`, d.dish, d.restaurant, votesText(d.votes)]);
    mark.style.setProperty('--size', `${size}px`);
    plate.append(mark, el('figcaption', 'plate-name', d.dish), el('span', 'plate-place', d.restaurant));
    wall.append(plate);
  }
  return [head, numbers, split, card(t('stats.plates'), t('stats.plates-sub'), wall)];
}

// ---- Analytics: KPIs, votes per day and weekday, average and range, star spread, sortable table ----

function perDayChart(s) {
  const allTime = s.range === 'all';
  const byDate = new Map(s.days.map((d) => [d.date, d]));
  const dates = allTime ? s.days.map((d) => d.date) : weekdays(s.from, s.to);
  const max = Math.max(1, ...dates.map((d) => byDate.get(d)?.votes ?? 0));
  const chart = el('div', 'cols');
  chart.style.setProperty('--n', String(dates.length));
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
    if (day) slot.append(el('span', 'col-value', num(day.avg)));
    slot.append(col);
    chart.append(slot);
    if (i % every === 0) {
      const label = el('span', 'col-label', SHORT_FMT.format(utcDate(date)));
      label.style.gridColumn = String(i + 1);
      chart.append(label);
    }
  });
  return card(
    t('stats.per-day'),
    t('stats.per-day-sub'),
    chart,
    tableView(
      [t('stats.day'), t('stats.votes'), t('stats.avg')],
      s.days.map((d) => [DAY_FMT.format(utcDate(d.date)), d.votes, num(d.avg)]),
    ),
  );
}

function hbars(rows, className = '') {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const list = el('div', `hbars ${className}`);
  for (const r of rows) {
    const row = el('div', 'hbar-row');
    const track = el('div', 'hbar-track');
    const bar = el('div', 'hbar');
    bar.style.width = `${(r.value / max) * 100}%`;
    withTooltip(bar, [String(r.value), r.label]);
    track.append(bar);
    row.append(el('span', 'hbar-label', r.label), track, el('span', 'hbar-value', r.text ?? String(r.value)));
    list.append(row);
  }
  return list;
}

function weekdayChart(s) {
  const counts = [0, 0, 0, 0, 0];
  for (const d of s.days) {
    const day = utcDate(d.date).getUTCDay();
    if (day >= 1 && day <= 5) counts[day - 1] += d.votes;
  }
  const names = [1, 2, 3, 4, 5].map((i) => WEEKDAY_FMT.format(new Date(Date.UTC(2026, 9, 4 + i))));
  return card(
    t('stats.weekdays-title'),
    t('stats.weekdays-sub'),
    hbars(names.map((n, i) => ({ label: n, value: counts[i] }))),
  );
}

function starsOf(s, id) {
  const list = [0, 0, 0, 0, 0];
  for (const r of s.stars) if (r.id === id) list[r.stars - 1] = r.votes;
  return list;
}

function rangeChart(s) {
  const list = el('div', 'ranges');
  const axis = el('div', 'range-row range-axis');
  const ticks = el('span', 'range-ticks');
  for (const n of [1, 2, 3, 4, 5]) ticks.append(el('span', null, String(n)));
  axis.append(el('span'), ticks, el('span'));
  list.append(axis);
  for (const r of s.restaurants) {
    const stars = starsOf(s, r.id);
    const lo = stars.findIndex((n) => n) + 1;
    const hi = 5 - [...stars].reverse().findIndex((n) => n);
    const row = el('div', 'range-row');
    const track = el('span', 'range-track');
    const line = el('span', 'range-line');
    line.style.left = `${((lo - 1) / 4) * 100}%`;
    line.style.width = `${((hi - lo) / 4) * 100}%`;
    const dot = scoreMark(r.avg, 'range-dot', [`★ ${num(r.avg)}`, r.name, `${lo}–${hi}`, votesText(r.votes)]);
    dot.textContent = '';
    dot.style.left = `${((r.avg - 1) / 4) * 100}%`;
    track.append(line, dot);
    row.append(el('span', 'range-name', r.name), track, el('span', 'range-value', num(r.avg)));
    list.append(row);
  }
  return card(t('stats.range-title'), t('stats.range-sub'), list);
}

function spreadChart(s) {
  const legend = el('div', 'legend');
  for (const n of [1, 2, 3, 4, 5]) {
    const item = el('span', 'legend-item');
    item.append(el('span', `legend-swatch s${n}`), `${n} ★`);
    legend.append(item);
  }
  const list = el('div', 'spread');
  for (const r of s.restaurants) {
    const row = el('div', 'spread-row');
    const bar = el('span', 'spread-bar');
    starsOf(s, r.id).forEach((n, i) => {
      if (!n) return;
      const part = withTooltip(el('span', `spread-part s${i + 1}`, String(n)), [`${i + 1} ★: ${n}`, r.name]);
      part.style.flex = String(n);
      bar.append(part);
    });
    row.append(el('span', 'spread-name', r.name), bar, el('span', 'spread-votes', String(r.votes)));
    list.append(row);
  }
  return card(t('stats.spread-title'), null, legend, list);
}

function ratedTable(s) {
  const columns = [
    ['dish', t('stats.dish'), 'text'],
    ['restaurant', t('stats.restaurant'), 'text'],
    ['last', t('stats.last-rated'), 'text'],
    ['votes', t('stats.votes'), 'num'],
    ['avg', t('stats.avg'), 'num'],
    ['max', t('stats.low-high'), 'num'],
  ];
  const { key, dir } = state.table;
  const rows = [...s.rated].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    return (typeof x === 'string' ? x.localeCompare(y, LOCALE) : x - y) * dir;
  });
  const table = el('table', 'rated');
  const head = el('tr');
  for (const [k, label, type] of columns) {
    const th = el('th', type);
    th.scope = 'col';
    th.setAttribute('aria-sort', k === key ? (dir < 0 ? 'descending' : 'ascending') : 'none');
    const b = el('button', 'sort-by', `${label}${k === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}`);
    b.type = 'button';
    b.addEventListener('click', () => {
      state.table = { key: k, dir: k === key ? -dir : type === 'text' ? 1 : -1 };
      render();
      document.querySelector(`.rated th:nth-child(${columns.findIndex(([c]) => c === k) + 1}) button`)?.focus();
    });
    th.append(b);
    head.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  for (const d of rows) {
    const row = el('tr');
    const avg = el('td', 'num');
    avg.append(scoreMark(d.avg, 'score-pill'));
    row.append(
      el('td', 'dish', d.dish),
      el('td', null, d.restaurant),
      el('td', null, DAY_FMT.format(utcDate(d.last))),
      el('td', 'num', String(d.votes)),
      avg,
      el('td', 'num', d.min === d.max ? String(d.min) : `${d.min}–${d.max}`),
    );
    table.tBodies[0].append(row);
  }
  const wrap = el('div', 'table-scroll');
  wrap.append(table);
  return card(t('stats.rated-title'), t('stats.rated-sub'), wrap);
}

function analyticsView() {
  const s = state.stats;
  if (!s.totals.votes) return [el('p', 'notice', t('stats.empty'))];
  const kpis = el('div', 'kpis');
  kpis.append(
    kpi(t('stats.votes'), String(s.totals.votes), period(s)),
    kpi(t('stats.voters'), String(s.totals.voters), t('stats.browsers')),
    kpi(t('stats.dishes-rated'), String(s.totals.dishes), t('stats.at-places', s.restaurants.length)),
    kpi(t('stats.kpi-avg'), `★ ${num(s.totals.avg)}`, t('stats.of-5')),
    kpi(t('stats.places-rated'), String(s.restaurants.length), t('stats.of-n', state.lunch?.restaurants.length ?? 10)),
  );
  const row1 = el('div', 'viz-grid two-one');
  row1.append(perDayChart(s), weekdayChart(s));
  const row2 = el('div', 'viz-grid');
  row2.append(rangeChart(s), spreadChart(s));
  return [kpis, row1, row2, ratedTable(s)];
}

// ---- Dashboard: today's menus at a glance, votes this week vs last, today's dishes ----

const TABLE_ROWS = 12;
const menuPlaces = () => (state.lunch?.restaurants ?? []).filter((r) => !r.error && !r.embed && r.dishes.length);

function lineChart(series, labels) {
  const max = Math.max(1, ...series.flatMap((s) => s.values.filter((v) => v !== null)));
  const box = el('div', 'line-chart');
  const plot = svg('svg', { viewBox: '0 0 100 50', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
  const x = (i) => (i / (labels.length - 1)) * 100;
  const y = (v) => 50 - (v / max) * 46 - 2;
  for (const s of series) {
    const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
    plot.append(
      svg('polyline', { points: pts.join(' '), class: `line ${s.className}`, 'vector-effect': 'non-scaling-stroke' }),
    );
  }
  box.append(plot);
  for (const s of series) {
    s.values.forEach((v, i) => {
      if (v === null) return;
      const dot = withTooltip(el('span', `line-dot ${s.className}`), [votesText(v), `${s.label}, ${labels[i]}`]);
      dot.style.left = `${x(i)}%`;
      dot.style.top = `${(y(v) / 50) * 100}%`;
      box.append(dot);
    });
  }
  const axis = el('div', 'line-axis');
  for (const l of labels) axis.append(el('span', null, l));
  const legend = el('div', 'legend');
  for (const s of series) {
    const item = el('span', 'legend-item');
    item.append(el('span', `legend-line ${s.className}`), s.label);
    legend.append(item);
  }
  return [box, axis, legend];
}

function dishTable() {
  const today = state.lunch.date;
  const all = menuPlaces().flatMap((r) => r.dishes.map((d) => ({ r, d })));
  const tabs = el('div', 'diet-tabs');
  tabs.setAttribute('role', 'tablist');
  for (const id of ['all', 'veg', 'fish', 'meat']) {
    const n = all.filter(({ d }) => id === 'all' || d.diet === id).length;
    const b = el('button', 'diet-tab', `${id === 'all' ? t('diet.all') : t(`diet.${id}`)} `);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.dietTab === id));
    b.append(el('span', 'diet-tab-count', String(n)));
    b.addEventListener('click', () => {
      state.dietTab = id;
      render();
      document.querySelector('.diet-tab[aria-selected="true"]')?.focus();
    });
    tabs.append(b);
  }
  const matching = all.filter(({ d }) => state.dietTab === 'all' || d.diet === state.dietTab);
  const rows = state.allDishes ? matching : matching.slice(0, TABLE_ROWS);
  const ratedToday = new Map(
    state.stats.rated.filter((x) => x.last === today).map((x) => [`${x.restaurant}\n${x.dish}`, x]),
  );
  const table = el('table', 'menu-table');
  const head = el('tr');
  for (const [label, cls] of [
    [t('stats.dish'), null],
    [t('stats.restaurant'), null],
    [t('stats.walk'), 'num'],
    [t('stats.mentions'), null],
    [t('stats.status'), null],
  ]) {
    const th = el('th', cls, label);
    th.scope = 'col';
    head.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(head);
  for (const { r, d } of rows) {
    const row = el('tr');
    const dish = el('td', 'dish');
    dish.append(el('span', `diet-dot ${d.diet ?? 'none'}`), tr(d.name));
    const rated = ratedToday.get(`${r.name}\n${tr(d.name)}`) ?? ratedToday.get(`${r.name}\n${d.name}`);
    const status = el('td');
    const mentions = d.mentions ?? [];
    if (rated) status.append(el('span', 'pill good', `★ ${num(rated.avg)}`));
    else if (mentions.includes('shellfish') || mentions.includes('nuts'))
      status.append(el('span', 'pill warn', t(`allergen.${mentions.includes('nuts') ? 'nuts' : 'shellfish'}`)));
    else status.append(el('span', 'pill', t('rate.none')));
    row.append(
      dish,
      el('td', null, r.name),
      el('td', 'num', t('card.walk-short', walkOf(r))),
      el('td', null, mentions.map((m) => t(`allergen.${m}`).toLocaleLowerCase(LOCALE)).join(', ') || '–'),
      status,
    );
    table.tBodies[0].append(row);
  }
  const wrap = el('div', 'table-scroll');
  wrap.append(table);
  const box = el('section', 'viz-card menu-card');
  box.append(tabs, wrap);
  if (matching.length > TABLE_ROWS) {
    const more = el('button', 'table-more', state.allDishes ? t('card.fewer') : t('stats.show-all', matching.length));
    more.type = 'button';
    more.addEventListener('click', () => {
      state.allDishes = !state.allDishes;
      render();
      document.querySelector('.table-more')?.focus();
    });
    box.append(more);
  }
  return box;
}

function dashboardView() {
  if (!state.lunch?.day) return [el('p', 'notice', t('stats.no-menu'))];
  const s = state.stats;
  const places = menuPlaces();
  const diet = dietCounts(places);
  const dishes = places.reduce((n, r) => n + r.dishes.length, 0);
  const before = [...s.menuDays].reverse().find((d) => d.date < state.lunch.date);
  const prices = places.map(priceOf).filter(Boolean);
  const { thisWeek, lastWeek } = weekVotes(s.days, state.lunch.date);
  const sum = (xs) => xs.reduce((a, b) => a + (b ?? 0), 0);
  const kpis = el('div', 'kpis kpi-strip');
  kpis.append(
    kpi(
      t('stats.dishes-today'),
      String(dishes),
      before ? t('stats.vs', DAY_FMT.format(utcDate(before.date))) : t('stats.history-starts'),
      before ? signed(dishes - before.dishes) : null,
    ),
    kpi(
      t('diet.veg'),
      String(diet.veg),
      before ? t('stats.vs', DAY_FMT.format(utcDate(before.date))) : null,
      before ? signed(diet.veg - before.veg) : null,
    ),
    kpi(t('stats.places-serving'), String(places.length), t('stats.of-n', state.lunch.restaurants.length)),
    kpi(
      t('stats.avg-price'),
      prices.length ? `${Math.round(sum(prices) / prices.length)} kr` : '–',
      t('stats.list-price', prices.length),
    ),
    kpi(t('stats.votes-week'), String(sum(thisWeek)), t('stats.vs-last-week'), signed(sum(thisWeek) - sum(lastWeek))),
    kpi(t('stats.kpi-avg'), s.totals.votes ? `★ ${num(s.totals.avg)}` : '–', votesText(s.totals.votes)),
  );

  const mix = el('div', 'mix-bar');
  const mixLegend = el('div', 'legend');
  for (const k of DIETS) {
    if (!diet[k]) continue;
    const label = k === 'none' ? t('stats.no-label') : t(`diet.${k}`);
    const part = withTooltip(el('span', `mix-part ${k}`), [String(diet[k]), label]);
    part.style.flex = String(diet[k]);
    mix.append(part);
    const item = el('span', 'legend-item');
    item.append(el('span', `legend-swatch ${k}`), `${label} `, el('strong', null, String(diet[k])));
    mixLegend.append(item);
  }
  const most = hbars(
    [...places]
      .sort((a, b) => b.dishes.length - a.dishes.length)
      .slice(0, 6)
      .map((r) => ({
        label: r.name,
        value: r.dishes.length,
        text: t('stats.dishes-veg', r.dishes.length, r.dishes.filter((d) => d.diet === 'veg').length),
      })),
    'ink',
  );
  const mixCard = card(
    t('stats.mix-title'),
    t('stats.mix-sub', dishes, places.length),
    mix,
    mixLegend,
    el('h4', 'viz-subhead', t('stats.most-dishes')),
    most,
  );
  const names = [1, 2, 3, 4, 5].map((i) => WEEKDAY_FMT.format(new Date(Date.UTC(2026, 9, 4 + i))).slice(0, 3));
  const lineCard = card(
    t('stats.week-title'),
    t('stats.week-sub'),
    ...lineChart(
      [
        { label: t('stats.last-week'), values: lastWeek, className: 'last' },
        { label: t('stats.this-week'), values: thisWeek, className: 'this' },
      ],
      names,
    ),
  );
  const row = el('div', 'viz-grid one-two');
  row.append(mixCard, lineCard);
  return [kpis, row, dishTable()];
}

// ---- Graph: places linked to the ingredients on today's menus ----

const GRAPH_W = 1060;
const GRAPH_H = 600;
let graphObserver = null;

function graphView() {
  const places = menuPlaces();
  if (!places.length) return [el('p', 'notice', t('stats.no-menu'))];
  const graph = ingredientGraph(places);
  const pos = layoutGraph(graph, GRAPH_W, GRAPH_H);
  const label = (n) =>
    n.kind === 'place' ? n.label : (INGREDIENTS.find(([sv]) => sv === n.label)?.[LANG === 'en' ? 1 : 0] ?? n.label);
  const sel = state.selected && graph.nodes.some((n) => n.id === state.selected) ? state.selected : null;
  const near = new Set(
    sel ? graph.links.filter((l) => l.source === sel || l.target === sel).flatMap((l) => [l.source, l.target]) : [],
  );
  const radius = (n) => (n.kind === 'place' ? 12 + n.size * 1.1 : 4 + n.size * 1.2);

  const frame = el('div', 'graph-frame');
  const stage = el('div', 'graph-stage');
  const lines = svg('svg', { viewBox: `0 0 ${GRAPH_W} ${GRAPH_H}`, class: 'graph-lines', 'aria-hidden': 'true' });
  for (const l of graph.links) {
    const a = pos.get(l.source);
    const b = pos.get(l.target);
    const kind = graph.nodes.find((n) => n.id === l.target).kind;
    const on = sel && (l.source === sel || l.target === sel);
    lines.append(
      svg('line', {
        x1: a.x,
        y1: a.y,
        x2: b.x,
        y2: b.y,
        class: `edge ${kind}${on ? ' on' : ''}${sel && !on ? ' off' : ''}`,
        'stroke-width': 0.6 + l.weight * 0.6,
      }),
    );
  }
  stage.append(lines);
  for (const n of graph.nodes) {
    const p = pos.get(n.id);
    const r = radius(n);
    const node = el('button', `node ${n.kind}${sel && !near.has(n.id) ? ' off' : ''}${n.id === sel ? ' on' : ''}`);
    node.type = 'button';
    node.style.left = `${p.x}px`;
    node.style.top = `${p.y}px`;
    node.style.setProperty('--r', `${r}px`);
    const text =
      n.kind === 'place' ? t('stats.node-place', label(n), n.size) : t('stats.node-ingredient', label(n), n.size);
    node.setAttribute('aria-label', text);
    node.setAttribute('aria-pressed', String(n.id === sel));
    node.title = text;
    node.addEventListener('click', () => {
      state.selected = n.id === sel ? null : n.id;
      render();
      document.querySelector('.node[aria-pressed="true"]')?.focus();
    });
    stage.append(node);
    if (n.kind === 'place' || n.size >= 5 || near.has(n.id)) {
      const tag = el('span', `node-label ${n.kind}${sel && !near.has(n.id) ? ' off' : ''}`, label(n));
      tag.style.left = `${p.x}px`;
      tag.style.top = `${p.y + r + 3}px`;
      stage.append(tag);
    }
  }
  frame.append(stage);
  // The stage is laid out at 1060 × 600 and scaled to the frame's width.
  graphObserver?.disconnect();
  graphObserver = new ResizeObserver(([entry]) => {
    const scale = Math.min(1, entry.contentRect.width / GRAPH_W);
    stage.style.transform = `scale(${scale})`;
    frame.style.height = `${GRAPH_H * scale}px`;
  });
  graphObserver.observe(frame);

  const side = el('aside', 'graph-side');
  side.append(el('h2', 'graph-title', t('stats.graph-title')), el('p', 'viz-subtitle', t('stats.graph-sub')));
  const legend = el('div', 'legend legend-column');
  for (const [cls, key] of [
    ['place', 'stats.legend-place'],
    ['meat', 'stats.legend-meat'],
    ['fish', 'stats.legend-fish'],
    ['veg', 'stats.legend-veg'],
  ]) {
    const item = el('span', 'legend-item');
    item.append(el('span', `legend-dot ${cls}`), t(key));
    legend.append(item);
  }
  const info = el('div', 'graph-info');
  if (sel) {
    const node = graph.nodes.find((n) => n.id === sel);
    const links = graph.links.filter((l) => l.source === sel || l.target === sel);
    const other = (l) => graph.nodes.find((n) => n.id === (l.source === sel ? l.target : l.source));
    info.append(
      el('strong', null, label(node)),
      el('span', null, links.map((l) => `${label(other(l))}${l.weight > 1 ? ` ×${l.weight}` : ''}`).join(', ')),
    );
  } else {
    const hubs = graph.nodes
      .filter((n) => n.kind !== 'place')
      .sort((a, b) => b.size - a.size)
      .slice(0, 4);
    info.append(
      el('strong', null, t('stats.hubs')),
      el('span', null, hubs.map((n) => `${label(n)} (${n.size})`).join(', ')),
    );
  }
  side.append(legend, info);
  const ingredients = graph.nodes.filter((n) => n.kind !== 'place').sort((a, b) => b.size - a.size);
  const asTable = tableView(
    [t('stats.ingredient'), t('stats.dishes'), t('stats.restaurants')],
    ingredients.map((n) => [
      label(n),
      n.size,
      graph.links
        .filter((l) => l.target === n.id)
        .map((l) => graph.nodes.find((x) => x.id === l.source).label)
        .join(', '),
    ]),
  );
  const layout = el('div', 'graph-layout');
  const main = el('div', 'graph-main');
  main.append(frame, asTable);
  layout.append(side, main);
  return [layout];
}

// ---- Visuals: treemap, price vs walk, day-to-day slope, rating calendar, mentions, threads ----

function treemap(places) {
  const box = el('div', 'treemap');
  for (const r of [...places].sort((a, b) => b.dishes.length - a.dishes.length)) {
    const col = el('div', 'tree-col');
    col.style.flex = String(r.dishes.length);
    col.append(el('span', 'tree-name', r.name));
    const counts = dietCounts([r]);
    for (const k of ['meat', 'fish', 'veg', 'none']) {
      if (!counts[k]) continue;
      const label = k === 'none' ? t('stats.no-label') : t(`diet.${k}`);
      const cell = el('span', `tree-cell ${k}`);
      cell.append(el('span', 'tree-count', String(counts[k])));
      withTooltip(cell, [String(counts[k]), r.name, label]);
      cell.style.flex = String(counts[k]);
      col.append(cell);
    }
    box.append(col);
  }
  return card(t('stats.tree-title'), t('stats.tree-sub'), box);
}

function scatter(places) {
  const points = places.map((r) => ({ r, price: priceOf(r), walk: walkOf(r) })).filter((p) => p.price);
  if (points.length < 2) return card(t('stats.scatter-title'), t('stats.scatter-none'));
  const lo = Math.floor(Math.min(...points.map((p) => p.price)) / 10) * 10 - 5;
  const hi = Math.ceil(Math.max(...points.map((p) => p.price)) / 10) * 10 + 5;
  const maxWalk = Math.max(7, ...points.map((p) => p.walk + 1));
  const plot = el('div', 'scatter');
  for (const p of points) {
    const size = 14 + p.r.dishes.length * 4;
    const dot = withTooltip(el('span', 'scatter-dot'), [
      `${p.price} kr`,
      p.r.name,
      t('card.walk', p.walk),
      t('stats.dishes-n', p.r.dishes.length),
    ]);
    dot.style.left = `${(p.walk / maxWalk) * 100}%`;
    dot.style.bottom = `${((p.price - lo) / (hi - lo)) * 100}%`;
    dot.style.setProperty('--size', `${size}px`);
    const name = el('span', 'scatter-name', p.r.name.split(' ')[0]);
    name.style.left = dot.style.left;
    name.style.bottom = `calc(${dot.style.bottom} + ${size / 2 + 2}px)`;
    plot.append(dot, name);
  }
  plot.append(
    el('span', 'scatter-y top', `${hi} kr`),
    el('span', 'scatter-y bottom', `${lo} kr`),
    el('span', 'scatter-x', t('card.walk', maxWalk)),
  );
  return card(t('stats.scatter-title'), t('stats.scatter-sub', points.length), plot);
}

function slope(s, places) {
  const today = { date: state.lunch.date, ...dietCounts(places) };
  const before = [...s.menuDays].reverse().find((d) => d.date < today.date);
  if (!before) return card(t('stats.slope-title'), t('stats.history-starts'));
  const max = Math.max(...['veg', 'fish', 'meat'].flatMap((k) => [before[k], today[k]]), 1);
  const plot = svg('svg', {
    viewBox: '0 0 100 60',
    preserveAspectRatio: 'none',
    class: 'slope-lines',
    'aria-hidden': 'true',
  });
  const box = el('div', 'slope');
  const y = (v) => 56 - (v / max) * 52;
  for (const k of ['meat', 'veg', 'fish']) {
    plot.append(
      svg('line', {
        x1: 0,
        y1: y(before[k]),
        x2: 100,
        y2: y(today[k]),
        class: `slope-line ${k}`,
        'vector-effect': 'non-scaling-stroke',
      }),
    );
    const a = el('span', 'slope-label left', String(before[k]));
    a.style.top = `${(y(before[k]) / 60) * 100}%`;
    const b = el('span', `slope-label right ${k}`, `${today[k]} ${t(`diet.${k}`)}`);
    b.style.top = `${(y(today[k]) / 60) * 100}%`;
    box.append(a, b);
  }
  box.prepend(plot);
  const axis = el('div', 'slope-axis');
  axis.append(
    el('span', null, DAY_FMT.format(utcDate(before.date))),
    el('span', null, DAY_FMT.format(utcDate(today.date))),
  );
  return card(t('stats.slope-title'), t('stats.slope-sub'), box, axis);
}

function calendar(s) {
  const byDate = new Map(s.days.map((d) => [d.date, d.votes]));
  const first = utcDate(s.range === 'all' && s.days.length ? s.days[0].date : s.from);
  first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const grid = el('div', 'calendar');
  grid.append(el('span'));
  for (let i = 0; i < 5; i++)
    grid.append(el('span', 'cal-head', WEEKDAY_FMT.format(new Date(Date.UTC(2026, 9, 5 + i))).slice(0, 3)));
  const max = Math.max(1, ...s.days.map((d) => d.votes));
  for (
    const monday = new Date(first);
    monday.toISOString().slice(0, 10) <= s.to;
    monday.setUTCDate(monday.getUTCDate() + 7)
  ) {
    grid.append(el('span', 'cal-week', t('stats.week-short', isoWeek(monday.toISOString().slice(0, 10)))));
    for (let i = 0; i < 5; i++) {
      const d = new Date(monday);
      d.setUTCDate(monday.getUTCDate() + i);
      const iso = d.toISOString().slice(0, 10);
      const n = byDate.get(iso) ?? 0;
      const cell = withTooltip(
        el(
          'span',
          `cal-day level${n ? Math.ceil((n / max) * 3) : 0}${iso > s.to ? ' future' : ''}`,
          n ? String(n) : '',
        ),
        [votesText(n), DAY_FMT.format(d)],
      );
      grid.append(cell);
    }
  }
  return card(t('stats.calendar-title'), t('stats.calendar-sub'), grid);
}

function mentions(places) {
  const counts = new Map();
  for (const r of places)
    for (const d of r.dishes) for (const m of d.mentions ?? []) counts.set(m, (counts.get(m) ?? 0) + 1);
  const rows = [...counts].sort((a, b) => b[1] - a[1]).map(([m, n]) => ({ label: t(`allergen.${m}`), value: n }));
  return card(
    t('stats.mentions-title'),
    t(
      'stats.mentions-sub',
      places.reduce((n, r) => n + r.dishes.length, 0),
    ),
    hbars(rows, 'warn'),
  );
}

// Data art: a fan of threads per place, one per dish, coloured by diet; longer means a longer walk.
function threads(places) {
  const art = svg('svg', {
    viewBox: '-170 -170 340 340',
    class: 'threads',
    role: 'img',
    'aria-label': t(
      'stats.threads-label',
      places.reduce((n, r) => n + r.dishes.length, 0),
      places.length,
    ),
  });
  const maxWalk = Math.max(...places.map(walkOf), 1);
  places.forEach((r, pi) => {
    const base = (pi / places.length) * Math.PI * 2 - Math.PI / 2;
    const spread = ((Math.PI * 2) / places.length) * 0.8;
    r.dishes.forEach((d, di) => {
      const a = base + (r.dishes.length === 1 ? 0 : (di / (r.dishes.length - 1) - 0.5) * spread);
      const len = 46 + (walkOf(r) / maxWalk) * 80 + (di % 3) * 7;
      const bend = a + 0.35;
      art.append(
        svg('path', {
          d: `M0 0 Q ${Math.cos(bend) * len * 0.6} ${Math.sin(bend) * len * 0.6} ${Math.cos(a) * len} ${Math.sin(a) * len}`,
          class: `thread ${d.diet ?? 'none'}`,
        }),
      );
    });
    const tip = svg('text', {
      x: Math.cos(base) * 150,
      y: Math.sin(base) * 150,
      class: 'thread-label',
      'text-anchor': 'middle',
      'dominant-baseline': 'middle',
    });
    tip.textContent = r.name.split(' ')[0];
    art.append(tip);
  });
  const box = el('section', 'viz-card art');
  box.append(el('h3', 'viz-title', t('stats.threads-title')), el('p', 'viz-subtitle', t('stats.threads-sub')), art);
  return box;
}

function visualsView() {
  if (!state.lunch?.day) return [el('p', 'notice', t('stats.no-menu'))];
  const places = menuPlaces();
  const grid = el('div', 'viz-grid three');
  grid.append(
    treemap(places),
    scatter(places),
    slope(state.stats, places),
    calendar(state.stats),
    mentions(places),
    threads(places),
  );
  return [grid];
}

// ---- The page ----

const VIEWS = {
  overview: overviewView,
  analytics: analyticsView,
  dashboard: dashboardView,
  graph: graphView,
  visuals: visualsView,
  history: historyView,
};

// ---- History: the latest week's menus, its best-rated dishes and the dishes that keep coming back ----

function historyTable(head, rows) {
  const table = el('table', 'menu-table history-table');
  const headRow = el('tr');
  for (const [label, cls] of head) {
    const th = el('th', cls, label);
    th.scope = 'col';
    headRow.append(th);
  }
  table.append(el('thead'), el('tbody'));
  table.tHead.append(headRow);
  for (const cells of rows) {
    const row = el('tr');
    cells.forEach((c, i) => {
      row.append(el('td', head[i][1], c));
    });
    table.tBodies[0].append(row);
  }
  const wrap = el('div', 'table-scroll');
  wrap.append(table);
  return wrap;
}

function historyView() {
  const h = state.history;
  if (h === undefined) {
    if (!historyRequested) {
      historyRequested = true;
      loadHistory();
    }
    return [el('p', 'notice', t('stats.loading'))];
  }
  if (h === null) return [el('p', 'notice', t('stats.failed'))];
  if (!h.week) return [el('p', 'notice', t('history.empty'))];
  const short = (iso) => SHORT_FMT.format(utcDate(iso));
  const week = t('history.week', h.week.week, short(h.week.from), short(h.week.to));
  const top = h.top.length
    ? historyTable(
        [
          [t('stats.dish'), null],
          [t('stats.restaurant'), null],
          [t('stats.votes'), 'num'],
          [t('stats.avg'), 'num'],
        ],
        h.top.map((d) => [d.dish, d.restaurant, String(d.votes), `★ ${num(d.avg)}`]),
      )
    : el('p', 'empty', t('history.no-votes'));
  const recurring = h.recurring.length
    ? historyTable(
        [
          [t('stats.dish'), null],
          [t('stats.restaurant'), null],
          [t('history.col-times'), 'num'],
          [t('history.col-last'), null],
        ],
        h.recurring.map((d) => [d.dish, d.restaurant, String(d.times), short(d.last)]),
      )
    : el('p', 'empty', t('history.no-recurring'));
  const days = el('div', 'viz-grid');
  for (const day of h.week.days) {
    const list = el('ul', 'history-day');
    for (const p of day.places) {
      const li = el('li');
      li.append(el('strong', null, p.name));
      const dishes = el('ul');
      for (const d of p.dishes) {
        const item = el('li');
        const dot = el('span', `diet-dot ${d.diet ?? 'none'}`);
        dot.setAttribute('role', 'img');
        dot.setAttribute('aria-label', d.diet ? t(`diet.${d.diet}`) : t('stats.no-label'));
        item.append(dot, d.dish);
        dishes.append(item);
      }
      li.append(dishes);
      list.append(li);
    }
    days.append(card(WEEKDAY_FMT.format(utcDate(day.date)), short(day.date), list));
  }
  const both = el('div', 'viz-grid');
  both.append(card(t('history.top'), week, top), card(t('history.recurring'), t('history.recurring-sub'), recurring));
  return [
    el('p', 'notice', t('history.since', short(h.since), h.days)),
    both,
    el('h2', 'history-heading', `${t('history.menus')} · ${week}`),
    days,
  ];
}

// Fetched once, the first time the tab opens; null when it failed.
let historyRequested = false;
async function loadHistory() {
  try {
    const res = await fetch(`history.json?lang=${LANG}`);
    state.history = res.ok ? await res.json() : null;
  } catch {
    state.history = null;
  }
  if (state.tab === 'history') render();
}

function render() {
  const panel = document.getElementById('stats-view');
  for (const b of document.querySelectorAll('[data-tab]')) {
    const on = b.dataset.tab === state.tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  panel.setAttribute('aria-labelledby', `tab-${state.tab}`);
  document.getElementById('stats-range').hidden = !['overview', 'analytics'].includes(state.tab);
  if (!state.stats) return;
  if (state.tab !== 'graph') graphObserver?.disconnect();
  panel.replaceChildren(...VIEWS[state.tab]());
}

// The ratings for the chosen range; `menus` (the first load) is awaited too, so the views draw once with both.
async function loadStats(menus = Promise.resolve()) {
  const panel = document.getElementById('stats-view');
  panel.setAttribute('aria-busy', 'true');
  try {
    const [res] = await Promise.all([fetch(`stats.json?range=${state.range}&lang=${LANG}`), menus]);
    if (!res.ok) throw new Error(res.status);
    state.stats = await res.json();
    render();
  } catch {
    panel.replaceChildren(el('p', 'notice', t('stats.failed')));
  } finally {
    panel.setAttribute('aria-busy', 'false');
  }
}

async function loadMenus() {
  try {
    const [lunch, translations] = await Promise.all([
      fetch('lunch.json').then((r) => (r.ok ? r.json() : null)),
      LANG === 'en' ? fetch('translations.json').then((r) => (r.ok ? r.json() : {})) : {},
    ]);
    state.lunch = lunch;
    state.tr = translations ?? {};
  } catch {}
}

for (const b of document.querySelectorAll('[data-tab]')) {
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab;
    try {
      localStorage.setItem(TAB_KEY, state.tab);
    } catch {}
    render();
  });
  // Arrow keys move between tabs, as in any tab list.
  b.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    const i = TABS.indexOf(b.dataset.tab) + (event.key === 'ArrowRight' ? 1 : -1);
    document.querySelector(`[data-tab="${TABS[(i + TABS.length) % TABS.length]}"]`)?.click();
    document.querySelector('[data-tab][aria-selected="true"]')?.focus();
  });
}
for (const button of document.querySelectorAll('[data-range]')) {
  button.addEventListener('click', () => {
    for (const b of document.querySelectorAll('[data-range]')) b.setAttribute('aria-pressed', String(b === button));
    state.range = button.dataset.range;
    loadStats();
  });
}

render();
// Menus and ratings in parallel; most views need both.
loadStats(loadMenus());
