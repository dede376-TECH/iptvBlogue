/**
 * Typed helpers around `astro:content`. Kept separate from `seo.ts` so SEO helpers stay
 * pure and testable outside Astro.
 */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export type Article = CollectionEntry<'articles'>;
export type Author = CollectionEntry<'authors'>;
export type Cluster = CollectionEntry<'clusters'>;
export type Page = CollectionEntry<'pages'>;

const isProd = import.meta.env.PROD;

/** Published articles (drafts excluded in production builds, included in dev). */
export async function getPublishedArticles(): Promise<Article[]> {
  const all = await getCollection('articles', ({ data }) => (isProd ? !data.draft : true));
  return all.sort((a, b) => {
    const da = (a.data.updatedAt ?? a.data.publishedAt).getTime();
    const db = (b.data.updatedAt ?? b.data.publishedAt).getTime();
    return db - da;
  });
}

export async function getClusters(): Promise<Cluster[]> {
  const all = await getCollection('clusters');
  return all.sort((a, b) => a.data.order - b.data.order);
}

export async function getArticlesByCluster(cluster: string): Promise<Article[]> {
  const all = await getPublishedArticles();
  return all.filter((a) => a.data.cluster === cluster);
}

export async function getAuthor(ref: { id: string }): Promise<Author> {
  const author = await getEntry('authors', ref.id);
  if (!author) throw new Error(`Unknown author "${ref.id}"`);
  return author;
}

export async function resolveRelated(article: Article, limit = 4): Promise<Article[]> {
  const all = await getPublishedArticles();
  const byId = new Map(all.map((a) => [a.id, a]));
  const explicit = article.data.related
    .map((id) => byId.get(id))
    .filter((a): a is Article => Boolean(a) && a!.id !== article.id);
  if (explicit.length >= limit) return explicit.slice(0, limit);
  const fill = all.filter(
    (a) => a.data.cluster === article.data.cluster && a.id !== article.id && !explicit.includes(a),
  );
  return [...explicit, ...fill].slice(0, limit);
}

export function articleSlug(article: Article): string {
  return article.id.split('/').slice(1).join('/');
}
