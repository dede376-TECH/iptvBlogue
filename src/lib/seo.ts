/**
 * Central SEO helpers: meta tag computation, canonical/hreflang resolution, reading time.
 * All JSON-LD builders live in `./schema.ts` and are re-exported here so components only
 * ever import from `@/lib/seo`.
 */
import { CONTENT_RULES, SITE } from './site';

export * from './schema';

export type Geo = 'GB' | 'US' | 'GLOBAL';

export interface Hreflang {
  lang: string;
  href: string;
}

export interface SeoInput {
  title: string;
  description: string;
  /** Site-relative path, with trailing slash. */
  path: string;
  type?: 'website' | 'article';
  image?: string;
  imageAlt?: string;
  publishedAt?: Date;
  updatedAt?: Date;
  authorName?: string;
  noindex?: boolean;
  hreflang?: Hreflang[];
  geo?: Geo;
}

export interface SeoMeta {
  title: string;
  description: string;
  canonical: string;
  lang: string;
  ogLocale: string;
  robots: string;
  type: 'website' | 'article';
  image: string;
  imageAlt: string;
  publishedAt?: string;
  updatedAt?: string;
  authorName?: string;
  hreflang: Hreflang[];
}

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE.url}${path.startsWith('/') ? '' : '/'}${path}`;
}

/** Ensure a path has a trailing slash (site uses `trailingSlash: 'always'`). */
export function withTrailingSlash(path: string): string {
  if (path.endsWith('/')) return path;
  if (/\.[a-z0-9]+$/i.test(path)) return path; // files (sitemap.xml, og.png)
  return `${path}/`;
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 0)).trimEnd()}…`;
}

export function langForGeo(geo: Geo | undefined): string {
  if (!geo) return SITE.defaultLang;
  return SITE.locales[geo];
}

export function ogLocaleFor(lang: string): string {
  if (lang === 'en') return 'en_GB';
  return lang.replace('-', '_');
}

export function ogImagePath(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return `/og/${clean || 'home'}.png`;
}

/**
 * Compute everything the <SEO> component needs. Titles are NOT suffixed with the site name
 * automatically: article titles already carry the keyword and must stay <= 60 chars.
 */
export function buildSeo(input: SeoInput): SeoMeta {
  const path = withTrailingSlash(input.path);
  const lang = langForGeo(input.geo);
  const robots = input.noindex
    ? 'noindex, nofollow'
    : 'index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:-1';
  return {
    title: truncate(input.title, CONTENT_RULES.maxTitleLength),
    description: truncate(input.description, CONTENT_RULES.maxDescriptionLength),
    canonical: absoluteUrl(path),
    lang,
    ogLocale: ogLocaleFor(lang),
    robots,
    type: input.type ?? 'website',
    image: absoluteUrl(input.image ?? ogImagePath(path)),
    imageAlt: input.imageAlt ?? input.title,
    publishedAt: input.publishedAt?.toISOString(),
    updatedAt: (input.updatedAt ?? input.publishedAt)?.toISOString(),
    authorName: input.authorName,
    hreflang: input.hreflang ?? [],
  };
}

/**
 * Build the hreflang set for an article that has real variants. Returns [] when there are
 * none (we never emit self-referencing hreflang for single-language pages).
 * `x-default` points at the GLOBAL variant when present, otherwise at the en-GB page.
 */
export function buildHreflang(
  self: { path: string; geo: Geo },
  alternates: { lang: 'en-GB' | 'en-US'; path: string }[],
): Hreflang[] {
  if (alternates.length === 0) return [];
  const selfLang = langForGeo(self.geo);
  const set = new Map<string, string>();
  set.set(selfLang, absoluteUrl(self.path));
  for (const alt of alternates) set.set(alt.lang, absoluteUrl(alt.path));
  const xDefault = set.get('en') ?? set.get('en-GB') ?? absoluteUrl(self.path);
  const out: Hreflang[] = [...set.entries()]
    .filter(([lang]) => lang !== 'en')
    .map(([lang, href]) => ({ lang, href }));
  out.push({ lang: 'x-default', href: xDefault });
  return out;
}

export function readingTimeMinutes(wordCount: number): number {
  return Math.max(1, Math.round(wordCount / CONTENT_RULES.wordsPerMinute));
}

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

export function formatDate(date: Date, lang: string = SITE.defaultLang): string {
  // Generic "en" (GLOBAL articles) uses the site default so dates read "8 October 2026" everywhere
  // except on explicitly US-targeted pages.
  const locale = lang === 'en' ? SITE.defaultLang : lang;
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(
    date,
  );
}

/** Max ad slots allowed for a given word count (3 per 1000 words, floor, min 0). */
export function maxAdSlots(wordCount: number): number {
  return Math.floor((wordCount / 1000) * 3);
}
