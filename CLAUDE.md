# lunch-app

Shows today's lunch menus for restaurants near the Knowit office (Göteborg). Strict TypeScript (TS 7), run directly by Node ≥22.18 (type stripping) and wrangler; no runtime dependencies.

- `src/shared/types.ts` — shapes shared by server and client (`LunchResponse`, `Dish`, `ReportRequest`, …)
- `src/server/restaurants.ts` — restaurant list + one parser per site (page text lines → today's dishes)
- `src/server/pdf.ts` — dependency-free PDF text extraction (Canva exports; drops rotated background text) for PDF menus (`pdf` field on a restaurant)
- `src/server/diet.ts` — veg/fish/meat per dish: from the restaurant's category label, else guessed by Workers AI (Llama 3.3 70B via the Worker's `AI` binding; answer edge-cached a day per dish list, free tier), plus a dish-kind icon (🍔 🍲 🍛 …, by keyword on the dish name) and allergens the menu text mentions (keyword lists; never free-from claims)
- `src/server/lunch.ts` — fetches pages, picks today's weekday (Europe/Stockholm), caches 30 min
- `src/server/worker.ts` — Cloudflare Worker (`wrangler.jsonc`): live `/lunch.json` edge-cached 30 min (keyed by deployed version, so deploys need no purge), rest from `dist/`
- `src/server/report.ts` — `POST /report`: in-page form → GitHub issue (honeypot, Turnstile, per-IP rate limit); Worker secrets `TURNSTILE_SECRET`, `GITHUB_TOKEN`
- `public/picker.js` — "Välj åt mig": 3 random questions from a pool score dishes/restaurants (plus distance, open now, the diet filter and the per-browser visit history in localStorage); pure functions, tested in `test/picker.test.js`
- `src/server/releases.ts` + `public/nyheter.html` — release notes at `/nyheter`: build writes feat/fix commits from git log to `dist/commits.json`; the Worker's `/releases.json` rewrites new ones into Swedish with Workers AI (8 per request) and stores them in D1 `release_notes`, so each commit is rewritten once
- `migrations/` — D1 (`lunch-app`, binding `DB`) schema; apply with `npx wrangler d1 migrations apply lunch-app --remote` (and `--local` for `wrangler dev`)
- `server.ts` — local dev: serves `public/` and a live `GET /lunch.json`
- `scripts/capture.ts` — reads Poppels' Canva menu text with a headed Playwright Chromium (headless is blocked by Cloudflare) into `captured.json`; CI runs it under `xvfb-run` before the build
- `scripts/build.ts` — static build to `dist/` (public/ + fetched `lunch.json` snapshot + `captured.json`, which the Worker reads via `ASSETS`)
- `.github/workflows/deploy.yml` — tests, captures, builds and `wrangler deploy`s to Cloudflare on push to main and weekdays 08:00 UTC
- `test/fixtures/*.txt` — each parsed site's page flattened with `htmlToLines`, captured 2026-09-28 (v. 40); `delissimo.pdf` is the raw menu PDF; `poppels.txt` is `scripts/capture.ts` output from 2026-10-06 (v. 41); `carotte.txt` and `bbbangers.txt` are from 2026-10-06 (v. 41)

## Common commands
- `npm start` — run on http://localhost:3000 (`PORT=…` to change)
- `node scripts/capture.ts` — capture Poppels locally (opens a Chrome window; `npx playwright install chromium` once)
- `npm run build` — build `dist/` (prints one line per restaurant)
- `node --test --test-reporter=dot` — quiet test run
- `npm run -s lint` — Biome lint + format check (`npm run format` applies fixes)
- `npm run -s typecheck` — tsc (TS 7) over the node, worker, test and client tsconfigs

Port 3000 is often taken on this machine; use e.g. `PORT=3124 npm start`.

When a site changes layout, re-capture its fixture with `htmlToLines` and fix that site's parser.
