import { useCallback, useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { validateDoc } from '../lib/data';
import { useData, useReducedMotion } from '../lib/useData';
import { fmt1, fmt2, fmtInt, fmtUTC } from '../lib/format';
import { boundsOf, geometryCoords } from '../lib/geo';
import { Link } from '../lib/router';
import { addLayers, MapView, setGeoJSON } from '../components/MapView';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading } from '../components/Icon';

type Frame = GeoJSON.Feature<GeoJSON.Polygon, { Prop_step: number; Acqu_date: string; acquisition_utc: string; 'BA (ha)': number; Quality: string;
  Clouds: number; Smoke: number; geometry_area_ha_equal_area: number; timezone_basis: string; land_cover_pct: Record<string, number> }>;
interface Interval { from_step: number; to_step: number; elapsed_hours: number; area_gain_ha: number; interval_mean_net_growth_ha_per_hour: number; previous_area_missing_ha: number }
interface Story {
  event_id: number; source: string; source_url: string; license: string; timezone_assumption: string; limitations: string[];
  frames: Frame[]; prefire: GeoJSON.Feature<GeoJSON.Polygon, { Acqu_date: string; Info: string }>; missing: { date: string; info: string }[];
  intervals: Interval[];
  official: { source: string; query: string; identity: Record<string, string>; final_observation_vs_official_iou: number; final_observation_minus_official_reported_area_ha: number; feature: GeoJSON.Feature };
  weather: { product: string; provider: string; requested_lat_lon: number[]; returned_lat_lon: number[]; returned_elevation_m: number; note: string;
    daily_utc: { date: string; t_max_c: number; rh_min_pct: number; wind_max_ms: number; gust_max_ms: number; precip_mm: number }[] };
}

function validateStory(raw: unknown, path: string): Story {
  const s = validateDoc<Story>('firewatch.story.brvenica.v1', ['frames', 'missing', 'official'])(raw, path);
  if (s.frames.length !== 8 || s.missing.length !== 15) throw new Error(`${path}: expected 8 observed frames and 15 missing observations`);
  return s;
}

const DAYS = Array.from({ length: 24 }, (_, i) => new Date(Date.UTC(2017, 6, 23 + i)).toISOString().slice(0, 10));

