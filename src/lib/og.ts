/**
 * Open Graph image rendering (1200x630) with Satori + resvg. Build-time only.
 * Fonts: the self-hosted Inter WOFF files shipped by @fontsource (Satori cannot read WOFF2).
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { SITE } from './site';

const require = createRequire(import.meta.url);

let fontsPromise: Promise<{ regular: ArrayBuffer; bold: ArrayBuffer }> | null = null;
async function loadFonts() {
  if (!fontsPromise) {
    fontsPromise = (async () => {
      const regularPath = require.resolve('@fontsource/inter/files/inter-latin-400-normal.woff');
      const boldPath = require.resolve('@fontsource/inter/files/inter-latin-700-normal.woff');
      const [r, b] = await Promise.all([readFile(regularPath), readFile(boldPath)]);
      return { regular: toArrayBuffer(r), bold: toArrayBuffer(b) };
    })();
  }
  return fontsPromise;
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

export interface OgInput {
  title: string;
  kicker?: string;
  footer?: string;
}

type Node = { type: string; props: Record<string, unknown> };
const el = (type: string, style: Record<string, unknown>, children?: unknown): Node => ({
  type,
  props: { style, children },
});

export async function renderOgPng(input: OgInput): Promise<Buffer> {
  const fonts = await loadFonts();
  const title = input.title.length > 90 ? `${input.title.slice(0, 87)}…` : input.title;
  const titleSize = title.length > 60 ? 52 : 64;

  const tree = el(
    'div',
    {
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px',
      background: 'linear-gradient(135deg, #0f766e 0%, #134e4a 100%)',
      color: '#ffffff',
      fontFamily: 'Inter',
    },
    [
      el(
        'div',
        { display: 'flex', fontSize: 28, fontWeight: 400, opacity: 0.9 },
        input.kicker ?? SITE.name,
      ),
      el(
        'div',
        {
          display: 'flex',
          fontSize: titleSize,
          fontWeight: 700,
          lineHeight: 1.15,
          letterSpacing: '-0.02em',
        },
        title,
      ),
      el('div', { display: 'flex', justifyContent: 'space-between', fontSize: 26, opacity: 0.9 }, [
        el('div', { display: 'flex' }, input.footer ?? SITE.url.replace(/^https?:\/\//, '')),
        el('div', { display: 'flex' }, 'Informational guides · No subscriptions sold'),
      ]),
    ],
  );

  const svg = await satori(tree as never, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: fonts.regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: fonts.bold, weight: 700, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
  return Buffer.from(png);
}
