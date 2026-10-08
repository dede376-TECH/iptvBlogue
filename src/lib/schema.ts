/**
 * JSON-LD builders. Pure functions returning plain objects; rendered by <JsonLd />.
 * Policy: no AggregateRating / Review schema (we have no real reviews).
 */
import { SITE } from './site';

type JsonLd = Record<string, unknown>;

const CONTEXT = 'https://schema.org';

export function absolute(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE.url}${path.startsWith('/') ? '' : '/'}${path}`;
}

export function organizationId(): string {
  return `${SITE.url}/#organization`;
}

export function websiteId(): string {
  return `${SITE.url}/#website`;
}

export function personId(authorSlug: string): string {
  return `${SITE.url}/authors/${authorSlug}/#person`;
}

export function organizationSchema(): JsonLd {
  return {
    '@type': 'Organization',
    '@id': organizationId(),
    name: SITE.organization.name,
    url: `${SITE.url}/`,
    logo: {
      '@type': 'ImageObject',
      url: absolute(SITE.organization.logoPath),
    },
    email: SITE.organization.email,
    sameAs: SITE.organization.sameAs,
  };
}

export function websiteSchema(): JsonLd {
  return {
    '@type': 'WebSite',
    '@id': websiteId(),
    url: `${SITE.url}/`,
    name: SITE.name,
    description: SITE.tagline,
    publisher: { '@id': organizationId() },
    inLanguage: ['en-GB', 'en-US'],
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/search/?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export interface PersonInput {
  slug: string;
  name: string;
  role: string;
  description: string;
  image?: string;
  sameAs?: string[];
  email?: string;
}

export function personSchema(p: PersonInput): JsonLd {
  const out: JsonLd = {
    '@type': 'Person',
    '@id': personId(p.slug),
    name: p.name,
    url: `${SITE.url}/authors/${p.slug}/`,
    jobTitle: p.role,
    description: p.description,
    worksFor: { '@id': organizationId() },
  };
  if (p.image) out.image = absolute(p.image);
  if (p.sameAs?.length) out.sameAs = p.sameAs;
  if (p.email) out.email = p.email;
  return out;
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

export function breadcrumbSchema(items: BreadcrumbItem[]): JsonLd {
  return {
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: absolute(item.path),
    })),
  };
}

export interface ArticleInput {
  path: string;
  headline: string;
  description: string;
  image: string;
  publishedAt: Date;
  updatedAt?: Date;
  authorSlug: string;
  authorName: string;
  wordCount: number;
  keywords: string[];
  section: string;
  lang: string;
}

export function articleSchema(a: ArticleInput): JsonLd {
  return {
    '@type': 'Article',
    '@id': `${absolute(a.path)}#article`,
    mainEntityOfPage: { '@type': 'WebPage', '@id': absolute(a.path) },
    headline: a.headline,
    description: a.description,
    image: [absolute(a.image)],
    datePublished: a.publishedAt.toISOString(),
    dateModified: (a.updatedAt ?? a.publishedAt).toISOString(),
    author: { '@id': personId(a.authorSlug), '@type': 'Person', name: a.authorName },
    publisher: { '@id': organizationId() },
    isPartOf: { '@id': websiteId() },
    wordCount: a.wordCount,
    keywords: a.keywords.join(', '),
    articleSection: a.section,
    inLanguage: a.lang,
    isAccessibleForFree: true,
  };
}

export interface FaqItem {
  question: string;
  answer: string;
}

export function faqSchema(items: FaqItem[]): JsonLd | undefined {
  if (items.length === 0) return undefined;
  return {
    '@type': 'FAQPage',
    mainEntity: items.map((f) => ({
      '@type': 'Question',
      name: f.question,
      acceptedAnswer: { '@type': 'Answer', text: f.answer },
    })),
  };
}

export interface HowToInput {
  name: string;
  description: string;
  path: string;
  totalTime?: string;
  tools?: string[];
  supplies?: string[];
  steps: { name: string; text: string; url?: string; image?: string }[];
}

export function howToSchema(h: HowToInput): JsonLd {
  const out: JsonLd = {
    '@type': 'HowTo',
    name: h.name,
    description: h.description,
    step: h.steps.map((s, i) => {
      const step: JsonLd = {
        '@type': 'HowToStep',
        position: i + 1,
        name: s.name,
        text: s.text,
        url: s.url ? absolute(s.url) : `${absolute(h.path)}#step-${i + 1}`,
      };
      if (s.image) step.image = absolute(s.image);
      return step;
    }),
  };
  if (h.totalTime) out.totalTime = h.totalTime;
  if (h.tools?.length) out.tool = h.tools.map((t) => ({ '@type': 'HowToTool', name: t }));
  if (h.supplies?.length) out.supply = h.supplies.map((s) => ({ '@type': 'HowToSupply', name: s }));
  return out;
}

export interface CollectionPageInput {
  path: string;
  name: string;
  description: string;
  items: { name: string; path: string }[];
}

export function collectionPageSchema(c: CollectionPageInput): JsonLd {
  return {
    '@type': 'CollectionPage',
    '@id': absolute(c.path),
    url: absolute(c.path),
    name: c.name,
    description: c.description,
    isPartOf: { '@id': websiteId() },
    mainEntity: {
      '@type': 'ItemList',
      itemListElement: c.items.map((it, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: it.name,
        url: absolute(it.path),
      })),
    },
  };
}

export function webPageSchema(p: { path: string; name: string; description: string }): JsonLd {
  return {
    '@type': 'WebPage',
    '@id': absolute(p.path),
    url: absolute(p.path),
    name: p.name,
    description: p.description,
    isPartOf: { '@id': websiteId() },
  };
}

/** Wrap one or more schema nodes into a single @graph document. */
export function graph(...nodes: (JsonLd | undefined)[]): JsonLd {
  return {
    '@context': CONTEXT,
    '@graph': nodes.filter((n): n is JsonLd => Boolean(n)),
  };
}
