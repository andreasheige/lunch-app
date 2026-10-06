// Cloudflare Worker: live /lunch.json (edge-cached 30 min), POST /report → GitHub issue; everything else is served from dist/ assets.
import type { LunchResponse } from '../shared/types.ts';
import { addDiets, type Classified, DIET_PROMPT, parseModelDiets, unlabelledDishes } from './diet.ts';
import { getTodaysLunch, parseCaptured } from './lunch.ts';
import { handleReport, type ReportEnv } from './report.ts';

interface Env extends ReportEnv {
  AI: Ai;
  ASSETS: Fetcher;
  CF_VERSION_METADATA: WorkerVersionMetadata;
}

const MAX_AGE = 30 * 60;
const DIET_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const DIET_MAX_AGE = 24 * 60 * 60;

// Workers AI guesses for dishes without a telling label; any failure just leaves them without an icon.
// The model's answer is edge-cached a day per exact dish list, so only the first menu fetch of the day
// waits for it; cached answers go through parseModelDiets again like fresh ones.
async function classify(ai: Ai, lunch: LunchResponse, origin: string): Promise<Classified> {
  const dishes = unlabelledDishes(lunch);
  if (!dishes.size) return {};
  try {
    const input = JSON.stringify(Object.fromEntries([...dishes.values()].map((t, i) => [i + 1, t])));
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${DIET_MODEL}\n${input}`));
    const id = [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const key = new Request(`${origin}/diets/${id}`);
    let answer: unknown = await (await caches.default.match(key))?.json();
    if (answer === undefined) {
      const out = await ai.run(DIET_MODEL, {
        messages: [
          { role: 'system', content: DIET_PROMPT },
          { role: 'user', content: input },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 1024,
      });
      answer = typeof out === 'object' && out !== null && 'response' in out ? out.response : null;
      const res = new Response(JSON.stringify(answer), {
        headers: { 'cache-control': `public, max-age=${DIET_MAX_AGE}` },
      });
      await caches.default.put(key, res);
    }
    const diets = parseModelDiets(answer, dishes.size);
    const keys = [...dishes.keys()];
    return Object.fromEntries(keys.flatMap((k, i) => (diets[i] ? [[k, diets[i]]] : [])));
  } catch {
    return {};
  }
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === '/report') return handleReport(request, env);
    if (pathname !== '/lunch.json') return env.ASSETS.fetch(request);

    // Keyed by deployed version, so a deploy starts with an empty cache instead of serving the old menu list.
    const key = new Request(`${new URL(request.url).origin}/lunch.json?v=${env.CF_VERSION_METADATA.id}`);
    const cache = caches.default;
    const cached = await cache.match(key);
    if (cached) return cached;

    // Menus the build read with a real browser (captured.json, see scripts/capture.ts); 404 when none were.
    const capturedRes = await env.ASSETS.fetch(new Request(`${new URL(request.url).origin}/captured.json`));
    const lunch = await getTodaysLunch(parseCaptured(capturedRes.ok ? await capturedRes.text() : null));
    const data = addDiets(lunch, await classify(env.AI, lunch, new URL(request.url).origin));
    const res = new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${MAX_AGE}` },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
} satisfies ExportedHandler<Env>;
