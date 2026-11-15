import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { useData, useReducedMotion } from '../lib/useData';
import { compass, compassWords, fmt1, fmtInt, fmtUTC, skopjeParts } from '../lib/format';
import { Link } from '../lib/router';
import { addLayers, MapView, setGeoJSON, setImage } from '../components/MapView';
import { WindParticles } from '../components/WindParticles';
import { fieldFromComponents } from '../lib/wind-field';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading, Tech } from '../components/Icon';
import { ARRIVAL_RAMP, areaAt, decodeRun, FLAME_COLORS, flameClass, paintFuel, paintRun, validateLab, validateRuns, type Backtest as BacktestRun, type Lab, type RunSummary, type Site, type Weather } from '../lib/spread-lab';

type Mode = 'whatif' | 'day' | 'fire';
const MODES: [Mode, string, string][] = [['whatif', 'What if…', 'Pick the wind, dryness and start'], ['day', 'Real days', 'Weather of real afternoons'], ['fire', 'vs. a real fire', 'Model against a mapped burn']];
// Andrews & Rothermel (1982) fire-behaviour interpretation, by flame length.
const FLAME_LABEL = ['under 1.2 m', '1.2–2.4 m', '2.4–3.4 m', 'over 3.4 m'];
const FLAME_TEXT = ['Hand crews can attack the head and flanks.', 'Too hot for hand tools at the head: engines, dozers or aircraft needed.',
  'Serious control problems; attacking the head is probably ineffective.', 'Major runs probable; attacking the head is ineffective.'];
const SPEED_NAME = ['Calm', 'Light', 'Breezy', 'Strong', 'Very strong'];
const COMPASS_GRID = ['NW', 'N', 'NE', 'W', '', 'E', 'SW', 'S', 'SE'];
const FRONT_MIN = 20;

const fromKey = (speed: number, dir: string) => (speed ? `${speed}-${dir}` : '0-calm');
const localTime = (iso: string) => skopjeParts(iso)[1];
const plusMinutes = (iso: string, m: number) => new Date(new Date(iso).getTime() + m * 60000).toISOString();
const dur = (m: number) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${Math.round(m % 60)} min` : ''}`);

function siteBox(site: Site): [number, number, number, number] {
  const lons = site.corners.map((c) => c[0]); const lats = site.corners.map((c) => c[1]);
  return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
}

