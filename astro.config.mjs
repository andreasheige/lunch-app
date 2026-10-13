// Static pages only: Astro writes HTML to dist/ (public/ copied as is), then scripts/build.ts adds the data files.
// No adapter, so the Worker (src/server/worker.ts) and wrangler.jsonc's assets setup stay as they are.
import { copyFile, mkdir } from 'node:fs/promises';
import { defineConfig } from 'astro/config';

// SortableJS (the "Sortera" drag and drop) ships as the package's own minified file, loaded only in sort mode.
const vendor = {
  name: 'vendor-sortable',
  hooks: {
    'astro:build:done': async ({ dir }) => {
      await mkdir(new URL('vendor/', dir), { recursive: true });
      await copyFile(
        new URL('./node_modules/sortablejs/Sortable.min.js', import.meta.url),
        new URL('vendor/sortable.min.js', dir),
      );
    },
  },
};

export default defineConfig({
  srcDir: './src/site',
  outDir: './dist',
  // stats.html, not stats/index.html: Cloudflare serves it at /stats. The old Swedish URLs redirect (public/_redirects).
  // The stylesheet (src/site/styles/site.css, ~7 kB gzipped) goes inline, so nothing blocks the first paint.
  build: { format: 'file', inlineStylesheets: 'always' },
  compressHTML: false,
  devToolbar: { enabled: false },
  integrations: [vendor],
});
