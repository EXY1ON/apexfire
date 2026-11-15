import { useCallback, useEffect, useState } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { validateDoc } from '../lib/data';
import { useData, useReducedMotion } from '../lib/useData';
import { fmt1, fmtUTC, kmh } from '../lib/format';
import { boundsOf, geometryCoords } from '../lib/geo';
import { Link } from '../lib/router';
import { addLayers, MapView, setGeoJSON } from '../components/MapView';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading, Tech } from '../components/Icon';

interface Scenario {
  calibrated: false;
  engine: { name: string; version: string; propagation: string };
  grid: { crs: string; shape: [number, number]; cell_m: number; native_effis_information: string };
  ignition: { kind: string; time_utc: string; longitude: number; latitude: number };
  weather: { selected_hours: Record<string, (string | number)[]>; wind_conversion: string; spatial_assumption: string };
  weather_source: string;
  assumptions: { moisture_kg_per_kg: Record<string, number>; canopy: string; spotting: boolean; suppression: boolean; fuel: string; exclusions: string; terrain_nodata: string; moisture: string; time: string };
  results: { burned_cells: number; burned_area_ha: number; stop_time_minutes: number; boundary_reached: boolean; arrival_range_minutes: [number, number] };
  checks: Record<string, { stop_time_minutes: number; burned_cells: number; extents_cells?: Record<string, number> }>;
  created_utc: string;
  perimeters: GeoJSON.FeatureCollection<GeoJSON.Polygon, { elapsed_minutes: number; valid_time_utc: string; burned_area_ha: number; model: string; calibrated: boolean }>;
  arrival_cells: GeoJSON.FeatureCollection<GeoJSON.Polygon, { arrival_minutes: number }>;
}

function validateScenario(raw: unknown, path: string): Scenario {
  const s = validateDoc<Scenario>('firewatch.spread.v1', ['perimeters', 'assumptions', 'engine'])(raw, path);
  const areas = s.perimeters.features.map((f) => f.properties.burned_area_ha).join('/');
  if (s.calibrated !== false || areas !== '2/4/11/17') throw new Error(`${path}: scenario does not match the verified uncalibrated 2/4/11/17 ha run`);
  return s;
}

const MOISTURE_LABEL: Record<string, string> = {
  fuel_moisture_dead_1hr: 'Dead fuel, 1-h', fuel_moisture_dead_10hr: 'Dead fuel, 10-h', fuel_moisture_dead_100hr: 'Dead fuel, 100-h',
  fuel_moisture_live_herbaceous: 'Live herbaceous', fuel_moisture_live_woody: 'Live woody', foliar_moisture: 'Foliar',
};

