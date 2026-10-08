/**
 * Consent banner + Consent Mode v2 + lazy GA4 / AdSense loader + GA4 engagement events.
 *
 * This is the only script shipped on every page. It is dependency-free and small.
 * Nothing optional (GA4, AdSense) is loaded until the visitor has made a choice.
 *
 * Storage: localStorage["iptvb_consent"] = { v, analytics, ads, ts }
 * Markup hooks:
 *   #consent-banner [data-consent="accept"|"reject"]
 *   [data-consent-pref="analytics"|"ads"] checkboxes + [data-consent="save"] (cookies page)
 *   .ad-slot[data-ad-client][data-ad-unit]
 */

type ConsentState = { v: 1; analytics: boolean; ads: boolean; ts: number };

declare global {
  interface Window {
    dataLayer: unknown[];
    gtag: (...args: unknown[]) => void;
    adsbygoogle: unknown[] & { requestNonPersonalizedAds?: number };
    __iptvbConfig?: { ga4Id?: string; adsenseClient?: string; npaWithoutConsent?: boolean };
  }
}

const KEY = 'iptvb_consent';
const config = window.__iptvbConfig ?? {};

function readConsent(): ConsentState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentState;
    return parsed && parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeConsent(state: Omit<ConsentState, 'v' | 'ts'>): ConsentState {
  const full: ConsentState = { v: 1, ts: Date.now(), ...state };
  try {
    localStorage.setItem(KEY, JSON.stringify(full));
  } catch {
    /* private mode – ignore */
  }
  return full;
}

function gtag(...args: unknown[]) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}
window.gtag = window.gtag || gtag;

function updateConsentMode(state: ConsentState) {
  const g = state.ads ? 'granted' : 'denied';
  window.gtag('consent', 'update', {
    ad_storage: g,
    ad_user_data: g,
    ad_personalization: g,
    analytics_storage: state.analytics ? 'granted' : 'denied',
  });
  if (!state.ads) window.gtag('set', 'ads_data_redaction', true);
}