/** Every option is a real precomputed engine run; the page only picks one and draws it. */
export function SpreadLab() {
  const lab = useData('spread/lab/index.json', validateLab);
  const expert = useExpert();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>('whatif');
  const [ign, setIgn] = useState('centre');
  const [dry, setDry] = useState('dry');
  const [speed, setSpeed] = useState(15);
  const [dir, setDir] = useState('N');
  const [dayId, setDayId] = useState('typical');
  const [btId, setBtId] = useState('negotino-2022');
  const [view, setView] = useState<'arrival' | 'flame'>('arrival');
  const [showFuel, setShowFuel] = useState(false);
  const [t, setT] = useState(360);
  const [playing, setPlaying] = useState(false);
  const [map, setMap] = useState<MLMap | null>(null);
  const L = lab.data;

  const sel = useMemo(() => {
    if (!L) return null;
    if (mode === 'fire') {
      const b = L.backtests.find((x) => x.id === btId) ?? L.backtests[0];
      return { bt: b, file: b.file, key: 'backtest', summary: b.summary, horizon: b.horizon_minutes, site: b.site, slider: 30, start: b.ignition.time_utc,
        point: [b.ignition.lon, b.ignition.lat] as [number, number], weather: b.weather as Weather | null, offset: new Date(b.ignition.time_utc).getUTCMinutes() };
    }
    const ig = L.ignitions.find((x) => x.id === ign) ?? L.ignitions[0];
    const bt = null as BacktestRun | null;
    if (mode === 'day') {
      const d = L.situations.find((x) => x.id === dayId) ?? L.situations[0];
      return { bt, file: d.file, key: ig.id, summary: d.runs[ig.id], horizon: d.horizon_minutes, site: L.site, slider: 10, start: d.weather.time[0],
        point: [ig.lon, ig.lat] as [number, number], weather: d.weather, offset: 0 };
    }
    const cell = L.matrix[ig.id][dry];
    const key = fromKey(speed, dir);
    return { bt, file: cell.file, key, summary: cell.runs[key], horizon: L.horizon_minutes, site: L.site, slider: 10, start: null as string | null,
      point: [ig.lon, ig.lat] as [number, number], weather: null as Weather | null, offset: 0 };
  }, [L, mode, ign, dry, speed, dir, dayId, btId]);

  const runs = useData(sel ? `spread/lab/${sel.file}` : null, validateRuns);
  const run = useMemo(() => {
    const c = sel && runs.data?.runs[sel.key];
    return c && runs.data ? decodeRun(c, runs.data.step_minutes) : null;
  }, [runs.data, sel]);
  const limit = sel ? (sel.summary.edge_minute ?? sel.horizon) : 0;
  const scenario = sel ? `${mode}|${sel.file}|${sel.key}` : '';

  // A new scenario opens on its end state; Play replays it from ignition.
  useEffect(() => { setT(limit); setPlaying(false); }, [scenario, limit]);
  useEffect(() => {
    if (!playing || !sel) return;
    if (t >= limit) { setPlaying(false); return; }
    const id = setTimeout(() => setT((x) => Math.min(limit, x + sel.slider)), reduced ? 400 : 120);
    return () => clearTimeout(id);
  }, [playing, t, limit, sel, reduced]);

  // Wind acting at minute t: constant for what-if runs, the hour's value for real weather.
  const wind = useMemo(() => {
    if (!sel) return null;
    if (!sel.weather) return speed ? { kmh: speed, from: 45 * (L?.directions.indexOf(dir) ?? 0) } : { kmh: 0, from: 0 };
    const h = Math.min(sel.weather.time.length - 1, Math.floor((t + sel.offset) / 60));
    return { kmh: sel.weather.wind_kmh[h], from: sel.weather.wind_from[h], hour: h };
  }, [sel, t, speed, dir, L]);

  useEffect(() => {
    if (!map || !L || !sel || !run) return;
    setImage(map, 'fw-fire', paintRun(run, sel.site.rows, sel.site.cols, t, limit, view, L.flame_breaks_m, FRONT_MIN), sel.site.corners,
      { opacity: 0.88 });
    setGeoJSON(map, 'fw-ign', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: sel.point } }, 'Model: Pyretechnics (experimental, uncalibrated) · Fuels: EFFIS fuel map (CC BY 4.0)');
    const bt = sel.bt;
    setGeoJSON(map, 'fw-bt-perim', { type: 'FeatureCollection', features: bt ? [{ type: 'Feature', properties: {}, geometry: bt.perimeter }] : [] });
    setGeoJSON(map, 'fw-bt-det', { type: 'FeatureCollection', features: bt ? bt.detections.filter((d) => d.after_min <= t).map((d) => ({
      type: 'Feature', properties: { reached: d.reached }, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })) : [] });
    addLayers(map, [
      { id: 'fw-bt-perim-line', type: 'line', source: 'fw-bt-perim', paint: { 'line-color': '#7fd1ff', 'line-width': 2.2, 'line-dasharray': [0.5, 1.5] }, layout: { 'line-cap': 'round' } },
      { id: 'fw-bt-det-pt', type: 'circle', source: 'fw-bt-det', paint: { 'circle-radius': 4, 'circle-color': ['case', ['get', 'reached'], '#7fd1ff', 'rgba(0,0,0,0)'],
        'circle-stroke-color': ['case', ['get', 'reached'], '#0C0D0A', '#ff5a5a'], 'circle-stroke-width': ['case', ['get', 'reached'], 1, 2] } },
      { id: 'fw-ign-pt', type: 'circle', source: 'fw-ign', paint: { 'circle-radius': 6, 'circle-color': '#0C0D0A', 'circle-stroke-color': '#f2f0ea', 'circle-stroke-width': 2 } },
    ]);
  }, [map, L, sel, run, t, limit, view, mode]);

  useEffect(() => {
    if (!map || !L || !sel) return;
    setImage(map, 'fw-fuel', showFuel ? paintFuel(sel.site, L.fuel_models) : null, sel.site.corners, { opacity: 0.5, before: 'fw-fire-layer' });
  }, [map, L, sel, showFuel]);

  const siteId = sel?.site.id;
  useEffect(() => {
    if (!map || !sel) return;
    map.fitBounds(siteBox(sel.site), { padding: 16, animate: !reduced });
    // refit only when the landscape changes, not on every scenario
  }, [map, siteId, reduced]);

  const field = useMemo(() => {
    if (!sel || !wind || wind.kmh < 1) return null;
    const [w, s, e, n] = siteBox(sel.site); const ms = wind.kmh / 3.6; const r = (wind.from * Math.PI) / 180;
    const u = -ms * Math.sin(r); const v = -ms * Math.cos(r);
    return fieldFromComponents([s, n], [w, e], [u, u, u, u], [v, v, v, v]);
  }, [sel, wind]);
  const site = sel?.site;
  const boundary = useMemo<GeoJSON.Polygon | null>(() => (site ? { type: 'Polygon', coordinates: [[...site.corners, site.corners[0]]] } : null), [site]);
  const onReady = useCallback((m: MLMap) => setMap(m), []);

  if (lab.error) return <div className="page"><h1 id="page-title" tabIndex={-1}>Spread Lab</h1><p className="error panel" role="alert">Spread Lab data failed to load: {lab.error}</p></div>;
  if (!L || !sel || !wind) return <div className="page"><p role="status">Loading Spread Lab…</p></div>;
  const s = sel.summary;
  const area = run ? areaAt(run, t) : null;
  const clock = sel.start ? (mode === 'fire' ? skopjeParts(plusMinutes(sel.start, t)).join(' ') : localTime(plusMinutes(sel.start, t))) : null;
  const topClass = flameClass(s.max_flame_m, L.flame_breaks_m);
  const fuelName = (m: number) => L.fuel_models[String(m)]?.short ?? `model ${m}`;
  const day = L.situations.find((x) => x.id === dayId) ?? L.situations[0];
  const nRuns = Object.values(L.matrix).flatMap((d) => Object.values(d)).reduce((n, c) => n + Object.keys(c.runs).length, 0) + L.situations.length * L.ignitions.length + L.backtests.length;
  const r = L.backtests.map((b) => b.metrics.model_ha / b.mapped_ha);
  const ratios = r.length > 1 ? `${Math.round(Math.min(...r))}–${Math.round(Math.max(...r))}` : `${Math.round(r[0])}`;

  return (
    <div className="page story">
      <h1 id="page-title" tabIndex={-1}>Spread Lab</h1>
      <div className="banner model" role="note">
        <strong>Experimental model output.</strong> {fmtInt(nRuns)} precomputed runs of the {L.engine.name} {L.engine.version} fire-spread engine on real terrain and
        fuel maps. Uncalibrated, surface fire only, no firefighting. A way to see how wind, dryness and terrain shape a fire, not a forecast of any fire.
      </div>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="wind" size={18} /></span><span><strong>Change the conditions</strong>Pick a starting point, the wind and how dry the vegetation is. Each choice shows a real run of the model, not a drawing.</span></li>
        <li><span className="ih-icon"><Icon name="calendar" size={18} /></span><span><strong>Real weather</strong>Replay the weather of real summer afternoons in Mariovo, from a typical day to the hottest and windiest of 2016–2025.</span></li>
        <li><span className="ih-icon"><Icon name="compare" size={18} /></span><span><strong>Checked against real fires</strong>Run on {L.backtests.length} mapped fires, the model reaches most of each real burn but ends {ratios}× larger: it ignores firefighting and needs local calibration.</span></li>
      </ul>}

      <div className="seg lab-modes" role="group" aria-label="Spread Lab view">
        {MODES.map(([m, label, hint]) => <button key={m} type="button" aria-pressed={mode === m} title={hint} onClick={() => setMode(m)}>{label}</button>)}
      </div>

      <div className="story-grid">
        <section className="map-pane" aria-label="Spread Lab map">
          <MapView label={`Modeled fire ${dur(t)} after ignition: ${area ?? '…'} modeled hectares`} onReady={onReady}>
            <ul className="legend" aria-label="Map legend">
              {view === 'arrival'
                ? <li><span className="swatch" style={{ background: `linear-gradient(90deg,${ARRIVAL_RAMP.join(',')})`, borderRadius: 2, width: 26 }} aria-hidden />Modeled arrival, 0 → {dur(limit)}</li>
                : FLAME_COLORS.map((c, k) => <li key={k}><span className="swatch" style={{ background: c, borderRadius: 2 }} aria-hidden />Flame length {FLAME_LABEL[k]}</li>)}
              <li><span className="swatch" style={{ background: '#fff8e1', borderRadius: 2 }} aria-hidden />Burning in the last {FRONT_MIN} min</li>
              <li><span className="swatch ring" aria-hidden />{mode === 'fire' ? 'Start: first satellite detection' : 'Start (assumed)'}</li>
              {mode === 'fire' && <><li><span className="swatch dot" aria-hidden />EFFIS mapped burned area</li>
                <li><span className="swatch" style={{ background: '#7fd1ff' }} aria-hidden />Detection the model had reached</li>
                <li><span className="swatch" style={{ border: '2px solid #ff5a5a' }} aria-hidden />Detection the model missed</li></>}
              {wind.kmh >= 1 && <li><Icon name="wind" size={13} />&nbsp;Wind {Math.round(wind.kmh)} km/h from {compass(wind.from)}</li>}
            </ul>
          </MapView>
          {field && boundary && map && !reduced && <WindParticles map={map} field={field} boundary={boundary} density={0.3} />}
        </section>

        <div className="story-side">
          {mode === 'whatif' && <WhatIf L={L} ign={ign} setIgn={setIgn} dry={dry} setDry={setDry} speed={speed} setSpeed={setSpeed} dir={dir} setDir={setDir} expert={expert} />}
          {mode === 'day' && <section className="panel" aria-labelledby="day-h">
            <IconHeading icon="calendar" id="day-h" className="h3">Real summer afternoons</IconHeading>
            <p className="small muted">Hourly {expert ? 'ERA5 reanalysis' : 'weather records'} at Mariovo, 12:00–18:00 local time. Dead-fuel dryness follows that day’s temperature and humidity.</p>
            <div className="lab-days" role="group" aria-label="Real day">
              {L.situations.map((d) => <button key={d.id} type="button" aria-pressed={d.id === dayId} onClick={() => setDayId(d.id)}>
                <strong>{d.label}</strong><span className="num">{d.date}</span></button>)}
            </div>
            <p className="small">{day.blurb}{day.story && <> <Link href={`/stories/${day.story}`}>Read the fire story</Link>.</>}</p>
            <Starts L={L} ign={ign} setIgn={setIgn} />
            <WeatherTable w={day.weather} expert={expert} />
          </section>}
          {mode === 'fire' && sel.bt && <Backtest L={L} bt={sel.bt} setBt={setBtId} expert={expert} />}

          <section className="panel" aria-labelledby="time-h">
            <IconHeading icon="clock" id="time-h" className="h3">Time</IconHeading>
            <div className="lab-time">
              <button type="button" className="btn-primary" onClick={() => { if (t >= limit) setT(0); setPlaying((p) => !p); }} aria-pressed={playing}>{playing ? 'Pause' : t >= limit ? 'Replay' : 'Play'}</button>
              <label className="stack"><span>{dur(t)} after ignition{clock && <> · {clock}</>}</span>
                <input type="range" min={0} max={Math.ceil(limit / sel.slider) * sel.slider} step={sel.slider} value={t}
                  onChange={(e) => { setPlaying(false); setT(Math.min(limit, Number(e.target.value))); }} aria-valuetext={`${dur(t)} after ignition`} />
              </label>
            </div>
            <div className="seg" role="group" aria-label="Colour the fire by">
              <button type="button" aria-pressed={view === 'arrival'} onClick={() => setView('arrival')}>Arrival time</button>
              <button type="button" aria-pressed={view === 'flame'} onClick={() => setView('flame')}>Flame length</button>
            </div>
          </section>

          <section className="panel" aria-labelledby="res-h">
            <IconHeading icon="spread" id="res-h" className="h3">What the model shows</IconHeading>
            {runs.error && <p className="error" role="alert">This run failed to load: {runs.error}</p>}
            {!s.spread ? <p className="banner warn">The fire did not spread: the fuel at this start is too moist to carry fire (above its moisture of extinction).</p> : <>
              <dl className="figures">
                <div><dt>Burned by {dur(t)}</dt><dd className="num">{area === null ? '…' : fmtInt(area)}<small> ha</small></dd></div>
                <div><dt>Farthest run</dt><dd className="num">{fmt1(s.run_km)}<small> km</small>{s.run_bearing !== null && <><br /><small>towards the {compassWords(s.run_bearing)}</small></>}</dd></div>
                <div><dt>Longest flames</dt><dd className="num">{fmt1(s.max_flame_m)}<small> m</small></dd></div>
                <div><dt>Fastest spread</dt><dd className="num">{fmt1(s.max_ros_m_min)}<small> m/min</small><br /><small>{fmt1(s.max_ros_m_min * 0.06)} km/h</small></dd></div>
              </dl>
              <FlameBar pct={s.flame_class_pct} />
              <p className="small"><strong>Hardest part of this fire:</strong> {FLAME_TEXT[topClass]} {expert && <span className="muted">(Andrews &amp; Rothermel 1982 interpretation; the model itself has no crown fire.)</span>}</p>
            </>}
            {s.edge_minute !== null && <p className="small lab-warn">The modeled fire reached the edge of the mapped area after {dur(s.edge_minute)}; later times are not shown.</p>}
            {mode === 'whatif' && <CompareChart L={L} ign={ign} dir={dir} speed={speed} dry={dry} />}
          </section>

          <section className="panel" aria-labelledby="fuel-h">
            <IconHeading icon="leaf" id="fuel-h" className="h3">What can burn here</IconHeading>
            <label className="check"><input type="checkbox" checked={showFuel} onChange={(e) => setShowFuel(e.target.checked)} />Show the fuel map</label>
            <ul className="lab-fuels">
              {Object.entries(sel.site.fuel_share_pct).sort((a, b) => b[1] - a[1]).map(([m, pct]) => (
                <li key={m}><span className="swatch" style={{ background: L.fuel_models[m]?.color, borderRadius: 2 }} aria-hidden />
                  <span>{expert ? `${m} · ${L.fuel_models[m]?.name}` : L.fuel_models[m]?.short}</span><span className="num muted">{fmt1(pct)} %</span></li>))}
            </ul>
            <p className="hint">Share of the burnable area of the {sel.site.name} map; {fmt1(sel.site.excluded_pct)} % of cells (unclassified, farmland gaps, built-up, water) are treated as barriers. {expert ? 'EFFIS European fuel map ver. 2017, crosswalked to Anderson (1982) / NFFL models; about 290 m source detail.' : 'From the European EFFIS fuel map, a coarse regional classification.'}</p>
          </section>

          <section className="panel" aria-labelledby="inputs-h">
            <IconHeading icon="gauge" id="inputs-h" className="h3">Inputs and assumptions</IconHeading>
            {!expert && <p className="small">Real terrain and fuel maps; one wind for the whole area; no tree-crown fire, no embers jumping ahead, no firefighting.</p>}
            <Tech expert={expert}>
              <ul className="small">{Object.entries(L.assumptions).map(([k, v]) => <li key={k}>{v}</li>)}</ul>
              <div className="table-scroll"><table className="compact">
                <caption className="small muted">What-if dryness (Scott &amp; Burgan 2005 moisture scenarios, % of dry weight)</caption>
                <thead><tr><th scope="col">Level</th><th scope="col">Dead 1-h / 10-h / 100-h</th><th scope="col">Live herb / woody</th></tr></thead>
                <tbody>{L.dryness.map((d) => { const m = Object.values(d.moisture).map((v) => Math.round(v * 100)); return <tr key={d.id}><th scope="row">{d.label} ({d.scenario})</th><td>{m.slice(0, 3).join(' / ')}</td><td>{m.slice(3).join(' / ')}</td></tr>; })}</tbody>
              </table></div>
              <dl className="facts tight">
                <dt>Landscape</dt><dd>{L.site.name}: {L.site.rows} × {L.site.cols} cells of {L.site.cell_m} m, {L.site.crs}</dd>
                <dt>Starts</dt><dd>{L.ignitions.map((x) => `${x.label}: ${fuelName(x.fuel_model)}, ${x.elevation_m} m, slope ${x.slope_pct} %`).join('; ')}</dd>
                <dt>Local wind</dt><dd>{L.climate.window}: median {L.climate.wind_kmh.p50} km/h, 99th percentile {L.climate.wind_kmh.p99}, calm (under 5 km/h) {L.climate.calm_pct} % of hours; gusts median {L.climate.gust_kmh.p50} km/h. {L.climate.source}, cell {L.climate.cell.join(', ')} ({L.climate.cell_elevation_m} m).</dd>
                <dt>Local dryness</dt><dd>Estimated 1-h dead fuel moisture on those hours: median {L.climate.dead_1h_pct.p50} %, driest tenth below {L.climate.dead_1h_pct.p10} %.</dd>
                <dt>Engine</dt><dd>{L.engine.name} {L.engine.version}, {L.engine.propagation}</dd>
                <dt>Built</dt><dd>{fmtUTC(L.created_utc)} by <code>tools/run_spread_lab.py</code></dd>
              </dl>
              {expert && <ul className="small muted lab-hashes">{L.inputs.map((x) => <li key={x.path}>{x.path} · sha256 {x.sha256.slice(0, 12)}…</li>)}</ul>}
            </Tech>
          </section>

          <section className="panel" aria-labelledby="checks-h">
            <IconHeading icon="search" id="checks-h" className="h3">Engine sanity checks</IconHeading>
            <p className="small">Controlled runs confirm the engine responds in the expected direction (wind from the west pushes growth east) and stops at barriers. The original Spread Lab run (2 Sep 2024, 17 ha) is reproduced cell for cell on every rebuild. These test the engine’s behaviour, not real-world accuracy.</p>
            <Tech expert={expert}>
              <div className="table-scroll"><table className="compact">
                <thead><tr><th scope="col">Check</th><th scope="col">Minutes</th><th scope="col">Burned cells</th><th scope="col">Extent W/E/S/N (cells)</th></tr></thead>
                <tbody>{Object.entries(L.checks).map(([k, c]) => (
                  <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td>{c.stop_time_minutes}</td><td>{c.burned_cells}</td><td>{c.extents_cells ? `${c.extents_cells.west}/${c.extents_cells.east}/${c.extents_cells.south}/${c.extents_cells.north}` : '—'}</td></tr>
                ))}</tbody>
              </table></div>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="dl-h">
            <IconHeading icon="download" id="dl-h" className="h3">Download and licence</IconHeading>
            <ul className="small">
              <li><a href="/data/spread/lab/index.json" download>All run summaries, weather and assumptions (JSON)</a></li>
              <li><a href={`/data/spread/lab/${sel.file}`} download>This group of runs (JSON, arrival and flame grids)</a></li>
              <li><a href="/data/spread/mariovo-scenario.json" download>Original verified run with perimeters (JSON with GeoJSON)</a> and its <a href="/data/spread/mariovo-scenario.jpg">figure</a></li>
              <li><a href="/data/spread/PYRETECHNICS-LICENSE.txt">Pyretechnics licence terms</a>: dual community/commercial licence by Spatial Informatics Group; not MIT/Apache.</li>
            </ul>
            <ul className="small muted">{L.credits.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function Starts({ L, ign, setIgn }: { L: Lab; ign: string; setIgn: (v: string) => void }) {
  return <fieldset><legend>Start</legend><div className="btn-row" role="group" aria-label="Starting point">
    {L.ignitions.map((x) => <button key={x.id} type="button" aria-pressed={x.id === ign} onClick={() => setIgn(x.id)}>{x.label}</button>)}
  </div></fieldset>;
}

function WhatIf({ L, ign, setIgn, dry, setDry, speed, setSpeed, dir, setDir, expert }: { L: Lab; ign: string; setIgn: (v: string) => void; dry: string; setDry: (v: string) => void;
  speed: number; setSpeed: (v: number) => void; dir: string; setDir: (v: string) => void; expert: boolean }) {
  const c = L.climate;
  const si = L.speeds.indexOf(speed);
  const di = L.dryness.findIndex((d) => d.id === dry);
  const speedNote = si === 0 ? 'No wind: the fire spreads by itself, faster uphill.'
    : c.speed_at_least_pct[si] > 0 ? `${SPEED_NAME[si]}. In Mariovo the hourly mean wind reaches this on ${c.speed_at_least_pct[si]} % of summer-afternoon hours; gusts on ${c.gust_at_least_pct[si]} %.`
    : `${SPEED_NAME[si]}. Stronger than any hourly mean wind on Mariovo summer afternoons in 2016–2025 (highest ${c.wind_kmh.max} km/h), but gusts reach it on ${c.gust_at_least_pct[si]} % of hours; ridges and gaps can see more than this ~30 km average.`;
  return (
    <section className="panel" aria-labelledby="whatif-h">
      <IconHeading icon="wind" id="whatif-h" className="h3">Choose the conditions</IconHeading>
      <p className="small muted">On the real Mariovo landscape south of Prilep, six hours from a single burning cell.</p>
      <Starts L={L} ign={ign} setIgn={setIgn} />
      <fieldset><legend>Wind speed, km/h at 10 m</legend>
        <div className="seg" role="group" aria-label="Wind speed">
          {L.speeds.map((v) => <button key={v} type="button" aria-pressed={v === speed} onClick={() => setSpeed(v)} aria-label={v ? `${v} km/h` : 'Calm'}>{v || 'Calm'}</button>)}
        </div>
        <p className="hint">{speedNote}{si === 1 && ` Median summer afternoon: ${c.wind_kmh.p50} km/h.`}</p>
      </fieldset>
      <fieldset disabled={!speed}><legend>Wind from</legend>
        <div className="lab-compass" role="group" aria-label="Wind direction (where it blows from)">
          {COMPASS_GRID.map((d, k) => {
            if (!d) return <span key={k} className="lab-compass-mid" aria-hidden="true"><Icon name="wind" size={16} /></span>;
            const share = c.rose_pct[L.directions.indexOf(d)];
            return <button key={d} type="button" aria-pressed={speed > 0 && d === dir} onClick={() => setDir(d)} aria-label={`From ${d}: ${share} % of breezy summer afternoons`}>
              <strong>{d}</strong><span className="lab-rose" style={{ width: `${Math.min(100, share * 2)}%` }} aria-hidden="true" /><small>{share} %</small></button>;
          })}
        </div>
        <p className="hint">Bars: how often the wind blows from each side on summer afternoons with some wind ({expert ? `${c.source}, ${c.window}` : 'ERA5 weather records, 2016–2025'}). Northerlies dominate.</p>
      </fieldset>
      <fieldset><legend>Vegetation dryness</legend>
        <div className="seg" role="group" aria-label="Vegetation dryness">
          {L.dryness.map((d) => <button key={d.id} type="button" aria-pressed={d.id === dry} onClick={() => setDry(d.id)}>{d.label}</button>)}
        </div>
        <p className="hint">Fine dead fuel at {Math.round(L.dryness[di].moisture.fuel_moisture_dead_1hr * 100)} % moisture{expert && ` (${L.dryness[di].scenario})`}. Summer afternoons this dry or drier in Mariovo: {c.dryness_at_or_below_pct[di]} % of hours.</p>
      </fieldset>
    </section>
  );
}

function FlameBar({ pct }: { pct: number[] }) {
  return (
    <div className="lab-flamebar" role="img" aria-label={`Burned area by flame length: ${pct.map((p, k) => `${FLAME_LABEL[k]} ${p} %`).join(', ')}`}>
      {pct.map((p, k) => p > 0 && <span key={k} style={{ width: `${p}%`, background: FLAME_COLORS[k] }} title={`${FLAME_LABEL[k]}: ${p} %`} />)}
    </div>
  );
}

/** Area after 2 h against wind speed, one line per dryness level, for the current start and direction (log scale). */
function CompareChart({ L, ign, dir, speed, dry }: { L: Lab; ign: string; dir: string; speed: number; dry: string }) {
  const W = 320; const H = 150; const P = { l: 34, r: 8, t: 8, b: 22 };
  const at = L.checkpoints.indexOf(120);
  const x = (k: number) => P.l + (k / (L.speeds.length - 1)) * (W - P.l - P.r);
  const y = (ha: number) => P.t + (1 - Math.log10(Math.max(1, ha)) / 4) * (H - P.t - P.b);
  const series = L.dryness.map((d, di) => ({ d, di, pts: L.speeds.map((v, k) => {
    const r: RunSummary = L.matrix[ign][d.id].runs[fromKey(v, dir)];
    const ha = r.area_ha[at];
    return { k, ha: ha ?? r.final_ha, edge: ha === null };
  }) }));
  const lineColor = ['#ff6a00', '#ffb347', '#c9b28a', '#7fa8c9'];
  return (
    <figure className="lab-chart">
      <figcaption className="small"><strong>Area after 2 hours</strong> by wind speed, wind from {dir}, this start</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={series.map((s) => `${s.d.label}: ${s.pts.map((p) => `${L.speeds[p.k]} km/h ${p.ha} ha`).join(', ')}`).join('; ')}>
        {[1, 10, 100, 1000, 10000].map((v) => <g key={v}><line x1={P.l} x2={W - P.r} y1={y(v)} y2={y(v)} stroke="var(--line-soft)" />
          <text x={P.l - 4} y={y(v) + 3} fontSize="8" textAnchor="end" fill="var(--faint)">{v >= 1000 ? `${v / 1000}k` : v}</text></g>)}
        {L.speeds.map((v, k) => <text key={v} x={x(k)} y={H - 6} fontSize="8" textAnchor="middle" fill={v === speed ? 'var(--text)' : 'var(--faint)'}>{v} km/h</text>)}
        {series.map((s) => <g key={s.d.id} opacity={s.d.id === dry ? 1 : 0.55}>
          <path d={s.pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.k).toFixed(1)},${y(p.ha).toFixed(1)}`).join('')} fill="none" stroke={lineColor[s.di]} strokeWidth={s.d.id === dry ? 2.2 : 1.2} />
          {s.pts.map((p) => <circle key={p.k} cx={x(p.k)} cy={y(p.ha)} r={p.edge ? 3.2 : 2} fill={p.edge ? 'var(--ink-1)' : lineColor[s.di]} stroke={lineColor[s.di]} />)}
        </g>)}
      </svg>
      <ul className="lab-chart-key">{series.map((s) => <li key={s.d.id}><span className="swatch line" style={{ background: lineColor[s.di] }} aria-hidden />{s.d.label}</li>)}
        <li><span className="swatch ring" aria-hidden />reached the map edge first</li></ul>
    </figure>
  );
}

/** Hourly forcing; one-day tables show the clock time only, multi-day ones the date too. */
function WeatherTable({ w, expert, every = 1, dated = false }: { w: Weather; expert: boolean; every?: number; dated?: boolean }) {
  const rows = w.time.map((_, k) => k).filter((k) => k % every === 0);
  const when = (iso: string) => { const [d, h] = skopjeParts(iso); const hm = h.split(' ')[0]; return dated ? `${d.replace(/ \d{4}$/, '')}, ${hm}` : hm; };
  return (
    <div className="table-scroll"><table className="compact nowrap">
      <thead><tr><th scope="col">{expert ? 'UTC' : `Local (${skopjeParts(w.time[0])[1].split(' ')[1]})`}</th><th scope="col">Wind</th><th scope="col">From</th><th scope="col">Temp</th><th scope="col">RH</th><th scope="col">{expert ? '1-h fuel' : 'Fine fuel moisture'}</th></tr></thead>
      <tbody>{rows.map((k) => <tr key={w.time[k]}><th scope="row">{expert ? fmtUTC(w.time[k]).slice(dated ? 5 : 11, 16) : when(w.time[k])}</th>
        <td>{Math.round(w.wind_kmh[k])} km/h</td><td>{compass(w.wind_from[k])}</td><td>{fmt1(w.t[k])} °C</td><td>{Math.round(w.rh[k])} %</td><td>{fmt1(w.dead_1h_pct[k])} %</td></tr>)}</tbody>
    </table></div>
  );
}

function Backtest({ L, bt, setBt, expert }: { L: Lab; bt: BacktestRun; setBt: (id: string) => void; expert: boolean }) {
  const b = bt; const m = b.metrics; const ratio = m.model_ha / b.mapped_ha;
  return (
    <section className="panel" aria-labelledby="bt-h">
      <IconHeading icon="compare" id="bt-h" className="h3">Model vs. real fires</IconHeading>
      <div className="btn-row" role="group" aria-label="Real fire">
        {L.backtests.map((x) => <button key={x.id} type="button" aria-pressed={x.id === b.id} onClick={() => setBt(x.id)}>{x.name}</button>)}
      </div>
      <p className="small">EFFIS mapped <strong>{fmtInt(b.mapped_ha)} ha</strong> burned. The same engine starts where satellites first saw the fire ({fmtUTC(b.ignition.time_utc)}, {b.ignition.detections} detection{b.ignition.detections === 1 ? '' : 's'}) and
        runs with that period’s hourly weather until the last detection. <Link href={`/stories/${b.story}`}>Read the fire story</Link>.</p>
      <dl className="figures">
        <div><dt>Real fire</dt><dd className="num">{fmtInt(b.mapped_ha)}<small> ha</small><br /><small>detections over {dur(b.horizon_minutes)}</small></dd></div>
        <div><dt>Model</dt><dd className="num">{fmtInt(m.model_ha)}<small> ha</small><br /><small>{b.summary.edge_minute !== null ? `by ${dur(b.summary.edge_minute)}, at the map edge` : `after ${dur(b.horizon_minutes)}`}</small></dd></div>
        <div><dt>Real burn covered</dt><dd className="num">{m.mapped_reached_pct}<small> %</small></dd></div>
        <div><dt>Model outside it</dt><dd className="num">{m.model_outside_pct}<small> %</small></dd></div>
      </dl>
      <p className="small"><strong>What this shows:</strong> the model reaches {m.mapped_reached_pct} % of the real burn and ends {fmt1(ratio)}× larger than it{m.model_matches_mapped_min !== null && <>; it is already as large as the whole real fire after {dur(m.model_matches_mapped_min)}</>}.
        {' '}{m.detections_reached_pct} % of the {m.detections} satellite detections fell where the model had already arrived by then{m.detections_reached_pct < 50 ? ', so early on it spreads too slowly and in the wrong places' : ''}.
        {' '}Firefighting, roads and fields the fuel map misses, and local winds all shape real fires; the model knows none of them. Calibrating it on many such fires is the next step before it can say anything practical.</p>
      <div className="table-scroll"><table className="compact nowrap">
        <caption className="small muted">All model checks against mapped fires</caption>
        <thead><tr><th scope="col">Fire</th><th scope="col">Mapped</th><th scope="col">Model</th><th scope="col">Covered</th><th scope="col">Outside</th><th scope="col">Detections reached</th></tr></thead>
        <tbody>{L.backtests.map((x) => <tr key={x.id} className={x.id === b.id ? 'current' : ''}><th scope="row">{x.name}</th><td>{fmtInt(x.mapped_ha)} ha</td><td>{fmtInt(x.metrics.model_ha)} ha</td>
          <td>{x.metrics.mapped_reached_pct} %</td><td>{x.metrics.model_outside_pct} %</td><td>{x.metrics.detections_reached_pct} %</td></tr>)}</tbody>
      </table></div>
      <Tech expert={expert}>
        <dl className="facts tight">
          <dt>Start</dt><dd>Burnable cell nearest the first overpass ({b.ignition.lat}, {b.ignition.lon}), fuel {L.fuel_models[String(b.ignition.fuel_model)]?.name}</dd>
          <dt>Mapped area on the grid</dt><dd>{fmtInt(b.mapped_grid_ha)} cells of 1 ha (EFFIS {b.effis_id}: {fmtInt(b.mapped_ha)} ha)</dd>
          <dt>Fuels inside the real burn</dt><dd>{Object.entries(b.mapped_fuel_pct).map(([k, v]) => `${k === '0' ? 'barrier' : L.fuel_models[k]?.short} ${v} %`).join(', ')}</dd>
          <dt>Overlap</dt><dd>{fmtInt(m.overlap_ha)} ha of model inside the mapped area</dd>
        </dl>
        <WeatherTable w={b.weather} expert={expert} every={3} dated />
      </Tech>
    </section>
  );
}
