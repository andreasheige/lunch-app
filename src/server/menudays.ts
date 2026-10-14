// Daily menu history (D1 menu_days, migrations/0005): which of today's dishes to store. Pure helper; worker.ts
// writes the rows.
import type { LunchResponse } from '../shared/types.ts';

export interface MenuDayRow {
  date: string;
  restaurant: string;
  dish: string;
  description: string | null;
  diet: string | null;
  mentions: string;
}

// Today's dishes as rows; nothing on weekends, and nothing from a place whose menu is another week's, missing or
// only an embed, so the history only holds menus that were really served that day.
export function menuDayRows(lunch: LunchResponse): MenuDayRow[] {
  if (!lunch.day) return [];
  return lunch.restaurants
    .filter((r) => !r.stale && !r.error && !r.embed)
    .flatMap((r) =>
      r.dishes.map((d) => ({
        date: lunch.date,
        restaurant: r.id,
        dish: d.name,
        description: d.description ?? null,
        diet: d.diet ?? null,
        mentions: (d.mentions ?? []).join(','),
      })),
    );
}
