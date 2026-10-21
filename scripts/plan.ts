/**
 * Keyword plan builder: data/keywords_trends.csv -> content/plan.json
 *
 *   pnpm plan:build                 # rebuild the plan (keeps statuses of existing items)
 *   pnpm plan:build -- --limit 50   # cap the number of planned articles
 *   pnpm plan:build -- --csv data/keywords_trends.sample.csv   # alternative input
 *
 * Steps:
 *   1. Parse the CSV. Skip rows that are blocklisted, name a brand or a marketplace, are
 *      transactional, hunt for playlists/streams, or name a website.
 *   2. Normalise: strip years (2019-2025) and community-site modifiers (reddit, quora…), so
 *      "iptv buffering reddit 2023" and "iptv buffering" become one query.
 *   3. Skip head terms and bare hardware names unless listed in data/whitelist.txt.
 *   4. Group near-duplicates, then merge by entity (xmltv, epg, m3u, tivimate, smarters, kodi,
 *      firestick): one pillar per entity, the rest become satellites. `mergedFrom` lists what
 *      was folded into a pillar.
 *   5. Score and write the plan with per-cluster stats and a `skipped` list with reasons.
 *
 * Google Trends values are relative (0-100 within one request, or a growth percentage for
 * "rising"). They are not search volume and cannot be compared across requests, so the score
 * ignores them. See SCORING below. Titles are drafts for a human to rewrite.
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
const BRANDS = join(ROOT, 'data', 'blocklist-brands.txt');
const WHITELIST = join(ROOT, 'data', 'whitelist.txt');
const OUT_DIR = join(ROOT, 'content');
const OUT = join(OUT_DIR, 'plan.json');

type Intent = 'how-to' | 'what-is' | 'comparison' | 'troubleshooting' | 'legal';
type Geo = 'GB' | 'US' | 'GLOBAL';
type Role = 'pillar' | 'satellite' | 'standalone';

export interface PlanItem {
  title: string;
  slug: string;
  cluster: string;
  targetKeyword: string;
  secondaryKeywords: string[];
  intent: Intent;
  geo: Geo;
  /** Entity grouping: a pillar per entity, satellites point at it. */
  role: Role;
  entity?: string;
  pillarSlug?: string;
  /** Queries folded into this item, for audit. */
  mergedFrom?: string[];
  internalLinkTargets: string[];
  status: 'planned' | 'stubbed' | 'drafting' | 'published' | 'rejected';
  score: number;
  scoreParts: { seeds: number; geos: number; top: boolean; rising: boolean };
  sources: { seed: string; type: string; geo: string; value: number; query: string }[];
}

interface Row {
  raw: string;
  query: string;
  value: number;
  seed: string;
  type: 'top' | 'rising';
  geo: string;
}

interface Skipped {
  query: string;
  reason: string;
}

/**
 * Score = 3 per distinct seed + 2 per distinct geo + 2 if seen in "top" + 1 if seen in
 * "rising". A query that several seeds and both markets surface ranks higher. Raw Trends
 * values are recorded in `sources` for reference but never ranked on.
 */
const SCORING = {
  formula: '3 × distinct seeds + 2 × distinct geos + 2 if in top + 1 if in rising',
  note: 'Google Trends values are relative to each request (0-100, or growth % for rising). They are not search volume and are not used for ranking.',
};

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

/** Too broad to answer in one informational guide. */
const HEAD_TERMS = new Set([
  'iptv',
  'best iptv',
  'iptv uk',
  'iptv usa',
  'iptv us',
  'iptv tv',
  'iptv box',
  'iptv online',
]);

/** A bare device name is a product search, not a question. */
const HARDWARE = new Set([
  'firestick',
  'fire stick',
  'fire tv',
  'fire tv stick',
  'amazon firestick',
  'amazon fire stick',
  'roku',
  'chromecast',
  'apple tv',
  'android tv',
  'android box',
  'android tv box',
  'google tv',
  'smart tv',
  'samsung tv',
  'samsung smart tv',
  'lg tv',
  'lg smart tv',
  'nvidia shield',
  'mag box',
  'tv box',
  'firestick 4k',
  'firestick 4k max',
  'fire tv stick 4k',
  'fire tv stick 4k max',
  'onn 4k',
  'onn 4k pro',
  'onn box',
]);

