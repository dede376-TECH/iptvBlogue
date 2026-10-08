/**
 * URL builders. Every internal link in components goes through these helpers so the
 * URL structure (`/[cluster]/[slug]/`, trailing slashes) is defined in one place.
 */
export function clusterUrl(cluster: string): string {
  return `/${cluster}/`;
}

export function articleUrl(id: string): string {
  // id is `cluster/slug`
  return `/${id.replace(/^\/+|\/+$/g, '')}/`;
}

export function authorUrl(slug: string): string {
  return `/authors/${slug}/`;
}

export function pageUrl(slug: string): string {
  return `/${slug}/`;
}

/**
 * Order of the static pages in the footer. Labels come from the `pages` collection
 * (`navLabel` / `h1`) so no copy is hardcoded here.
 */
export const FOOTER_PAGE_ORDER = [
  'about',
  'editorial-policy',
  'contact',
  'privacy',
  'cookies',
  'disclaimer',
] as const;

export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(href);
}
