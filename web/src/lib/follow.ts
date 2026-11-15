// "Follow" stored on this device only: a 5 km watch area around a fire or place, with the time it was followed.
// New detections inside the area after that time are counted when data is loaded. No account, no server.
import { useSyncExternalStore } from 'react';
import { haversineKm } from './geo';

export interface Follow { id: string; name: string; lat: number; lon: number; radiusKm: number; since: string }

const KEY = 'firewatch.follows';
const listeners = new Set<() => void>();
let cache: Follow[] = read();

function read(): Follow[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((f) => f && typeof f.id === 'string' && Number.isFinite(f.lat) && Number.isFinite(f.lon)) : [];
  } catch { return []; }
}

function write(next: Follow[]) {
  cache = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage blocked: follows last for this page only */ }
  listeners.forEach((l) => l());
}

export function useFollows(): Follow[] {
  return useSyncExternalStore((cb) => { listeners.add(cb); return () => listeners.delete(cb); }, () => cache);
}

export function toggleFollow(f: Omit<Follow, 'since' | 'radiusKm'>, now = new Date().toISOString()) {
  write(cache.some((x) => x.id === f.id) ? cache.filter((x) => x.id !== f.id) : [...cache, { ...f, radiusKm: 5, since: now }]);
}

/** Detections inside a followed area that were acquired after it was followed. */
export function newSince(f: Follow, dets: { lat: number; lon: number; t: string }[]): number {
  return dets.filter((d) => d.t > f.since.slice(0, 16) + 'Z' && haversineKm(f.lat, f.lon, d.lat, d.lon) <= f.radiusKm).length;
}
