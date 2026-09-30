// Cloudflare Worker: live /lunch.json (edge-cached 30 min), POST /report → GitHub issue; everything else is served from dist/ assets.
import { getTodaysLunch } from './lunch.js';
import { handleReport } from './report.js';

const MAX_AGE = 30 * 60;

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === '/report') return handleReport(request, env);
    if (pathname !== '/lunch.json') return env.ASSETS.fetch(request);

    const cache = caches.default;
    const cached = await cache.match(request);
    if (cached) return cached;

    const data = await getTodaysLunch();
    const res = new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${MAX_AGE}` },
    });
    ctx.waitUntil(cache.put(request, res.clone()));
    return res;
  },
};
