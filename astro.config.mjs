// Static pages only: Astro writes HTML to dist/ (public/ copied as is), then scripts/build.ts adds the data files.
// No adapter, so the Worker (src/server/worker.ts) and wrangler.jsonc's assets setup stay as they are.
import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './src/site',
  outDir: './dist',
  // stats.html, not stats/index.html: Cloudflare serves it at /stats. The old Swedish URLs redirect (public/_redirects).
  // The stylesheet (src/site/styles/site.css, ~7 kB gzipped) goes inline, so nothing blocks the first paint.
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: false,
  devToolbar: { enabled: false },
});
