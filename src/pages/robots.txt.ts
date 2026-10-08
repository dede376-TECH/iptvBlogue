import type { APIRoute } from 'astro';
import { SITE } from '@/lib/site';

export const GET: APIRoute = ({ site }) => {
  const base = (site?.href ?? `${SITE.url}/`).replace(/\/$/, '');
  const lines = ['User-agent: *', 'Allow: /', 'Disallow: /search/', 'Disallow: /og/', ''];
  if (SITE.temporaryHost) {
    lines.push(
      '# Temporary host. Every page is noindex; do not submit this site to Search Console.',
      '',
    );
  } else {
    lines.push(`Sitemap: ${base}/sitemap-index.xml`, '');
  }
  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
