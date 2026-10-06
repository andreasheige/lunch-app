// "Välj åt mig": three questions drawn from QUESTIONS, each answer nudging dish and restaurant scores, then
// distance, how recently you ate there and a dash of chance pick the place. Pure functions; app.js draws the UI.

const COMFORT = ['burger', 'pancake', 'mince', 'sausage', 'pasta', 'pizza', 'pork'];
const SPICY = ['curry', 'noodles', 'taco', 'wok', 'wrap'];

// Each answer can score dishes by kind, diet or words in their text, and restaurants by distance or novelty.
// `why` is the reason shown with the suggestion when that answer helped pick it.
export const QUESTIONS = [
  {
    id: 'hunger',
    text: 'Hur hungrig är du?',
    answers: [
      { label: 'Lite sugen', kinds: ['salad', 'soup', 'sushi', 'sandwich'], why: 'du ville ha något lätt' },
      { label: 'Lagom' },
      {
        label: 'Vrålhungrig',
        kinds: ['burger', 'pizza', 'pasta', 'sausage', 'steak', 'pork', 'mince', 'pancake', 'curry'],
        why: 'du är vrålhungrig',
      },
    ],
  },
  {
    id: 'distance',
    text: 'Hur långt orkar du gå?',
    answers: [
      { label: 'Så nära som möjligt', distance: 'near', why: 'det är nära' },
      { label: 'Spelar ingen roll' },
      { label: 'Gärna en promenad', distance: 'far', why: 'du ville ha en promenad' },
    ],
  },
  {
    id: 'diet',
    text: 'Kött, fisk eller grönt?',
    answers: [
      { label: '🥩 Kött', diet: 'meat', why: 'du var sugen på kött' },
      { label: '🐟 Fisk', diet: 'fish', why: 'du var sugen på fisk' },
      { label: '🌱 Grönt', diet: 'veg', why: 'du ville äta grönt' },
      { label: 'Överraska mig', chance: 2 },
    ],
  },
  {
    id: 'mood',
    text: 'Vilket humör är du på?',
    answers: [
      { label: 'Comfort food', kinds: COMFORT, why: 'du behöver comfort food' },
      {
        label: 'Något fräscht',
        kinds: ['salad', 'fish', 'sushi', 'wok', 'shellfish'],
        words: /sallad|citron|lime|örter|picklad/i,
        why: 'du ville ha något fräscht',
      },
      {
        label: 'Något kryddigt',
        kinds: SPICY,
        words: /chili|kryddig|stark|jalapeño|kimchi|sriracha/i,
        why: 'du ville ha det kryddigt',
      },
    ],
  },
  {
    id: 'weather',
    text: 'Hur är vädret där ute?',
    answers: [
      {
        label: 'Grått och kallt',
        kinds: ['soup', 'curry', 'pasta', 'mince'],
        words: /gryta|soppa|gratäng|mos|puré/i,
        why: 'det är grått ute och det här värmer',
      },
      { label: 'Sol!', kinds: ['salad', 'taco', 'fish', 'wrap'], words: /sallad|grill/i, why: 'solen skiner' },
      { label: 'Vet inte, sitter i möte' },
    ],
  },
  {
    id: 'novelty',
    text: 'Något nytt eller det vanliga?',
    answers: [
      { label: 'Något nytt', novelty: 'new', why: 'det var länge sen du var där' },
      { label: 'Det vanliga', novelty: 'usual', why: 'det är ett säkert kort för dig' },
    ],
  },
  {
    id: 'carb',
    text: 'Potatis, ris eller pasta?',
    answers: [
      { label: 'Potatis', words: /potatis|mos\b|puré|pommes|klyft/i, why: 'du ville ha potatis' },
      { label: 'Ris', words: /\bris\b|jasminris|basmati|risotto|kokosris/i, why: 'du ville ha ris' },
      {
        label: 'Pasta & nudlar',
        kinds: ['pasta', 'noodles'],
        words: /nudlar|pasta/i,
        why: 'du ville ha pasta eller nudlar',
      },
      { label: 'Spelar ingen roll' },
    ],
  },
  {
    id: 'sauce',
    text: 'Hur viktig är såsen?',
    answers: [
      { label: 'Sås är livet', words: /sås|sky\b|gravy|gryta|curry/i, why: 'det blir sås' },
      { label: 'Lagom viktig' },
      { label: 'Torrt, tack', words: /sås|sky\b|gryta/i, weight: -1.5, why: 'det är inte så mycket sås' },
    ],
  },
  {
    id: 'adventure',
    text: 'Hur äventyrlig känner du dig?',
    answers: [
      {
        label: 'Säkra kort',
        kinds: ['burger', 'pizza', 'pasta', 'mince', 'fish', 'chicken'],
        why: 'du ville ha ett säkert kort',
      },
      {
        label: 'Överraska mig',
        kinds: ['curry', 'noodles', 'sushi', 'dumpling', 'wok', 'taco'],
        chance: 2,
        why: 'du ville bli överraskad',
      },
    ],
  },
];

