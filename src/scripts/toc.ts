const groups = document.querySelectorAll<HTMLElement>('.toc-h2');
const owner = new Map<string, string>();

groups.forEach((item) => {
  const slug = item.dataset.slug;
  if (!slug) return;
  owner.set(slug, slug);
  item.querySelectorAll<HTMLAnchorElement>('.toc-h3 a').forEach((link) => {
    const id = link.getAttribute('href')?.slice(1);
    if (id) owner.set(id, slug);
  });
});

const links = document.querySelectorAll<HTMLAnchorElement>('.toc a[href^="#"]');

function mark(id: string) {
  const parent = owner.get(id) ?? id;
  groups.forEach((item) => item.classList.toggle('is-current', item.dataset.slug === parent));
  links.forEach((link) => {
    if (link.getAttribute('href') === `#${id}`) link.setAttribute('aria-current', 'true');
    else link.removeAttribute('aria-current');
  });
}

const targets: Element[] = [];
owner.forEach((_parent, id) => {
  const el = document.getElementById(id);
  if (el) targets.push(el);
});

if (targets.length > 0 && 'IntersectionObserver' in window) {
  const visible = new Map<string, number>();
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.set(entry.target.id, entry.boundingClientRect.top);
        else visible.delete(entry.target.id);
      }
      const next = [...visible.entries()].sort((a, b) => a[1] - b[1])[0];
      if (next) mark(next[0]);
    },
    { rootMargin: '-72px 0px -55% 0px', threshold: [0, 1] },
  );
  for (const el of targets) observer.observe(el);
}
