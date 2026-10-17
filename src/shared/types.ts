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
  /** Earlier days this place served a dish of this name (D1 menu_days), and the latest of them. */
  served?: { times: number; last: string } | undefined;
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

// A feat/fix commit as build.ts reads it from git log.
export interface ReleaseCommit {
  sha: string;
  /** ISO 8601 commit date. */
  date: string;
  /** ISO 8601 author date; with the headline it finds the commit among a PR's commits after a rebase merge. */
  authored: string;
  /** The whole first line, "feat: …". */
  headline: string;
  type: 'feat' | 'fix';
  subject: string;
  body: string;
  /** GitHub issue from "(#22)" / "closes #18" in the subject. */
  issue: number | null;
}

// A merged pull request as build.ts reads it from GitHub.
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  mergeCommit: string | null;
  commits: { headline: string; authored: string }[];
}

// One release: the feat/fix commits of one PR, or a single commit pushed without one (dist/releases-source.json).
export interface ReleaseSource {
  /** "pr-47" or the commit sha; the D1 key of its texts. */
  key: string;
  /** Its page: /news/<slug>, "2026-10-14-a-new-lunchit". Language-neutral, so both languages share it. */
  slug: string;
  /** The newest commit's date. */
  date: string;
  pr: number | null;
  title: string;
  body: string;
  commits: Pick<ReleaseCommit, 'type' | 'subject' | 'body'>[];
}

export type ChangeKind = 'new' | 'improved' | 'fixed';

export interface ReleaseChange {
  kind: ChangeKind;
  title: string;
  text: string;
}

// The texts Workers AI writes for a release, per language (D1 release_posts).
export interface ReleaseText {
  title: string;
  summary: string;
  intro: string[];
  changes: ReleaseChange[];
}

// GET /releases.json: one post per release, newest first.
export interface ReleasePost extends ReleaseText {
  key: string;
  slug: string;
  date: string;
  pr: number | null;
  /** Kinds of change in it, in the order new, improved, fixed. */
  kinds: ChangeKind[];
  /** No AI text yet; title and changes come from the PR and commit subjects. */
  pending: boolean;
}

// POST /rate body (date is set by the server).
export interface RatingInput {
  date: string;
  restaurant: string;
  dish: string;
  stars: number;
  /** Random id from the voter's browser. */
  voter: string;
}

export interface RatingSummary {
  avg: number;
  count: number;
}

// GET /ratings.json: today's ratings by `${restaurant}\n${dish}`.
export type TodaysRatings = Record<string, RatingSummary>;

// GET /stats.json?range=14|all
export interface StatsResponse {
  range: '14' | 'all';
  from: string;
  to: string;
  totals: { votes: number; voters: number; dishes: number; avg: number | null };
  restaurants: { id: string; name: string; avg: number; votes: number }[];
  dishes: { restaurant: string; dish: string; avg: number; votes: number }[];
  days: { date: string; votes: number; avg: number }[];
  /** Widest spread of stars (min 3 votes): the dish people disagree on most. */
  divisive: { restaurant: string; dish: string; avg: number; votes: number; spread: number } | null;
  /** Average and votes per place and day: the league's form. */
  placeDays: { id: string; date: string; avg: number; votes: number }[];
  /** Votes per place and star (1–5): the star spread. */
  stars: { id: string; stars: number; votes: number }[];
  /** Every rated dish with its lowest and highest vote and the last day it was rated. */
  rated: { restaurant: string; dish: string; avg: number; votes: number; min: number; max: number; last: string }[];
  /** The served menus per day (D1 menu_days): dishes and their diets. */
  menuDays: { date: string; dishes: number; veg: number; fish: number; meat: number; none: number }[];
}

// GET /history.json: what the menus held lately (D1 menu_days) and how it was rated.
export interface HistoryResponse {
  /** First day in the history and how many days it holds. */
  since: string | null;
  days: number;
  /** The latest week with menus (Monday to Friday, so far): per day, per place, the dishes served. */
  week: {
    week: number;
    from: string;
    to: string;
    days: { date: string; places: { id: string; name: string; dishes: { dish: string; diet: Diet | null }[] }[] }[];
  } | null;
  /** That week's best-rated dishes. */
  top: { restaurant: string; dish: string; avg: number; votes: number; date: string }[];
  /** Dishes served on two or more days: how often, and the first and latest day. */
  recurring: { restaurant: string; dish: string; times: number; first: string; last: string }[];
}

/** A browser's vote for one day: one dish, 1–5 stars. */
export interface MyVote {
  restaurant: string;
  dish: string;
  stars: number;
}

// GET /myvote.json: this browser's votes (voter cookie) for today and the previous lunch day, by date.
export interface MyVotesResponse {
  votes: Record<string, MyVote>;
}

// GET /yesterday.json: the previous lunch day's served menu (D1 menu_days), to rate it the day after.
export interface YesterdayResponse {
  /** The previous lunch day, or null when the history has none. */
  date: string | null;
  places: { id: string; name: string; dishes: { dish: string; diet: Diet | null }[] }[];
  /** Its averages by `${restaurant}\n${dish}`. */
  ratings: TodaysRatings;
  /** English for the dish names (lang=en); ratings key on the Swedish ones. */
  translations: Record<string, string>;
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
