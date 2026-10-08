/**
 * Dynamic OG images: /og/home.png, /og/<cluster>.png, /og/<cluster>/<slug>.png,
 * /og/authors/<slug>.png and /og/<page>.png. Generated at build time.
 */
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { getClusters, getPublishedArticles } from '@/lib/content';
import { renderOgPng, type OgInput } from '@/lib/og';
import { SITE } from '@/lib/site';

export async function getStaticPaths() {
  const clusters = await getClusters();
  const articles = await getPublishedArticles();
  const authors = await getCollection('authors');
  const pages = await getCollection('pages');
  const clusterLabel = new Map(clusters.map((c) => [c.id, c.data.navLabel]));

  const paths: { params: { path: string }; props: OgInput }[] = [
    { params: { path: 'home' }, props: { title: SITE.tagline, kicker: SITE.name } },
    { params: { path: 'search' }, props: { title: 'Search the guides', kicker: SITE.name } },
    { params: { path: '404' }, props: { title: 'Page not found', kicker: SITE.name } },
    ...clusters.map((c) => ({
      params: { path: c.id },
      props: { title: c.data.h1, kicker: `${SITE.name} · Topic` },
    })),
    ...articles.map((a) => ({
      params: { path: a.id },
      props: {
        title: a.data.title,
        kicker: `${SITE.name} · ${clusterLabel.get(a.data.cluster) ?? ''}`,
      },
    })),
    ...authors.map((a) => ({
      params: { path: `authors/${a.id}` },
      props: { title: a.data.name, kicker: `${SITE.name} · Author` },
    })),
    ...pages
      .filter((p) => p.id !== 'home')
      .map((p) => ({ params: { path: p.id }, props: { title: p.data.h1, kicker: SITE.name } })),
  ];
  return paths;
}

export const GET: APIRoute = async ({ props }) => {
  const png = await renderOgPng(props as OgInput);
  return new Response(new Uint8Array(png), {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
