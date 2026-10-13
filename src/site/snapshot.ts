// Today's lunch as scripts/build.ts fetched it, so the pages carry the menus in their HTML (for crawlers, agents
// and readers without JavaScript); app.js then redraws from the live /lunch.json. Without a snapshot (plain
// `astro build`, as `npm start` does) the pages render without menus.
import { readFileSync } from 'node:fs';
import type { LunchResponse } from '../shared/types.ts';

export const SITE = 'https://lunchit.se';

export function lunchSnapshot(): LunchResponse | null {
  const file = process.env.LUNCH_SNAPSHOT;
  return file ? (JSON.parse(readFileSync(file, 'utf8')) as LunchResponse) : null;
}

// JSON for a <script type="application/ld+json">: menu texts come from restaurant sites, so "<" is escaped and
// can't close the script element.
export const jsonForScript = (value: unknown): string => JSON.stringify(value).replace(/</g, '\\u003c');
