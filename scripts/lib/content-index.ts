/**
 * Filesystem-level index of the content collections.
 *
 * This module deliberately does NOT import from `astro:content` so that it can be used
 * from `astro.config.ts` (sitemap lastmod per URL), from the CLI scripts (seo-check,
 * stubs, indexnow) and from CI, without booting Astro.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse as parseYaml } from 'yaml';

export const ROOT = process.cwd();
export const ARTICLES_DIR = join(ROOT, 'src', 'content', 'articles');
export const AUTHORS_DIR = join(ROOT, 'src', 'content', 'authors');
export const CLUSTERS_DIR = join(ROOT, 'src', 'content', 'clusters');
export const PAGES_DIR = join(ROOT, 'src', 'content', 'pages');

export interface ArticleFrontmatter {
  title: string;
  description: string;
  cluster: string;
  targetKeyword: string;
  secondaryKeywords?: string[];
  intent: string;
  geo: string;
  publishedAt: string;
  updatedAt?: string;
  author: string;
  faq?: { question: string; answer: string }[];
  related?: string[];
  draft?: boolean;
  pillar?: boolean;
  template?: 'default' | 'minimal';
  alternates?: { lang: string; id: string }[];
  keyTakeaways?: string[];
  howTo?: unknown;
  [key: string]: unknown;
}

export interface IndexedArticle {
  /** `cluster/slug` – mirrors the Astro content entry id. */
  id: string;
  cluster: string;
  slug: string;
  /** Site-relative URL with trailing slash, e.g. `/technical/what-is-m3u/`. */
  path: string;
  filePath: string;
  frontmatter: ArticleFrontmatter;
  body: string;
  wordCount: number;
}

export interface IndexedCluster {
  id: string;
  path: string;
  filePath: string;
  data: Record<string, unknown> & { title: string; updatedAt?: string };
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function splitFrontmatter(raw: string): { data: Record<string, unknown>; body: string } {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { data: {}, body: raw };
  const data = (parseYaml(match[1] ?? '') ?? {}) as Record<string, unknown>;
  return { data, body: match[2] ?? '' };
}

/** Walk a directory recursively and return files matching the extensions. */
export function walk(dir: string, exts: string[]): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...walk(full, exts));
    else if (exts.some((e) => name.endsWith(e)) && !name.startsWith('_')) out.push(full);
  }
  return out.sort();
}

/**
 * Count words in an MDX body, ignoring frontmatter, import/export lines, JSX tags,
 * code fences, HTML comments and markdown syntax characters.
 */
export function countWords(body: string): number {
  const cleaned = body
    .replace(/^(import|export)\s.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/[#*_>`|[\]()!-]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ');
  return cleaned.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function toPosix(p: string): string {
  return p.split(sep).join('/');
}

export function indexArticles(opts: { includeDrafts?: boolean } = {}): IndexedArticle[] {
  const files = walk(ARTICLES_DIR, ['.mdx', '.md']);
  const articles: IndexedArticle[] = [];
  for (const filePath of files) {
    const raw = readFileSync(filePath, 'utf8');
    const { data, body } = splitFrontmatter(raw);
    const fm = data as ArticleFrontmatter;
    if (fm.draft && !opts.includeDrafts) continue;
    const rel = toPosix(relative(ARTICLES_DIR, filePath)).replace(/\.(mdx|md)$/, '');
    const [cluster, ...rest] = rel.split('/');
    const slug = rest.join('/');
    if (!cluster || !slug) continue;
    articles.push({
      id: rel,
      cluster,
      slug,
      path: `/${cluster}/${slug}/`,
      filePath,
      frontmatter: fm,
      body,
      wordCount: countWords(body),
    });
  }
  return articles;
}

export function indexClusters(): IndexedCluster[] {
  const files = walk(CLUSTERS_DIR, ['.json']);
  return files.map((filePath) => {
    const data = JSON.parse(readFileSync(filePath, 'utf8')) as IndexedCluster['data'];
    const id = toPosix(relative(CLUSTERS_DIR, filePath)).replace(/\.json$/, '');
    return { id, path: `/${id}/`, filePath, data };
  });
}

/** Map of site-relative path -> ISO lastmod, used by the sitemap integration. */
export function lastmodMap(): Map<string, string> {
  const map = new Map<string, string>();
  const articles = indexArticles();
  const clusterLatest = new Map<string, string>();
  for (const a of articles) {
    const last = String(a.frontmatter.updatedAt ?? a.frontmatter.publishedAt);
    map.set(a.path, new Date(last).toISOString());
    const prev = clusterLatest.get(a.cluster);
    if (!prev || new Date(last) > new Date(prev)) clusterLatest.set(a.cluster, last);
  }
  for (const c of indexClusters()) {
    const last = clusterLatest.get(c.id) ?? c.data.updatedAt;
    if (last) map.set(c.path, new Date(last).toISOString());
  }
  return map;
}

/** Load the blocklist as lowercase, trimmed, non-empty, non-comment lines. */
export function loadBlocklist(file = join(ROOT, 'data', 'blocklist.txt')): string[] {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((l) => l.trim().toLowerCase())
    .filter((l) => l && !l.startsWith('#'));
}
