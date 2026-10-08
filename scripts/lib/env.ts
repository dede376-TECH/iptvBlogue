/**
 * Read an environment variable. Process env wins; otherwise the value is taken from a local
 * `.env` file. `tsx` scripts do not load `.env` on their own, and nothing here falls back to a
 * hardcoded URL.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

let fileEnv: Record<string, string> | undefined;

function loadFileEnv(): Record<string, string> {
  if (fileEnv) return fileEnv;
  fileEnv = {};
  for (const name of ['.env', '.env.local', '.env.production', '.env.production.local']) {
    const path = join(process.cwd(), name);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      fileEnv[key] = value;
    }
  }
  return fileEnv;
}

/** Empty string when unset. A value already in the environment is never replaced by `.env`. */
export function env(name: string): string {
  if (process.env[name] !== undefined) return process.env[name]!.trim();
  return loadFileEnv()[name]?.trim() ?? '';
}

export function requireSiteUrl(): string {
  const url = env('SITE_URL').replace(/\/$/, '');
  if (!url) {
    throw new Error(
      'SITE_URL is empty. Set it in the environment or in .env. Until a domain is bought, use the *.vercel.app URL from the Vercel project.',
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`SITE_URL is not an absolute URL: ${url}`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`SITE_URL must be http(s): ${url}`);
  }
  return url;
}

/** True for the temporary Vercel host. Those URLs are noindexed so they never compete with the domain. */
export function isTemporaryHost(siteUrl: string): boolean {
  try {
    const host = new URL(siteUrl).hostname.toLowerCase();
    return host === 'vercel.app' || host.endsWith('.vercel.app');
  } catch {
    return false;
  }
}
