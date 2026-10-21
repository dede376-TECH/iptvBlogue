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

| Command                 | What it does                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------- |
| `pnpm dev`              | Dev server (drafts visible, search index absent)                                            |
| `pnpm build`            | `astro build` → Pagefind → `ads.txt` (only if ads are allowed) → IndexNow (no-op unless on) |
| `pnpm build:prod`       | `pnpm build` + strict SEO gate + `launch-check`                                             |
| `pnpm check`            | `astro check`                                                                               |
| `pnpm lint` / `format`  | ESLint / Prettier                                                                           |
| `pnpm seo-check`        | Quality gate on `dist/` (structural errors fail; unfinished articles warn)                  |
| `pnpm seo-check:strict` | Production gate: unfinished articles, short pages and drafts fail                           |
| `pnpm launch-check`     | Fails on placeholders, needs-human or VERIFY markers, an empty `SITE_URL`, or ads on Hobby  |
| `pnpm review`           | Review status per article; writes `docs/verify-checklist.md` and `docs/images-checklist.md` |
| `pnpm trends`           | `python scripts/trends.py` → `data/keywords_trends.csv` (see Keyword pipeline)              |
| `pnpm plan:build`       | CSV → `content/plan.json`                                                                   |
| `pnpm plan`             | `content/plan.json` → draft MDX stubs                                                       |
| `pnpm indexnow`         | Submit sitemap URLs to IndexNow (`--dry-run`, `--since`, `--url`)                           |
| `pnpm verify`           | lint + check + build + seo-check                                                            |

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

`plan.ts` also skips brand and marketplace names (`data/blocklist-brands.txt`), head terms and
bare hardware names (unless listed in `data/whitelist.txt`), strips years 2019-2025 and
community-site modifiers before merging duplicates, folds each entity (xmltv, epg, m3u, tivimate,
smarters, kodi, firestick) into one pillar plus satellites with `mergedFrom`, and writes
per-cluster stats and a `skipped` list with reasons. Items are ranked by a score built from
distinct seeds, distinct geos and top versus rising. Google Trends values are relative to each
request, not search volume, so they are recorded but never used for ranking.

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

## Review workflow

Guides are drafted with AI assistance. Each one stays `reviewStatus: needs-human` until a person
has tested it, and the article page says "AI-assisted guide, not yet tested on a device".
While a guide is not approved, it emits no HowTo or FAQPage structured data.

1. Run `pnpm review`. It prints each article's status, tested devices and VERIFY count, and
   writes `docs/verify-checklist.md` (markers grouped by device or topic) and
   `docs/images-checklist.md` (screenshots to take, with target file names).
2. Work through the checklist on the device or source named. Correct the text, then delete the
   `{/* VERIFY: … */}` comment. Use MDX comments only; HTML comments break MDX.
3. Add the devices and software versions you used to `testedOn`.
4. Replace each `<ScreenshotSlot>` with a `<Figure kind="screenshot">` once the screenshot exists
   (WebP or AVIF, at most 150 KB, in `src/assets/articles/<slug>/`). Slots render only in
   `pnpm dev`. `seo-check` fails on a screenshot while `testedOn` is empty.
5. If a published fact changes, add an entry to `corrections` (`{ date, note }`) and bump
   `updatedAt`. The article shows a Corrections section.
6. Set `reviewStatus: approved`. `pnpm launch-check` fails while any article is `needs-human` or
   still contains a VERIFY marker.

Topics with no published article are hidden everywhere and come back on their own.

## Deploy on Vercel

- Build command: `pnpm build`. Output: `dist`. `vercel.json` sets these and the install command.
- Node 22, from `package.json` `engines` and `.nvmrc` (`22.12.0`). No version is pinned in the dashboard.
- Environment variables (Production): `SITE_URL` = the production `*.vercel.app` URL (currently
  `https://screenwise-one.vercel.app`), `PUBLIC_HOSTING_COMMERCIAL=false`. Leave `PUBLIC_GA4_ID`,
  `PUBLIC_ADSENSE_CLIENT` and `INDEXNOW_KEY` empty and `INDEXNOW_ENABLED=false`.
- **No ads, no GA4 and no affiliate links on Vercel Hobby.** Its terms do not allow commercial use.
- While `SITE_URL` ends in `.vercel.app`, every page is noindexed (meta robots and the
  `X-Robots-Tag` header in `vercel.json`). Do not add a custom domain until you are ready to lift it.
- When the GitHub repository is connected to the Vercel project, each push to `main` deploys.
- GitHub Actions: set the repository variable `SITE_URL` to the same origin. If it is empty, CI
  falls back to the reserved host `https://ci.screenwise.invalid` for that run only. The build scripts refuse that host on Vercel
  and without `SCREENWISE_CI_FALLBACK=1`, and `launch-check` fails on it.

CI runs lint, format check, `astro check`, `pnpm build` and the standard `seo-check` on every
branch. Lighthouse CI runs after it and does not block. The strict SEO gate and `launch-check`
run only in `pnpm build:prod`.

## Deploy: Cloudflare Pages (later)

When the domain exists and the plan allows the site to be indexed:

1. Set `SITE_URL` to `https://<the-domain>` (no trailing slash) in `.env`, Vercel or Cloudflare, and the GitHub variable.
2. Remove the `X-Robots-Tag` header from `vercel.json` if anything is still deployed there. `launch-check` requires that removal once `SITE_URL` is not a `.vercel.app` host.
3. Cloudflare Pages: build command `pnpm build:prod`, output `dist`, Node 22. `public/_headers` is applied by Pages (Vercel ignores it) and does **not** send `noindex`.
4. Set `PUBLIC_HOSTING_COMMERCIAL=true` only if that Cloudflare plan allows advertising. Then add `PUBLIC_ADSENSE_CLIENT`. `ads.txt` is generated at build time and is omitted while the client id is empty.
5. IndexNow: set `INDEXNOW_KEY` and `INDEXNOW_ENABLED=true` on the production build only.

`pnpm build:prod` is the production command. It runs the strict SEO gate and `launch-check`, so it fails on purpose while any article is `needs-human` or still has VERIFY markers.

## Content policy (hard rules)

Informational only. Never link to playlists, resellers or unlicensed services. Never invent
statistics, prices, reviews, quotes or channel counts. Articles are AI-assisted drafts that cite
their sources; one is marked approved only after hands-on testing and human review (see Review
workflow). Screenshots come only from that testing. `data/blocklist.txt` is enforced by both the
keyword plan and the SEO gate. See `/editorial-policy/` and `.cursorrules`.
