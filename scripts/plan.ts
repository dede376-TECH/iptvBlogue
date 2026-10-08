/**
 * Keyword plan builder: data/keywords_trends.csv -> content/plan.json
 *
 *   pnpm plan:build                 # rebuild the plan (keeps statuses of existing items)
 *   pnpm plan:build -- --limit 50   # cap the number of planned articles
 *   pnpm plan:build -- --csv data/keywords_trends.sample.csv   # alternative input
 *
 * Steps: parse CSV, normalise + dedupe queries, drop blocklisted/transactional ones, group
 * near-duplicates (secondary keywords), assign cluster + intent, rank (rising first, then
 * value) and write the plan. Titles are drafts for a human to rewrite.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { indexArticles, indexClusters, loadBlocklist, ROOT } from './lib/content-index';
import { jaccard, phraseMatcher, slugify, titleCase, tokens } from './lib/text';

const csvArg = process.argv.indexOf('--csv');
const CSV =
  csvArg > -1
    ? resolve(ROOT, process.argv[csvArg + 1]!)
    : join(ROOT, 'data', 'keywords_trends.csv');
const SEEDS = join(ROOT, 'data', 'seeds.json');
const OUT_DIR = join(ROOT, 'content');
const OUT = join(OUT_DIR, 'plan.json');

type Intent = 'how-to' | 'what-is' | 'comparison' | 'troubleshooting' | 'legal';
type Geo = 'GB' | 'US' | 'GLOBAL';

export interface PlanItem {
  title: string;
  slug: string;
  cluster: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  intent: Intent;
  geo: Geo;
  internalLinkTargets: string[];
  status: 'planned' | 'stubbed' | 'drafting' | 'published' | 'rejected';
  priority: number;
  sources: { seed: string; type: string; geo: string; value: number }[];
}

interface Row {
  query: string;
  value: number;
  seed: string;
  type: 'top' | 'rising';
  geo: string;
}

/** Transactional / navigational modifiers that are not informational content targets. */
const TRANSACTIONAL = [
  'buy',
  'cheap',
  'cheapest',
  'price',
  'prices',
  'pricing',
  'subscription',
  'subscriptions',
  'provider',
  'providers',
  'service',
  'services',
  'seller',
  'sellers',
  'deal',
  'deals',
  'discount',
  'coupon',
  'promo',
  'review',
  'reviews',
  'trial',
  'apk download',
  'download apk',
];

/**
 * Playlist/stream *source hunting* – people looking for a feed to consume rather than for an
 * explanation. These are rejected regardless of the phrase blocklist, because the vocabulary is
 * open-ended (every year, broadcaster and country spawns new variants). Each entry is a pair of
 * token groups that must both appear (in any order).
 */
const FEED = String.raw`(?:m3u8?|playlists?|channel lists?|links?|urls?|streams?)`;
const SOURCE_HUNTING: { reason: string; a: string; b: string }[] = [
  { reason: 'free feed', a: String.raw`free|gratis|no subscription|without subscription`, b: FEED },
  {
    reason: 'feed repository',
    a: String.raw`github|gitlab|reddit|telegram|pastebin|discord|forum|dropbox|mega`,
    b: FEED,
  },
  { reason: 'dated feed', a: String.raw`20\d\d`, b: FEED },
  {
    reason: 'channel count',
    a: String.raw`\d{1,3}(?:[,.]\d{3})+|\d+k\+?|\d{3,}\+? channels?`,
    b: FEED,
  },
  {
    reason: 'fresh feed',
    a: String.raw`working|updated|daily|latest|new|fresh|download|list`,
    b: String.raw`m3u8?|playlists?`,
  },
  {
    reason: 'broadcaster feed',
    a: String.raw`sky|bt sport|tnt sports?|bein|dazn|espn|hbo|netflix|disney|paramount|peacock|airtel|jio|tata|dstv|canal\+?|movistar|sling|directv|premier league|epl|nba|nfl|ufc|ppv|f1|formula 1`,
    b: String.raw`iptv|m3u8?|playlists?`,
  },
  {
    reason: 'regional feed',
    a: String.raw`uk|usa?|united kingdom|united states|british|american|india|indian|pakistan|pakistani|arabic|arab|turkish|turkey|german|germany|french|france|spanish|spain|italian|italy|polish|poland|portugu[eê]s|brazil|latino|africa|nigeria|canada|canadian|australia`,
    b: String.raw`m3u8?|playlists?|channel lists?`,
  },
];
const sourceHunting = (() => {
  const word = (alt: string) => String.raw`(?<![\p{L}\p{N}])(?:${alt})(?![\p{L}\p{N}])`;
  const compiled = SOURCE_HUNTING.map(({ reason, a, b }) => ({
    reason,
    re: new RegExp(`${word(a)}.*${word(b)}|${word(b)}.*${word(a)}`, 'iu'),
  }));
  return (q: string) => compiled.filter((c) => c.re.test(q)).map((c) => c.reason);
})();

