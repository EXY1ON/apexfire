import { useEffect, useMemo, useState } from 'react';
import type { LayerSpecification, Map as MLMap } from 'maplibre-gl';
import { validateDoc, validateGeoJSON, type Catalog, validateCatalog } from '../lib/data';
import { useData, useReducedMotion } from '../lib/useData';
import { compass, compassWords, fmt1, fmtInt } from '../lib/format';
import { Link } from '../lib/router';
import { useExpert } from '../lib/mode';
import { fwiClass, fwiMeaning, fwiSeries } from '../lib/fwi';
import { SENSOR_LABEL } from '../lib/history';
import { dayField, dayIndex, validateWeatherYear } from '../lib/weather-history';
import { addLayers, MapView, sensorPointLayer, SensorMark, setGeoJSON, setRaster } from '../components/MapView';
import { WindParticles } from '../components/WindParticles';
import { FlameGlyph, WindGlyph } from '../components/LayersDrawer';
import { Chip, Icon, IconHeading, Tech } from '../components/Icon';
import type { SensorKey } from '../lib/data';

// Officially mapped (EFFIS) fires with satellite detections by day and ERA5 weather, built by tools/fetch_fire_stories.py + export.
interface Det { t: string; lat: number; lon: number; frp: number; sensor: SensorKey; conf: number | string; dn: string }
interface Day { date: string; detections: number; by_sensor: Record<string, number>; frp_sum: number; frp_max: number; centroid: [number, number] | null; hull_km2: number }
export interface FireStoryDoc {
  id: string; title: string; place: string; place_mk: string; municipality: string; year: number; summary: string[];
  context: { text: string; source_label: string; url: string }[];
  official: { source: string; effis_id: string; firedate: string; finaldate: string | null; lastupdate: string; area_ha: number; landcover_pct: Record<string, number>; natura2000_pct?: number; query_url: string };
  perimeter: GeoJSON.Feature | null; center: [number, number]; bbox: [number, number, number, number]; window: { start: string; end: string };
  detections: Det[]; selection: string; days: Day[];
  weather: { source: string; grid: [number, number]; elevation_m: number;
    hourly: { time: string[]; wind_kmh: number[]; wind_dir: number[]; gust_kmh: number[]; t: number[]; rh: number[]; rain: number[] };
    noon: { date: string; t: number; rh: number; wind: number; rain: number }[] };
  sources: { label: string; url: string }[]; credits: string;
}
export interface FireStoryIndex { stories: { id: string; title: string; place: string; place_mk: string; municipality: string; year: number; start: string; end: string; area_ha: number; detections: number; peak_day: string; center: [number, number] }[] }
export const validateFireStoryIndex = validateDoc<FireStoryIndex>('firewatch.story.fire.index.v1', ['stories']);
const validateStory = validateDoc<FireStoryDoc>('firewatch.story.fire.v1', ['days', 'detections', 'weather', 'window', 'official']);

const rad = (d: number) => (d * Math.PI) / 180;
/** One day's ERA5 weather at the fire: mean wind as a vector (so opposite hours cancel), strongest gust, hottest hour, driest hour, rain total. */
function dayWeather(w: FireStoryDoc['weather'], date: string) {
  const idx = w.hourly.time.flatMap((t, i) => (t.startsWith(date) ? [i] : []));
  if (!idx.length) return null;
  const h = w.hourly;
  let u = 0; let v = 0;
  for (const i of idx) { u -= h.wind_kmh[i] * Math.sin(rad(h.wind_dir[i])); v -= h.wind_kmh[i] * Math.cos(rad(h.wind_dir[i])); }
  const from = ((Math.atan2(-u, -v) * 180) / Math.PI + 360) % 360;
  return {
    from, mean: idx.reduce((s, i) => s + h.wind_kmh[i], 0) / idx.length, gust: Math.max(...idx.map((i) => h.gust_kmh[i])),
    tmax: Math.max(...idx.map((i) => h.t[i])), rhmin: Math.min(...idx.map((i) => h.rh[i])), rain: idx.reduce((s, i) => s + h.rain[i], 0),
    hours: idx.map((i) => ({ kmh: h.wind_kmh[i], gust: h.gust_kmh[i], dir: h.wind_dir[i] })),
  };
}

