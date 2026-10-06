// Veg / fish / meat per dish: from the restaurant's own category label where it says, else guessed by
// Workers AI (worker.ts sends the unlabelled dishes with DIET_PROMPT).
import type { Diet, Dish, LunchResponse } from '../shared/types.ts';

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

export function addDiets(data: LunchResponse, classified: Classified): LunchResponse {
  return {
    ...data,
    restaurants: data.restaurants.map((r) => ({
      ...r,
      dishes: r.dishes.map((d): Dish => {
        const fromMenu = dietFromCategory(d.category);
        if (fromMenu) return { ...d, diet: fromMenu };
        const guess = classified[dishKey(d)];
        return guess ? { ...d, diet: guess, dietByAi: true } : d;
      }),
    })),
  };
}
