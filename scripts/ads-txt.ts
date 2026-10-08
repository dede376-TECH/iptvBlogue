/**
 * Write dist/ads.txt from PUBLIC_ADSENSE_CLIENT after the build.
 * Omitted when the publisher id is empty or the host is flagged non-commercial,
 * so a static placeholder is never shipped.
 *
 * The certification-authority id is Google's published ads.txt value. Confirm the
 * finished line in the AdSense account before relying on it.
 */
import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { env } from './lib/env';

const out = join(process.cwd(), 'dist', 'ads.txt');
const client = env('PUBLIC_ADSENSE_CLIENT');
const commercial = env('PUBLIC_HOSTING_COMMERCIAL') === 'true';

if (existsSync(out)) unlinkSync(out);

if (!client || !commercial) {
  console.log('[ads.txt] omitted (advertising is off).');
  process.exit(0);
}

const publisher = client.replace(/^ca-/, '');
const line = `google.com, ${publisher}, DIRECT, f08c47fec0942fa0\n`;
writeFileSync(out, line);
console.log('[ads.txt] wrote one Google AdSense line.');
