import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Map as MLMap, RasterSourceSpecification } from 'maplibre-gl';
import { load, validateCatalog, validateDoc, validatePartition, type Detection } from '../lib/data';
import { useData, useReducedMotion } from '../lib/useData';
import { fmt1, fmtInt } from '../lib/format';
import { SENSOR_LABEL } from '../lib/history';
import { Link } from '../lib/router';
import { addLayers, MapView, sensorPointLayer, SensorMark, SHAPE_NAME, setGeoJSON } from '../components/MapView';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading, Tech } from '../components/Icon';

interface MariovoStory {
  reference: { status: string; source: string; source_url: string; attribution_claimed: string; reported_area_ha: number; projected_polygon_area_ha: number; provenance_gap: string; feature: GeoJSON.Feature };
  mcd64a1: { product: string; granule: string; note: string; cells: GeoJSON.FeatureCollection };
  inside_reference_detection_check: Record<string, number>;
  metrics: any;
  evidence_image: { path: string; alt: string };
  crop_bbox_wgs84: [number, number, number, number];
  gibs: { layer: string; date: string; max_zoom: number; template: string; credit: string; note: string };
}

const vStory = validateDoc<MariovoStory>('firewatch.story.mariovo.v1', ['reference', 'mcd64a1', 'metrics', 'gibs']);
const DAYS = ['2024-09-01', '2024-09-02', '2024-09-03', '2024-09-04', '2024-09-05', '2024-09-06', '2024-09-07'];
const BURN_COLORS = ['#fff3b0', '#ffd27a', '#ffad5a', '#ff8640', '#f2602e', '#cf3f2a', '#a32626'];

