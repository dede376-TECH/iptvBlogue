/**
 * Minimal Pagefind UI. Loaded only on /search/. Uses the Pagefind JS API (generated into
 * /pagefind/ by `pagefind --site dist` after `astro build`) instead of the default UI bundle to
 * keep JS small. In `astro dev` the index does not exist, so a notice is shown instead.
 */

interface PagefindResultData {
  url: string;
  excerpt: string;
  meta: { title?: string; image?: string };
}
interface PagefindResult {
  id: string;
  data: () => Promise<PagefindResultData>;
}
interface Pagefind {
  init: () => Promise<void>;
  search: (q: string) => Promise<{ results: PagefindResult[] }>;
  options: (o: Record<string, unknown>) => Promise<void>;
}

const input = document.querySelector<HTMLInputElement>('#search-input');
const results = document.querySelector<HTMLElement>('#search-results');
const status = document.querySelector<HTMLElement>('#search-status');

let pagefind: Pagefind | null = null;

async function load(): Promise<Pagefind | null> {
  if (pagefind) return pagefind;
  try {
    // Runtime path only (generated post-build); keep it out of TS/Vite module resolution.
    const bundlePath = '/pagefind/pagefind.js';
    const mod = (await import(/* @vite-ignore */ bundlePath)) as Pagefind;
    await mod.options({ excerptLength: 30 });
    await mod.init();
    pagefind = mod;
    return pagefind;
  } catch {
    if (status)
      status.textContent =
        'Search index not available. Run a production build (pnpm build) to generate it.';
    return null;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

let seq = 0;
async function run(q: string) {
  if (!results || !status) return;
  const query = q.trim();
  if (query.length < 2) {
    results.innerHTML = '';
    status.textContent = '';
    return;
  }
  const pf = await load();
  if (!pf) return;
  const current = ++seq;
  status.textContent = 'Searching…';
  const res = await pf.search(query);
  if (current !== seq) return;
  const top = await Promise.all(res.results.slice(0, 10).map((r) => r.data()));
  if (current !== seq) return;
  status.textContent = `${res.results.length} result${res.results.length === 1 ? '' : 's'} for "${query}"`;
  results.innerHTML = top
    .map(
      (r) => `
      <li class="card">
        <a class="font-semibold text-slate-900 hover:text-brand-700 hover:underline" href="${escapeHtml(r.url)}">${escapeHtml(r.meta.title ?? r.url)}</a>
        <p class="mt-1 text-sm text-slate-600">${r.excerpt}</p>
      </li>`,
    )
    .join('');
  const url = new URL(location.href);
  url.searchParams.set('q', query);
  history.replaceState(null, '', url);
}

if (input) {
  let timer: number | undefined;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => run(input.value), 200);
  });
  const initial = new URLSearchParams(location.search).get('q');
  if (initial) {
    input.value = initial;
    void run(initial);
  }
  // Warm the index on focus so the first keystroke feels instant.
  input.addEventListener('focus', () => void load(), { once: true });
}

export {};
