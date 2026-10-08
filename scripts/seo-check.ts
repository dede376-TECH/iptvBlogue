/**
 * SEO quality gate. Run after `astro build`:
 *
 *   pnpm seo-check            # structural errors fail; content-readiness issues are warnings
 *   pnpm seo-check --strict   # production gate: TODOs, word counts and drafts fail too
 *
 * Checks the built HTML in dist/ (what crawlers see) plus the MDX sources for word counts and
 * frontmatter consistency.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { parse as parseHtml, type HTMLElement } from 'node-html-parser';
import {
  ARTICLES_DIR,
  indexArticles,
  indexClusters,
  loadBlocklist,
  walk,
  type IndexedArticle,
} from './lib/content-index';
import { phraseMatcher } from './lib/text';

const STRICT = process.argv.includes('--strict');
const DIST = join(process.cwd(), 'dist');
const SITE_URL = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');

const LIMITS = {
  title: 60,
  description: 155,
  minWordsArticle: 800,
  minWordsPillar: 1800,
  minInternalLinks: 3,
  maxClickDepth: 3,
  adSlotsPer1000Words: 3,
};

type Level = 'error' | 'warn';
interface Issue {
  level: Level;
  page: string;
  rule: string;
  message: string;
}
const issues: Issue[] = [];
const err = (page: string, rule: string, message: string) =>
  issues.push({ level: 'error', page, rule, message });
const warn = (page: string, rule: string, message: string) =>
  issues.push({ level: 'warn', page, rule, message });
/** Error in strict mode, warning otherwise. */
const gate = (page: string, rule: string, message: string) =>
  (STRICT ? err : warn)(page, rule, message);

interface Page {
  path: string; // "/technical/foo/"
  file: string;
  root: HTMLElement;
  title: string;
  description: string;
  canonical: string;
  noindex: boolean;
  h1s: string[];
  headings: { level: number; text: string }[];
  links: string[]; // internal hrefs (site-relative, as written)
  hreflang: { lang: string; href: string }[];
  jsonLdTypes: Set<string>;
  text: string;
  ids: Set<string>;
  isArticle: boolean;
  isHub: boolean;
}

function toPath(file: string): string {
  const rel = relative(DIST, file).split(sep).join('/');
  if (rel === 'index.html') return '/';
  if (rel.endsWith('/index.html')) return `/${rel.slice(0, -'index.html'.length)}`;
  return `/${rel}`;
}

function collectJsonLdTypes(root: HTMLElement): Set<string> {
  const types = new Set<string>();
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const data = JSON.parse(s.text) as Record<string, unknown>;
      const nodes = Array.isArray(data['@graph'])
        ? (data['@graph'] as Record<string, unknown>[])
        : [data];
      for (const n of nodes) {
        const t = n['@type'];
        if (typeof t === 'string') types.add(t);
        if (Array.isArray(t)) t.forEach((x) => types.add(String(x)));
      }
    } catch {
      types.add('__INVALID_JSON__');
    }
  }
  return types;
}

