/**
 * Site-wide configuration. Copy lives in `src/content`; this file holds the brand,
 * the canonical URL and feature switches. The URL comes from the `SITE` value Astro
 * copies out of the SITE_URL environment variable. There is no hardcoded domain.
 */
function canonicalUrl(): string {
  const url = (import.meta.env.SITE ?? '').replace(/\/$/, '');
  if (!url) {
    throw new Error(
      'SITE_URL is empty. Set it in .env. Until a domain is bought, use the *.vercel.app URL from the Vercel project.',
    );
  }
  return url;
}

function temporaryHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'vercel.app' || host.endsWith('.vercel.app');
  } catch {
    return false;
  }
}

const url = canonicalUrl();

/**
 * Vercel Hobby does not allow commercial use. Advertising stays off unless this is exactly
 * "true" (a host whose plan allows ads). The publisher id is ignored while this is false,
 * so a leftover env var cannot turn ads on.
 */
const hostingCommercial = import.meta.env.PUBLIC_HOSTING_COMMERCIAL === 'true';
const adsenseRequested = (import.meta.env.PUBLIC_ADSENSE_CLIENT ?? '').trim();

export const SITE = {
  name: 'Screenwise',
  shortName: 'Screenwise',
  url,
  /** True while the canonical URL is a temporary *.vercel.app host. Pages are noindexed. */
  temporaryHost: temporaryHost(url),
  hostingCommercial,
  /** Default language of the HTML document. Articles may override via `geo`. */
  defaultLang: 'en-GB',
  locales: {
    GB: 'en-GB',
    US: 'en-US',
    GLOBAL: 'en',
  } as const,
  tagline: 'Plain-English IPTV guides for everyday viewers.',
  /** Used in Organization schema. No postal address and no country are published. */
  organization: {
    name: 'Screenwise',
    logoPath: '/logo.svg',
    sameAs: [] as string[],
  },
  twitterHandle: '',
  /** Shown in the footer. */
  foundedYear: 2026,
} as const;

export const ANALYTICS = {
  /** Empty disables GA4: no gtag snippet and no analytics consent category. */
  ga4Id: (import.meta.env.PUBLIC_GA4_ID ?? '').trim(),
};

export const ADS = {
  /** Empty unless a publisher id is set AND the host allows commercial use. */
  adsenseClient: hostingCommercial ? adsenseRequested : '',
  /** Max ad slots per 1000 words (hard content-policy rule). */
  maxSlotsPer1000Words: 3,
  /**
   * Serve non-personalised ads to visitors who rejected advertising cookies.
   * Off: even non-personalised ads need storage consent. Do not turn on without a legal review.
   */
  npaWithoutConsent: false,
};

/** Which optional consent categories actually exist. Both false: no banner, no consent script. */
export const CONSENT = {
  analytics: Boolean(ANALYTICS.ga4Id),
  ads: Boolean(ADS.adsenseClient),
};

export const CONTENT_RULES = {
  minWordsArticle: 800,
  minWordsPillar: 1800,
  maxTitleLength: 60,
  maxDescriptionLength: 155,
  wordsPerMinute: 200,
};
