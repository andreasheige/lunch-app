// Veg / fish / meat per dish: from the restaurant's own category label where it says, else guessed by
// Workers AI (worker.ts sends the unlabelled dishes with DIET_PROMPT). Plus the allergens a dish's text mentions.
import type { Allergen, Diet, Dish, DishKind, LunchResponse } from '../shared/types.ts';

/** AI-guessed diets for dishes without a telling label, by dishKey. */
export type Classified = Record<string, Diet>;

const DIETS: readonly string[] = ['veg', 'fish', 'meat'] satisfies Diet[];
const isDiet = (v: unknown): v is Diet => typeof v === 'string' && DIETS.includes(v);

// "Vegetariska", "Veg", "Street Food Vegetarisk", "Fisk", "Fish Market", "Kött", "Fågel", "Butcher´s".
// Pagoden's "Green Kitchen" isn't one: it has chicken bowls.
export function dietFromCategory(category: string | null): Diet | null {
  if (!category) return null;
  if (/veg/i.test(category)) return 'veg';
  if (/fisk|fish/i.test(category)) return 'fish';
  if (/kött|fågel|butcher/i.test(category)) return 'meat';
  return null;
}

export const dishKey = (d: Dish): string => `${d.name}\n${d.description ?? ''}`;

export const DIET_PROMPT = `You classify Swedish lunch dishes. The user sends a JSON object mapping ids to dishes.
For each, answer "veg" (vegetarian or vegan: no meat, poultry, fish or seafood), "fish" (fish or seafood, no meat
or poultry), "meat" (meat or poultry, with or without fish), or "unknown" (you can't tell, or the guest picks the
protein). Reply with a JSON object mapping every id to its answer, e.g. {"1": "veg", "2": "meat"}.`;

// Dishes whose label says nothing about diet, deduplicated: dishKey -> the text the model sees.
export function unlabelledDishes(data: LunchResponse): Map<string, string> {
  return new Map(
    data.restaurants
      .flatMap((r) => r.dishes)
      .filter((d) => !dietFromCategory(d.category))
      .map((d) => [dishKey(d), [d.name, d.description].filter(Boolean).join(' – ')]),
  );
}

// The model's {"1": "veg", …} answer (JSON text, or already parsed by JSON mode) for dishes 1..count; a missing
// id or any other value ("unknown" included) gives null, so a model that skips a dish only costs that dish its
// icon. Only Diet values ever leave here, so menu text steering the model can't put anything else on the page.
export function parseModelDiets(answer: unknown, count: number): (Diet | null)[] {
  try {
    const data: unknown = typeof answer === 'string' ? JSON.parse(answer) : answer;
    const byId = typeof data === 'object' && data !== null ? new Map(Object.entries(data)) : new Map();
    return Array.from({ length: count }, (_, i) => {
      const d: unknown = byId.get(String(i + 1));
      return isDiet(d) ? d : null;
    });
  } catch {
    return Array.from({ length: count }, () => null);
  }
}

// Words in Swedish menu text that mean the allergen is in the dish. Only ever used to say a dish *mentions*
// one: menus leave plenty out, so a dish without a match isn't free from it. Lookbehinds skip the look-alikes:
// nötkött/nötstek (beef), kokosmjölk/-grädde, ostronsås (oyster sauce, not cheese), risnudlar.
const MENTIONS: [Allergen, RegExp][] = [
  ['nuts', /(jord|cashew|hassel|val|pekan|pinje|para|macadamia)nöt|\bnötter\b|mandel|pistage/i],
  [
    'gluten',
    /vete|mjöl(?!k)|bröd|(?<!ris)nudlar|pasta|spaghetti|tagliatelle|lasagne|panko|paner|krutong|bulgur|couscous|brioche|pizza|tempura|seitan|dinkel|\bråg|burgare|tortilla|pita|naan/i,
  ],
  [
    'lactose',
    /(?<!kokos|soja|havre)grädd|(?<!kokos|havre|soja)mjölk|(?<!nöts?)smör|ost\b|ostar|parmesan|mozzarella|halloumi|grana padano|crème|creme|yoghurt|raita|gräddfil|bechamel/i,
  ],
  ['shellfish', /räk|kräft|hummer|krabb|mussl|skaldjur|scampi|ostron|bläckfisk/i],
  ['egg', /ägg|majo|aioli|hollandaise|bearnaise|béarnaise/i],
];

