# lunch-app

Shows today's lunch menus for restaurants near the Knowit office (Göteborg). Node ≥22, no dependencies.

- `src/restaurants.js` — restaurant list + one parser per site (page text lines → today's dishes)
- `src/lunch.js` — fetches pages, picks today's weekday (Europe/Stockholm), caches 30 min
- `server.js` — local dev: serves `public/` and a live `GET /lunch.json`
- `scripts/build.js` — static build to `dist/` (public/ + fetched `lunch.json`) for GitHub Pages
- `.github/workflows/pages.yml` — tests, builds and deploys to Pages on push and weekday mornings
- `test/fixtures/*.txt` — each parsed site's page flattened with `htmlToLines`, captured 2026-09-28 (v. 40)

## Common commands
- `npm start` — run on http://localhost:3000 (`PORT=…` to change)
- `npm run build` — build `dist/` (prints one line per restaurant)
- `node --test --test-reporter=dot` — quiet test run

Port 3000 is often taken on this machine; use e.g. `PORT=3124 npm start`.

When a site changes layout, re-capture its fixture with `htmlToLines` and fix that site's parser.