// ---------------------------------------------------------------------------
// GA4
// ---------------------------------------------------------------------------
let gaLoaded = false;
function loadGa(state: ConsentState) {
  if (gaLoaded || !state.analytics || !config.ga4Id) return;
  gaLoaded = true;
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(config.ga4Id)}`;
  document.head.appendChild(s);
  window.gtag('js', new Date());
  window.gtag('config', config.ga4Id, { transport_type: 'beacon', send_page_view: true });
  attachEngagementEvents();
}

let engagementAttached = false;
function attachEngagementEvents() {
  if (engagementAttached) return;
  engagementAttached = true;

  // Scroll depth 50 / 90
  const fired = new Set<number>();
  const onScroll = () => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (max <= 0) return;
    const pct = Math.round((window.scrollY / max) * 100);
    for (const t of [50, 90]) {
      if (pct >= t && !fired.has(t)) {
        fired.add(t);
        window.gtag('event', 'scroll_depth', { percent: t, page_path: location.pathname });
      }
    }
    if (fired.size === 2) window.removeEventListener('scroll', onScroll);
  };
  window.addEventListener('scroll', onScroll, { passive: true });

  // Time on page: milestones + total engaged time on leave
  const start = performance.now();
  let hiddenAt: number | null = null;
  let hiddenTotal = 0;
  for (const sec of [15, 30, 60, 120, 180]) {
    setTimeout(() => {
      if (document.visibilityState === 'visible')
        window.gtag('event', 'time_on_page', { seconds: sec, page_path: location.pathname });
    }, sec * 1000);
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = performance.now();
    else if (hiddenAt !== null) {
      hiddenTotal += performance.now() - hiddenAt;
      hiddenAt = null;
    }
  });
  window.addEventListener('pagehide', () => {
    const engaged = Math.round((performance.now() - start - hiddenTotal) / 1000);
    window.gtag('event', 'engaged_time', { seconds: engaged, page_path: location.pathname });
  });

  // Outbound + internal link clicks (delegated)
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as HTMLElement | null)?.closest?.('a[href]') as HTMLAnchorElement | null;
      if (!a) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) {
        window.gtag('event', 'click_outbound', {
          link_url: url.href,
          link_domain: url.hostname,
          link_text: (a.textContent || '').trim().slice(0, 100),
        });
      } else if (url.pathname !== location.pathname) {
        window.gtag('event', 'click_internal', {
          link_url: url.pathname,
          link_text: (a.textContent || '').trim().slice(0, 100),
          link_area: a.closest('[data-area]')?.getAttribute('data-area') ?? 'body',
        });
      }
    },
    { capture: true, passive: true },
  );
}

// ---------------------------------------------------------------------------
// AdSense (lazy, only after consent and only when a publisher id is configured)
// ---------------------------------------------------------------------------
let adsScriptLoaded = false;
function loadAds(state: ConsentState) {
  const client = config.adsenseClient;
  if (!client) return;
  const allowed = state.ads || (config.npaWithoutConsent && !state.ads);
  if (!allowed) return;

  const slots = Array.from(document.querySelectorAll<HTMLElement>('.ad-slot[data-ad-client]'));
  if (slots.length === 0) return;

  if (!adsScriptLoaded) {
    adsScriptLoaded = true;
    window.adsbygoogle = window.adsbygoogle || [];
    if (!state.ads) window.adsbygoogle.requestNonPersonalizedAds = 1;
    const s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`;
    document.head.appendChild(s);
  }

  const fill = (el: HTMLElement) => {
    if (el.dataset.filled) return;
    el.dataset.filled = '1';
    const unit = el.dataset.adUnit;
    if (!unit) return; // slot id not yet created in AdSense – keep the placeholder
    el.querySelector('.ad-slot__label')?.remove();
    const ins = document.createElement('ins');
    ins.className = 'adsbygoogle';
    ins.style.display = 'block';
    ins.setAttribute('data-ad-client', client);
    ins.setAttribute('data-ad-slot', unit);
    ins.setAttribute('data-full-width-responsive', 'false');
    el.appendChild(ins);
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  };

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            fill(entry.target as HTMLElement);
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '300px 0px' },
    );
    slots.forEach((s) => io.observe(s));
  } else {
    slots.forEach(fill);
  }
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------
function apply(state: ConsentState) {
  updateConsentMode(state);
  loadGa(state);
  loadAds(state);
  document.dispatchEvent(new CustomEvent('consentchange', { detail: state }));
}

function syncPreferenceForm(state: ConsentState | null) {
  document.querySelectorAll<HTMLInputElement>('[data-consent-pref]').forEach((input) => {
    const key = input.dataset.consentPref as 'analytics' | 'ads';
    input.checked = state ? Boolean(state[key]) : false;
  });
  const status = document.querySelector<HTMLElement>('[data-consent-status]');
  if (status) {
    status.textContent = state
      ? `Current choice: analytics ${state.analytics ? 'on' : 'off'}, advertising ${state.ads ? 'on' : 'off'} (saved ${new Date(state.ts).toLocaleDateString()}).`
      : 'No choice saved yet.';
  }
}

function init() {
  const banner = document.getElementById('consent-banner');
  let state = readConsent();

  const choose = (next: Omit<ConsentState, 'v' | 'ts'>) => {
    state = writeConsent(next);
    banner?.setAttribute('hidden', '');
    syncPreferenceForm(state);
    apply(state);
  };

  document.querySelectorAll<HTMLElement>('[data-consent]').forEach((el) => {
    el.addEventListener('click', (e) => {
      const action = el.dataset.consent;
      if (action === 'accept') choose({ analytics: true, ads: true });
      else if (action === 'reject') choose({ analytics: false, ads: false });
      else if (action === 'save') {
        e.preventDefault();
        const get = (k: string) =>
          document.querySelector<HTMLInputElement>(`[data-consent-pref="${k}"]`)?.checked ?? false;
        choose({ analytics: get('analytics'), ads: get('ads') });
      } else if (action === 'reopen') {
        e.preventDefault();
        banner?.removeAttribute('hidden');
      }
    });
  });

  syncPreferenceForm(state);
  if (state) apply(state);
  else banner?.removeAttribute('hidden');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

export {};
