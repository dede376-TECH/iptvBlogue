/** Small text helpers shared by the CLI scripts. */

const STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'how',
  'what',
  'why',
  'does',
  'do',
  'my',
  'me',
  'i',
  'it',
  'vs',
  'versus',
  'can',
  'you',
  'your',
]);

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

export function tokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
}

export function jaccard(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  const inter = [...sa].filter((x) => sb.has(x)).length;
  const union = new Set([...sa, ...sb]).size;
  return union === 0 ? 0 : inter / union;
}

export function titleCase(input: string): string {
  const small = new Set([
    'a',
    'an',
    'and',
    'or',
    'of',
    'to',
    'in',
    'on',
    'for',
    'with',
    'vs',
    'the',
  ]);
  const upper = new Map([
    ['iptv', 'IPTV'],
    ['m3u', 'M3U'],
    ['m3u8', 'M3U8'],
    ['epg', 'EPG'],
    ['xmltv', 'XMLTV'],
    ['tv', 'TV'],
    ['uk', 'UK'],
    ['us', 'US'],
    ['usa', 'USA'],
    ['hls', 'HLS'],
    ['vlc', 'VLC'],
    ['ott', 'OTT'],
    ['vpn', 'VPN'],
    ['dns', 'DNS'],
    ['apk', 'APK'],
    ['ios', 'iOS'],
    ['tivimate', 'TiviMate'],
    ['firestick', 'Firestick'],
    ['kodi', 'Kodi'],
    ['lg', 'LG'],
  ]);
  return input
    .split(/\s+/)
    .map((w, i) => {
      const lw = w.toLowerCase();
      if (upper.has(lw)) return upper.get(lw)!;
      if (i > 0 && small.has(lw)) return lw;
      return lw.charAt(0).toUpperCase() + lw.slice(1);
    })
    .join(' ');
}

/** Escape a string for use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matcher for a list of phrases. */
export function phraseMatcher(phrases: string[]): (text: string) => string[] {
  const res = phrases.map((p) => ({
    p,
    re: new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(p)}(?![\\p{L}\\p{N}])`, 'iu'),
  }));
  return (text: string) => res.filter(({ re }) => re.test(text)).map(({ p }) => p);
}
