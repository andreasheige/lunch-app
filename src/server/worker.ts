// Cloudflare Worker: live /lunch.json (edge-cached 30 min), POST /report → GitHub issue; everything else is served from dist/ assets.
import { getTodaysLunch } from './lunch.ts';
import { handleReport, type ReportEnv } from './report.ts';

interface Env extends ReportEnv {
  ASSETS: Fetcher;
  CF_VERSION_METADATA: WorkerVersionMetadata;
}

const MAX_AGE = 30 * 60;

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

    const data = await getTodaysLunch();
    const res = new Response(JSON.stringify(data), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${MAX_AGE}` },
    });
    ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  },
} satisfies ExportedHandler<Env>;