export function Brvenica() {
  const story = useData('stories/brvenica-2017.json', validateStory);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [showOfficial, setShowOfficial] = useState(false);
  const [map, setMap] = useState<MLMap | null>(null);
  const reduced = useReducedMotion();
  const expert = useExpert();
  const s = story.data;

  useEffect(() => {
    if (!playing || !s) return;
    if (step >= s.frames.length - 1) { setPlaying(false); return; }
    const t = setTimeout(() => setStep((x) => x + 1), 1600);
    return () => clearTimeout(t);
  }, [playing, step, s]);

  useEffect(() => {
    if (!map || !s) return;
    const prev = step > 0 ? [s.frames[step - 1]] : [];
    setGeoJSON(map, 'fw-frame', { type: 'FeatureCollection', features: [s.frames[step]] }, 'Progression: FireSpread_MedEU v2 (CC BY 4.0)');
    setGeoJSON(map, 'fw-prev', { type: 'FeatureCollection', features: prev });
    setGeoJSON(map, 'fw-official', { type: 'FeatureCollection', features: showOfficial ? [s.official.feature] : [] }, 'Reference: EFFIS (CC BY 4.0)');
    addLayers(map, [
      { id: 'fw-frame-fill', type: 'fill', source: 'fw-frame', paint: { 'fill-color': '#FF6A00', 'fill-opacity': 0.38 } },
      { id: 'fw-frame-line', type: 'line', source: 'fw-frame', paint: { 'line-color': '#FF6A00', 'line-width': 2 } },
      { id: 'fw-prev-line', type: 'line', source: 'fw-prev', paint: { 'line-color': '#f2f0ea', 'line-width': 1.2, 'line-opacity': 0.7 } },
      { id: 'fw-official-line', type: 'line', source: 'fw-official', paint: { 'line-color': '#7fd1ff', 'line-width': 2, 'line-dasharray': [0.5, 1.5] }, layout: { 'line-cap': 'round' } },
    ]);
  }, [map, s, step, showOfficial]);

  const onReady = useCallback((m: MLMap) => setMap(m), []);
  useEffect(() => {
    if (!map || !s) return;
    const b = boundsOf(s.frames.flatMap((f) => geometryCoords(f.geometry)).concat(geometryCoords(s.official.feature.geometry)));
    map.fitBounds(b, { padding: 30, animate: !reduced });
  }, [map, s, reduced]);

  if (story.error) return <div className="page"><h1 id="page-title" tabIndex={-1}>Brvenica 2017</h1><p className="error panel" role="alert">Story data failed to load: {story.error}</p></div>;
  if (!s) return <div className="page"><p role="status">Loading Brvenica observations…</p></div>;

  const f = s.frames[step].properties;
  const interval = step > 0 ? s.intervals[step - 1] : null;
  const frameByDate = new Map(s.frames.map((fr, i) => [fr.properties.Acqu_date, i]));
  const missingByDate = new Map(s.missing.map((m) => [m.date, m.info]));
  const id = s.official.identity;
  const last = s.frames[7].properties;

  return (
    <div className="page story">
      <p className="crumb"><Link href="/stories">Fire stories</Link> /</p>
      <h1 id="page-title" tabIndex={-1}>Brvenica, July–August 2017</h1>
      <p className="kind-tag">Observed satellite-derived burned area at actual acquisition times, not a modeled or hourly fire front</p>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="satellite" size={18} /></span><span><strong>Real satellite maps</strong>{s.frames.length} dated maps of the burned area, from {s.frames[0].properties.Acqu_date} to {last.Acqu_date}, at the times the images were taken.</span></li>
        <li><span className="ih-icon"><Icon name="calendar" size={18} /></span><span><strong>Gaps stay visible</strong>On {s.missing.length} days there was no image or it was too cloudy. Playback jumps between real images; nothing is drawn in between.</span></li>
        <li><span className="ih-icon"><Icon name="compare" size={18} /></span><span><strong>Two sources, two answers</strong>The official EFFIS outline reports {fmtInt(Number(id.AREA_HA))} ha and different dates; the satellite maps end at {fmt2(last['BA (ha)'])} ha. Neither is adjusted to match the other.</span></li>
      </ul>}
      <div className="story-grid">
        <section className="map-pane" aria-label="Brvenica observed progression map">
          <MapView label={`Brvenica burned-area observation ${step + 1} of 8, ${f.Acqu_date}`} onReady={onReady}>
            <ul className="legend" aria-label="Map legend">
              <li><span className="swatch" style={{ background: '#FF6A00' }} aria-hidden />Observation {step + 1}: {f.Acqu_date}</li>
              {step > 0 && <li><span className="swatch line" aria-hidden />Previous observation (outline)</li>}
              {showOfficial && <li><span className="swatch dot" aria-hidden />EFFIS reference perimeter</li>}
            </ul>
          </MapView>
        </section>
        <div className="story-side">
          <section className="panel" aria-labelledby="replay-h">
            <IconHeading icon="clock" id="replay-h" className="h3">Observation replay</IconHeading>
            <div className="btn-row" role="group" aria-label="Replay controls">
              <button type="button" onClick={() => { setPlaying(false); setStep((x) => Math.max(0, x - 1)); }} disabled={step === 0}>← Previous</button>
              <button type="button" onClick={() => { if (step >= 7) setStep(0); setPlaying((p) => !p); }} aria-pressed={playing}>{playing ? 'Pause' : step >= 7 ? 'Replay' : 'Play'}</button>
              <button type="button" onClick={() => { setPlaying(false); setStep((x) => Math.min(7, x + 1)); }} disabled={step === 7}>Next →</button>
            </div>
            <p className="small muted">Playback jumps between real acquisitions only; nothing is drawn between them.</p>
            <ol className="day-track" aria-label="Daily observation track, 23 July to 15 August 2017">
              {DAYS.map((day) => {
                const fi = frameByDate.get(day);
                const miss = missingByDate.get(day);
                const pre = day === s.prefire.properties.Acqu_date;
                const label = fi !== undefined ? `${day}: observation ${fi + 1}` : pre ? `${day}: pre-fire reference image (not burned area)` : miss ? `${day}: no observation, ${miss}` : `${day}`;
                return (
                  <li key={day}>
                    {fi !== undefined
                      ? <button type="button" className={`trk obs${fi === step ? ' current' : ''}`} aria-label={label} title={label} aria-current={fi === step} onClick={() => { setPlaying(false); setStep(fi); }}>●</button>
                      : <span className={`trk ${pre ? 'pre' : 'miss'}`} title={label} aria-label={label} role="img">{pre ? '○' : '×'}</span>}
                  </li>
                );
              })}
            </ol>
            <p className="small"><span aria-hidden>●</span> observed burned area · <span aria-hidden>×</span> missing image or too cloudy ({s.missing.length} days) · <span aria-hidden>○</span> last pre-fire image (23 Jul)</p>
            <div aria-live="polite">
              <h3 className="h4">Observation {step + 1} of 8 · {fmtUTC(f.acquisition_utc)}</h3>
              <dl className="facts tight">
                <dt>Mapped area (source)</dt><dd>{fmt2(f['BA (ha)'])} ha</dd>
                {expert && <><dt>Geometry area (equal-area)</dt><dd>{fmt2(f.geometry_area_ha_equal_area)} ha</dd>
                <dt>Source quality</dt><dd>{f.Quality} <span className="muted small">(subjective source label)</span></dd>
                <dt>Clouds / smoke flags</dt><dd>{f.Clouds} / {f.Smoke}</dd></>}
                {interval && !expert && <><dt>Since the previous image</dt><dd>+{fmtInt(interval.area_gain_ha)} ha new over {fmt1(interval.elapsed_hours)} h</dd></>}
                {interval && expert && <><dt>Since previous observation</dt>
                  <dd>+{fmtInt(interval.area_gain_ha)} ha new over {fmt1(interval.elapsed_hours)} h · interval average {fmt1(interval.interval_mean_net_growth_ha_per_hour)} ha/h net
                    <br /><span className="muted small">Average only: there are no hourly observations. {fmt1(interval.previous_area_missing_ha)} ha of the previous outline is absent from this one (frames are not strictly nested).</span></dd></>}
              </dl>
              {expert && <p className="small muted">Time basis: {f.timezone_basis}.</p>}
            </div>
          </section>

          <section className="panel" aria-labelledby="cmp-h">
            <IconHeading icon="compare" id="cmp-h" className="h3">Two sources, two answers</IconHeading>
            <label className="check"><input type="checkbox" checked={showOfficial} onChange={(e) => setShowOfficial(e.target.checked)} /> Show EFFIS reference perimeter on map</label>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col"></th><th scope="col">FireSpread_MedEU (Planet)</th><th scope="col">EFFIS event {id.id}</th></tr></thead>
              <tbody>
                <tr><th scope="row">Final area</th><td>{fmt2(last['BA (ha)'])} ha ({last.Acqu_date})</td><td>{fmtInt(Number(id.AREA_HA))} ha</td></tr>
                <tr><th scope="row">Dates</th><td>first burned frame {s.frames[0].properties.Acqu_date}, last {last.Acqu_date}</td><td>FIREDATE {id.FIREDATE.slice(0, 10)}, FINALDATE {id.FINALDATE.slice(0, 10)}</td></tr>
                <tr><th scope="row">Location</th><td colSpan={2}><span lang="mk">{id.PROVINCE}</span> · {id.COMMUNE} · {id.COUNTRY}</td></tr>
              </tbody>
            </table></div>
            <p className="small">{expert && <>Final-frame overlap with EFFIS: IoU {fmt2(s.official.final_observation_vs_official_iou)}; area difference {fmt1(s.official.final_observation_minus_official_reported_area_ha)} ha. </>}Neither source is adjusted to match the other, and source dates need not equal ignition or extinction.</p>
          </section>

          <section className="panel" aria-labelledby="bw-h">
            <IconHeading icon="wind" id="bw-h" className="h3">{expert ? 'Weather context (ERA5 reanalysis)' : 'Weather at the time'}</IconHeading>
            {!expert && <p className="small">Daily weather reconstructed afterwards by a weather model at one mountain point, not a weather-station record and not the valley floor.</p>}
            {expert && <p className="small">{s.weather.note} Grid point {s.weather.returned_lat_lon.join(', ')} at {s.weather.returned_elevation_m} m (requested {s.weather.requested_lat_lon.join(', ')}); a mountain grid cell, not the valley floor.</p>}
            <details><summary>Daily UTC summary, 23 Jul – 15 Aug</summary>
              <div className="table-scroll"><table className="compact">
                <thead><tr><th scope="col">Date</th><th scope="col">Max °C</th><th scope="col">Min RH %</th><th scope="col">Max wind m/s</th><th scope="col">Max gust m/s</th><th scope="col">Precip mm</th></tr></thead>
                <tbody>{s.weather.daily_utc.map((d) => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.t_max_c}</td><td>{d.rh_min_pct}</td><td>{d.wind_max_ms}</td><td>{d.gust_max_ms}</td><td>{d.precip_mm}</td></tr>)}</tbody>
              </table></div>
            </details>
            <p className="hint">{s.weather.provider}.</p>
          </section>

          <section className="panel" aria-labelledby="lim-h">
            <IconHeading icon="info" id="lim-h" className="h3">Limits</IconHeading>
            <ul className="small">{s.limitations.map((l) => <li key={l}>{l}.</li>)}</ul>
            <p className="hint">Source: {s.source}, <a href={s.source_url} rel="noopener" target="_blank">Zenodo record</a>. {s.license}. Terrain for this event has not been acquired, so no model backtest is shown.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