/** Expert sees the content as is; Simple gets it folded behind one summary line. */
export function Mariovo() {
  const story = useData('stories/mariovo-2024.json', vStory);
  const catalog = useData('catalog.json', validateCatalog);
  const [dets, setDets] = useState<Detection[] | null>(null);
  const [detError, setDetError] = useState<string | null>(null);
  const [day, setDay] = useState<string>('all');
  const [layers, setLayers] = useState({ reference: true, cells: true, dets: true, gibs: false });
  const [gibsError, setGibsError] = useState(false);
  const [map, setMap] = useState<MLMap | null>(null);
  const reduced = useReducedMotion();
  const expert = useExpert();
  const s = story.data;

  useEffect(() => {
    if (!catalog.data || !s) return;
    const [w, so, e, n] = s.crop_bbox_wgs84;
    const files = catalog.data.history.files.filter((f) => f.year === 2024);
    Promise.all(files.map((f) => load(f.data, validatePartition))).then(
      (parts) => setDets(parts.flat().filter((d) => d.t >= '2024-09-01' && d.t < '2024-09-08' && d.lon >= w && d.lon <= e && d.lat >= so && d.lat <= n)),
      (err: Error) => setDetError(err.message));
  }, [catalog.data, s]);

  const shownDets = useMemo(() => (dets ?? []).filter((d) => day === 'all' || d.t.startsWith(day)), [dets, day]);

  useEffect(() => {
    if (!map || !s) return;
    const cells = { ...s.mcd64a1.cells, features: s.mcd64a1.cells.features.filter((f) => day === 'all' || f.properties?.burn_date <= day) };
    setGeoJSON(map, 'fw-ref', { type: 'FeatureCollection', features: layers.reference ? [s.reference.feature] : [] }, 'Reference: WorldFires mirror, EFFIS-attributed (unconfirmed)');
    setGeoJSON(map, 'fw-cells', layers.cells ? cells : { type: 'FeatureCollection', features: [] }, 'Burned area: NASA MODIS MCD64A1 C6.1');
    setGeoJSON(map, 'fw-dets', { type: 'FeatureCollection', features: layers.dets ? shownDets.map((d) => ({ type: 'Feature', properties: { sensor: d.sensor }, geometry: { type: 'Point', coordinates: [d.lon, d.lat] } })) : [] }, 'Detections: NASA FIRMS');
    addLayers(map, [
      { id: 'fw-cells-fill', type: 'fill', source: 'fw-cells', paint: { 'fill-color': ['match', ['get', 'burn_date'], ...DAYS.flatMap((d, i) => [d, BURN_COLORS[i]]), '#888'] as any, 'fill-opacity': 0.55 } },
      { id: 'fw-ref-line', type: 'line', source: 'fw-ref', paint: { 'line-color': '#7fd1ff', 'line-width': 2, 'line-dasharray': [0.5, 1.5] }, layout: { 'line-cap': 'round' } },
      sensorPointLayer('fw-dets-pt', 'fw-dets', [0.5, 0.6, 0.95]),
    ]);
  }, [map, s, day, layers, shownDets]);

  useEffect(() => {
    if (!map || !s) return;
    const has = !!map.getSource('fw-gibs');
    if (layers.gibs && !has) {
      setGibsError(false);
      map.addSource('fw-gibs', { type: 'raster', tiles: [s.gibs.template], tileSize: 256, maxzoom: s.gibs.max_zoom, attribution: s.gibs.credit } as RasterSourceSpecification);
      map.addLayer({ id: 'fw-gibs-layer', type: 'raster', source: 'fw-gibs', paint: { 'raster-opacity': 0.85 } }, 'fw-cells-fill');
    } else if (!layers.gibs && has) {
      map.removeLayer('fw-gibs-layer');
      map.removeSource('fw-gibs');
    }
  }, [map, s, layers.gibs]);

  const onReady = useCallback((m: MLMap) => {
    m.on('error', (e) => { if ((e as { sourceId?: string }).sourceId === 'fw-gibs') setGibsError(true); });
    setMap(m);
  }, []);
  useEffect(() => {
    if (map && s) map.fitBounds([[s.crop_bbox_wgs84[0], s.crop_bbox_wgs84[1]], [s.crop_bbox_wgs84[2], s.crop_bbox_wgs84[3]]], { padding: 20, animate: !reduced });
  }, [map, s, reduced]);

  if (story.error) return <div className="page"><h1 id="page-title" tabIndex={-1}>Mariovo 2024</h1><p className="error panel" role="alert">Case data failed to load: {story.error}</p></div>;
  if (!s) return <div className="page"><p role="status">Loading Mariovo evidence…</p></div>;
  const m = s.metrics;
  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));
  const daily = m.firms_daily_detections_inside_reference_sep1_7 as Record<string, Record<string, number>>;

  return (
    <div className="page story">
      <p className="crumb"><Link href="/stories">Fire stories</Link> /</p>
      <h1 id="page-title" tabIndex={-1}>Mariovo / Prilep, September 2024</h1>
      <p className="kind-tag">Historical evidence study: several products that disagree, side by side</p>
      <div className="banner warn" role="note"><strong>Reference extent unconfirmed.</strong> The ~{fmtInt(s.reference.reported_area_ha)} ha perimeter is a secondary geometry ({s.reference.source}). {s.reference.provenance_gap} Figures computed inside it are conditional on that geometry.</div>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="pin" size={18} /></span><span><strong>The outline is not confirmed</strong>The fire outline comes from a secondary source, so every figure measured inside it depends on that outline.</span></li>
        <li><span className="ih-icon"><Icon name="layers" size={18} /></span><span><strong>Several kinds of evidence</strong>Before and after satellite images, MODIS burn dates, satellite sightings of heat, terrain and weather, side by side.</span></li>
        <li><span className="ih-icon"><Icon name="compare" size={18} /></span><span><strong>The products disagree</strong>They measure different things at different detail; none is used to correct another.</span></li>
        <li><span className="ih-icon"><Icon name="info" size={18} /></span><span><strong>Not a forecast</strong>It shows dated evidence. It does not give a fire-front forecast, spread speed or a reliable burned-hectare figure.</span></li>
      </ul>}
      <div className="story-grid">
        <section className="map-pane" aria-label="Mariovo evidence map">
          <MapView label="Mariovo case map: reference perimeter, MODIS burned-area cells and hotspot detections" onReady={onReady}>
            <ul className="legend" aria-label="Map legend">
              <li><span className="swatch dot" aria-hidden />Secondary reference perimeter (unconfirmed)</li>
              <li><span className="swatch" style={{ background: 'linear-gradient(90deg,#fff3b0,#a32626)' }} aria-hidden />MCD64A1 burn date 1→7 Sep (~463 m cells)</li>
              {(['modis', 'viirs-jpss1', 'viirs-snpp'] as const).map((k) => <li key={k}><SensorMark sensor={k} />{SENSOR_LABEL[k]} detection ({SHAPE_NAME[k]})</li>)}
            </ul>
          </MapView>
        </section>
        <div className="story-side">
          <section className="panel" aria-labelledby="layers-h">
            <IconHeading icon="layers" id="layers-h" className="h3">Layers and dates</IconHeading>
            <label className="stack">Show through (UTC)
              <select value={day} onChange={(e) => setDay(e.target.value)}>
                <option value="all">All of 1–7 Sep 2024</option>
                {DAYS.map((d) => <option key={d} value={d}>{d} (detections that day; burn cells up to that day)</option>)}
              </select>
            </label>
            <fieldset><legend className="sr-only">Map layers</legend>
              <label className="check"><input type="checkbox" checked={layers.reference} onChange={() => toggle('reference')} /> Reference perimeter (unconfirmed)</label>
              <label className="check"><input type="checkbox" checked={layers.cells} onChange={() => toggle('cells')} /> {expert ? 'MODIS MCD64A1 burned cells' : 'Burned-area cells (MODIS)'} ({s.mcd64a1.cells.features.length})</label>
              <label className="check"><input type="checkbox" checked={layers.dets} onChange={() => toggle('dets')} /> {expert ? 'FIRMS detections in map extent' : 'Satellite sightings of heat on this map'} ({dets ? fmtInt(shownDets.length) : '…'})</label>
              <label className="check"><input type="checkbox" checked={layers.gibs} onChange={() => toggle('gibs')} /> {expert ? 'NASA GIBS MODIS Terra true colour' : 'Satellite photo'}, {s.gibs.date}</label>
            </fieldset>
            {detError && <p className="error small" role="alert">Detections failed to load: {detError}</p>}
            {layers.gibs && <p className="small">{expert && <>{s.gibs.note} Max zoom {s.gibs.max_zoom}; tiles requested from NASA GIBS. </>}{gibsError && <strong className="error">Some imagery tiles failed to load.</strong>}</p>}
          </section>

          <section className="panel" aria-labelledby="det-h">
            <IconHeading icon="satellite" id="det-h" className="h3">{expert ? 'Hotspot detections inside the reference, 1–7 Sep (UTC)' : 'Satellite sightings of heat inside the outline, 1–7 Sep'}</IconHeading>
            {!expert && <p className="small">Each satellite sees differently and passes at different times, so their counts are not added into one fire count.</p>}
            <Tech expert={expert}>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col">Date</th><th scope="col">MODIS</th><th scope="col">NOAA-20</th><th scope="col">S-NPP</th></tr></thead>
              <tbody>{DAYS.map((d) => <tr key={d}><th scope="row">{d}</th><td>{daily[d]?.modis ?? 0}</td><td>{daily[d]?.['viirs-jpss1'] ?? 0}</td><td>{daily[d]?.['viirs-snpp'] ?? 0}</td></tr>)}</tbody>
              <tfoot><tr><th scope="row">Total</th>{(['modis', 'viirs-jpss1', 'viirs-snpp'] as const).map((k) => <td key={k}>{s.inside_reference_detection_check[k]}</td>)}</tr></tfoot>
            </table></div>
            <p className="small">Recomputed from ApexFire's exported partitions; matches the case analysis. Sensors differ in resolution and overpass timing, so the columns are not added into a fire count. The map shows all detections in the case rectangle, including outside the perimeter.</p>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="area-h">
            <IconHeading icon="compare" id="area-h" className="h3">Area: products disagree</IconHeading>
            <Tech expert={expert}>
            <dl className="facts tight">
              <dt>Reference perimeter (secondary)</dt><dd>{fmtInt(s.reference.reported_area_ha)} ha reported; polygon {fmtInt(s.reference.projected_polygon_area_ha)} ha</dd>
              <dt>MODIS MCD64A1 cells inside, 1–7 Sep</dt><dd>~{fmtInt(m.modis_mcd64a1.approx_area_ha_from_500m_cells_in_1_to_7_sep_window)} ha ({m.modis_mcd64a1.valid_burned_pixels_in_1_to_7_sep_window} cells × ~21.5 ha) — {fmtInt(m.modis_mcd64a1.approx_area_as_fraction_of_effis_reported_area * 100)}% of the reference</dd>
              <dt>HLS dNBR ≥ 0.2 inside</dt><dd>~{fmtInt(m.d_nbr.threshold_sensitivity['0.2'].area_inside_perimeter_ha)} ha (threshold sensitivity, not a calibrated estimate)</dd>
            </dl>
            </Tech>
            <p className="small">These are different measurements with different resolutions and thresholds; none is used to correct another.</p>
          </section>

          <section className="panel" aria-labelledby="hls-h">
            <IconHeading icon="eye" id="hls-h" className="h3">Before/after imagery (HLS Sentinel-2)</IconHeading>
            <figure>
              <img src={`/data/${s.evidence_image.path}`} alt={s.evidence_image.alt} loading="lazy" width="1800" height="1100" />
              <figcaption className="small">Evidence overview from the case analysis (HLS S30 23 Aug, 2 Sep, 12 Sep; dNBR; MCD64A1; terrain; WorldCover).</figcaption>
            </figure>
            <Tech expert={expert}>
            <div className="table-scroll"><table className="compact">
              <thead><tr><th scope="col">HLS date</th><th scope="col">Usable inside reference</th><th scope="col">High-aerosol share</th><th scope="col">Tile cloud metadata</th></tr></thead>
              <tbody>{Object.entries(m.hls as Record<string, any>).map(([d, v]) => <tr key={d}><th scope="row">{d}</th><td>{fmt1(v.strict_usable_fraction_of_perimeter * 100)}%</td><td>{fmt1(v.high_aerosol_fraction_of_perimeter * 100)}%</td><td>{v.cloud_cover_metadata_percent_whole_tile}%</td></tr>)}</tbody>
            </table></div>
            <p className="small">On 2 Sep the tile says 1% cloud, yet 40% of pixels inside the perimeter are high-aerosol (likely smoke); local QA matters more than tile metadata.</p>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="ctx-h">
            <IconHeading icon="leaf" id="ctx-h" className="h3">Terrain, cover and weather context</IconHeading>
            <Tech expert={expert}>
            <dl className="facts tight">
              <dt>Elevation (NASADEM)</dt><dd>{fmtInt(m.terrain.elevation_min_m)}–{fmtInt(m.terrain.elevation_max_m)} m, median slope ~{fmt1(m.terrain.median_slope_degrees)}°</dd>
              <dt>Cover (WorldCover 2021)</dt><dd>~{fmtInt(m.worldcover_2021_nearest_sampled_on_30m_grid.Grassland.fraction_of_perimeter * 100)}% grassland, ~{fmtInt(m.worldcover_2021_nearest_sampled_on_30m_grid['Tree cover'].fraction_of_perimeter * 100)}% tree cover — not fuel types or moisture</dd>
              <dt>Weather 1–7 Sep (ECMWF IFS archived forecast)</dt><dd>Wind median {m.open_meteo_historical_forecast.wind_speed_10m_m_s_min_median_max[1]} m/s, max {m.open_meteo_historical_forecast.wind_speed_10m_m_s_min_median_max[2]} m/s, gusts to {m.open_meteo_historical_forecast.wind_gusts_10m_max_m_s} m/s, mean from {fmtInt(m.open_meteo_historical_forecast.wind_direction_10m_circular_mean_from_degrees)}°; RH {m.open_meteo_historical_forecast.relative_humidity_2m_min_max_percent.join('–')}%; {fmt1(m.open_meteo_historical_forecast.precipitation_total_mm)} mm rain</dd>
            </dl>
            <p className="small">{m.open_meteo_historical_forecast.interpretation}</p>
            </Tech>
          </section>

          <section className="panel" aria-labelledby="lim-h">
            <IconHeading icon="info" id="lim-h" className="h3">What this supports, and what it does not</IconHeading>
            <p className="small">Supports: a dated evidence view of hotspots, coarse burn timing, imagery quality and context. Does not support: a fire-front forecast, rate of spread, arrival times or a reliable burned-hectare figure from hotspots.</p>
            <p className="small">The <Link href="/spread-lab">Spread Lab</Link> runs a separate, hypothetical 3-hour model scenario in this area. It is not a reconstruction of this fire and is not validated against it.</p>
            <p className="hint">Credits: NASA HLS, MODIS MCD64A1 C6.1, NASADEM, FIRMS; ESA WorldCover 2021 (CC BY 4.0); Open-Meteo / ECMWF; reference geometry via WorldFires ({s.reference.attribution_claimed} as stated by that site). Imagery {s.gibs.credit}.</p>
          </section>
        </div>
      </div>
    </div>
  );
}
