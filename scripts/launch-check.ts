/**
 * Launch checklist. Fails if the site still carries placeholders or if ads are enabled on a
 * host that is flagged non-commercial.
 *
 *   pnpm launch-check
 *
 * Scans the site source and, when present, the built dist/. Generator scripts are skipped:
 * they contain the marker text on purpose.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { env, isTemporaryHost, requireSiteUrl } from './lib/env';

const ROOT = process.cwd();

const RULES: { id: string; re: RegExp }[] = [
  { id: 'example.com', re: /example\.com/i },
  { id: 'TODO_REPLACE', re: /TODO_REPLACE/ },
  { id: 'TODO', re: /\bTODO\b/ },
  { id: 'old brand', re: /IPTV Blogue/i },
  { id: 'old brand', re: /IPTVBlogue/ },
  { id: 'editorial-team', re: /editorial-team/i },
];

const SCAN_DIRS = ['src', 'public'];
const SCAN_FILES = [
  '.env.example',
  'astro.config.ts',
  'vercel.json',
  'package.json',
  'README.md',
  join('.github', 'workflows', 'ci.yml'),
];
const DIST_EXT = new Set(['.html', '.txt', '.xml', '.js', '.css', '.svg']);

function inDist(file: string): boolean {
  const rel = relative(ROOT, file);
  return rel === 'dist' || rel.startsWith(`dist${sep}`);
}

function skippedDist(file: string): boolean {
  const rel = relative(ROOT, file);
  return rel.startsWith(`dist${sep}pagefind${sep}`) || rel.startsWith(`dist${sep}og${sep}`);
}

type Hit = { rule: string; file: string; line: number; text: string };

const hits: Hit[] = [];
const checks: { ok: boolean; label: string }[] = [];

function check(ok: boolean, label: string) {
  checks.push({ ok, label });
}

function walk(dir: string, out: string[]) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (skippedDist(path)) continue;
    const st = statSync(path);
    if (st.isDirectory()) walk(path, out);
    else out.push(path);
  }
}

function scanFile(path: string) {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) {
        hits.push({
          rule: rule.id,
          file: relative(ROOT, path),
          line: i + 1,
          text: line.trim().slice(0, 140),
        });
      }
    }
  });
}

function main() {
  let site = '';
  try {
    site = requireSiteUrl();
    check(true, `SITE_URL is set (${site})`);
  } catch (error) {
    check(false, error instanceof Error ? error.message : 'SITE_URL is empty');
  }

  const files: string[] = [];
  for (const dir of SCAN_DIRS) walk(join(ROOT, dir), files);
  for (const file of SCAN_FILES) {
    const path = join(ROOT, file);
    if (existsSync(path)) files.push(path);
  }
  if (existsSync(join(ROOT, 'dist'))) walk(join(ROOT, 'dist'), files);
  for (const file of files) {
    const ext = file.slice(file.lastIndexOf('.'));
    if (inDist(file) && !DIST_EXT.has(ext)) continue;
    scanFile(file);
  }

  const byRule = new Map<string, Hit[]>();
  for (const hit of hits) {
    const list = byRule.get(hit.rule) ?? [];
    list.push(hit);
    byRule.set(hit.rule, list);
  }
  for (const rule of [...new Set(RULES.map((r) => r.id))]) {
    const found = byRule.get(rule) ?? [];
    check(
      found.length === 0,
      found.length === 0 ? `no "${rule}"` : `"${rule}" found in ${found.length} place(s)`,
    );
  }

  const commercial = env('PUBLIC_HOSTING_COMMERCIAL') === 'true';
  const adsense = env('PUBLIC_ADSENSE_CLIENT');
  const ga4 = env('PUBLIC_GA4_ID');
  const indexnow = env('INDEXNOW_ENABLED').toLowerCase() === 'true';
  const indexnowKey = env('INDEXNOW_KEY');
  const temporary = site ? isTemporaryHost(site) : false;

  check(
    !(adsense && !commercial),
    adsense && !commercial
      ? 'PUBLIC_ADSENSE_CLIENT is set while PUBLIC_HOSTING_COMMERCIAL is not true (no ads on a non-commercial host)'
      : 'advertising is off, or the host is flagged commercial',
  );

  const adsTxt = join(ROOT, 'dist', 'ads.txt');
  if (existsSync(adsTxt) && !commercial) {
    check(false, 'dist/ads.txt exists while hosting is non-commercial');
  } else {
    check(true, 'ads.txt is absent, or hosting is commercial');
  }

  if (existsSync(join(ROOT, 'dist'))) {
    const distText = files
      .filter((f) => inDist(f) && DIST_EXT.has(f.slice(f.lastIndexOf('.'))))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    if (!ga4 && /googletagmanager\.com\/gtag/.test(distText)) {
      check(false, 'GA4 script is in dist/ while PUBLIC_GA4_ID is empty');
    } else {
      check(true, 'GA4 script matches PUBLIC_GA4_ID');
    }
    if ((!adsense || !commercial) && /adsbygoogle\.js/.test(distText)) {
      check(false, 'AdSense script is in dist/ while advertising is off');
    } else {
      check(true, 'AdSense script matches the advertising switch');
    }
    if (temporary) {
      const html = files.filter((f) => inDist(f) && f.endsWith('.html'));
      const missing = html.filter((f) => !/noindex/i.test(readFileSync(f, 'utf8')));
      check(
        missing.length === 0,
        missing.length === 0
          ? 'temporary host pages are noindex'
          : `${missing.length} built page(s) missing noindex`,
      );
    }
  }

  let vercelRaw: string;
  try {
    vercelRaw = readFileSync(join(ROOT, 'vercel.json'), 'utf8');
  } catch {
    vercelRaw = '';
  }
  const hasRobotsTag = /X-Robots-Tag/.test(vercelRaw) && /noindex/.test(vercelRaw);
  if (temporary) {
    check(
      hasRobotsTag,
      'vercel.json sends X-Robots-Tag: noindex while SITE_URL is a *.vercel.app host',
    );
  } else if (site) {
    check(
      !hasRobotsTag,
      'vercel.json does not send X-Robots-Tag: noindex (SITE_URL is not a *.vercel.app host)',
    );
  }

  const articleFiles: string[] = [];
  walk(join(ROOT, 'src', 'content', 'articles'), articleFiles);
  const reviewHits: { file: string; line: number; text: string }[] = [];
  for (const file of articleFiles) {
    if (!file.endsWith('.mdx') && !file.endsWith('.md')) continue;
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/\bneeds-human\b/.test(line) || /\bVERIFY\b/.test(line)) {
        reviewHits.push({
          file: relative(ROOT, file),
          line: i + 1,
          text: line.trim().slice(0, 140),
        });
      }
    });
  }
  check(
    reviewHits.length === 0,
    reviewHits.length === 0
      ? 'no article still needs a human review'
      : `${reviewHits.length} needs-human or VERIFY marker(s) in articles`,
  );

  if (temporary && indexnow) {
    check(false, 'INDEXNOW_ENABLED is true on a *.vercel.app host');
  } else if (indexnow && !indexnowKey) {
    check(false, 'INDEXNOW_ENABLED is true but INDEXNOW_KEY is empty');
  } else {
    check(true, 'IndexNow is off, or it has a key on a non-temporary host');
  }

  console.log('Launch check');
  console.log('');
  for (const item of checks) {
    console.log(`${item.ok ? 'pass' : 'FAIL'}  ${item.label}`);
  }

  if (hits.length) {
    console.log('');
    console.log('Matches (first 40):');
    for (const hit of hits.slice(0, 40)) {
      console.log(`  ${hit.rule}  ${hit.file}:${hit.line}  ${hit.text}`);
    }
    if (hits.length > 40) console.log(`  … ${hits.length - 40} more`);
  }
  if (reviewHits.length) {
    console.log('');
    console.log('Review markers (first 40):');
    for (const hit of reviewHits.slice(0, 40)) {
      console.log(`  ${hit.file}:${hit.line}  ${hit.text}`);
    }
    if (reviewHits.length > 40) console.log(`  … ${reviewHits.length - 40} more`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log('');
  console.log(failed === 0 ? 'PASSED' : `FAILED (${failed} check(s))`);
  process.exit(failed === 0 ? 0 : 1);
}

main();
