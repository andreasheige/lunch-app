// Reads menus that block plain fetches into captured.json for build.ts: Poppels' Canva design sits behind
// a Cloudflare bot check that a headless browser fails, so this drives a headed Chromium (CI runs it under
// xvfb-run). Never fails the deploy: a missed capture just leaves Poppels on its Canva embed.
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { RESTAURANTS } from '../src/server/restaurants.ts';

const out = path.join(import.meta.dirname, '..', 'captured.json');

async function capturePoppels(): Promise<string[]> {
  const poppels = RESTAURANTS.find((r) => r.id === 'poppels');
  if (!poppels) throw new Error('no poppels in RESTAURANTS');
  const res = await fetch(poppels.url, { headers: { 'user-agent': 'knowit-lunch-app (lunch menu reader)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const embed = poppels.parse([], 'Måndag', await res.text()).embed;
  if (!embed) throw new Error('no Canva embed on the page');

  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage({ locale: 'sv-SE' });
    await page.goto(embed, { waitUntil: 'load', timeout: 60_000 });
    // Cloudflare's "Vänta…" page comes first; poll until Canva has rendered the menu text.
    for (let tries = 0; tries < 30; tries++) {
      const lines = (await page.innerText('body'))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.includes('MÅNDAG')) return lines;
      await page.waitForTimeout(1000);
    }
    throw new Error(`no menu text after 30 s (page title "${await page.title()}")`);
  } finally {
    await browser.close();
  }
}

try {
  const lines = await capturePoppels();
  await fs.writeFile(out, JSON.stringify({ poppels: lines }));
  process.stdout.write(`Poppels: captured ${lines.length} lines\n`);
} catch (err) {
  process.stdout.write(
    `Poppels: capture failed (${err instanceof Error ? err.message.split('\n')[0] : String(err)})\n`,
  );
}
