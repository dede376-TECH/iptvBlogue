/**
 * llms.txt – a plain-text map of the site for LLM crawlers (https://llmstxt.org).
 */
import type { APIRoute } from 'astro';
import { getClusters, getPublishedArticles } from '@/lib/content';
import { articleUrl, clusterUrl } from '@/lib/links';
import { absoluteUrl } from '@/lib/seo';
import { SITE } from '@/lib/site';

export const GET: APIRoute = async () => {
  const clusters = await getClusters();
  const articles = await getPublishedArticles();

  const lines: string[] = [
    `# ${SITE.name}`,
    '',
    `> ${SITE.tagline}`,
    '',
    'This site is informational and educational only. It does not sell IPTV subscriptions and never links to playlists, resellers or unlicensed services. Content is written for UK (en-GB) and US (en-US) readers.',
    '',
    '## Policies',
    '',
    `- [Editorial policy](${absoluteUrl('/editorial-policy/')}): how articles are researched and corrected`,
    `- [Disclaimer](${absoluteUrl('/disclaimer/')}): informational content, not legal advice`,
    `- [About](${absoluteUrl('/about/')})`,
    '',
  ];

  for (const c of clusters) {
    lines.push(
      `## ${c.data.h1}`,
      '',
      `${c.data.description}`,
      '',
      `- [Hub](${absoluteUrl(clusterUrl(c.id))})`,
    );
    for (const a of articles.filter((x) => x.data.cluster === c.id)) {
      lines.push(`- [${a.data.title}](${absoluteUrl(articleUrl(a.id))}): ${a.data.description}`);
    }
    lines.push('');
  }

  lines.push(
    '## Optional',
    '',
    `- [RSS feed](${absoluteUrl('/rss.xml')})`,
    `- [Sitemap](${absoluteUrl('/sitemap-index.xml')})`,
    '',
  );

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
