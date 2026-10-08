# Screenwise

Plain-English IPTV guides for everyday viewers.

Informational IPTV site. Static Astro build, SEO-first. **No subscriptions sold, no links to
playlists or unlicensed services.** The git repository name is unchanged.

## Stack

Astro 7 (static, `trailingSlash: always`) · TypeScript strict · Tailwind CSS 4 · MDX ·
Pagefind · Satori/resvg OG images · pnpm · Node 22.12+

Hosting today is Vercel (temporary). Cloudflare Pages is the later target; `public/_headers`
is kept for that move. Vercel reads `vercel.json` instead.

## Commands

| Command                 | What it does                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Dev server (drafts visible, search index absent)                                                |
| `pnpm build`            | `astro build` → Pagefind → `ads.txt` (only if ads are allowed) → IndexNow (no-op unless on)     |
| `pnpm build:prod`       | `pnpm build` + strict SEO gate + `launch-check`                                                 |
| `pnpm check`            | `astro check`                                                                                   |
| `pnpm lint` / `format`  | ESLint / Prettier                                                                               |
| `pnpm seo-check`        | Quality gate on `dist/` (structural errors fail; unfinished articles warn)                      |
| `pnpm seo-check:strict` | Production gate: unfinished articles, short pages and drafts fail                               |
| `pnpm launch-check`     | Fails on placeholders, the previous brand, an empty `SITE_URL`, or ads on a non-commercial host |
| `pnpm trends`           | `python scripts/trends.py` → `data/keywords_trends.csv` (see Keyword pipeline)                  |
| `pnpm plan:build`       | CSV → `content/plan.json`                                                                       |
| `pnpm plan`             | `content/plan.json` → draft MDX stubs                                                           |
| `pnpm indexnow`         | Submit sitemap URLs to IndexNow (`--dry-run`, `--since`, `--url`)                               |
| `pnpm verify`           | lint + check + build + seo-check                                                                |

## Content model

- `src/content/articles/<cluster>/<slug>.mdx` → `/<cluster>/<slug>/`. Frontmatter is validated by
  `src/content.config.ts` (title ≤ 60, description ≤ 155, intent, geo, faq, related, howTo, …).
- `src/content/clusters/<cluster>.json` → hub page `/<cluster>/`.
- `src/content/authors/<slug>.mdx` → `/authors/<slug>/`. The byline is the Screenwise Editorial Team.
- `src/content/pages/*.mdx` → about, contact, privacy, cookies, disclaimer, editorial-policy, home.

Set `draft: true` to keep an article out of production builds. Set `template: minimal` for a
distraction-free paid-test landing page. Declare `alternates` only when a real en-GB / en-US
variant exists; hreflang is emitted (and checked) reciprocally.

## Keyword pipeline

```sh
python -m pip install -r scripts/requirements.txt   # once (Python 3.10+)
pnpm trends                                         # Google Trends → data/keywords_trends.csv
pnpm plan:build                                     # CSV → content/plan.json (review it)
pnpm plan -- --limit 5                              # plan → draft MDX stubs for a human to write
```

Google Trends rate-limits aggressively (HTTP 429). `trends.py` backs off exponentially, flushes
the CSV after every seed and can be resumed. `plan.ts` rejects blocklisted phrases, transactional
modifiers and source-hunting patterns, and records the reason in `plan.json`.

## Environment

Copy `.env.example` to `.env`. Nothing in the app falls back to a domain: `astro.config.ts`,
canonical URLs, the sitemap, RSS, robots and IndexNow all read `SITE_URL`.

| Variable                    | Purpose                                                                  |
| --------------------------- | ------------------------------------------------------------------------ |
| `SITE_URL`                  | Required. Canonical origin, no trailing slash.                           |
| `PUBLIC_HOSTING_COMMERCIAL` | `true` only when the host allows ads and affiliate links. Default false. |
| `PUBLIC_GA4_ID`             | Empty disables GA4 and the analytics consent category.                   |
| `PUBLIC_ADSENSE_CLIENT`     | Empty disables AdSense. Ignored unless hosting is commercial.            |
| `INDEXNOW_KEY`              | Empty disables IndexNow. `*.vercel.app` URLs are never submitted.        |
| `INDEXNOW_ENABLED`          | Must be `true` as well as a key, or the post-build ping does nothing.    |

A `SITE_URL` whose host ends in `.vercel.app` is noindexed (`meta` robots and `X-Robots-Tag`)
and is left out of the sitemap, so the temporary URL cannot compete with the domain later.

**No ads or affiliate links on Vercel Hobby.** Leave `PUBLIC_HOSTING_COMMERCIAL` false and
`PUBLIC_ADSENSE_CLIENT` empty until the host allows commercial use. `pnpm launch-check` fails
if a publisher id is set while that flag is not `true`.

## Deploy: Vercel (now, temporary)

Node 22 comes from `package.json` `engines` and `.nvmrc` (`22.12.0`). Vercel uses those; the
project does not pin a second version in the dashboard.

1. Import the repository. Framework preset Astro. `vercel.json` sets the install command, `pnpm build`, and `dist`.
2. Environment variables (Production):

   - `SITE_URL` = the `*.vercel.app` URL Vercel assigns (Project → Settings → Domains). Replace the slug in `.env.example` if it differs.
   - `PUBLIC_HOSTING_COMMERCIAL` = `false`
   - Leave `PUBLIC_GA4_ID`, `PUBLIC_ADSENSE_CLIENT`, `INDEXNOW_KEY` empty and `INDEXNOW_ENABLED` false.

3. Do not add a custom domain until you are ready to remove the temporary noindex. While `SITE_URL` ends in `.vercel.app`, `vercel.json` must keep `X-Robots-Tag: noindex, nofollow`. `launch-check` fails if that header and the URL disagree.
4. GitHub Actions: set the repository variable `SITE_URL` to the same origin. The workflow file does not contain a URL. The build job stops if the variable is empty.

## Deploy: Cloudflare Pages (later)

When the domain exists and the plan allows the site to be indexed:

1. Set `SITE_URL` to `https://<the-domain>` (no trailing slash) in `.env`, Vercel or Cloudflare, and the GitHub variable.
2. Remove the `X-Robots-Tag` header from `vercel.json` if anything is still deployed there. `launch-check` requires that removal once `SITE_URL` is not a `.vercel.app` host.
3. Cloudflare Pages: build command `pnpm build:prod`, output `dist`, Node 22. `public/_headers` is applied by Pages (Vercel ignores it) and does **not** send `noindex`.
4. Set `PUBLIC_HOSTING_COMMERCIAL=true` only if that Cloudflare plan allows advertising. Then add `PUBLIC_ADSENSE_CLIENT`. `ads.txt` is generated at build time and is omitted while the client id is empty.
5. IndexNow: set `INDEXNOW_KEY` and `INDEXNOW_ENABLED=true` on the production build only.

`pnpm build:prod` is the production command. It runs the strict SEO gate and `launch-check`, so unfinished sample articles fail it on purpose.

## Content policy (hard rules)

Informational only. Never link to playlists, resellers or unlicensed services. Never invent
statistics, prices, reviews, quotes or channel counts. Every article is human-edited with
original screenshots or tests and cited sources. `data/blocklist.txt` is enforced by both the
keyword plan and the SEO gate. See `/editorial-policy/` and `.cursorrules`.
