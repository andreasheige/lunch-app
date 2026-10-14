// /sitemap.xml: the three pages and every news post (the posts come from the build's news snapshot).
import { newsPosts } from '../news.ts';
import { SITE } from '../snapshot.ts';

const url = (path: string, changefreq: string, priority: string, lastmod?: string) =>
  `  <url><loc>${SITE}${path}</loc>${lastmod ? `<lastmod>${lastmod.slice(0, 10)}</lastmod>` : ''}<changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;

export function GET(): Response {
  const posts = newsPosts();
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    url('/', 'daily', '1.0'),
    url('/stats', 'daily', '0.5'),
    url('/news', 'weekly', '0.3', posts[0]?.date),
    ...posts.map((p) => url(`/news/${p.slug}`, 'yearly', '0.2', p.date)),
    '</urlset>',
    '',
  ].join('\n');
  return new Response(body, { headers: { 'content-type': 'application/xml' } });
}
