import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap, { ChangeFreqEnum, type SitemapItem } from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { indexClusters, lastmodMap } from './scripts/lib/content-index';

const SITE_URL = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');

/**
 * Build-time index of content for accurate <lastmod> values and one sitemap chunk per
 * topic cluster. Read from the filesystem so the config never depends on `astro:content`.
 */
const lastmod = lastmodMap();
const clusters = indexClusters().map((c) => c.id);

function withLastmod(item: SitemapItem): SitemapItem {
  const path = new URL(item.url).pathname;
  const lm = lastmod.get(path);
  if (lm) item.lastmod = lm;
  return item;
}

const chunks: Record<string, (item: SitemapItem) => SitemapItem | undefined> = {};
for (const cluster of clusters) {
  chunks[cluster] = (item) => {
    const path = new URL(item.url).pathname;
    if (!path.startsWith(`/${cluster}/`)) return undefined;
    item.changefreq = ChangeFreqEnum.WEEKLY;
    return withLastmod(item);
  };
}

export default defineConfig({
  site: SITE_URL,
  output: 'static',
  trailingSlash: 'always',
  // Astro 7 defaults to JSX-style whitespace stripping; keep HTML-aware compression so
  // inline elements in prose keep their spaces.
  compressHTML: true,
  prefetch: false,
  build: {
    format: 'directory',
    inlineStylesheets: 'auto',
  },
  image: {
    // Astro's default Sharp service already outputs AVIF/WebP when `format` is set;
    // we set defaults in the <Image> usages.
  },
  integrations: [
    mdx(),
    sitemap({
      filter: (page) => !page.includes('/search/') && !page.includes('/404'),
      serialize: withLastmod,
      chunks,
      namespaces: { news: false, image: false, video: false },
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
