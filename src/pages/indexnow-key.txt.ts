/**
 * IndexNow key file. The key is read from the INDEXNOW_KEY env var at build time, so the same
 * value is used by scripts/indexnow.ts (`keyLocation` points here).
 */
import type { APIRoute } from 'astro';

export const GET: APIRoute = () => {
  const key = process.env.INDEXNOW_KEY ?? '';
  return new Response(key, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
