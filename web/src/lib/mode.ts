import { useSyncExternalStore } from 'react';

// Simple (default) hides detail for ordinary visitors; Expert shows everything. One preference per browser, like the basemap.
const KEY = 'firewatch.mode';
const listeners = new Set<() => void>();
let expert = (() => { try { return localStorage.getItem(KEY) === 'expert'; } catch { return false; } })();

export function setExpert(on: boolean) {
  expert = on;
  try { localStorage.setItem(KEY, on ? 'expert' : 'simple'); } catch { /* storage unavailable: choice lasts for this page only */ }
  listeners.forEach((l) => l());
}

export function useExpert(): boolean {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => expert);
}
