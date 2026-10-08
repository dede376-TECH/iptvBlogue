import { defineCollection, reference } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * Topic clusters – one JSON file per cluster in `src/content/clusters/`.
 * The file name is the URL segment (`technical.json` -> `/technical/`).
 */
const clusters = defineCollection({
  loader: glob({ pattern: '*.json', base: './src/content/clusters' }),
  schema: z.object({
    title: z.string().max(60),
    h1: z.string(),
    /** Short label for the main navigation. */
    navLabel: z.string(),
    description: z.string().max(155),
    intro: z.string(),
    order: z.number().int(),
    /** Article id (`cluster/slug`) of the pillar article for this hub. */
    pillar: z.string().optional(),
    updatedAt: z.coerce.date().optional(),
    faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
  }),
});

const authors = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/authors' }),
  schema: ({ image }) =>
    z.object({
      name: z.string(),
      role: z.string(),
      shortBio: z.string().max(200),
      avatar: image().optional(),
      email: z.email().optional(),
      links: z
        .object({
          website: z.url().optional(),
          twitter: z.url().optional(),
          linkedin: z.url().optional(),
          github: z.url().optional(),
          mastodon: z.url().optional(),
        })
        .default({}),
      /** Credentials or experience shown in the author box (E-E-A-T). */
      credentials: z.array(z.string()).default([]),
    }),
});

export const INTENTS = ['how-to', 'what-is', 'comparison', 'troubleshooting', 'legal'] as const;
export const GEOS = ['GB', 'US', 'GLOBAL'] as const;

const howToStep = z.object({
  name: z.string(),
  text: z.string(),
  url: z.string().optional(),
  image: z.string().optional(),
});

const articles = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/articles' }),
  schema: ({ image }) =>
    z
      .object({
        title: z.string().max(60, { error: 'Title must be <= 60 characters' }),
        description: z.string().max(155, { error: 'Description must be <= 155 characters' }),
        cluster: z.string(),
        targetKeyword: z.string(),
        secondaryKeywords: z.array(z.string()).default([]),
        intent: z.enum(INTENTS),
        geo: z.enum(GEOS).default('GLOBAL'),
        publishedAt: z.coerce.date(),
        updatedAt: z.coerce.date().optional(),
        author: reference('authors'),
        faq: z.array(z.object({ question: z.string(), answer: z.string() })).default([]),
        /** Article ids (`cluster/slug`) to show as related posts. */
        related: z.array(z.string()).default([]),
        draft: z.boolean().default(false),

        // --- supporting fields -------------------------------------------------
        /** Pillar articles need >= 1800 words and are featured on the hub. */
        pillar: z.boolean().default(false),
        /** `minimal` = distraction-free template for paid (SEA) landing tests. */
        template: z.enum(['default', 'minimal']).default('default'),
        /** Hero / OG image. Falls back to the generated OG image when missing. */
        image: image().optional(),
        imageAlt: z.string().optional(),
        /** Shown in the "Key takeaways" block at the top of the article. */
        keyTakeaways: z.array(z.string()).default([]),
        /** HowTo structured data (setup / troubleshooting articles). */
        howTo: z
          .object({
            name: z.string().optional(),
            totalTime: z.string().optional(),
            tools: z.array(z.string()).default([]),
            supplies: z.array(z.string()).default([]),
            steps: z.array(howToStep).min(2),
          })
          .optional(),
        /**
         * Real language/region variants of this article. Only set when a genuinely
         * different en-GB / en-US version exists; hreflang is emitted reciprocally.
         */
        alternates: z
          .array(z.object({ lang: z.enum(['en-GB', 'en-US']), id: z.string() }))
          .default([]),
        /** Set to false to keep a page out of the index (still built). */
        index: z.boolean().default(true),
      })
      .refine((d) => !d.imageAlt || d.image, {
        error: 'imageAlt requires image',
      }),
});

/** Static informational pages (about, privacy, cookies, …) authored in MDX. */
const pages = defineCollection({
  loader: glob({ pattern: '*.{md,mdx}', base: './src/content/pages' }),
  schema: z.object({
    title: z.string().max(60),
    description: z.string().max(155),
    h1: z.string(),
    /** Short label for navigation (footer). Falls back to `h1`. */
    navLabel: z.string().optional(),
    updatedAt: z.coerce.date(),
    index: z.boolean().default(true),
  }),
});

export const collections = { clusters, authors, articles, pages };