/** "on 30 Sept" for a one-day record, "30 Sept to 2 Oct" otherwise. */
const spanText = (from: string, to: string | null) => (!to || to.slice(0, 10) === from.slice(0, 10) ? `on ${fmtDay(from.slice(0, 10))}` : `${fmtDay(from.slice(0, 10))} to ${fmtDay(to.slice(0, 10))}`);
const fmtDay = (d: string, long = false) => new Date(`${d}T12:00Z`).toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' } : { day: 'numeric', month: 'short' });
const gibs = (date: string) => `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${date >= '2018-01-01' ? 'VIIRS_NOAA20' : 'VIIRS_SNPP'}_CorrectedReflectance_TrueColor/default/${date}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`;

export function FireStory({ id }: { id: string }) {
  const expert = useExpert();
  const reduced = useReducedMotion();
  const story = useData(`stories/fires/${id}.json`, validateStory);
  const catalog = useData<Catalog>('catalog.json', validateCatalog);
  const boundary = useData('boundary-mk.geojson', validateGeoJSON);
  const s = story.data;
  const wxYear = useData(s && catalog.data?.weather?.years.includes(s.year) ? `weather/weather-${s.year}.json` : null, validateWeatherYear);
  const [map, setMap] = useState<MLMap | null>(null);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [show, setShow] = useState({ perimeter: true, imagery: false, streaks: true });
  const peak = s ? s.days.reduce((b, d, i) => (d.detections > s.days[b].detections ? i : b), 0) : 0;
  const k = step ?? peak;
  const day = s?.days[k];
  const fwi = useMemo(() => {
    if (!s) return new Map<string, number>();
    const v = fwiSeries(s.weather.noon.map((n) => ({ ...n, month: Number(n.date.slice(5, 7)) })));
    return new Map(s.weather.noon.map((n, i) => [n.date, v[i].fwi]));
  }, [s]);
  const wx = useMemo(() => (s ? new Map(s.days.map((d) => [d.date, dayWeather(s.weather, d.date)])) : new Map()), [s]);
  const field = useMemo(() => (wxYear.data && day ? dayField(wxYear.data, dayIndex(wxYear.data, day.date)) : null), [wxYear.data, day]);
  const country = boundary.data?.features[0]?.geometry ?? null;

  useEffect(() => {
    if (!playing || !s) return;
    if (k >= s.days.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setStep(k + 1), reduced ? 2500 : 1300);
    return () => clearTimeout(t);
  }, [playing, k, s, reduced]);
  useEffect(() => { if (s) document.title = `${s.title} · ApexFire`; }, [s]);
  useEffect(() => { if (map && s) map.fitBounds(s.bbox, { padding: 48, animate: false, maxZoom: 12 }); }, [map, s]);
  useEffect(() => {
    if (!map || !s || !day) return;
    const w = wx.get(day.date);
    const pt = (d: Det) => ({ type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [d.lon, d.lat] }, properties: { sensor: d.sensor, frp: d.frp } });
    setGeoJSON(map, 'fw-st-perim', { type: 'FeatureCollection', features: show.perimeter && s.perimeter ? [s.perimeter] : [] }, 'Burned area: EFFIS (CC BY 4.0)');
    setGeoJSON(map, 'fw-st-before', { type: 'FeatureCollection', features: s.detections.filter((d) => d.t.slice(0, 10) < day.date).map(pt) }, 'Detections: NASA FIRMS');
    setGeoJSON(map, 'fw-st-today', { type: 'FeatureCollection', features: s.detections.filter((d) => d.t.startsWith(day.date)).map(pt) });
    setGeoJSON(map, 'fw-st-wind', { type: 'FeatureCollection', features: w ? [{ type: 'Feature', geometry: { type: 'Point', coordinates: [s.center[1], s.center[0]] },
      properties: { dir: w.from, kmh: Math.round(w.mean), size: Math.min(3.6, 2 + w.mean / 10) } }] : [] }, 'Weather: ERA5 via Open-Meteo');
    const flames: LayerSpecification = { id: 'fw-st-flame', type: 'symbol', source: 'fw-st-today', layout: { 'icon-image': 'fw-flame', 'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'symbol-sort-key': ['get', 'frp'], 'icon-size': ['interpolate', ['linear'], ['sqrt', ['get', 'frp']], 0, 0.45, 5, 0.6, 20, 0.85] } };
    addLayers(map, [
      { id: 'fw-st-perim-fill', type: 'fill', source: 'fw-st-perim', paint: { 'fill-color': '#7fd1ff', 'fill-opacity': 0.08 } },
      { id: 'fw-st-perim-line', type: 'line', source: 'fw-st-perim', paint: { 'line-color': '#7fd1ff', 'line-width': 2, 'line-dasharray': [0.6, 1.6] }, layout: { 'line-cap': 'round' } },
      { id: 'fw-st-before-pt', type: 'circle', source: 'fw-st-before', paint: { 'circle-radius': 3, 'circle-color': '#9c4a17', 'circle-opacity': 0.75, 'circle-stroke-color': '#0C0D0A', 'circle-stroke-width': 0.6 } },
      sensorPointLayer('fw-st-shape', 'fw-st-today', [0.7, 0.95, 1.2]), flames,
      { id: 'fw-st-wind-arrow', type: 'symbol', source: 'fw-st-wind', metadata: { 'fw:ink': 'wind' }, layout: { 'icon-image': 'fw-wind-light', 'icon-rotate': ['+', ['get', 'dir'], 180],
        'icon-rotation-alignment': 'map', 'icon-size': ['get', 'size'], 'icon-allow-overlap': true, 'icon-ignore-placement': true, 'icon-offset': [0, -14],
        'text-field': ['concat', ['to-string', ['get', 'kmh']], ' km/h'], 'text-font': ['Noto Sans Bold'], 'text-size': 13, 'text-offset': [0, 2.4], 'text-anchor': 'top', 'text-allow-overlap': true },
        paint: { 'icon-opacity': 0.95, 'text-halo-width': 1.6 } },
    ]);
    const vis = (l: string, on: boolean) => map.getLayer(l) && map.setLayoutProperty(l, 'visibility', on ? 'visible' : 'none');
    vis('fw-st-shape', expert); vis('fw-st-flame', !expert);
    setRaster(map, 'fw-st-gibs', show.imagery ? gibs(day.date) : null, { attribution: 'NASA EOSDIS GIBS, VIIRS true colour (daily)', maxzoom: 9, opacity: 0.95,
      bounds: [s.bbox[0] - 0.5, s.bbox[1] - 0.5, s.bbox[2] + 0.5, s.bbox[3] + 0.5] });
  }, [map, s, day, show, expert, wx]);

  if (story.error) return <div className="page prose"><h1 id="page-title" tabIndex={-1}>Fire story not found</h1><p className="error">{story.error}</p><p><Link href="/stories">All fire stories</Link></p></div>;
  if (!s || !day) return <div className="page prose"><p role="status">Loading fire story…</p></div>;
  const w = wx.get(day.date);
  const f = fwi.get(day.date);
  const fc = f === undefined ? null : fwiClass(f);
  const active = s.days.filter((d) => d.detections > 0).length;
  const maxDet = Math.max(...s.days.map((d) => d.detections), 1);
  const lc = Object.entries(s.official.landcover_pct).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);

  return (
    <div className="page story">
      <p className="crumb"><Link href="/stories">Fire stories</Link> /</p>
      <IconHeading as="h1" icon="flame" id="page-title">{s.title} <span lang="mk" className="alt-name">{s.place_mk}</span></IconHeading>
      <p className="kind-tag">Officially mapped burned area (EFFIS), satellite heat detections by day (NASA FIRMS) and reanalysis weather (ERA5). Detections are not the fire front; the first detection is not the ignition.</p>
      <ul className="summary-card">
        <li><Chip icon="map" /><span><strong>{fmtInt(s.official.area_ha)} ha mapped</strong>EFFIS dates the fire {spanText(s.official.firedate, s.official.finaldate)} in {s.municipality}.</span></li>
        <li><Chip icon="satellite" /><span><strong>{fmtInt(s.detections.length)} {expert ? 'detections' : 'satellite sightings'} on {active} day{active === 1 ? '' : 's'}</strong>The most on {fmtDay(s.days[peak].date)} ({s.days[peak].detections}).</span></li>
        {s.summary[2] && <li><Chip icon="wind" /><span><strong>Wind</strong>{s.summary[2]}</span></li>}
      </ul>
      <div className="story-grid">
        <section className="map-pane" aria-label={`${s.title}: map of ${fmtDay(day.date, true)}`}>
          <MapView label={`${s.title}, ${day.date}`} onReady={setMap}>
            <ul className="legend" aria-label="Map legend">
              <li>{expert ? <SensorMark sensor="viirs-jpss1" size={12} /> : <FlameGlyph height={14} />}&nbsp;{expert ? 'Detections' : 'Sightings'} on {fmtDay(day.date)}</li>
              <li><span className="swatch dot" style={{ background: '#9c4a17' }} aria-hidden />Earlier days</li>
              {show.perimeter && <li><span className="swatch dash" aria-hidden />EFFIS mapped burned area</li>}
              <li><WindGlyph size={13} />&nbsp;Wind that day, towards</li>
            </ul>
          </MapView>
          {show.streaks && field && country && !reduced && map && <WindParticles map={map} field={field} boundary={country} />}
        </section>
        <div className="story-side">
          <section className="panel" aria-labelledby="day-h">
            <IconHeading icon="calendar" id="day-h" className="h3">{fmtDay(day.date, true)}</IconHeading>
            <div className="btn-row" role="group" aria-label="Day controls">
              <button type="button" onClick={() => { setPlaying(false); setStep(Math.max(0, k - 1)); }} disabled={k === 0}>← Day before</button>
              <button type="button" aria-pressed={playing} onClick={() => { if (k >= s.days.length - 1) setStep(0); setPlaying((p) => !p); }}>{playing ? 'Pause' : 'Play the fire'}</button>
              <button type="button" onClick={() => { setPlaying(false); setStep(Math.min(s.days.length - 1, k + 1)); }} disabled={k === s.days.length - 1}>Next day →</button>
            </div>
            <div aria-live="polite">
              <dl className="figures">
                <div><dt><Icon name="flame" size={13} /> {expert ? 'Detections' : 'Sightings'}</dt><dd className="num">{day.detections}{expert && day.detections > 0 && <><br /><small>{Object.entries(day.by_sensor).map(([k2, n]) => `${SENSOR_LABEL[k2 as SensorKey] ?? k2} ${n}`).join(' · ')}</small></>}</dd></div>
                <div><dt><Icon name="map" size={13} /> Span so far</dt><dd className="num">{fmt1(day.hull_km2)}<small> km²</small><br /><small>{expert ? 'convex hull of detections, not burned area' : 'area the sightings cover, not the burned area'}</small></dd></div>
                <div><dt><Icon name="wind" size={13} /> Wind</dt><dd className="num">{w ? <>{Math.round(w.mean)}<small> km/h, gusts {Math.round(w.gust)}</small><br /><small>from the {expert ? compass(w.from) : compassWords(w.from)}</small></> : '–'}</dd></div>
                <div><dt><Icon name="gauge" size={13} /> Fire danger</dt><dd>{fc ? <><span className="danger-chip" style={{ background: fc.color }}>{fc.label}</span>{expert && <small className="num"> FWI {fmt1(f!)}</small>}</> : '–'}</dd></div>
                <div><dt><Icon name="thermo" size={13} /> Hottest</dt><dd className="num">{w ? <>{fmt1(w.tmax)}<small> °C</small></> : '–'}</dd></div>
                <div><dt><Icon name="drop" size={13} /> Driest / rain</dt><dd className="num">{w ? <>{Math.round(w.rhmin)}<small> % · {w.rain < 0.1 ? 'no rain' : `${fmt1(w.rain)} mm`}</small></> : '–'}</dd></div>
              </dl>
              {expert && day.detections > 0 && <p className="small muted" style={{ marginTop: 0 }}>Radiative power {fmtInt(day.frp_sum)} MW summed, peak {fmt1(day.frp_max)} MW.</p>}
              {!expert && fc && <p className="small" style={{ margin: '0 0 6px' }}>{fwiMeaning(fc.label)}</p>}
              {w && <HourlyWind hours={w.hours} />}
            </div>
            <label className="check"><input type="checkbox" checked={show.imagery} onChange={(e) => setShow((x) => ({ ...x, imagery: e.target.checked }))} />{expert ? 'Satellite true-colour image of this day (VIIRS, GIBS)' : 'Satellite photo of this day (smoke shows)'}</label>
            {field && !reduced && <label className="check"><input type="checkbox" checked={show.streaks} onChange={(e) => setShow((x) => ({ ...x, streaks: e.target.checked }))} />{expert ? 'Moving wind streaks (NASA POWER daily mean)' : 'Moving wind lines'}</label>}
            <label className="check"><input type="checkbox" checked={show.perimeter} onChange={(e) => setShow((x) => ({ ...x, perimeter: e.target.checked }))} />EFFIS mapped burned area</label>
          </section>

          <section className="panel" aria-labelledby="days-h">
            <IconHeading icon="chart" id="days-h" className="h3">Day by day</IconHeading>
            <ol className="fire-days" aria-label="Days of the fire">
              {s.days.map((d, i) => {
                const dw = wx.get(d.date); const df = fwi.get(d.date); const c = df === undefined ? null : fwiClass(df);
                return (
                  <li key={d.date}>
                    <button type="button" aria-current={i === k} onClick={() => { setPlaying(false); setStep(i); }}>
                      <span className="fd-date">{fmtDay(d.date)}</span>
                      <span className="fd-bar" aria-label={`${d.detections} ${expert ? 'detections' : 'sightings'}`}><span style={{ width: `${(d.detections / maxDet) * 100}%` }} /><b className="num">{d.detections || ''}</b></span>
                      <span className="fd-wind">{dw ? <><WindGlyph size={14} rotate={(dw.from + 180) % 360} /><span className="num">{Math.round(dw.mean)}</span><small className="num">↑{Math.round(dw.gust)}</small></> : null}</span>
                      <span className="fd-danger" style={{ background: c?.color }} title={c ? `${c.label}${expert ? `, FWI ${fmt1(df!)}` : ''}` : 'no data'} aria-label={c ? `Fire danger ${c.label}` : 'Fire danger unknown'} />
                    </button>
                  </li>
                );
              })}
            </ol>
            <p className="hint">Bar = {expert ? 'detections' : 'satellite sightings'} that day. Arrow = where the wind blew, with the day's mean speed and strongest gust (↑) in km/h. Colour = fire danger (Fire Weather Index, EFFIS classes) worked out from the weather.</p>
          </section>

          <section className="panel" aria-labelledby="official-h">
            <IconHeading icon="shield" id="official-h" className="h3">The official record</IconHeading>
            <dl className="facts">
              <dt>Mapped by</dt><dd>EFFIS (European Forest Fire Information System){expert && `, event ${s.official.effis_id}`}</dd>
              <dt>Burned area</dt><dd className="num">{fmtInt(s.official.area_ha)} ha</dd>
              <dt>Dates</dt><dd>{s.official.firedate.slice(0, 10)}{s.official.finaldate ? ` to ${s.official.finaldate.slice(0, 10)}` : ''}{expert && ` (updated ${s.official.lastupdate.slice(0, 10)})`}</dd>
              <dt>What burned</dt><dd>{lc.map(([k2, v]) => `${k2.replace('_', ' ')} ${fmt1(v)} %`).join(' · ')}{s.official.natura2000_pct ? ` · ${fmt1(s.official.natura2000_pct)} % in Natura 2000` : ''}</dd>
            </dl>
            {s.context.length > 0 && <ul className="plain small">{s.context.map((c) => <li key={c.url} style={{ marginBottom: 8 }}>{c.text} <a href={c.url} target="_blank" rel="noopener">{c.source_label}</a></li>)}</ul>}
          </section>

          <section className="panel" aria-labelledby="read-h">
            <IconHeading icon="info" id="read-h" className="h3">How to read this</IconHeading>
            <p className="small">The dashed outline is the area EFFIS mapped as burned from satellite images. The marks are hot pixels seen on single satellite passes; they show where the fire was active, not the whole burned area, and clouds or smoke can hide them. Wind and weather come from the ERA5 reanalysis at one grid point (about 28 km), not a station on the fire.</p>
            <Tech expert={expert}>
              <p className="hint">{s.selection} Weather: {s.weather.source}, grid {s.weather.grid.join(', ')} at {s.weather.elevation_m} m. Fire Weather Index computed in your browser from ERA5 noon values with 60 days of spin-up. Moving streaks on the map: NASA POWER (MERRA-2) daily mean wind.</p>
              <p className="hint"><a href={s.official.query_url} target="_blank" rel="noopener">EFFIS query</a>{s.sources.map((x) => <span key={x.url}> · <a href={x.url} target="_blank" rel="noopener">{x.label}</a></span>)}</p>
            </Tech>
            <p className="hint">{s.credits}</p>
          </section>
        </div>
      </div>
    </div>
  );
}

