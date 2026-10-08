/**
 * Site-wide configuration. Copy (titles, bios, article text) lives in `src/content`;
 * this file only holds identifiers, URLs and feature switches.
 */
export const SITE = {
  // TODO(human): confirm final brand name and domain before launch.
  name: 'IPTV Blogue',
  shortName: 'IPTVBlogue',
  url: (import.meta.env.SITE ?? 'https://example.com').replace(/\/$/, ''),
  /** Default language of the HTML document. Articles may override via `geo`. */
  defaultLang: 'en-GB',
  locales: {
    GB: 'en-GB',
    US: 'en-US',
    GLOBAL: 'en',
  } as const,
  tagline:
    'Independent, informational guides to IPTV technology, players, setup and legal streaming.',
  /** Used in Organization schema. */
  organization: {
    name: 'IPTV Blogue',
    logoPath: '/logo.svg',
    sameAs: [] as string[],
    // TODO(human): add a contact email before launch.
    email: 'contact@example.com',
  },
  twitterHandle: '',
  /** Shown in the footer; keep accurate for E-E-A-T. */
  foundedYear: 2026,
} as const;

export const ANALYTICS = {
  ga4Id: import.meta.env.PUBLIC_GA4_ID ?? '',
};

export const ADS = {
  adsenseClient: import.meta.env.PUBLIC_ADSENSE_CLIENT ?? '',
  /** Max ad slots per 1000 words (hard content-policy rule). */
  maxSlotsPer1000Words: 3,
  /**
   * Serve non-personalised ads to visitors who rejected advertising cookies.
   * Off by default: under UK GDPR / ePrivacy even NPA needs storage consent. Turn on only
   * after a legal review (e.g. for US-only traffic).
   */
  npaWithoutConsent: false,
};

export const CONTENT_RULES = {
  minWordsArticle: 800,
  minWordsPillar: 1800,
  maxTitleLength: 60,
  maxDescriptionLength: 155,
  wordsPerMinute: 200,
};
