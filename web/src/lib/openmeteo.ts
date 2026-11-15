// Live Open-Meteo requests made from the visitor's browser (no key; free non-commercial service).
// Model is explicit (ECMWF IFS) so provenance is stable; responses are validated before use.
import { useEffect, useState } from 'react';
import { fwiSeries, type FwiDay } from './fwi';

const API = 'https://api.open-meteo.com/v1/forecast';
// Every 0.125° (~11-14 km): close to the ~9 km model grid, so the field keeps the valleys and ridges the model resolves
// (tested 15 Nov 2026: 273 points hit 256 distinct model cells). Sampling every 0.25° smoothed them away.
const SPACING = 0.125;
const LATS = Array.from({ length: 13 }, (_, i) => 40.875 + SPACING * i);
const LONS = Array.from({ length: 21 }, (_, j) => 20.5 + SPACING * j);

export interface LiveWindGrid {
  delivery: 'live'; retrieved_utc: string; model_requested: string; model_run_time: null; credit: string; note: string; spacing_deg: number;
  times: string[]; points: { requested: [number, number]; grid: [number, number]; elevation_m: number; speed: number[]; dir: number[]; gust: number[] }[];
}

type Hourly = Record<string, (number | null)[] | string[]>;
interface OmPoint { latitude: number; longitude: number; elevation: number; hourly: Hourly }

const finite = (a: (number | null)[]) => a.every((v) => typeof v === 'number' && Number.isFinite(v));

async function getJSON(url: string, signal?: AbortSignal): Promise<unknown> {
  const r = await fetch(url, { signal });
  if (!r.ok) throw new Error(`Open-Meteo HTTP ${r.status}`);
  return r.json();
}

export async function fetchWindGrid(signal?: AbortSignal): Promise<LiveWindGrid> {
  const pts = LATS.flatMap((lat) => LONS.map((lon) => [lat, lon] as [number, number]));
  const q = new URLSearchParams({
    latitude: pts.map((p) => p[0]).join(','), longitude: pts.map((p) => p[1]).join(','),
    hourly: 'wind_speed_10m,wind_direction_10m,wind_gusts_10m', models: 'ecmwf_ifs', wind_speed_unit: 'ms', timezone: 'UTC', forecast_hours: '48',
  });
  const body = (await getJSON(`${API}?${q}`, signal)) as OmPoint[];
  if (!Array.isArray(body) || body.length !== pts.length) throw new Error('Open-Meteo returned an unexpected grid');
  const times = (body[0].hourly.time as string[]).map((t) => `${t}Z`);
  const points = body.map((b, i) => {
    const s = b.hourly.wind_speed_10m as number[]; const d = b.hourly.wind_direction_10m as number[]; const g = b.hourly.wind_gusts_10m as number[];
    if (s.length !== times.length || !finite(s) || !finite(d) || !finite(g)) throw new Error('Open-Meteo grid has missing values');
    return { requested: pts[i], grid: [b.latitude, b.longitude] as [number, number], elevation_m: b.elevation, speed: s, dir: d, gust: g };
  });
  return {
    delivery: 'live', retrieved_utc: new Date().toISOString(), model_requested: 'ecmwf_ifs', model_run_time: null, spacing_deg: SPACING,
    credit: 'Weather data by Open-Meteo.com (CC BY 4.0); ECMWF IFS HRES model (CC BY 4.0)',
    note: 'Live model forecast at ~9 km grid points, fetched by your browser; not station observations.', times, points,
  };
}

let gridCache: { at: number; p: Promise<LiveWindGrid> } | null = null;
const GRID_KEY = 'firewatch.liveWind';
const GRID_TTL = 30 * 60e3;

/** A grid fetched in this tab within the last 30 minutes survives reloads (sessionStorage), sparing the free API; null if absent or stale. */
function storedGrid(): LiveWindGrid | null {
  try {
    const g = JSON.parse(sessionStorage.getItem(GRID_KEY) ?? 'null') as LiveWindGrid | null;
    return g && g.spacing_deg === SPACING && Date.now() - Date.parse(g.retrieved_utc) < GRID_TTL ? g : null;
  } catch { return null; }
}

