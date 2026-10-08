/**
 * IndexNow submitter (Bing, Yandex, Seznam, Naver share the endpoint).
 *
 *   pnpm indexnow                        # submit every URL from dist/sitemap-*.xml
 *   pnpm indexnow -- --since 2026-10-01  # only URLs with lastmod >= date
 *   pnpm indexnow -- --url https://example.com/a/ --url https://example.com/b/
 *   pnpm indexnow -- --dry-run
 *
 * `--post-build` is used by `pnpm build`: it exits silently unless INDEXNOW_ENABLED=true and
 * INDEXNOW_KEY is set (so local and preview builds never ping search engines).
 *
 * The key file is served from /indexnow-key.txt (see src/pages/indexnow-key.txt.ts).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { walk } from './lib/content-index';

const DIST = join(process.cwd(), 'dist');
const ENDPOINT = 'https://api.indexnow.org/indexnow';
const BATCH = 10_000;

const argv = process.argv.slice(2);
const has = (f: string) => argv.includes(f);
const vals = (f: string) => argv.flatMap((a, i) => (a === f && argv[i + 1] ? [argv[i + 1]!] : []));

async function main() {
  const postBuild = has('--post-build');
  const key = process.env.INDEXNOW_KEY ?? '';
  const site = (process.env.SITE_URL ?? 'https://example.com').replace(/\/$/, '');
  const enabled = (process.env.INDEXNOW_ENABLED ?? '').toLowerCase() === 'true';

  if (postBuild && (!enabled || !key)) {
    console.log(
      '[indexnow] skipped (set INDEXNOW_ENABLED=true and INDEXNOW_KEY to ping after builds).',
    );
    return;
  }
  if (!key) {
    console.error('[indexnow] INDEXNOW_KEY is not set.');
    process.exit(1);
  }
  if (site.includes('example.com')) {
    console.error('[indexnow] SITE_URL is still the placeholder; refusing to submit.');
    process.exit(1);
  }

  let urls = vals('--url');
  if (urls.length === 0) {
    if (!existsSync(DIST)) {
      console.error('[indexnow] dist/ not found; run `pnpm build` first.');
      process.exit(1);
    }
    const since = vals('--since')[0] ? new Date(vals('--since')[0]!) : null;
    const files = walk(DIST, ['.xml']).filter(
      (f) => /sitemap-.*\.xml$/.test(f) && !f.endsWith('sitemap-index.xml'),
    );
    for (const f of files) {
      const xml = readFileSync(f, 'utf8');
      for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/g)) {
        const loc = /<loc>([^<]+)<\/loc>/.exec(m[1]!)?.[1];
        const lastmod = /<lastmod>([^<]+)<\/lastmod>/.exec(m[1]!)?.[1];
        if (!loc) continue;
        if (since && lastmod && new Date(lastmod) < since) continue;
        urls.push(loc);
      }
    }
  }
  urls = [...new Set(urls)].filter((u) => u.startsWith(site));
  if (urls.length === 0) {
    console.log('[indexnow] nothing to submit.');
    return;
  }

  const host = new URL(site).host;
  const keyLocation = `${site}/indexnow-key.txt`;
  console.log(
    `[indexnow] submitting ${urls.length} URL(s) for ${host}${has('--dry-run') ? ' (dry run)' : ''}`,
  );
  if (has('--dry-run')) {
    urls.forEach((u) => console.log('  ', u));
    return;
  }

  for (let i = 0; i < urls.length; i += BATCH) {
    const urlList = urls.slice(i, i + BATCH);
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList }),
    });
    // 200 OK, 202 Accepted (key validation pending). Anything else is an error.
    if (res.status === 200 || res.status === 202) {
      console.log(`[indexnow] batch ${i / BATCH + 1}: HTTP ${res.status}`);
    } else {
      console.error(
        `[indexnow] batch ${i / BATCH + 1} failed: HTTP ${res.status} ${await res.text()}`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((e) => {
  console.error('[indexnow]', e);
  process.exit(1);
});