/** Topic rules evaluated in order; first match wins. */
const CLUSTER_RULES: { cluster: string; re: RegExp }[] = [
  {
    cluster: 'legal-streaming',
    re: /\b(legal|illegal|law|licen[cs]ed?|fast channels?|pluto|freevee|tubi|iplayer|itvx|channel 4|all 4|my5|bbc|free ad[- ]supported)\b/i,
  },
  {
    cluster: 'troubleshooting',
    re: /\b(buffer(ing)?|freez(e|ing)|stutter(ing)?|lag(ging)?|not (working|loading|showing|playing)|error|fix|crash(es|ing)?|black screen|no sound|out of sync|keeps? (stopping|cutting))\b/i,
  },
  {
    cluster: 'setup',
    re: /\b(firestick|fire tv|fire stick|android tv|google tv|smart tv|samsung|lg|tizen|webos|apple tv|iphone|ipad|ios|roku|chromecast|nvidia shield|install(ing)?|set ?up|how to (add|use|install|put|get))\b/i,
  },
  {
    cluster: 'players',
    re: /\b(tivimate|ott navigator|kodi|vlc|perfect player|gse|iptv smarters|smarters|xciptv|implayer|flex iptv|sparkle|televizo|player|app|apps|best .*(app|player))\b/i,
  },
  {
    cluster: 'languages',
    re: /\b(arabic|turkish|polish|hindi|urdu|punjabi|bengali|tamil|spanish|portuguese|french|italian|german|greek|russian|chinese|korean|japanese|african|nigerian|indian|pakistani|international|diaspora|foreign|latino|desi)\b/i,
  },
  {
    cluster: 'technical',
    re: /\b(m3u8?|epg|xmltv|tvg[- ]?id|playlist|hls|mpeg[- ]?ts|dash|codec|bitrate|format|url|xtream|stalker|portal|catch[- ]?up|timeshift|validate|validator|editor)\b/i,
  },
  {
    cluster: 'cord-cutting',
    re: /\b(cable|satellite|sky|virgin media|comcast|xfinity|dish|directv|cord ?cutting|cut the cord|cost|cheaper|compare|comparison|vs|versus|alternative)\b/i,
  },
];

function detectIntent(q: string, cluster: string): Intent {
  if (/\b(legal|illegal|law|licen[cs]ed?|fine|prosecut)/i.test(q)) return 'legal';
  if (
    /\b(not (working|loading|showing)|buffer|freez|fix|error|crash|problem|issue|lag|stutter)/i.test(
      q,
    )
  )
    return 'troubleshooting';
  if (/\b(vs|versus|compare|comparison|difference|better|best|alternative|cheaper)\b/i.test(q))
    return 'comparison';
  if (/\b(how to|install|set ?up|setup|configure|add|use|get|put)\b/i.test(q)) return 'how-to';
  if (/\b(what is|what are|meaning|explained|definition|does)\b/i.test(q)) return 'what-is';
  if (cluster === 'setup' || cluster === 'languages') return 'how-to';
  if (cluster === 'troubleshooting') return 'troubleshooting';
  if (cluster === 'legal-streaming') return 'legal';
  if (cluster === 'cord-cutting') return 'comparison';
  return 'what-is';
}

