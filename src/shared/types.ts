// Shapes shared by the server (lunch.json, POST /report) and the browser client.

export type Weekday = 'Måndag' | 'Tisdag' | 'Onsdag' | 'Torsdag' | 'Fredag';

export interface Dish {
  category: string | null;
  name: string;
  description?: string | undefined;
}

// Static facts about a restaurant, as listed in restaurants.ts.
export interface RestaurantInfo {
  id: string;
  name: string;
  url: string;
  address: string;
  /** Walking distance from the office, in metres. */
  distance: number;
  hours: string;
  price: string | null;
}

// One restaurant's entry in lunch.json.
export interface RestaurantMenu extends RestaurantInfo {
  dishes: Dish[];
  /** Canva embed URL, for menus the server can't read (Poppels). */
  embed: string | null;
  /** The menu found is for another week than today's. */
  stale: boolean;
  menuWeek: number | null;
  error: string | null;
}

// GET /lunch.json
export interface LunchResponse {
  /** Stockholm calendar date, YYYY-MM-DD. */
  date: string;
  /** null on weekends, when restaurants is empty. */
  day: Weekday | null;
  week: number;
  /** ISO 8601 with Stockholm UTC offset. */
  fetchedAt: string;
  restaurants: RestaurantMenu[];
}

export type ReportKind = 'bug' | 'feat-req';

// POST /report body. `website` is the honeypot field.
export interface ReportRequest {
  kind: ReportKind;
  title: string;
  text: string;
  token: string;
  website?: string;
}

export type ReportResponse = { ok: true; url?: string } | { error: string };