/** 24 hourly wind speeds (solid) and gusts (dashed) for the chosen day. */
function HourlyWind({ hours }: { hours: { kmh: number; gust: number; dir: number }[] }) {
  const W = 300; const H = 54; const n = hours.length;
  const max = Math.max(20, ...hours.map((h) => h.gust));
  const x = (i: number) => (i / Math.max(1, n - 1)) * W;
  const path = (v: number[]) => v.map((y, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(H - (y / max) * (H - 4)).toFixed(1)}`).join('');
  return (
    <svg className="wx-chart" viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label={`Hourly wind ${Math.round(Math.min(...hours.map((h) => h.kmh)))} to ${Math.round(Math.max(...hours.map((h) => h.kmh)))} km/h, gusts up to ${Math.round(max)} km/h`}>
      <line x1="0" x2={W} y1={H} y2={H} stroke="var(--line)" />
      <path d={path(hours.map((h) => h.gust))} fill="none" stroke="var(--muted)" strokeWidth="1.1" strokeDasharray="3 3" />
      <path d={path(hours.map((h) => h.kmh))} fill="none" stroke="var(--text)" strokeWidth="1.8" />
      <text x="0" y={H + 11} fontSize="9" fill="var(--faint)">00 UTC</text><text x={W / 2} y={H + 11} fontSize="9" fill="var(--faint)" textAnchor="middle">12</text>
      <text x={W} y={H + 11} fontSize="9" fill="var(--faint)" textAnchor="end">23</text><text x="2" y="9" fontSize="9" fill="var(--faint)">{Math.round(max)} km/h</text>
    </svg>
  );
}
