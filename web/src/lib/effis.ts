// Live EFFIS season statistics for North Macedonia, requested from the visitor's browser (the API allows any origin; no key).
import { useEffect, useState } from 'react';
import { skopjeToday } from './mkffis';

const API = 'https://api2.effis.emergency.copernicus.eu/statistics/v2/effis';

export interface EffisRow { week: number; mddate: string; events: number | null; area_ha: number | null; events_avg: number | null; area_ha_avg: number | null; min_year: number }
export interface EffisSeason {
  retrieved_utc: string; year: number; source_url: string; annual_source_url: string;
  weekly: EffisRow[]; cumulative: EffisRow[]; annual: { year: number; ba: number; nf: number }[];
}

const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
const orNull = (v: unknown) => (num(v) ? (v as number) : null);

function rows(raw: unknown, what: string): EffisRow[] {
  if (!Array.isArray(raw) || raw.length < 52 || raw.length > 53) throw new Error(`EFFIS ${what} has an unexpected shape`);
  return raw.map((r: Record<string, unknown>, i) => {
    if (r.iso3 !== 'MKD' || r.week !== i + 1 || !/^\d{8}$/.test(String(r.mddate))) throw new Error(`EFFIS ${what} row ${i + 1} is malformed`);
    // Unpublished weeks are null; anything else that is not a finite number is treated the same way, never as zero.
    return { week: i + 1, mddate: String(r.mddate), events: orNull(r.events), area_ha: orNull(r.area_ha), events_avg: orNull(r.events_avg), area_ha_avg: orNull(r.area_ha_avg), min_year: Number(r.min_year) };
  });
}

/** Weekly and cumulative mapped burned area for this year, plus the annual series since 2006. */
export async function fetchEffisSeason(year = Number(skopjeToday().slice(0, 4)), signal?: AbortSignal): Promise<EffisSeason> {
  const source_url = `${API}/weekly?country=MKD&year=${year}`;
  const annual_source_url = `${API}/estimatesbycountry?country=MKD`;
  const get = async (u: string) => { const r = await fetch(u, { signal }); if (!r.ok) throw new Error(`EFFIS HTTP ${r.status}`); return r.json(); };
  const [w, a] = await Promise.all([get(source_url), get(annual_source_url)]);
  const weekly = rows(w?.banfweekly, 'weekly'); const cumulative = rows(w?.banfcumulative, 'cumulative');
  if (!Array.isArray(a) || !a.length || !a.every((r) => num(r?.year) && num(r?.ba) && num(r?.nf))) throw new Error('EFFIS annual estimates are malformed');
  return { retrieved_utc: new Date().toISOString(), year, source_url, annual_source_url, weekly, cumulative, annual: a };
}

let cache: { at: number; p: Promise<EffisSeason> } | null = null;
const TTL = 6 * 3600e3; // EFFIS publishes weekly; six hours keeps a long-open tab current without hammering the API.
/** Live EFFIS season, fetched at most once per six hours per tab; errors are reported, not replaced. */
export function useEffisSeason(enabled = true) {
  const [state, setState] = useState<{ data: EffisSeason | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    if (!cache || Date.now() - cache.at > TTL) cache = { at: Date.now(), p: fetchEffisSeason() };
    cache.p.then((data) => live && setState({ data, error: null }), (e: Error) => { cache = null; if (live) setState({ data: null, error: e.message }); });
    return () => { live = false; };
  }, [enabled]);
  return state;
}

export const lastPublished = (rs: EffisRow[]) => [...rs].reverse().find((r) => r.area_ha !== null && r.events !== null);