/** Sideloading tools. The guides do not name installer apps. */
const INSTALLERS = new Set(['downloader', 'applinked', 'filelinked', 'unlinked']);

/**
 * "<word> iptv", "iptv <word>" or "<word>iptv": when the other word is not ordinary vocabulary,
 * the query is most likely a service or app brand. Skipped for a human to decide.
 */
const INFO_WORDS = new Set([
  'player',
  'players',
  'app',
  'apps',
  'epg',
  'm3u',
  'm3u8',
  'xmltv',
  'legal',
  'illegal',
  'buffering',
  'firestick',
  'smarters',
  'stream',
  'streams',
  'streaming',
  'channels',
  'guide',
  'setup',
  'meaning',
  'explained',
  'kodi',
  'tivimate',
]);
function brandLike(q: string): boolean {
  const words = q.split(' ');
  if (words.length === 1) return /iptv/.test(q) && q !== 'iptv';
  if (words.length !== 2 || !words.includes('iptv')) return false;
  const other = words.find((w) => w !== 'iptv')!;
  return !INFO_WORDS.has(other);
}

const YEARS = /(?<![\p{L}\p{N}])(?:2019|2020|2021|2022|2023|2024|2025)(?![\p{L}\p{N}])/gu;
const COMMUNITY = /(?<![\p{L}\p{N}])(?:reddit|quora|youtube|forum)(?![\p{L}\p{N}])/giu;
const WEBSITE =
  /(?<![\p{L}\p{N}])[a-z0-9-]+\.(?:com|net|org|be|tv|io|uk|co|xyz|me|info|eu|cc|to)(?![\p{L}\p{N}])/iu;

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

/** Entities merged into one pillar each, in priority order (first match wins). */
const ENTITIES: { id: string; re: RegExp; tokens: string[] }[] = [
  { id: 'xmltv', re: /\bxmltv\b/i, tokens: ['xmltv'] },
  { id: 'epg', re: /\bepg\b/i, tokens: ['epg'] },
  { id: 'm3u', re: /\bm3u8?\b/i, tokens: ['m3u', 'm3u8'] },
  { id: 'tivimate', re: /\btivimate\b/i, tokens: ['tivimate'] },
  { id: 'smarters', re: /\bsmarters\b/i, tokens: ['smarters'] },
  { id: 'kodi', re: /\bkodi\b/i, tokens: ['kodi'] },
  {
    id: 'firestick',
    re: /\b(fire ?stick|fire tv( stick)?)\b/i,
    tokens: ['firestick', 'fire', 'stick'],
  },
];
/** Words that do not change what a query is about; a query made only of these joins the pillar. */
const GENERIC = new Set([
  'iptv',
  'file',
  'files',
  'format',
  'playlist',
  'playlists',
  'list',
  'guide',
  'explained',
  'meaning',
  'app',
  'apps',
  'player',
  'tv',
  'pro',
  'amazon',
  'iptv',
]);

