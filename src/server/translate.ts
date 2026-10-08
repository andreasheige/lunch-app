// English for the menu texts: worker.ts sends today's Swedish strings to Workers AI with TRANSLATE_PROMPT and
// serves the sv → en map at /translations.json. lunch.json stays Swedish (ratings and the picker key on it), so
// the client only swaps the text it shows.
import type { LunchResponse } from '../shared/types.ts';

/** English text by its Swedish original. */
export type Translations = Record<string, string>;

export const TRANSLATE_PROMPT = `You translate Swedish lunch-menu texts into plain, natural English for office workers.
The user sends a JSON object mapping ids to Swedish texts (dish names, descriptions, menu categories, prices).
Translate each one as a menu would say it in English. Mind the culinary terms: "sky" is jus or gravy, "kummel" is
hake, "sej" is pollock, "högrev" is chuck, "nattbakad" is slow-roasted overnight, "pyttipanna" is Swedish hash.
Dish names that are already English or a foreign proper name (Butter Chicken, Rogan Josh) stay as they are.
Keep restaurant and brand names, prices and numbers as they are; add no explanations or notes.
Reply with a JSON object mapping every id to its English text, e.g. {"1": "Fried herring with mashed potatoes"}.`;

// Every text the menu cards show that could be Swedish, deduplicated.
export function menuStrings(data: LunchResponse): string[] {
  const texts = data.restaurants.flatMap((r) => [
    r.price,
    r.error,
    ...r.dishes.flatMap((d) => [d.category, d.name, d.description]),
  ]);
  return [...new Set(texts.filter((t): t is string => typeof t === 'string' && t.trim() !== ''))];
}

// The model's {"1": "…", …} answer (JSON text, or already parsed) for texts[0..]; a missing id or a non-string
// leaves that text out, so the page shows the Swedish. Lengths are capped and the page renders them as text, so
// a steered model can't put markup or an essay on the page.
export function parseTranslations(answer: unknown, texts: string[]): Translations {
  try {
    const data: unknown = typeof answer === 'string' ? JSON.parse(answer) : answer;
    if (typeof data !== 'object' || data === null) return {};
    const byId = new Map(Object.entries(data));
    return Object.fromEntries(
      texts.flatMap((sv, i) => {
        const en: unknown = byId.get(String(i + 1));
        if (typeof en !== 'string' || !en.trim()) return [];
        return [[sv, en.trim().slice(0, Math.min(600, sv.length * 2 + 40))]];
      }),
    );
  } catch {
    return {};
  }
}