/** One live grid per 30 minutes per tab; errors are reported, never replaced with invented values. */
export function useLiveWind() {
  const [state, setState] = useState<{ grid: LiveWindGrid | null; error: string | null }>({ grid: null, error: null });
  useEffect(() => {
    let live = true;
    if (!gridCache || Date.now() - gridCache.at > GRID_TTL) {
      const kept = storedGrid();
      gridCache = { at: kept ? Date.parse(kept.retrieved_utc) : Date.now(), p: kept ? Promise.resolve(kept) : fetchWindGrid().then((g) => {
        try { sessionStorage.setItem(GRID_KEY, JSON.stringify(g)); } catch { /* storage full or blocked: refetch next time */ }
        return g;
      }) };
    }
    gridCache.p.then((grid) => live && setState({ grid, error: null }), (e: Error) => { gridCache = null; if (live) setState({ grid: null, error: e.message }); });
    return () => { live = false; };
  }, []);
  return state;
}

export interface PointWeather {
  retrieved_utc: string; grid: [number, number]; elevation_m: number;
  hourly: { time: string[]; t: number[]; rh: number[]; wind: number[]; dir: number[]; gust: number[]; rain: number[] };
  fwi: { date: string; noon: { t: number; rh: number; wind: number; rain: number }; value: FwiDay }[]; // daily at 11:00 UTC (12:00 CET)
}

/** Hourly weather for 60 past days plus 3 forecast days at one point, and the daily FWI derived from it. */
export async function fetchPointWeather(lat: number, lon: number, signal?: AbortSignal): Promise<PointWeather> {
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), models: 'ecmwf_ifs', timezone: 'UTC', past_days: '60', forecast_days: '3', wind_speed_unit: 'kmh',
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation',
  });
  return toPointWeather((await getJSON(`${API}?${q}`, signal)) as OmPoint);
}

/** ERA5 reanalysis for the 60 days up to a past date (Open-Meteo historical API), with the daily FWI. */
export async function fetchHistoricWeather(lat: number, lon: number, date: string, signal?: AbortSignal): Promise<PointWeather> {
  const start = new Date(Date.parse(`${date}T00:00Z`) - 60 * 864e5).toISOString().slice(0, 10);
  const q = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4), models: 'era5', timezone: 'UTC', start_date: start, end_date: date, wind_speed_unit: 'kmh',
    hourly: 'temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,wind_gusts_10m,precipitation',
  });
  return toPointWeather((await getJSON(`https://archive-api.open-meteo.com/v1/archive?${q}`, signal)) as OmPoint);
}

function toPointWeather(b: OmPoint): PointWeather {
  const h = b.hourly;
  const time = (h.time as string[]).map((t) => `${t}Z`);
  const col = (k: string) => (h[k] as (number | null)[]).map((v) => (v === null ? NaN : v));
  const hourly = { time, t: col('temperature_2m'), rh: col('relative_humidity_2m'), wind: col('wind_speed_10m'), dir: col('wind_direction_10m'), gust: col('wind_gusts_10m'), rain: col('precipitation') };
  if (time.length < 24 * 30) throw new Error('Open-Meteo returned too little history for the fire weather index');
  // Noon local standard time (11:00 UTC); rain is the 24 h total ending at that hour. Days with missing values stop the series.
  const days: PointWeather['fwi'] = [];
  const noons: { t: number; rh: number; wind: number; rain: number; month: number }[] = [];
  for (let i = 24; i < time.length; i++) {
    if (!time[i].endsWith('T11:00Z')) continue;
    const rain = hourly.rain.slice(i - 23, i + 1).reduce((a, v) => a + v, 0);
    const n = { t: hourly.t[i], rh: hourly.rh[i], wind: hourly.wind[i], rain, month: Number(time[i].slice(5, 7)) };
    if (![n.t, n.rh, n.wind, n.rain].every(Number.isFinite)) break;
    noons.push(n);
    days.push({ date: time[i].slice(0, 10), noon: { t: n.t, rh: n.rh, wind: n.wind, rain: Math.round(rain * 10) / 10 }, value: null as unknown as FwiDay });
  }
  fwiSeries(noons).forEach((v, k) => { days[k].value = v; });
  return { retrieved_utc: new Date().toISOString(), grid: [b.latitude, b.longitude], elevation_m: b.elevation, hourly, fwi: days };
}

