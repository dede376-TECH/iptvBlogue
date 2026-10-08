import rss from '@astrojs/rss';
import type { APIRoute } from 'astro';
import { getPublishedArticles } from '@/lib/content';
import { articleUrl } from '@/lib/links';
import { SITE } from '@/lib/site';

export const GET: APIRoute = async (context) => {
  const articles = await getPublishedArticles();
  return rss({
    title: SITE.name,
    description: SITE.tagline,
    site: context.site ?? SITE.url,
    trailingSlash: true,
    items: articles.slice(0, 50).map((a) => ({
      title: a.data.title,
      description: a.data.description,
      link: articleUrl(a.id),
      pubDate: a.data.publishedAt,
      categories: [a.data.cluster, a.data.intent],
      author: a.data.author.id,
    })),
    customData: `<language>${SITE.defaultLang.toLowerCase()}</language>`,
  });
};