export function mentions(d: Dish): Allergen[] {
  const text = [d.category, d.name, d.description].filter(Boolean).join(' ');
  return MENTIONS.filter(([, re]) => re.test(text)).map(([a]) => a);
}

// Dish kinds by keyword, in priority order: what the dish *is* (burger, soup, curry …) beats what's in it
// (chicken, fish …), so "Chicken Karahi" is a curry and "Pulled pork-burgare" a burger. Protein kinds carry the
// diet they imply, so a kind that contradicts the dish's diet ("Vegetarisk köttbullar") is dropped.
const KINDS: [DishKind, RegExp, Diet?][] = [
  ['burger', /burgare|burger/i],
  ['pizza', /pizza/i],
  ['taco', /taco/i],
  ['wrap', /wrap|burrito|quesadilla|tortilla|kebabrulle/i],
  ['soup', /soppa|soup|gryta|bouillabaisse|chili con carne/i],
  ['curry', /curry|karahi|tikka|masala|korma|thali|biryani|vindaloo|\bdaa?l\b|paneer/i],
  ['noodles', /nudlar|noodle|ramen|udon|ph?ad thai|\bpho\b/i],
  ['pasta', /pasta|spaghetti|tagliatelle|penne|lasagne|lasagna|carbonara|gnocchi|ravioli|tortellini/i],
  ['sushi', /sushi|poké|poke bowl/i],
  ['sandwich', /smörgås|macka|sandwich|toast|baguette|smørrebrød/i],
  ['dumpling', /dumpling|gyoza|dim sum|pirog|empanada/i],
  ['pie', /\bpaj|quiche/i],
  ['pancake', /pannkak|raggmunk|crêpe|crepe|plättar/i],
  ['falafel', /falafel/i],
  ['salad', /sallad|salad|caesar|cesar/i],
  ['wok', /\bwok/i],
  [
    'fish',
    /fisk|fish|\blax|torsk|kolja|\bsej\b|kummel|havskatt|röding|sill|strömming|gös|abborre|tonfisk|flundra|rödspätta|makrill|fångst|havets/i,
    'fish',
  ],
  ['shellfish', /räk|scampi|skaldjur|mussl|kräft|hummer/i, 'fish'],
  ['chicken', /kyckling|chicken|wings|vingar|buffalo|coq au vin|\bank(a|bröst)/i, 'meat'],
  ['sausage', /korv|sausage|banger|hot ?dog|chorizo/i, 'meat'],
  ['mince', /köttbull|färs|järpar|pannbiff|hackebiff|wallenbergare/i, 'meat'],
  ['steak', /biff|entrecote|oxfilé|nötstek|högrev|flankstek|steak|schnitzel|lamm|kalv|hjort|älg|secreto/i, 'meat'],
  ['pork', /fläsk|bacon|karré|kassler|revben|ribs|pulled pork/i, 'meat'],
  ['mushroom', /champinjon|svamp|kantarell/i],
];

// The part of the name that says what the dish is: a quoted title, else up to "med …", ", …" or " – …".
function dishHead(name: string): string {
  const quoted = name.match(/^["“”]([^"“”]+)["“”]/);
  if (quoted) return quoted[1] ?? name;
  return name.split(/,|\s[–-]\s|\s(?:med|i|serveras|toppad|toppas|på)\s/)[0] ?? name;
}

export function dishKind(d: Dish, diet: Diet | undefined): DishKind | null {
  const text = `${d.category ?? ''} ${dishHead(d.name)}`;
  for (const [kind, re, implies] of KINDS) {
    if (!re.test(text)) continue;
    if (implies && diet && implies !== diet) continue;
    return kind;
  }
  return null;
}

export function addDiets(data: LunchResponse, classified: Classified): LunchResponse {
  return {
    ...data,
    restaurants: data.restaurants.map((r) => ({
      ...r,
      dishes: r.dishes.map((d): Dish => {
        const found = mentions(d);
        const fromMenu = dietFromCategory(d.category);
        const guess = fromMenu ? undefined : classified[dishKey(d)];
        const diet = fromMenu ?? guess;
        const kind = dishKind(d, diet);
        return {
          ...d,
          ...(diet && { diet }),
          ...(guess && { dietByAi: true }),
          ...(kind && { kind }),
          ...(found.length && { mentions: found }),
        };
      }),
    })),
  };
}
