// Static pages only: Astro writes HTML to dist/ (public/ copied as is), then scripts/build.ts adds the data files.
// No adapter, so the Worker (src/server/worker.ts) and wrangler.jsonc's assets setup stay as they are.
import { defineConfig } from 'astro/config';

export default defineConfig({
  srcDir: './src/site',
  outDir: './dist',
  // statistik.html, not statistik/index.html: Cloudflare serves it at /statistik, like before.
  build: { format: 'file' },
  // Small pages; inline nothing, so pages keep loading /style.css like the client scripts expect.
  compressHTML: false,
  devToolbar: { enabled: false },
});
