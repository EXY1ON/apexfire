import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener('popstate', cb);
  return () => { listeners.delete(cb); window.removeEventListener('popstate', cb); };
}

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (opts.replace) history.replaceState(null, '', to); else history.pushState(null, '', to);
  listeners.forEach((l) => l());
}

export function useLocation(): URL {
  const href = useSyncExternalStore(subscribe, () => location.pathname + location.search);
  return new URL(href, location.origin);
}

export function Link({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || !href.startsWith('/')) return;
    e.preventDefault();
    navigate(href);
    const id = href.split('#')[1];
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView()); else window.scrollTo(0, 0);
  };
  return <a href={href} onClick={handle} {...rest} />;
}
