# iptvBlogue

Blog sur IPTV et contenus connexes

Informational IPTV blog for UK (en-GB) and US (en-US) readers. Static Astro site, SEO-first,
ad-monetisation ready. **No subscriptions sold, no links to playlists or unlicensed services.**

## Stack

Astro 7 (static, `trailingSlash: always`) · TypeScript strict · Tailwind CSS 4 · MDX ·
Pagefind · Satori/resvg OG images · Cloudflare Pages · pnpm · Node 22.12+

## Commands

| Command                 | What it does                                                                   |
| ----------------------- | ------------------------------------------------------------------------------ |
| `pnpm dev`              | Dev server (drafts visible, search index absent)                               |
| `pnpm build`            | `astro build` → Pagefind index → IndexNow ping (no-op unless enabled)          |
| `pnpm build:prod`       | `pnpm build` + `seo-check --strict` (use as the Cloudflare build command)      |
| `pnpm check`            | `astro check` (types in .astro + .ts)                                          |
| `pnpm lint` / `format`  | ESLint / Prettier                                                              |
| `pnpm seo-check`        | Quality gate on `dist/` (structural errors fail; TODO/word count warn)         |
| `pnpm seo-check:strict` | Production gate: TODOs, short articles, drafts in build also fail              |
| `pnpm trends`           | `python scripts/trends.py` → `data/keywords_trends.csv` (see Keyword pipeline) |
| `pnpm plan:build`       | CSV → `content/plan.json` (dedupe, blocklist, cluster, intent, priority)       |
| `pnpm plan`             | `content/plan.json` → draft MDX stubs in `src/content/articles/<cluster>/`     |
| `pnpm indexnow`         | Submit sitemap URLs to IndexNow (`--dry-run`, `--since`, `--url`)              |
| `pnpm verify`           | lint + check + build + seo-check                                               |

## Content model

- `src/content/articles/<cluster>/<slug>.mdx` → `/<cluster>/<slug>/`. Frontmatter is validated by
  `src/content.config.ts` (title ≤ 60, description ≤ 155, intent, geo, faq, related, howTo, …).
- `src/content/clusters/<cluster>.json` → hub page `/<cluster>/` (title, h1, intro, pillar, FAQ).
- `src/content/authors/<slug>.mdx` → `/authors/<slug>/` (Person schema, E-E-A-T box).
- `src/content/pages/*.mdx` → about, contact, privacy, cookies, disclaimer, editorial-policy, home.

Set `draft: true` to keep an article out of production builds. Set `template: minimal` for a
distraction-free paid-test landing page. Declare `alternates` only when a real en-GB / en-US
variant exists; hreflang is emitted (and checked) reciprocally.

## Keyword pipeline

```sh
python -m pip install -r scripts/requirements.txt   # once (Python 3.10+; `py` on Windows also works)
pnpm trends                                         # Google Trends → data/keywords_trends.csv
pnpm plan:build                                     # CSV → content/plan.json (review it!)
pnpm plan -- --limit 5                              # plan → draft MDX stubs for a human to write
```

Google Trends rate-limits aggressively (HTTP 429). `trends.py` backs off exponentially, flushes
the CSV after every seed and can be resumed; if a seed keeps failing, wait a few minutes or lower
`--limit`. `plan.ts` rejects three classes of queries and records why in `plan.json → rejected`:
`data/blocklist.txt` phrases, transactional modifiers (buy, cheap, provider, review…) and
_source-hunting_ patterns (free/github/reddit feeds, "playlist 2025", "10,000 channels",
broadcaster- or country-specific playlists). Review rejects occasionally — a false positive is
cheap, a pirated-playlist article is not.

## Environment

Copy `.env.example` to `.env`. `SITE_URL` drives canonical/sitemap/RSS/OG URLs. `PUBLIC_GA4_ID`
and `PUBLIC_ADSENSE_CLIENT` are loaded only after consent (Consent Mode v2). `INDEXNOW_KEY`

- `INDEXNOW_ENABLED=true` enable the post-build ping (production CI only).

## Content policy (hard rules)

Informational only. Never link to playlists, resellers or unlicensed services. Never invent
statistics, prices, reviews, quotes or channel counts. Every article is human-edited with
original screenshots/tests and cited sources. `data/blocklist.txt` is enforced by both the
keyword plan and the SEO gate. See `/editorial-policy/` and `.cursorrules`.