/** Expert sees the content as is; Simple gets it folded behind one summary line. */
export function SpreadLab() {
  const sc = useData('spread/mariovo-scenario.json', validateScenario);
  const [i, setI] = useState(3);
  const [map, setMap] = useState<MLMap | null>(null);
  const reduced = useReducedMotion();
  const expert = useExpert();
  const s = sc.data;
  const step = s?.perimeters.features[i]?.properties;

  useEffect(() => {
    if (!map || !s || !step) return;
    setGeoJSON(map, 'fw-cells', { type: 'FeatureCollection', features: s.arrival_cells.features.filter((c) => c.properties.arrival_minutes <= step.elapsed_minutes) }, 'Model: Pyretechnics (experimental)');
    setGeoJSON(map, 'fw-perim', { type: 'FeatureCollection', features: [s.perimeters.features[i]] });
    setGeoJSON(map, 'fw-ign', { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [s.ignition.longitude, s.ignition.latitude] } });
    addLayers(map, [
      { id: 'fw-cells-fill', type: 'fill', source: 'fw-cells', paint: { 'fill-color': ['interpolate', ['linear'], ['get', 'arrival_minutes'], 0, '#ffe08a', 60, '#ff9a3c', 120, '#e8572a', 180, '#a32626'], 'fill-opacity': 0.6 } },
      { id: 'fw-perim-line', type: 'line', source: 'fw-perim', paint: { 'line-color': '#f2f0ea', 'line-width': 2, 'line-dasharray': [3, 2] } },
      { id: 'fw-ign-pt', type: 'circle', source: 'fw-ign', paint: { 'circle-radius': 6, 'circle-color': '#0C0D0A', 'circle-stroke-color': '#f2f0ea', 'circle-stroke-width': 2 } },
    ]);
  }, [map, s, i, step]);

  const onReady = useCallback((m: MLMap) => setMap(m), []);
  useEffect(() => {
    if (!map || !s) return;
    const b = boundsOf(s.perimeters.features.flatMap((f) => geometryCoords(f.geometry)));
    const pad = 0.004;
    map.fitBounds([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], { animate: !reduced });
  }, [map, s, reduced]);

  if (sc.error) return <div className="page"><h1 id="page-title" tabIndex={-1}>Spread Lab</h1><p className="error panel" role="alert">Scenario failed to load: {sc.error}</p></div>;
  if (!s || !step) return <div className="page"><p role="status">Loading scenario…</p></div>;
  const w = s.weather.selected_hours;
  const end = s.perimeters.features[s.perimeters.features.length - 1].properties;

  return (
    <div className="page story">
      <h1 id="page-title" tabIndex={-1}>Spread Lab</h1>
      <div className="banner model" role="note">
        <strong>Experimental model output.</strong> One precomputed {s.engine.name} {s.engine.version} run from a <em>hypothetical</em> ignition with illustrative fuel moisture. Uncalibrated, surface fire only. It is not a reconstruction of the 2024 Mariovo fire and not a forecast.
      </div>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="spread" size={18} /></span><span><strong>A model experiment</strong>One saved computer-model run from a made-up starting point. It is not the 2024 Mariovo fire and not a forecast.</span></li>
        <li><span className="ih-icon"><Icon name="clock" size={18} /></span><span><strong>What you can see</strong>The modeled burned area at each saved step, reaching {end.burned_area_ha} modeled hectares after {end.elapsed_minutes} minutes.</span></li>
        <li><span className="ih-icon"><Icon name="info" size={18} /></span><span><strong>Not checked against real fires</strong>The model is uncalibrated. It needs local fuel, moisture and wind data and a comparison with observed fires before it can mean anything in practice.</span></li>
      </ul>}
      <div className="story-grid">
        <section className="map-pane" aria-label="Spread scenario map">
          <MapView label={`Modeled burned cells after ${step.elapsed_minutes} minutes: ${step.burned_area_ha} modeled hectares`} onReady={onReady}>
            <ul className="legend" aria-label="Map legend">
              <li><span className="swatch" style={{ background: 'linear-gradient(90deg,#ffe08a,#a32626)' }} aria-hidden />Modeled arrival 0→180 min (100 m cells)</li>
              <li><span className="swatch dash" aria-hidden />Modeled perimeter at {step.elapsed_minutes} min</li>
              <li><span className="swatch ring" aria-hidden />Hypothetical ignition</li>
            </ul>
          </MapView>
        </section>
        <div className="story-side">
          <section className="panel" aria-labelledby="steps-h">
            <IconHeading icon="clock" id="steps-h" className="h3">Saved model steps</IconHeading>
            <div className="btn-row" role="group" aria-label="Model time step">
              {s.perimeters.features.map((f, k) => (
                <button key={k} type="button" aria-pressed={k === i} className={k === i ? 'active' : ''} onClick={() => setI(k)}>{f.properties.elapsed_minutes} min</button>
              ))}
            </div>
            <div className="table-scroll"><table className="compact" aria-describedby="steps-note">
              <thead><tr><th scope="col">Elapsed</th><th scope="col">Valid time (UTC)</th><th scope="col">Modeled area</th></tr></thead>
              <tbody>{s.perimeters.features.map((f, k) => (
                <tr key={k} className={k === i ? 'current' : ''}><th scope="row">{f.properties.elapsed_minutes} min</th><td>{fmtUTC(f.properties.valid_time_utc)}</td><td>{f.properties.burned_area_ha} modeled ha</td></tr>
              ))}</tbody>
            </table></div>
            <p id="steps-note" className="small">These four steps come from one saved run ({fmtUTC(s.created_utc)}). There are no inputs to change here: a different ignition, wind or moisture would require executing the model again, which this site does not do yet.</p>
          </section>

          <section className="panel" aria-labelledby="inputs-h">
            <IconHeading icon="gauge" id="inputs-h" className="h3">Inputs and assumptions</IconHeading>
            {!expert && <p className="small">The starting point and fuel moisture are made up for the experiment; the wind and weather come from an archived weather forecast for that day. Surface fire only.</p>}
            <Tech expert={expert}>
            <dl className="facts tight">
              <dt>Ignition (hypothetical)</dt><dd>{s.ignition.kind}, {fmtUTC(s.ignition.time_utc)}, {s.ignition.latitude.toFixed(4)}, {s.ignition.longitude.toFixed(4)}</dd>
              <dt>Grid</dt><dd>{s.grid.shape[0]} × {s.grid.shape[1]} cells, {s.grid.cell_m} m, {s.grid.crs}</dd>
              <dt>Fuels</dt><dd>{s.assumptions.fuel}; {s.grid.native_effis_information}</dd>
              <dt>Canopy</dt><dd>{s.assumptions.canopy}</dd>
              <dt>Barriers</dt><dd>{s.assumptions.exclusions}</dd>
              <dt>Spotting / suppression</dt><dd>{s.assumptions.spotting ? 'on' : 'off'} / {s.assumptions.suppression ? 'on' : 'off'}</dd>
              <dt>Moisture</dt><dd>{s.assumptions.moisture}</dd>
            </dl>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col">Fuel moisture (assumed)</th><th scope="col">kg/kg</th></tr></thead>
              <tbody>{Object.entries(s.assumptions.moisture_kg_per_kg).map(([k, v]) => <tr key={k}><th scope="row">{MOISTURE_LABEL[k] ?? k}</th><td>{v}</td></tr>)}</tbody>
            </table></div>
            <h3 className="h4">Weather forcing ({s.weather_source})</h3>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col">UTC hour</th><th scope="col">Wind 10 m</th><th scope="col">From</th><th scope="col">Temp</th><th scope="col">RH</th></tr></thead>
              <tbody>{(w.time as string[]).map((t, k) => (
                <tr key={t}><th scope="row">{t.replace('T', ' ')}</th><td>{w.wind_speed_10m[k]} m/s ({fmt1(kmh(Number(w.wind_speed_10m[k])))} km/h)</td><td>{w.wind_direction_10m[k]}°</td><td>{w.temperature_2m[k]} °C</td><td>{w.relative_humidity_2m[k]} %</td></tr>
              ))}</tbody>
            </table></div>
            <p className="small">{s.weather.spatial_assumption}. {s.weather.wind_conversion}. {s.assumptions.time}.</p>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="checks-h">
            <IconHeading icon="search" id="checks-h" className="h3">Engine sanity checks</IconHeading>
            <p className="small">Controlled runs confirm the engine responds in the expected direction (e.g. wind from the west pushes growth east). They test orientation and barriers, not real-world accuracy.</p>
            <Tech expert={expert}>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col">Check</th><th scope="col">Minutes</th><th scope="col">Burned cells</th><th scope="col">Extent W/E/S/N (cells)</th></tr></thead>
              <tbody>{Object.entries(s.checks).map(([k, c]) => (
                <tr key={k}><th scope="row">{k.replace(/_/g, ' ')}</th><td>{c.stop_time_minutes}</td><td>{c.burned_cells}</td><td>{c.extents_cells ? `${c.extents_cells.west}/${c.extents_cells.east}/${c.extents_cells.south}/${c.extents_cells.north}` : '—'}</td></tr>
              ))}</tbody>
            </table></div>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="dl-h">
            <IconHeading icon="download" id="dl-h" className="h3">Download and licence</IconHeading>
            <ul className="small">
              <li><a href="/data/spread/mariovo-scenario.json" download>Scenario outputs and assumptions (JSON with GeoJSON)</a></li>
              <li><a href="/data/spread/mariovo-scenario.jpg">Scenario figure from the model run</a></li>
              <li><a href="/data/spread/PYRETECHNICS-LICENSE.txt">Pyretechnics licence terms</a>: dual community/commercial licence by Spatial Informatics Group; not MIT/Apache.</li>
            </ul>
            <p className="small">Validation needed before any operational meaning: local fuel, moisture and canopy data, fine-scale wind and held-out comparison against observed progressions such as <Link href="/stories/brvenica-2017">Brvenica 2017</Link>.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
