// National fire-danger maps from MKFFIS (Crisis Management Centre of North Macedonia), drawn as WMS overlays.
// The service is HTTP-only on port 8080 and sends no CORS headers, so browsers reach it only through a same-origin proxy at
// /mkffis/wms: the Vite dev/preview proxy locally (vite.config.ts), and in production a Firebase Hosting rewrite to the
// allowlisting function functions/mkffis.py (built, not deployed: MKFFIS reuse terms are unconfirmed).
// VITE_MKFFIS_WMS points at another proxy; an empty value turns the layers off.
import { useEffect, useState } from 'react';

const BASE = (import.meta.env.VITE_MKFFIS_WMS as string | undefined) ?? '/mkffis/wms';
export const MKFFIS_ON = !!BASE;
/** Extent of the MKFFIS rasters (from their capabilities); the proxy rejects tiles far outside it. */
export const MKFFIS_BOUNDS: [number, number, number, number] = [20, 40.5, 23.5, 42.5];
export const MKFFIS_CREDIT = 'MKFFIS, Crisis Management Centre of North Macedonia (mkffis.cuk.gov.mk); reuse terms unconfirmed';

const root = () => (BASE.startsWith('http') ? BASE : `${location.origin}${BASE}`);
const query = (p: Record<string, string>) => `${root()}?${new URLSearchParams({ service: 'WMS', version: '1.1.1', ...p })}`;
const compact = (day: string) => day.replace(/-/g, '');
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export const fwiName = (day: string) => `fwibeta:fwi${compact(day)}_tif`;
/** Tile template for MapLibre; the bbox placeholder must stay literal, so it is appended unencoded. */
export const tileUrl = (layer: string) => `${query({ request: 'GetMap', layers: layer, styles: '', srs: 'EPSG:3857', width: '256', height: '256', format: 'image/png', transparent: 'true' })}&bbox={bbox-epsg-3857}`;
export const legendUrl = (layer: string) => query({ request: 'GetLegendGraphic', layer, format: 'image/png' });
/** Today's calendar date in North Macedonia (MKFFIS names its daily maps by local date). */
export const skopjeToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Skopje' }).format(new Date());

const seen = new Map<string, Promise<boolean>>();
/** GeoServer answers an unknown layer with HTTP 200 and an XML exception, so existence = an image comes back for a 1 px request. */
function exists(layer: string): Promise<boolean> {
  if (!seen.has(layer)) {
    seen.set(layer, fetch(query({ request: 'GetMap', layers: layer, styles: '', srs: 'EPSG:4326', bbox: '20,40.5,23.5,42.5', width: '1', height: '1', format: 'image/png' }))
      .then((r) => r.ok && (r.headers.get('content-type') ?? '').startsWith('image/'))
      .catch((e) => { seen.delete(layer); throw e; }));
  }
  return seen.get(layer)!;
}

export interface MkLayer { name: string; from: string; to: string }

/** Daily Fire Weather Index map for `day`, or the latest of the `back` days before it. */
async function findFwi(day: string, back: number): Promise<MkLayer | null> {
  for (let i = 0; i <= back; i++) { const d = shift(day, -i); if (await exists(fwiName(d))) return { name: fwiName(d), from: d, to: d }; }
  return null;
}
/** Vegetation dryness comes in 8-day periods whose start dates are not on a fixed cycle; try each period that could contain `day`. */
async function findVdm(day: string): Promise<MkLayer | null> {
  const starts = Array.from({ length: 8 }, (_, i) => shift(day, -i));
  const names = starts.map((s) => `VDM:VDM_${compact(s)}_${compact(shift(s, 7))}_tif`);
  const hit = (await Promise.all(names.map(exists))).findIndex(Boolean);
  return hit < 0 ? null : { name: names[hit], from: starts[hit], to: shift(starts[hit], 7) };
}

export interface MkState { fwi: MkLayer | null; vdm: MkLayer | null; loading: boolean; error: string | null }
/** Looks up the MKFFIS maps for a date only while `day` is set (a layer is switched on). `back` days of fallback for "today". */
export function useMkffis(day: string | null, opts: { vdm: boolean; back: number }): MkState {
  const [st, setSt] = useState<MkState>({ fwi: null, vdm: null, loading: false, error: null });
  useEffect(() => {
    if (!day || !MKFFIS_ON) { setSt({ fwi: null, vdm: null, loading: false, error: null }); return; }
    let live = true;
    setSt((s) => ({ ...s, loading: true, error: null }));
    Promise.all([findFwi(day, opts.back), opts.vdm ? findVdm(day) : Promise.resolve(null)])
      .then(([fwi, vdm]) => live && setSt({ fwi, vdm, loading: false, error: null }),
        () => live && setSt({ fwi: null, vdm: null, loading: false, error: 'MKFFIS could not be reached (it is only available through the local ApexFire server)' }));
    return () => { live = false; };
  }, [day, opts.vdm, opts.back]);
  return st;
}