// Three questions in random order, preferring ones not asked last time; the diet question is skipped while a
// diet filter already says what you want.
export function drawQuestions(lastIds = [], dietFiltered = false, random = Math.random) {
  const pool = QUESTIONS.filter((q) => !(dietFiltered && q.id === 'diet'));
  const shuffled = pool
    .map((q) => ({ q, key: random() + (lastIds.includes(q.id) ? 1 : 0) }))
    .sort((a, b) => a.key - b.key);
  return shuffled.slice(0, 3).map(({ q }) => q);
}

const dishText = (d) => [d.category, d.name, d.description].filter(Boolean).join(' ');

function scoreDish(d, answers) {
  let score = 0;
  const why = [];
  for (const a of answers) {
    let hit = 0;
    if (a.kinds?.includes(d.kind)) hit += 2;
    if (a.words?.test(dishText(d))) hit += 1.5;
    if (a.diet && d.diet) hit += d.diet === a.diet ? 3 : -4;
    const points = hit * (a.weight ?? 1);
    score += points;
    if (points > 0 && a.why) why.push(a.why);
  }
  return { score, why };
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Days since you last logged a visit, or null if never (history is [{ id, date: 'YYYY-MM-DD' }]).
function daysSince(id, history, today) {
  const last = history.filter((h) => h.id === id).sort((a, b) => b.date.localeCompare(a.date))[0];
  return last ? Math.round((Date.parse(today) - Date.parse(last.date)) / DAY_MS) : null;
}

/**
 * Ranks today's restaurants for these answers, best first: [{ restaurant, dish, score, why }].
 * `visible(dish)` is the diet filter, `isOpen(restaurant)` whether lunch is still on.
 */
export function rank(data, answers, { history = [], visible = () => true, isOpen = () => true, random = Math.random }) {
  const chance = Math.max(1, ...answers.map((a) => a.chance ?? 0));
  const results = [];
  for (const r of data.restaurants) {
    const dishes = r.dishes.filter(visible);
    if (r.error || !dishes.length || !isOpen(r)) continue;
    const best = dishes
      .map((d) => ({ dish: d, ...scoreDish(d, answers) }))
      .sort((a, b) => b.score - a.score || random() - 0.5)[0];
    let score = best.score;
    const why = [...best.why];

    const distance = answers.find((a) => a.distance)?.distance;
    if (distance === 'near') score += (300 - r.distance) / 60;
    if (distance === 'far') score += r.distance / 150;
    if ((distance === 'near' && r.distance <= 200) || (distance === 'far' && r.distance >= 250)) {
      why.push(answers.find((a) => a.distance).why);
    }

    const days = daysSince(r.id, history, data.date);
    const novelty = answers.find((a) => a.novelty)?.novelty;
    if (novelty === 'usual') {
      const visits = history.filter((h) => h.id === r.id).length;
      score += Math.min(visits, 5) * 0.8;
      if (visits) why.push(answers.find((a) => a.novelty).why);
    } else {
      // Recently eaten there counts against it either way; "Något nytt" doubles that and rewards long gaps.
      const weight = novelty === 'new' ? 2 : 1;
      if (days === null) score += 1 * weight;
      else if (days <= 2) score -= 3 * weight;
      else if (days <= 6) score -= 1 * weight;
      else score += 0.5 * weight;
      if (novelty === 'new' && (days === null || days > 6)) {
        why.push(days === null ? 'du har inte loggat något besök där än' : 'det var länge sen du var där');
      }
    }

    results.push({ restaurant: r, dish: best.dish, score: score + random() * chance, why: [...new Set(why)] });
  }
  return results.sort((a, b) => b.score - a.score);
}

// "Du ville ha något fräscht och det är nära." from the reasons that helped; a shrug when none did.
export function reasonText(why) {
  if (!why.length) return 'Ingen stark favorit idag – så slumpen fick bestämma.';
  const parts = why.slice(0, 3);
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}` : parts[0];
  return `${text.charAt(0).toLocaleUpperCase('sv')}${text.slice(1)}.`;
}