function loadPage(file: string, clusterIds: Set<string>): Page {
  const html = readFileSync(file, 'utf8');
  const root = parseHtml(html, {
    blockTextElements: { script: true, style: true, noscript: true },
  });
  const path = toPath(file);
  const segs = path.split('/').filter(Boolean);
  const isHub = segs.length === 1 && clusterIds.has(segs[0]!);
  const isArticle = segs.length === 2 && clusterIds.has(segs[0]!);

  const headings = root
    .querySelectorAll('h1, h2, h3, h4, h5, h6')
    .map((h) => ({ level: Number(h.tagName.slice(1)), text: h.text.trim() }));

  const links = root
    .querySelectorAll('a[href]')
    .map((a) => a.getAttribute('href') ?? '')
    .filter((href) => href.startsWith('/') || href.startsWith(SITE_URL) || href.startsWith('#'))
    .map((href) => (href.startsWith(SITE_URL) ? href.slice(SITE_URL.length) : href));

  // Visible text only: drop scripts/styles and the JSON-LD.
  const body = root.querySelector('body');
  body?.querySelectorAll('script, style, noscript, template').forEach((n) => n.remove());
  const text = (body?.text ?? '').replace(/\s+/g, ' ').trim();

  return {
    path,
    file,
    root,
    title: root.querySelector('title')?.text.trim() ?? '',
    description:
      root.querySelector('meta[name="description"]')?.getAttribute('content')?.trim() ?? '',
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '',
    noindex: /noindex/i.test(
      root.querySelector('meta[name="robots"]')?.getAttribute('content') ?? '',
    ),
    h1s: root.querySelectorAll('h1').map((h) => h.text.trim()),
    headings,
    links,
    hreflang: root
      .querySelectorAll('link[rel="alternate"][hreflang]')
      .map((l) => ({ lang: l.getAttribute('hreflang') ?? '', href: l.getAttribute('href') ?? '' })),
    jsonLdTypes: collectJsonLdTypes(root),
    text,
    ids: new Set(root.querySelectorAll('[id]').map((n) => n.getAttribute('id') ?? '')),
    isArticle,
    isHub,
  };
}

function normalizeLink(href: string, fromPath: string): { path: string; hash: string } {
  const [p, hash = ''] = href.split('#');
  const path = p === '' ? fromPath : p!;
  return { path: path.split('?')[0]!, hash };
}