const pointCache = new Map<string, Promise<PointWeather>>();
/** Live point weather, or ERA5 reanalysis up to `date` when a past date is given. */
export function usePointWeather(lat: number | null, lon: number | null, date?: string) {
  const [state, setState] = useState<{ data: PointWeather | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  useEffect(() => {
    if (lat === null || lon === null) { setState({ data: null, error: null, loading: false }); return; }
    const key = `${lat.toFixed(3)},${lon.toFixed(3)},${date ?? 'now'}`;
    let live = true;
    setState({ data: null, error: null, loading: true });
    if (!pointCache.has(key)) pointCache.set(key, date ? fetchHistoricWeather(lat, lon, date) : fetchPointWeather(lat, lon));
    pointCache.get(key)!.then((data) => live && setState({ data, error: null, loading: false }),
      (e: Error) => { pointCache.delete(key); if (live) setState({ data: null, error: e.message, loading: false }); });
    return () => { live = false; };
  }, [lat, lon, date]);
  return state;
}

const AQ_API = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const AQ_KEYS = ['pm2_5', 'pm10', 'carbon_monoxide', 'european_aqi'] as const;
export type AqKey = (typeof AQ_KEYS)[number];
export const AQ_POINT = { area: 'Skopje', lat: 41.9981, lon: 21.4254 };

export interface AirQuality {
  retrieved_utc: string; area: string; grid: [number, number]; time: string[];
  units: Record<AqKey, string>; values: Record<AqKey, (number | null)[]>;
}

/** CAMS European ensemble (about 11 km) from yesterday to two days ahead, hourly; missing hours stay null, never filled. */
export async function fetchAirQuality(signal?: AbortSignal): Promise<AirQuality> {
  const q = new URLSearchParams({ latitude: AQ_POINT.lat.toFixed(4), longitude: AQ_POINT.lon.toFixed(4), domains: 'cams_europe',
    timezone: 'UTC', past_days: '1', forecast_days: '2', hourly: AQ_KEYS.join(',') });
  const b = (await getJSON(`${AQ_API}?${q}`, signal)) as { latitude: number; longitude: number; hourly?: Hourly; hourly_units?: Record<string, string> };
  const time = b.hourly?.time as string[] | undefined;
  if (!Array.isArray(time) || time.length < 24) throw new Error('Open-Meteo air quality returned too few hours');
  if (b.hourly_units?.european_aqi !== 'EAQI') throw new Error('Open-Meteo air quality returned unexpected units');
  const values = {} as AirQuality['values']; const units = {} as AirQuality['units'];
  for (const k of AQ_KEYS) {
    const v = b.hourly?.[k] as (number | null)[] | undefined;
    if (!Array.isArray(v) || v.length !== time.length) throw new Error(`Open-Meteo air quality is missing ${k}`);
    values[k] = v.map((x) => (typeof x === 'number' && Number.isFinite(x) ? x : null));
    units[k] = b.hourly_units[k] ?? '';
  }
  return { retrieved_utc: new Date().toISOString(), area: AQ_POINT.area, grid: [b.latitude, b.longitude], time: time.map((t) => `${t}Z`), units, values };
}

let aqCache: { at: number; p: Promise<AirQuality> } | null = null;
/** Live air quality, fetched at most once per 30 minutes per tab; errors are reported, not replaced. */
export function useAirQuality() {
  const [state, setState] = useState<{ data: AirQuality | null; error: string | null }>({ data: null, error: null });
  useEffect(() => {
    let live = true;
    if (!aqCache || Date.now() - aqCache.at > GRID_TTL) aqCache = { at: Date.now(), p: fetchAirQuality() };
    aqCache.p.then((data) => live && setState({ data, error: null }), (e: Error) => { aqCache = null; if (live) setState({ data: null, error: e.message }); });
    return () => { live = false; };
  }, []);
  return state;
}

// European AQI bands as documented by Open-Meteo: 0-20 good, 20-40 fair, 40-60 moderate, 60-80 poor, 80-100 very poor, above 100 extremely poor.
export const eaqiBand = (v: number) => ['Good', 'Fair', 'Moderate', 'Poor', 'Very poor'][Math.floor(v / 20)] ?? 'Extremely poor';