/** Topic rules evaluated in order; first match wins. */
const CLUSTER_RULES: { cluster: string; re: RegExp }[] = [
  {
    cluster: 'legal-streaming',
    re: /\b(legal|illegal|law|licen[cs]ed?|fast channels?|pluto|freevee|tubi|iplayer|itvx|channel 4|all 4|my5|bbc|free ad[- ]supported)\b/i,
  },
  {
    cluster: 'troubleshooting',
    re: /\b(buffer(ing)?|freez(e|ing)|stutter(ing)?|lag(ging)?|not (working|loading|showing|playing)|error|exception|fix|crash(es|ing)?|black screen|no sound|out of sync|keeps? (stopping|cutting))\b/i,
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

const TROUBLE =
  /\b(error|exception|not (working|loading|showing|playing)|fix(ed|ing)?|buffer(ing)?|freez(e|ing)|crash(es|ing)?|problem|issue|lag(ging)?|stutter(ing)?|black screen|no sound)\b/i;

function detectIntent(q: string, cluster: string): Intent {
  if (TROUBLE.test(q)) return 'troubleshooting';
  if (/\b(legal|illegal|law|licen[cs]ed?|fine|prosecut)/i.test(q)) return 'legal';
  if (/\b(vs|versus|compare|comparison|difference|better|best|alternative|cheaper)\b/i.test(q))
    return 'comparison';
  if (
    /\b(how to|install|set ?up|setup|configure|add|use|get|put|create|make|edit|build)\b/i.test(q)
  )
    return 'how-to';
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

function normalize(q: string): string {
  return q.replace(YEARS, ' ').replace(COMMUNITY, ' ').replace(/\s+/g, ' ').trim();
}

/** Keep a draft title within 60 characters, cutting at a word boundary. */
function fit(title: string, fallback: string): string {
  if (title.length <= 60) return title;
  if (fallback.length <= 60) return fallback;
  const cut = fallback.slice(0, 60);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 1)).trim();
}

/** Draft title per intent. A human rewrites it; it only needs to be keyword-first and sane. */
function draftTitle(q: string, intent: Intent, cluster: string): string {
  const base = titleCase(q);
  if (cluster === 'languages') return fit(`How to Watch ${base} Legally`, base);
  switch (intent) {
    case 'troubleshooting':
      if (/\bnot (working|loading|showing|playing)\b/i.test(q))
        return fit(`${base}? How to Fix It`, base);
      if (/\b(error|exception)\b/i.test(q))
        return fit(`${base}: What It Means and How to Fix It`, `${base}: How to Fix It`);
      return fit(`${base}: Causes and Fixes`, base);
    case 'how-to':
      if (/^how to\b/i.test(q)) return fit(base, base);
      if (/^(create|make|edit|build|add|install|use|set ?up)\b/i.test(q))
        return fit(`How to ${base}`, base);
      return fit(`${base}: Setup Guide`, base);
    case 'what-is':
      return /^what (is|are)\b/i.test(q)
        ? fit(`${base}?`, base)
        : fit(`${base} Explained in Plain English`, `${base} Explained`);
    case 'comparison':
      return /\b(vs|versus)\b/i.test(q)
        ? fit(`${base}: Key Differences`, base)
        : fit(`${base}: Options Compared`, base);
    case 'legal':
      return /^(is|are|can)\b/i.test(q)
        ? fit(`${base}? What Copyright Guidance Says`, `${base}?`)
        : fit(`${base}: Copyright Basics`, base);
  }
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
    const raw = (cells[qi] ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
    return {
      raw,
      query: normalize(raw),
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

function scoreOf(rows: Row[]): { score: number; parts: PlanItem['scoreParts'] } {
  const parts = {
    seeds: new Set(rows.map((r) => r.seed.toLowerCase())).size,
    geos: new Set(rows.map((r) => r.geo).filter(Boolean)).size,
    top: rows.some((r) => r.type === 'top'),
    rising: rows.some((r) => r.type === 'rising'),
  };
  const score = 3 * parts.seeds + 2 * parts.geos + (parts.top ? 2 : 0) + (parts.rising ? 1 : 0);
  return { score, parts };
}

function geoOf(rows: Row[]): Geo {
  const geos = new Set(rows.map((r) => r.geo));
  if (geos.has('GB') && geos.has('US')) return 'GLOBAL';
  if (geos.has('GB')) return 'GB';
  if (geos.has('US')) return 'US';
  return 'GLOBAL';
}

function entityOf(q: string) {
  return ENTITIES.find((e) => e.re.test(q));
}

/** True when the query says nothing beyond the entity and generic words. */
function isGenericFor(q: string, entity: (typeof ENTITIES)[number]): boolean {
  const extra = tokens(q).filter((t) => !entity.tokens.includes(t) && !GENERIC.has(t));
  return extra.length === 0;
}

interface Group {
  q: string;
  cluster: string;
  intent: Intent;
  toks: string[];
  rows: Row[];
  members: string[];
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
  const brands = phraseMatcher(loadBlocklist(BRANDS));
  const whitelist = new Set(loadBlocklist(WHITELIST));
  const transactional = phraseMatcher(TRANSACTIONAL);

  const skipped: Skipped[] = [];
  const skip = (query: string, reason: string) => {
    if (!skipped.some((s) => s.query === query && s.reason === reason))
      skipped.push({ query, reason });
  };

  /** Every filter, applied to primary and secondary keywords alike. Returns a reason or null. */
  function reject(raw: string, normalized: string): string | null {
    const b = blocked(raw);
    if (b.length) return `blocklist: ${b.join(', ')}`;
    const br = brands(raw);
    if (br.length) return `brand or marketplace: ${br.join(', ')}`;
    const t = transactional(raw);
    if (t.length) return `transactional: ${t.join(', ')}`;
    const s = sourceHunting(raw);
    if (s.length) return `source-hunting: ${s.join(', ')}`;
    if (WEBSITE.test(raw)) return 'names a website';
    if (!whitelist.has(normalized)) {
      if (HEAD_TERMS.has(normalized)) return 'head term';
      if (HARDWARE.has(normalized)) return 'bare hardware name';
      if (normalized.split(' ').some((w) => INSTALLERS.has(w))) return 'installer app name';
      if (brandLike(normalized)) return 'possible service or app brand (whitelist to keep)';
    }
    if (normalized.length < 3) return 'too short after removing years and site names';
    return null;
  }

  const allRows = parseCsv(CSV).filter((r) => r.raw.length >= 3);

  // 1. Row-level filters on the raw query, so a dated feed query cannot slip through after its
  //    year is stripped.
  const rows: Row[] = [];
  for (const r of allRows) {
    const reason = reject(r.raw, r.query);
    if (reason) skip(r.raw, reason);
    else rows.push(r);
  }

  // 2. Aggregate on the normalised query; years and community-site modifiers no longer split it.
  const agg = new Map<string, Row[]>();
  for (const r of rows) agg.set(r.query, [...(agg.get(r.query) ?? []), r]);
  for (const [q, rs] of agg) {
    const variants = [...new Set(rs.map((r) => r.raw))].filter((v) => v !== q);
    for (const v of variants) skip(v, `merged duplicate of "${q}" (year or site name removed)`);
  }

  const candidates = [...agg.entries()]
    .map(([q, rs]) => {
      const seedFallback = seedCluster.get(rs[0]!.seed.toLowerCase()) ?? 'technical';
      const detected = detectCluster(q, seedFallback);
      const cluster = clusterIds.has(detected) ? detected : 'technical';
      return { q, rows: rs, cluster, intent: detectIntent(q, cluster), toks: tokens(q) };
    })
    .sort((x, y) => scoreOf(y.rows).score - scoreOf(x.rows).score || x.q.length - y.q.length);

  // 3. Group near-duplicates: a query joins an existing group when Jaccard >= 0.5 on tokens.
  const groups: Group[] = [];
  for (const c of candidates) {
    const g = groups.find((grp) => grp.cluster === c.cluster && jaccard(grp.toks, c.toks) >= 0.5);
    if (g) {
      g.members.push(c.q);
      g.rows.push(...c.rows);
    } else groups.push({ ...c, members: [] });
  }

  // 4. Merge by entity: generic queries fold into one pillar, specific ones become satellites.
  const roles = new Map<Group, { role: Role; entity?: string; pillar?: Group; merged: string[] }>();
  for (const entity of ENTITIES) {
    const own = groups.filter((g) => entityOf(g.q)?.id === entity.id && !roles.has(g));
    if (own.length === 0) continue;
    const generic = own.filter((g) => isGenericFor(g.q, entity));
    const byScore = (a: Group, b: Group) => scoreOf(b.rows).score - scoreOf(a.rows).score;
    const pillar = [...(generic.length ? generic : own)].sort(byScore)[0]!;
    const merged: string[] = [];
    for (const g of generic) {
      if (g === pillar) continue;
      merged.push(g.q, ...g.members);
      pillar.members.push(g.q, ...g.members);
      pillar.rows.push(...g.rows);
      roles.set(g, { role: 'standalone', merged: [] }); // consumed below
    }
    roles.set(pillar, { role: 'pillar', entity: entity.id, merged });
    for (const g of own) {
      if (g === pillar || generic.includes(g)) continue;
      roles.set(g, { role: 'satellite', entity: entity.id, pillar, merged: [] });
    }
  }
  const consumed = new Set(
    [...roles.entries()]
      .filter(([g, r]) => r.role === 'standalone' && entityOf(g.q))
      .map(([g]) => g),
  );
  const finalGroups = groups
    .filter((g) => !consumed.has(g))
    .sort((a, b) => scoreOf(b.rows).score - scoreOf(a.rows).score || a.q.length - b.q.length)
    .slice(0, limit);

  // 5. Build plan items, keeping statuses (and titles once work has started) from a previous plan.
  const previous: PlanItem[] = existsSync(OUT)
    ? ((JSON.parse(readFileSync(OUT, 'utf8')) as { items?: PlanItem[] }).items ?? [])
    : [];
  const prevBySlug = new Map(previous.map((p) => [p.slug, p]));
  const pillarFor = (cluster: string) =>
    clusters.find((c) => c.id === cluster)?.data.pillar as string | undefined;
  const slugOf = (g: Group) => slugify(g.q);

  const items: PlanItem[] = finalGroups.map((g) => {
    const slug = slugOf(g);
    const prev = prevBySlug.get(slug);
    const info = roles.get(g) ?? { role: 'standalone' as Role, merged: [] };
    const { score, parts } = scoreOf(g.rows);

    const secondary: string[] = [];
    for (const m of [...new Set(g.members)]) {
      if (m === g.q) continue;
      const reason = reject(m, m);
      if (reason) skip(m, `secondary keyword dropped: ${reason}`);
      else secondary.push(m);
    }

    const existingInCluster = existing
      .filter((a) => a.cluster === g.cluster && a.slug !== slug)
      .slice(0, 2);
    const targets = [
      `/${g.cluster}/`,
      ...(pillarFor(g.cluster) ? [`/${pillarFor(g.cluster)}/`] : []),
      ...(info.pillar ? [`/${info.pillar.cluster}/${slugOf(info.pillar)}/`] : []),
      ...existingInCluster.map((a) => a.path),
      '/legal-streaming/is-iptv-legal/',
    ];
    const started = prev && prev.status !== 'planned';
    return {
      title: started ? prev.title : draftTitle(g.q, g.intent, g.cluster),
      slug,
      cluster: g.cluster,
      targetKeyword: g.q,
      secondaryKeywords: secondary.slice(0, 10),
      intent: g.intent,
      geo: geoOf(g.rows),
      role: info.role,
      ...(info.entity ? { entity: info.entity } : {}),
      ...(info.pillar ? { pillarSlug: slugOf(info.pillar) } : {}),
      ...(info.merged.length ? { mergedFrom: [...new Set(info.merged)] } : {}),
      internalLinkTargets: [...new Set(targets)],
      status: prev?.status ?? (existingSlugs.has(slug) ? 'published' : 'planned'),
      score,
      scoreParts: parts,
      sources: g.rows.map((r) => ({
        query: r.raw,
        seed: r.seed,
        type: r.type,
        geo: r.geo,
        value: r.value,
      })),
    };
  });

  const perCluster: Record<
    string,
    { items: number; pillars: number; satellites: number; standalone: number; keywords: number }
  > = {};
  for (const i of items) {
    const c = (perCluster[i.cluster] ??= {
      items: 0,
      pillars: 0,
      satellites: 0,
      standalone: 0,
      keywords: 0,
    });
    c.items++;
    c[i.role === 'pillar' ? 'pillars' : i.role === 'satellite' ? 'satellites' : 'standalone']++;
    c.keywords += 1 + i.secondaryKeywords.length;
  }
  const reasons = skipped.reduce<Record<string, number>>((acc, s) => {
    const key = s.reason.split(':')[0]!.replace(/ ".*$/, '');
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        source: 'data/keywords_trends.csv',
        scoring: SCORING,
        stats: {
          rows: allRows.length,
          uniqueQueries: agg.size,
          planned: items.length,
          skipped: skipped.length,
          skippedByReason: reasons,
          perCluster,
        },
        items,
        skipped,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Plan written to content/plan.json: ${items.length} items, ${skipped.length} skipped, ${agg.size} unique queries.`,
  );
  console.log('Per cluster:', perCluster);
  console.log('Skipped by reason:', reasons);
}

main();
