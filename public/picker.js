// "Välj åt mig": three questions drawn from QUESTIONS, each answer nudging dish and restaurant scores, then
// distance, how recently you ate there and a dash of chance pick the place. Pure functions; app.js draws the UI.

const COMFORT = ['burger', 'pancake', 'mince', 'sausage', 'pasta', 'pizza', 'pork'];
const SPICY = ['curry', 'noodles', 'taco', 'wok', 'wrap'];

// Each answer can score dishes by kind, diet or words in their text, and restaurants by distance or novelty.
// `why` is the reason shown with the suggestion when that answer helped pick it. Every Swedish text has an English
// twin (`textEn`, `labelEn`, `whyEn`); the `words` stay Swedish since they match the Swedish menu text.
export const QUESTIONS = [
  {
    id: 'hunger',
    text: 'Hur hungrig är du?',
    textEn: 'How hungry are you?',
    answers: [
      {
        label: 'Lite sugen',
        labelEn: 'A bit peckish',
        kinds: ['salad', 'soup', 'sushi', 'sandwich'],
        why: 'du ville ha något lätt',
        whyEn: 'you wanted something light',
      },
      { label: 'Lagom', labelEn: 'Medium' },
      {
        label: 'Vrålhungrig',
        labelEn: 'Starving',
        kinds: ['burger', 'pizza', 'pasta', 'sausage', 'steak', 'pork', 'mince', 'pancake', 'curry'],
        why: 'du är vrålhungrig',
        whyEn: "you're starving",
      },
    ],
  },
  {
    id: 'distance',
    text: 'Hur långt orkar du gå?',
    textEn: 'How far are you up for walking?',
    answers: [
      {
        label: 'Så nära som möjligt',
        labelEn: 'As close as possible',
        distance: 'near',
        why: 'det är nära',
        whyEn: "it's close",
      },
      { label: 'Spelar ingen roll', labelEn: "Doesn't matter" },
      {
        label: 'Gärna en promenad',
        labelEn: "I'd like a walk",
        distance: 'far',
        why: 'du ville ha en promenad',
        whyEn: 'you wanted a walk',
      },
    ],
  },
  {
    id: 'diet',
    text: 'Kött, fisk eller grönt?',
    textEn: 'Meat, fish or veggie?',
    answers: [
      { label: '🥩 Kött', labelEn: '🥩 Meat', diet: 'meat', why: 'du var sugen på kött', whyEn: 'you fancied meat' },
      { label: '🐟 Fisk', labelEn: '🐟 Fish', diet: 'fish', why: 'du var sugen på fisk', whyEn: 'you fancied fish' },
      { label: '🌱 Grönt', labelEn: '🌱 Veggie', diet: 'veg', why: 'du ville äta grönt', whyEn: 'you wanted veggie' },
      { label: 'Överraska mig', labelEn: 'Surprise me', chance: 2 },
    ],
  },
  {
    id: 'mood',
    text: 'Vilket humör är du på?',
    textEn: 'What mood are you in?',
    answers: [
      {
        label: 'Comfort food',
        labelEn: 'Comfort food',
        kinds: COMFORT,
        why: 'du behöver comfort food',
        whyEn: 'you need comfort food',
      },
      {
        label: 'Något fräscht',
        labelEn: 'Something fresh',
        kinds: ['salad', 'fish', 'sushi', 'wok', 'shellfish'],
        words: /sallad|citron|lime|örter|picklad/i,
        why: 'du ville ha något fräscht',
        whyEn: 'you wanted something fresh',
      },
      {
        label: 'Något kryddigt',
        labelEn: 'Something spicy',
        kinds: SPICY,
        words: /chili|kryddig|stark|jalapeño|kimchi|sriracha/i,
        why: 'du ville ha det kryddigt',
        whyEn: 'you wanted it spicy',
      },
    ],
  },
  {
    id: 'weather',
    text: 'Hur är vädret där ute?',
    textEn: "What's the weather like out there?",
    answers: [
      {
        label: 'Grått och kallt',
        labelEn: 'Grey and cold',
        kinds: ['soup', 'curry', 'pasta', 'mince'],
        words: /gryta|soppa|gratäng|mos|puré/i,
        why: 'det är grått ute och det här värmer',
        whyEn: "it's grey outside and this warms you up",
      },
      {
        label: 'Sol!',
        labelEn: 'Sunny!',
        kinds: ['salad', 'taco', 'fish', 'wrap'],
        words: /sallad|grill/i,
        why: 'solen skiner',
        whyEn: 'the sun is shining',
      },
      { label: 'Vet inte, sitter i möte', labelEn: "No idea, I'm in a meeting" },
    ],
  },
  {
    id: 'novelty',
    text: 'Något nytt eller det vanliga?',
    textEn: 'Something new or the usual?',
    answers: [
      {
        label: 'Något nytt',
        labelEn: 'Something new',
        novelty: 'new',
        why: 'det var länge sen du var där',
        whyEn: "it's been a while since you were there",
      },
      {
        label: 'Det vanliga',
        labelEn: 'The usual',
        novelty: 'usual',
        why: 'det är ett säkert kort för dig',
        whyEn: "it's a safe bet for you",
      },
    ],
  },
  {
    id: 'carb',
    text: 'Potatis, ris eller pasta?',
    textEn: 'Potatoes, rice or pasta?',
    answers: [
      {
        label: 'Potatis',
        labelEn: 'Potatoes',
        words: /potatis|mos\b|puré|pommes|klyft/i,
        why: 'du ville ha potatis',
        whyEn: 'you wanted potatoes',
      },
      {
        label: 'Ris',
        labelEn: 'Rice',
        words: /\bris\b|jasminris|basmati|risotto|kokosris/i,
        why: 'du ville ha ris',
        whyEn: 'you wanted rice',
      },
      {
        label: 'Pasta & nudlar',
        labelEn: 'Pasta & noodles',
        kinds: ['pasta', 'noodles'],
        words: /nudlar|pasta/i,
        why: 'du ville ha pasta eller nudlar',
        whyEn: 'you wanted pasta or noodles',
      },
      { label: 'Spelar ingen roll', labelEn: "Doesn't matter" },
    ],
  },
  {
    id: 'sauce',
    text: 'Hur viktig är såsen?',
    textEn: 'How important is the sauce?',
    answers: [
      {
        label: 'Sås är livet',
        labelEn: 'Sauce is life',
        words: /sås|sky\b|gravy|gryta|curry/i,
        why: 'det blir sås',
        whyEn: "there'll be sauce",
      },
      { label: 'Lagom viktig', labelEn: 'Fairly important' },
      {
        label: 'Torrt, tack',
        labelEn: 'Dry, please',
        words: /sås|sky\b|gryta/i,
        weight: -1.5,
        why: 'det är inte så mycket sås',
        whyEn: "there isn't much sauce",
      },
    ],
  },
  {
    id: 'adventure',
    text: 'Hur äventyrlig känner du dig?',
    textEn: 'How adventurous do you feel?',
    answers: [
      {
        label: 'Säkra kort',
        labelEn: 'Safe bets',
        kinds: ['burger', 'pizza', 'pasta', 'mince', 'fish', 'chicken'],
        why: 'du ville ha ett säkert kort',
        whyEn: 'you wanted a safe bet',
      },
      {
        label: 'Överraska mig',
        labelEn: 'Surprise me',
        kinds: ['curry', 'noodles', 'sushi', 'dumpling', 'wok', 'taco'],
        chance: 2,
        why: 'du ville bli överraskad',
        whyEn: 'you wanted to be surprised',
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

const whyOf = (a, lang) => (lang === 'en' ? a.whyEn : a.why);

const dishText = (d) => [d.category, d.name, d.description].filter(Boolean).join(' ');

function scoreDish(d, answers, lang) {
  let score = 0;
  const why = [];
  for (const a of answers) {
    let hit = 0;
    if (a.kinds?.includes(d.kind)) hit += 2;
    if (a.words?.test(dishText(d))) hit += 1.5;
    if (a.diet && d.diet) hit += d.diet === a.diet ? 3 : -4;
    const points = hit * (a.weight ?? 1);
    score += points;
    if (points > 0 && a.why) why.push(whyOf(a, lang));
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
 * `visible(dish)` is the diet filter, `isOpen(restaurant)` whether lunch is still on; `lang` ('sv' | 'en') the
 * language of the reasons.
 */
export function rank(
  data,
  answers,
  { history = [], visible = () => true, isOpen = () => true, random = Math.random, lang = 'sv' },
) {
  const chance = Math.max(1, ...answers.map((a) => a.chance ?? 0));
  const results = [];
  for (const r of data.restaurants) {
    const dishes = r.dishes.filter(visible);
    if (r.error || !dishes.length || !isOpen(r)) continue;
    const best = dishes
      .map((d) => ({ dish: d, ...scoreDish(d, answers, lang) }))
      .sort((a, b) => b.score - a.score || random() - 0.5)[0];
    let score = best.score;
    const why = [...best.why];

    const distance = answers.find((a) => a.distance)?.distance;
    if (distance === 'near') score += (300 - r.distance) / 60;
    if (distance === 'far') score += r.distance / 150;
    if ((distance === 'near' && r.distance <= 200) || (distance === 'far' && r.distance >= 250)) {
      why.push(
        whyOf(
          answers.find((a) => a.distance),
          lang,
        ),
      );
    }

    const days = daysSince(r.id, history, data.date);
    const novelty = answers.find((a) => a.novelty)?.novelty;
    if (novelty === 'usual') {
      const visits = history.filter((h) => h.id === r.id).length;
      score += Math.min(visits, 5) * 0.8;
      if (visits)
        why.push(
          whyOf(
            answers.find((a) => a.novelty),
            lang,
          ),
        );
    } else {
      // Recently eaten there counts against it either way; "Något nytt" doubles that and rewards long gaps.
      const weight = novelty === 'new' ? 2 : 1;
      if (days === null) score += 1 * weight;
      else if (days <= 2) score -= 3 * weight;
      else if (days <= 6) score -= 1 * weight;
      else score += 0.5 * weight;
      if (novelty === 'new' && (days === null || days > 6)) {
        const never = lang === 'en' ? "you haven't logged a visit there yet" : 'du har inte loggat något besök där än';
        const long = lang === 'en' ? "it's been a while since you were there" : 'det var länge sen du var där';
        why.push(days === null ? never : long);
      }
    }

    results.push({ restaurant: r, dish: best.dish, score: score + random() * chance, why: [...new Set(why)] });
  }
  return results.sort((a, b) => b.score - a.score);
}

// "Du ville ha något fräscht och det är nära." from the reasons that helped; a shrug when none did.
export function reasonText(why, lang = 'sv') {
  if (!why.length) {
    return lang === 'en'
      ? 'No clear favourite today – so chance decided.'
      : 'Ingen stark favorit idag – så slumpen fick bestämma.';
  }
  const parts = why.slice(0, 3);
  const and = lang === 'en' ? 'and' : 'och';
  const text = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)}` : parts[0];
  return `${text.charAt(0).toLocaleUpperCase(lang)}${text.slice(1)}.`;
}
