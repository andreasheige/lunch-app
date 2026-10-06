// Shapes shared by the server (lunch.json, POST /report) and the browser client.

export type Weekday = 'Måndag' | 'Tisdag' | 'Onsdag' | 'Torsdag' | 'Fredag';

export type Diet = 'veg' | 'fish' | 'meat';
export type Allergen = 'nuts' | 'gluten' | 'lactose' | 'shellfish' | 'egg';
export type DishKind =
  | 'burger'
  | 'pizza'
  | 'taco'
  | 'wrap'
  | 'soup'
  | 'curry'
  | 'noodles'
  | 'pasta'
  | 'sushi'
  | 'sandwich'
  | 'dumpling'
  | 'pie'
  | 'pancake'
  | 'falafel'
  | 'salad'
  | 'wok'
  | 'fish'
  | 'shellfish'
  | 'chicken'
  | 'sausage'
  | 'steak'
  | 'pork'
  | 'mince'
  | 'mushroom';

export interface Dish {
  category: string | null;
  name: string;
  description?: string | undefined;
  diet?: Diet | undefined;
  /** `diet` was guessed by Workers AI, not given by the restaurant. */
  dietByAi?: boolean | undefined;
  /** What sort of dish it is, from its name, for the icon. Never contradicts `diet`. */
  kind?: DishKind | undefined;
  /** Allergens the menu text mentions. Never a free-from claim: no mention doesn't mean it's absent. */
  mentions?: Allergen[] | undefined;
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

// A feat/fix commit as build.ts reads it from git log (dist/commits.json).
export interface ReleaseCommit {
  sha: string;
  /** ISO 8601 commit date. */
  date: string;
  type: 'feat' | 'fix';
  subject: string;
  body: string;
  /** GitHub issue from "(#22)" / "closes #18" in the subject. */
  issue: number | null;
}

// GET /releases.json: one post per commit, newest first.
export interface ReleaseNote {
  sha: string;
  date: string;
  type: 'feat' | 'fix';
  title: string;
  body: string;
  issue: number | null;
  /** Not rewritten into Swedish yet; title is the commit subject. */
  pending: boolean;
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