function detectCluster(q: string, fallback: string): string {
  for (const rule of CLUSTER_RULES) if (rule.re.test(q)) return rule.cluster;
  return fallback;
}

/** Draft title (<= 60 chars). A human rewrites it; this only needs to be sane and keyword-first. */
function draftTitle(q: string, intent: Intent, cluster: string): string {
  const base = titleCase(q.replace(/\s+/g, ' ').trim());
  let title: string;
  if (cluster === 'languages') title = `How to Watch ${base} Legally`;
  else {
    switch (intent) {
      case 'how-to':
        title = /^how to/i.test(base) ? base : `${base}: Step-by-Step Setup Guide`;
        break;
      case 'what-is':
        title = /^what (is|are)/i.test(base) ? `${base}?` : `${base}: What It Is and How It Works`;
        break;
      case 'troubleshooting':
        title = `${base}: Causes and Fixes`;
        break;
      case 'comparison':
        title = /\b(vs|versus)\b/i.test(base)
          ? `${base}: Which Is Better?`
          : `${base}: Honest Comparison`;
        break;
      case 'legal':
        title = /^(is|are|can)\b/i.test(base)
          ? `${base}? What the Law Says`
          : `${base}: What the Law Says`;
        break;
    }
  }
  return title.length > 60 ? base.slice(0, 60) : title;
}