function fileExistsForPath(path: string): boolean {
  if (path === '/') return existsSync(join(DIST, 'index.html'));
  const clean = path.replace(/^\//, '');
  if (/\.[a-z0-9]+$/i.test(clean)) return existsSync(join(DIST, ...clean.split('/')));
  return existsSync(join(DIST, ...clean.replace(/\/$/, '').split('/'), 'index.html'));
}

// ---------------------------------------------------------------------------
function main() {
  if (!existsSync(DIST)) {
    console.error('dist/ not found. Run `pnpm build` first.');
    process.exit(1);
  }

  const clusters = indexClusters();
  const clusterIds = new Set(clusters.map((c) => c.id));
  const articles = indexArticles({ includeDrafts: true });
  const blocklist = loadBlocklist();
  const banned = phraseMatcher(blocklist);

  const htmlFiles = walk(DIST, ['.html']).filter(
    (f) => !f.includes(`${sep}og${sep}`) && !f.includes(`${sep}pagefind${sep}`),
  );
  const pages = htmlFiles.map((f) => loadPage(f, clusterIds));
  const byPath = new Map(pages.map((p) => [p.path, p]));
  const is404 = (p: Page) => p.path === '/404.html' || p.path === '/404/';
  const indexable = pages.filter((p) => !p.noindex && !is404(p));

  // --- Per-page checks --------------------------------------------------------
  const titles = new Map<string, string[]>();
  const descriptions = new Map<string, string[]>();
  const h1s = new Map<string, string[]>();

  for (const p of pages) {
    const expectedCanonical = `${SITE_URL}${p.path}`;
    if (!p.title) err(p.path, 'title', 'Missing <title>');
    else if (p.title.length > LIMITS.title)
      err(p.path, 'title', `Title is ${p.title.length} chars (max ${LIMITS.title})`);
    if (!p.description) err(p.path, 'description', 'Missing meta description');
    else if (p.description.length > LIMITS.description)
      err(
        p.path,
        'description',
        `Description is ${p.description.length} chars (max ${LIMITS.description})`,
      );
    if (!p.canonical) err(p.path, 'canonical', 'Missing canonical');
    else if (p.canonical !== expectedCanonical && !is404(p))
      err(p.path, 'canonical', `Canonical "${p.canonical}" != "${expectedCanonical}"`);

    if (p.h1s.length !== 1) err(p.path, 'h1', `Expected exactly 1 <h1>, found ${p.h1s.length}`);

    // Heading order: first heading is h1; never skip a level going down.
    let prev = 0;
    p.headings.forEach((h, i) => {
      if (i === 0 && h.level !== 1)
        err(p.path, 'heading-order', `First heading is <h${h.level}> ("${h.text}")`);
      if (h.level > prev + 1 && prev !== 0)
        err(
          p.path,
          'heading-order',
          `<h${h.level}> "${h.text}" follows <h${prev}> (skipped level)`,
        );
      prev = h.level;
    });

    // Images need an alt attribute (empty alt allowed for decorative images).
    for (const img of p.root.querySelectorAll('img')) {
      if (!img.hasAttribute('alt'))
        err(p.path, 'img-alt', `<img src="${img.getAttribute('src')}"> has no alt attribute`);
      if (!img.getAttribute('width') || !img.getAttribute('height'))
        warn(p.path, 'img-size', `<img src="${img.getAttribute('src')}"> is missing width/height`);
    }

    // Internal links resolve to a built page (and anchor exists when present).
    for (const href of p.links) {
      const { path, hash } = normalizeLink(href, p.path);
      if (!fileExistsForPath(path)) {
        err(p.path, 'broken-link', `Internal link to "${href}" does not resolve to a built page`);
        continue;
      }
      if (!/\.[a-z0-9]+$/i.test(path) && !path.endsWith('/'))
        err(p.path, 'trailing-slash', `Internal link "${href}" must end with a trailing slash`);
      if (hash) {
        const target = byPath.get(path.endsWith('/') ? path : `${path}/`);
        if (target && !target.ids.has(hash))
          err(p.path, 'broken-anchor', `Anchor "#${hash}" not found on ${path}`);
      }
    }

    // Structured data
    if (p.jsonLdTypes.has('__INVALID_JSON__')) err(p.path, 'schema', 'Invalid JSON-LD');
    if (!p.jsonLdTypes.has('Organization') || !p.jsonLdTypes.has('WebSite'))
      err(p.path, 'schema', 'Missing Organization/WebSite schema');
    if (p.path !== '/' && !p.noindex && !is404(p) && !p.jsonLdTypes.has('BreadcrumbList'))
      err(p.path, 'schema', 'Missing BreadcrumbList schema');
    if (p.isArticle) {
      if (!p.jsonLdTypes.has('Article'))
        err(p.path, 'schema', 'Article page without Article schema');
      if (!p.jsonLdTypes.has('Person'))
        err(p.path, 'schema', 'Article page without Person (author) schema');
      if (p.ids.has('faq') && !p.jsonLdTypes.has('FAQPage'))
        err(p.path, 'schema', 'Visible FAQ without FAQPage schema');
      if (p.jsonLdTypes.has('FAQPage') && !p.ids.has('faq'))
        err(p.path, 'schema', 'FAQPage schema without visible FAQ');
    }
    if (p.isHub && !p.jsonLdTypes.has('CollectionPage'))
      err(p.path, 'schema', 'Hub page without CollectionPage schema');
    if (p.jsonLdTypes.has('AggregateRating') || p.jsonLdTypes.has('Review'))
      err(p.path, 'schema', 'AggregateRating/Review schema is not allowed (no real reviews)');

    // Banned terms and TODO leftovers in visible text
    const hits = banned(p.text);
    if (hits.length)
      err(p.path, 'banned-terms', `Blocklisted phrase(s) in visible text: ${hits.join(', ')}`);
    if (/\bTODO\b/.test(p.text)) gate(p.path, 'todo', 'Leftover TODO in visible text');

    if (!p.noindex) {
      titles.set(p.title, [...(titles.get(p.title) ?? []), p.path]);
      descriptions.set(p.description, [...(descriptions.get(p.description) ?? []), p.path]);
      if (p.h1s[0]) h1s.set(p.h1s[0], [...(h1s.get(p.h1s[0]) ?? []), p.path]);
    }
  }

  for (const [t, paths] of titles)
    if (paths.length > 1) err(paths.join(', '), 'duplicate-title', `Duplicate title "${t}"`);
  for (const [d, paths] of descriptions)
    if (paths.length > 1)
      err(paths.join(', '), 'duplicate-description', `Duplicate description "${d.slice(0, 60)}…"`);
  for (const [h, paths] of h1s)
    if (paths.length > 1) err(paths.join(', '), 'duplicate-h1', `Duplicate H1 "${h}"`);

  // --- Orphans + click depth (BFS from home) -------------------------------------
  const depth = new Map<string, number>([['/', 0]]);
  const queue = ['/'];
  while (queue.length) {
    const cur = queue.shift()!;
    const page = byPath.get(cur);
    if (!page) continue;
    for (const href of page.links) {
      const { path } = normalizeLink(href, cur);
      const key = path.endsWith('/') || /\.[a-z0-9]+$/i.test(path) ? path : `${path}/`;
      if (!depth.has(key) && byPath.has(key)) {
        depth.set(key, depth.get(cur)! + 1);
        queue.push(key);
      }
    }
  }
  for (const p of indexable) {
    const d = depth.get(p.path);
    if (d === undefined) err(p.path, 'orphan', 'Page is not reachable from the home page');
    else if (d > LIMITS.maxClickDepth)
      err(p.path, 'click-depth', `Page is ${d} clicks from home (max ${LIMITS.maxClickDepth})`);
  }

  // --- hreflang reciprocity -----------------------------------------------------
  for (const p of pages) {
    if (p.hreflang.length === 0) continue;
    const self = `${SITE_URL}${p.path}`;
    if (!p.hreflang.some((h) => h.href === self))
      err(p.path, 'hreflang', 'hreflang set does not include the page itself');
    if (!p.hreflang.some((h) => h.lang === 'x-default'))
      err(p.path, 'hreflang', 'hreflang set has no x-default');
    for (const h of p.hreflang) {
      if (h.lang === 'x-default') continue;
      const targetPath = h.href.startsWith(SITE_URL) ? h.href.slice(SITE_URL.length) : h.href;
      const target = byPath.get(targetPath);
      if (!target) {
        err(p.path, 'hreflang', `hreflang ${h.lang} points to missing page ${h.href}`);
        continue;
      }
      if (!target.hreflang.some((t) => t.href === self))
        err(p.path, 'hreflang', `hreflang to ${h.href} is not reciprocated`);
    }
  }

  // --- Sitemap coverage ---------------------------------------------------------
  const sitemapFiles = walk(DIST, ['.xml']).filter(
    (f) => /sitemap-.*\.xml$/.test(f) && !f.endsWith('sitemap-index.xml'),
  );
  const sitemapUrls = new Set<string>();
  for (const f of sitemapFiles) {
    for (const m of readFileSync(f, 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g))
      sitemapUrls.add(m[1]!);
  }
  if (!existsSync(join(DIST, 'sitemap-index.xml')))
    err('/', 'sitemap', 'sitemap-index.xml missing');
  if (!existsSync(join(DIST, 'robots.txt'))) err('/', 'robots', 'robots.txt missing');
  for (const p of indexable) {
    const url = `${SITE_URL}${p.path}`;
    if (!sitemapUrls.has(url)) err(p.path, 'sitemap', 'Indexable page missing from sitemap');
  }
  for (const p of pages) {
    if (p.noindex && sitemapUrls.has(`${SITE_URL}${p.path}`))
      err(p.path, 'sitemap', 'noindex page listed in sitemap');
  }

  // --- Article source checks (MDX) ----------------------------------------------
  for (const a of articles) {
    const fm = a.frontmatter;
    const pageRef = a.path;
    if (fm.cluster !== a.cluster)
      err(pageRef, 'frontmatter', `cluster "${fm.cluster}" does not match folder "${a.cluster}"`);
    if (!clusterIds.has(a.cluster))
      err(pageRef, 'frontmatter', `Unknown cluster folder "${a.cluster}"`);
    for (const rel of fm.related ?? []) {
      if (!articles.some((x) => x.id === rel))
        err(pageRef, 'frontmatter', `related id "${rel}" does not exist`);
    }
    for (const alt of fm.alternates ?? []) {
      const target = articles.find((x) => x.id === alt.id);
      if (!target) err(pageRef, 'hreflang', `alternates id "${alt.id}" does not exist`);
      else if (!(target.frontmatter.alternates ?? []).some((b) => b.id === a.id))
        err(pageRef, 'hreflang', `alternate "${alt.id}" does not declare this article back`);
    }
    if (!fm.title.toLowerCase().includes(fm.targetKeyword.toLowerCase().split(' ')[0] ?? ''))
      warn(pageRef, 'keyword', `Target keyword "${fm.targetKeyword}" not reflected in the title`);

    if (fm.draft) {
      if (STRICT && byPath.has(a.path))
        err(pageRef, 'draft', 'Draft article is present in the production build');
      continue;
    }

    const min = fm.pillar ? LIMITS.minWordsPillar : LIMITS.minWordsArticle;
    if (a.wordCount < min)
      gate(
        pageRef,
        'word-count',
        `${a.wordCount} words (${fm.pillar ? 'pillar' : 'article'} minimum ${min})`,
      );
    if (/\bTODO\b/.test(a.body)) gate(pageRef, 'todo', 'TODO marker in MDX body');

    const page = byPath.get(a.path);
    if (page) {
      const prose = page.root.querySelector('.prose');
      const bodyLinks = prose
        ? prose.querySelectorAll('a[href^="/"]').map((x) => x.getAttribute('href') ?? '')
        : [];
      const unique = new Set(bodyLinks.filter((h) => h !== a.path));
      if (unique.size < LIMITS.minInternalLinks)
        gate(
          pageRef,
          'internal-links',
          `${unique.size} contextual internal links in body (min ${LIMITS.minInternalLinks})`,
        );
      const adSlots = page.root.querySelectorAll('.ad-slot').length;
      const maxSlots = Math.floor((a.wordCount / 1000) * LIMITS.adSlotsPer1000Words);
      if (adSlots > maxSlots)
        err(pageRef, 'ads', `${adSlots} ad slots for ${a.wordCount} words (max ${maxSlots})`);
    }
  }

  // Every non-draft article must be linked from its hub, and link back to it.
  for (const a of articles.filter((x) => !x.frontmatter.draft)) {
    const hub = byPath.get(`/${a.cluster}/`);
    const page = byPath.get(a.path);
    if (hub && !hub.links.includes(a.path))
      err(a.path, 'hub-link', `Hub /${a.cluster}/ does not link to this article`);
    if (page && !page.links.includes(`/${a.cluster}/`))
      err(a.path, 'hub-link', `Article does not link back to its hub`);
  }

  // Source TODOs in non-article content (pages, authors) – production gate only.
  const otherContent = walk(join(process.cwd(), 'src', 'content'), ['.mdx', '.md']).filter(
    (f) => !f.startsWith(ARTICLES_DIR),
  );
  for (const f of otherContent) {
    if (/\bTODO\b/.test(readFileSync(f, 'utf8')))
      gate(relative(process.cwd(), f), 'todo', 'TODO marker in content source');
  }

  report(pages.length, articles);
}

function report(pageCount: number, articles: IndexedArticle[]) {
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warn');
  const fmt = (i: Issue) => `  [${i.rule}] ${i.page}\n      ${i.message}`;

  console.log(
    `\nSEO check (${STRICT ? 'strict' : 'default'} mode): ${pageCount} pages, ${articles.length} articles\n`,
  );
  if (warnings.length) {
    console.log(`Warnings (${warnings.length}):`);
    warnings.forEach((i) => console.log(fmt(i)));
    console.log('');
  }
  if (errors.length) {
    console.log(`Errors (${errors.length}):`);
    errors.forEach((i) => console.log(fmt(i)));
    console.log('\nFAILED');
    process.exit(1);
  }
  console.log(warnings.length ? 'PASSED with warnings' : 'PASSED');
}

main();