function parseCsv(file: string): Row[] {
  const text = readFileSync(file, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const header =
    lines
      .shift()
      ?.split(',')
      .map((h) => h.trim()) ?? [];
  const idx = (name: string) => header.indexOf(name);
  const qi = idx('query'),
    vi = idx('value'),
    si = idx('seed'),
    ti = idx('type'),
    gi = idx('geo');
  if ([qi, vi, si, ti, gi].some((i) => i < 0))
    throw new Error(`CSV header must be: query,value,seed,type,geo (got "${header.join(',')}")`);
  return lines.map((line) => {
    const cells = splitCsvLine(line);
    return {
      query: (cells[qi] ?? '').trim().toLowerCase(),
      value: Number(cells[vi] ?? 0) || 0,
      seed: (cells[si] ?? '').trim(),
      type: ((cells[ti] ?? 'top').trim() as Row['type']) === 'rising' ? 'rising' : 'top',
      geo: (cells[gi] ?? '').trim().toUpperCase(),
    };
  });
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function main() {
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : Infinity;

  if (!existsSync(CSV)) {
    console.error(`Missing ${CSV}. Run \`pnpm trends\` first (requires Python + pytrends).`);
    process.exit(1);
  }
  const seedsJson = JSON.parse(readFileSync(SEEDS, 'utf8')) as {
    seeds: { seed: string; cluster: string }[];
  };
  const seedCluster = new Map(seedsJson.seeds.map((s) => [s.seed.toLowerCase(), s.cluster]));
  const clusters = indexClusters();
  const clusterIds = new Set(clusters.map((c) => c.id));
  const existing = indexArticles({ includeDrafts: true });
  const existingSlugs = new Set(existing.map((a) => a.slug));
  const blocked = phraseMatcher(loadBlocklist());
  const transactional = phraseMatcher(TRANSACTIONAL);

  const rows = parseCsv(CSV).filter((r) => r.query.length >= 3);

  // 1. Aggregate identical queries across seeds/geos.
  const agg = new Map<string, { rows: Row[]; geos: Set<string>; rising: boolean; value: number }>();
  for (const r of rows) {
    const key = r.query.replace(/\s+/g, ' ');
    const a = agg.get(key) ?? { rows: [], geos: new Set(), rising: false, value: 0 };
    a.rows.push(r);
    a.geos.add(r.geo);
    if (r.type === 'rising') a.rising = true;
    a.value = Math.max(a.value, r.type === 'top' ? r.value : Math.min(r.value, 100) + 100);
    agg.set(key, a);
  }

  // 2. Filter + score.
  const rejected: { query: string; reason: string }[] = [];
  const candidates = [...agg.entries()]
    .filter(([q]) => {
      const b = blocked(q);
      if (b.length)
        return (rejected.push({ query: q, reason: `blocklist: ${b.join(', ')}` }), false);
      const t = transactional(q);
      if (t.length)
        return (rejected.push({ query: q, reason: `transactional: ${t.join(', ')}` }), false);
      const s = sourceHunting(q);
      if (s.length)
        return (rejected.push({ query: q, reason: `source-hunting: ${s.join(', ')}` }), false);
      return true;
    })
    .map(([q, a]) => {
      const seedFallback = seedCluster.get(a.rows[0]!.seed.toLowerCase()) ?? 'technical';
      const cluster = detectCluster(q, seedFallback);
      const intent = detectIntent(q, cluster);
      const geo: Geo =
        a.geos.has('GB') && a.geos.has('US')
          ? 'GLOBAL'
          : a.geos.has('GB')
            ? 'GB'
            : a.geos.has('US')
              ? 'US'
              : 'GLOBAL';
      const priority = (a.rising ? 1000 : 0) + a.value + (a.geos.size > 1 ? 50 : 0);
      return {
        q,
        a,
        cluster: clusterIds.has(cluster) ? cluster : 'technical',
        intent,
        geo,
        priority,
        toks: tokens(q),
      };
    })
    .sort((x, y) => y.priority - x.priority);

  // 3. Group near-duplicates: a query joins an existing group when Jaccard >= 0.5 on tokens.
  const groups: (typeof candidates)[] = [];
  for (const c of candidates) {
    const g = groups.find(
      (grp) => grp[0]!.cluster === c.cluster && jaccard(grp[0]!.toks, c.toks) >= 0.5,
    );
    if (g) g.push(c);
    else groups.push([c]);
  }

  // 4. Build plan items, keeping statuses from a previous plan.
  const previous: PlanItem[] = existsSync(OUT)
    ? ((JSON.parse(readFileSync(OUT, 'utf8')) as { items: PlanItem[] }).items ?? [])
    : [];
  const prevBySlug = new Map(previous.map((p) => [p.slug, p]));
  const hubFor = (cluster: string) => `/${cluster}/`;
  const pillarFor = (cluster: string) =>
    clusters.find((c) => c.id === cluster)?.data.pillar as string | undefined;

  const items: PlanItem[] = groups.slice(0, limit).map((g) => {
    const primary = g[0]!;
    const slug = slugify(primary.q);
    const prev = prevBySlug.get(slug);
    const existingInCluster = existing
      .filter((a) => a.cluster === primary.cluster && a.slug !== slug)
      .slice(0, 2);
    const targets = [
      hubFor(primary.cluster),
      ...(pillarFor(primary.cluster) ? [`/${pillarFor(primary.cluster)}/`] : []),
      ...existingInCluster.map((a) => a.path),
      '/legal-streaming/is-iptv-legal/',
    ];
    return {
      title: prev?.title ?? draftTitle(primary.q, primary.intent, primary.cluster),
      slug,
      cluster: primary.cluster,
      targetKeyword: primary.q,
      secondaryKeywords: g.slice(1, 8).map((x) => x.q),
      intent: primary.intent,
      geo: primary.geo,
      internalLinkTargets: [...new Set(targets)],
      status: prev?.status ?? (existingSlugs.has(slug) ? 'published' : 'planned'),
      priority: primary.priority,
      sources: primary.a.rows.map((r) => ({
        seed: r.seed,
        type: r.type,
        geo: r.geo,
        value: r.value,
      })),
    };
  });

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'data/keywords_trends.csv',
        stats: {
          rows: rows.length,
          uniqueQueries: agg.size,
          rejected: rejected.length,
          planned: items.length,
        },
        items,
        rejected,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Plan written to content/plan.json: ${items.length} items (${rejected.length} rejected, ${agg.size} unique queries).`,
  );
  const byCluster = items.reduce<Record<string, number>>(
    (acc, i) => ((acc[i.cluster] = (acc[i.cluster] ?? 0) + 1), acc),
    {},
  );
  console.log('Per cluster:', byCluster);
}

main();
