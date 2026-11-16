import { useEffect, useMemo, useState } from 'react';
import type { Map as MLMap, MapLayerMouseEvent } from 'maplibre-gl';
import { validateGeoJSON } from '../lib/data';
import { useData } from '../lib/useData';
import { useExpert } from '../lib/mode';
import { download, fmt1, fmtInt } from '../lib/format';
import { MapView } from '../components/MapView';
import { Icon, IconHeading } from '../components/Icon';
import { SeriesLegend, StackedBars } from '../components/StackedBars';
import { BURNED_PATH, LANDSCAPE_PATH, useBurnedLayer, useLandCover } from '../components/LandscapeLayers';
import { burnedFor, monthlyAverage, ratioText, START_SENSORS, tableCSV, toShares, validateLandscape, yearsOf, type StartSensor } from '../lib/landscape';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SENSOR_NAME: Record<StartSensor, string> = { 'viirs-snpp': 'VIIRS S-NPP', modis: 'MODIS', 'viirs-jpss1': 'VIIRS NOAA-20' };
const pct = (v: number) => `${fmt1(v * 100)} %`;
const cell = (v: string | number) => (typeof v === 'number' ? (Number.isInteger(v) ? fmtInt(v) : fmt1(v)) : v);
const r1 = (v: number) => Math.round(v * 10) / 10;

/** A chart's numbers as a table, with a CSV download in Expert (D23). */
function Numbers({ title = 'The numbers', name, header, rows, expert, credit, open = false }: {
  title?: string; name: string; header: string[]; rows: (string | number)[][]; expert: boolean; credit: string; open?: boolean;
}) {
  return (
    <details open={open}>
      <summary>{title}</summary>
      <div className="table-scroll"><table className="compact">
        <thead><tr>{header.map((h) => <th key={h} scope="col">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r) => <tr key={String(r[0])}>{r.map((v, i) => (i ? <td key={i} className="num">{cell(v)}</td> : <th key={i} scope="row">{v}</th>))}</tr>)}</tbody>
      </table></div>
      {expert && <button type="button" onClick={() => download(`apexfire-${name}.csv`, tableCSV(header, rows, credit), 'text/csv')}><Icon name="download" size={16} />CSV</button>}
    </details>
  );
}

/** "More than its share" bars; the tick marks 1× (in proportion to the land). */
function ShareBars({ rows, label }: { rows: { label: string; color: string; land: number; ratio: number }[]; label: string }) {
  const max = Math.max(2, ...rows.map((r) => r.ratio));
  return (
    <ul className="share-bars" aria-label={label}>
      {rows.filter((r) => r.land > 0).map((r) => (
        <li key={r.label}>
          <span className="sb-label">{r.label}<small>{pct(r.land)} of the land</small></span>
          <span className="sb-track" aria-hidden><span className="sb-bar" style={{ width: `${(r.ratio / max) * 100}%`, background: r.color }} /><span className="sb-one" style={{ left: `${(1 / max) * 100}%` }} /></span>
          <b className="num">{ratioText(r.ratio)}</b>
        </li>
      ))}
    </ul>
  );
}

export function Landscape() {
  const expert = useExpert();
  const doc = useData(LANDSCAPE_PATH, validateLandscape);
  const burned = useData(BURNED_PATH, validateGeoJSON);
  const [map, setMap] = useState<MLMap | null>(null);
  const [show, setShow] = useState({ land: true, burned: true });
  const [year, setYear] = useState<number | 'all'>('all');
  const [sensor, setSensor] = useState<StartSensor>('viirs-snpp');
  const [source, setSource] = useState<'nasa' | 'effis'>('nasa');
  const [shares, setShares] = useState(false);
  const [picked, setPicked] = useState<Record<string, unknown> | null>(null);
  useLandCover(map, show.land);
  const fc = useMemo(() => (burned.data && show.burned ? burnedFor(burned.data, year) : null), [burned.data, show.burned, year]);
  useBurnedLayer(map, fc);
  useEffect(() => {
    if (!map) return;
    const pick = (e: MapLayerMouseEvent) => setPicked(e.features?.[0]?.properties ?? null);
    const enter = () => { map.getCanvas().style.cursor = 'pointer'; };
    const leave = () => { map.getCanvas().style.cursor = ''; };
    map.on('click', 'fw-burned-fill', pick); map.on('mouseenter', 'fw-burned-fill', enter); map.on('mouseleave', 'fw-burned-fill', leave);
    return () => { map.off('click', 'fw-burned-fill', pick); map.off('mouseenter', 'fw-burned-fill', enter); map.off('mouseleave', 'fw-burned-fill', leave); };
  }, [map]);
  useEffect(() => setPicked(null), [year]);

  if (doc.error) return <div className="page prose"><h1 id="page-title" tabIndex={-1}>Landscape</h1><p className="error" role="alert">{doc.error}</p></div>;
  const d = doc.data;
  if (!d) return <div className="page prose"><p role="status">Loading the landscape…</p></div>;

  const credit = d.credits.join(' ');
  const groups = d.groups.map((g) => ({ label: g.label, color: g.color }));
  const fields = d.fields.map((f) => ({ label: f.label, color: f.color }));
  const st = d.starts[sensor];
  const avg = monthlyAverage(st);
  const asShares = shares && expert;
  const monthRows = asShares ? toShares(avg) : avg;
  const act = d.activity[sensor];
  const actAvg = act.by_month_group.map((r) => r.map((v) => v / (act.years[1] - act.years[0] + 1)));
  const nasaYears = yearsOf(d.nasa.years); const effisYears = yearsOf(d.effis.years);
  const burnRows = source === 'nasa' ? d.nasa.by_year_group : d.effis.ge30.by_year_field;
  const burnCats = source === 'nasa' ? nasaYears.map(String) : effisYears.map((y) => (y === d.effis.years[1] ? `${y}*` : String(y)));
  const burnClasses = source === 'nasa' ? d.groups : d.fields;
  const catches = d.shares.catches[sensor].map((r, i) => ({ ...groups[i], land: d.shares.catches_land[sensor][i], ratio: r }));
  const consumes = source === 'nasa'
    ? d.shares.consumes_nasa.map((r, i) => ({ ...groups[i], land: d.shares.consumes_nasa_land[i], ratio: r }))
    : d.shares.consumes_effis.map((r, i) => ({ ...fields[i], land: d.shares.consumes_effis_land[i], ratio: r }));
  const sum = (r: number[]) => r.reduce((a, b) => a + b, 0);
  const largest = year !== 'all' && fc ? [...fc.features].sort((a, b) => Number(b.properties?.area_ha) - Number(a.properties?.area_ha)).slice(0, 10) : [];

  return (
    <div className="page story">
      <IconHeading as="h1" icon="leaf" id="page-title">Landscape</IconHeading>
      <p className="kind-tag">What burns in North Macedonia: land cover (CORINE), mapped burned areas (EFFIS, NASA MCD64A1) and fire starts seen by satellites (NASA FIRMS).</p>
      <div className="story-grid">
        <section className="map-pane" aria-label="Map of land cover and mapped burned areas">
          <MapView label="North Macedonia land cover and mapped burned areas" onReady={setMap}>
            <ul className="legend" aria-label="Map legend">
              {show.burned && <li><span className="swatch" style={{ background: 'rgba(255,106,0,0.35)', border: '1px solid #ff8a3d' }} aria-hidden />Mapped burned area{year === 'all' ? ', 2016 to now' : `, ${year}`}</li>}
              {show.land && d.groups.map((g) => <li key={g.id}><span className="swatch" style={{ background: g.color }} aria-hidden />{g.label}</li>)}
            </ul>
          </MapView>
        </section>
        <div className="story-side">
          <section aria-labelledby="ls-take-h">
            <IconHeading icon="leaf" id="ls-take-h" className="h3">{expert ? 'Takeaways' : 'In short'}</IconHeading>
            <ul className="plain">{d.takeaways.map((t) => <li key={t.id} style={{ marginBottom: 8 }}>{t.text}</li>)}</ul>
            {expert && <p className="hint">Generated from the exported numbers on {d.export_date} by fixed templates; no figure is typed by hand.</p>}
          </section>

          <section aria-labelledby="ls-map-h">
            <IconHeading icon="map" id="ls-map-h" className="h3">On the map</IconHeading>
            <label className="check"><input type="checkbox" checked={show.land} onChange={(e) => setShow((s) => ({ ...s, land: e.target.checked }))} />Land cover (CORINE 2018)</label>
            <label className="check"><input type="checkbox" checked={show.burned} onChange={(e) => setShow((s) => ({ ...s, burned: e.target.checked }))} />Mapped burned areas (EFFIS)</label>
            <label className="stack">Year
              <select value={String(year)} onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
                <option value="all">All, {d.effis.years[0]}–{d.effis.years[1]}</option>
                {effisYears.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            {burned.error && <p className="error small" role="alert">{burned.error}</p>}
            {picked ? <p className="small" role="status"><strong>{fmtInt(Number(picked.area_ha))} ha mapped, {String(picked.firedate)}{picked.finaldate ? ` to ${String(picked.finaldate)}` : ''}</strong>
              {picked.small ? ' · under 30 ha, so not counted in the charts' : ''}<br />
              {d.raw_fields.filter((f) => Number(picked[f.id]) > 0).map((f) => `${f.label} ${fmt1(Number(picked[f.id]))} %`).join(' · ') || 'EFFIS has not given a land-cover breakdown for this fire yet.'}</p>
              : <p className="hint">Tap a burned area for its dates, size and what it burned.</p>}
            {largest.length > 0 && <details><summary>Largest mapped fires in {year}</summary><ul className="plain">{largest.map((f) => (
              <li key={String(f.properties?.id)}><button type="button" className="link-btn" onClick={() => setPicked(f.properties ?? null)}>{fmtInt(Number(f.properties?.area_ha))} ha from {String(f.properties?.firedate)}</button></li>))}</ul></details>}
            {expert && <Numbers title="Land cover by CORINE code (2018)" name="corine-2018" expert credit={credit} header={['CORINE code', 'Group', 'Share of land %']}
              rows={Object.entries(d.land['2018'].codes).sort((a, b) => b[1] - a[1]).map(([c, v]) => [c, d.groups.find((g) => g.codes.includes(c))?.label ?? '–', r1(v * 100)])} />}
          </section>

          <section aria-labelledby="ls-when-h">
            <IconHeading icon="calendar" id="ls-when-h" className="h3">What catches fire, and when</IconHeading>
            <div className="seg" role="group" aria-label="Satellite">{START_SENSORS.map((s) => (
              <button key={s} type="button" aria-pressed={sensor === s} onClick={() => setSensor(s)}>{SENSOR_NAME[s]} {d.starts[s].years[0]}–{d.starts[s].years[1]}</button>))}</div>
            {expert && <label className="check"><input type="checkbox" checked={shares} onChange={(e) => setShares(e.target.checked)} />Shares within each month</label>}
            <StackedBars categories={MONTHS} series={groups} values={monthRows} unit={asShares ? '' : 'starts'} fmt={asShares ? pct : fmt1}
              label={`${asShares ? 'Share of fire starts' : 'Average fire starts'} per month by land type, ${SENSOR_NAME[sensor]} ${st.years.join('–')}`} />
            <SeriesLegend series={groups} values={monthRows} />
            <p className="small">{expert
              ? `${fmtInt(st.total)} fire starts: detections joined within 2 km and ${st.gap_hours} h, each classed by the land under its first detection's footprint (the CORINE edition at or before its year). With a 48 h gap there would be ${fmtInt(st.total_48h)} (${fmt1(100 * (1 - st.total_48h / st.total))} % fewer).`
              : 'Each bar is an average month: how many fires started and on what land. A fire start is the first time satellites saw a fire, not the confirmed moment it was lit.'}</p>
            <Numbers name={`fire-starts-${sensor}`} header={['Month', ...d.groups.map((g) => g.label)]} rows={MONTHS.map((m, i) => [m, ...monthRows[i].map((v) => (asShares ? r1(v * 100) : r1(v)))])} expert={expert} credit={credit} />
            {expert && <>
              <h4 className="eyebrow">Fire activity: every detection</h4>
              <StackedBars categories={MONTHS} series={groups} values={actAvg} unit="detections" fmt={fmt1} label={`Average detections per month by land type, ${SENSOR_NAME[sensor]}`} />
              <p className="hint">{fmtInt(act.detections)} vegetation-fire detections, each shared over the land under its footprint. Long fires weigh more here than in fire starts.</p>
            </>}
          </section>

          <section aria-labelledby="ls-share-h">
            <IconHeading icon="compare" id="ls-share-h" className="h3">Burns more than its share</IconHeading>
            <p className="small">Above 1× a land type catches fire, or loses area to fire, more often than its size alone would suggest; below 1×, less.</p>
            <h4 className="eyebrow">Catches fire ({SENSOR_NAME[sensor]})</h4>
            <ShareBars rows={catches} label={`Fire starts relative to land share, ${SENSOR_NAME[sensor]}`} />
            <h4 className="eyebrow">Fire consumes ({source === 'nasa' ? 'NASA MCD64A1' : 'EFFIS, fires of 30 ha and up'})</h4>
            <ShareBars rows={consumes} label="Burned area relative to land share" />
            <Numbers name={`more-than-its-share-${sensor}`} header={['Land type', 'Share of land %', 'Catches fire ×', 'Fire starts per 100 km² per year']}
              rows={catches.map((c, i) => [c.label, r1(c.land * 100), c.ratio, d.shares.rates[sensor][i]])} expert={expert} credit={credit} />
          </section>

          <section aria-labelledby="ls-burn-h">
            <IconHeading icon="flame" id="ls-burn-h" className="h3">What burned</IconHeading>
            <div className="seg" role="group" aria-label="Burned-area source">
              <button type="button" aria-pressed={source === 'nasa'} onClick={() => setSource('nasa')}>NASA {d.nasa.years.join('–')}</button>
              <button type="button" aria-pressed={source === 'effis'} onClick={() => setSource('effis')}>EFFIS {d.effis.years.join('–')}</button>
            </div>
            <StackedBars categories={burnCats} series={source === 'nasa' ? groups : fields} values={burnRows} unit="ha" label={`Burned hectares per year by land type, ${source === 'nasa' ? 'NASA MCD64A1' : 'EFFIS'}`} />
            <SeriesLegend series={source === 'nasa' ? groups : fields} values={burnRows} />
            <p className="small">{source === 'nasa'
              ? 'NASA MODIS burned-area map (MCD64A1): 500 m cells of about 21 ha. It misses small and short fires, so its farmland figures are a floor.'
              : `EFFIS fires of 30 ha and up, as in EFFIS's own statistics, clipped to the border. *${d.effis.years[1]} runs to ${d.effis.to_date}.`}</p>
            <Numbers name={`burned-${source}`} header={['Year', ...burnClasses.map((c) => c.label)]} rows={burnCats.map((y, i) => [y, ...burnRows[i].map((v) => Math.round(v))])} expert={expert} credit={credit} />
            {expert && <Numbers title="NASA and EFFIS compared" name="burned-compared" credit={credit} expert
              header={['Year', 'NASA ha', 'EFFIS ha, 30 ha and up', 'EFFIS ha, all mapped', 'EFFIS fires (MK, 30 ha and up)', 'EFFIS annual estimate, fires', 'EFFIS annual estimate, ha']}
              rows={d.effis.cross_check.filter((c) => c.year <= d.nasa.years[1]).map((c) => [String(c.year), Math.round(sum(d.nasa.by_year_group[c.year - d.nasa.years[0]])),
                Math.round(sum(d.effis.ge30.by_year_field[c.year - d.effis.years[0]])), Math.round(sum(d.effis.all.by_year_field[c.year - d.effis.years[0]])), c.fires, c.estimate_fires ?? '–', c.estimate_ha ?? '–'])} />}
          </section>

          <section aria-labelledby="ls-spread-h">
            <IconHeading icon="spread" id="ls-spread-h" className="h3">What spreads</IconHeading>
            <p className="small">{expert
              ? 'Observed outcomes, not a model: EFFIS fire size (fires of 30 ha and up, whole fire) by the fire\'s largest land-cover field, and days from first to last detection of each fire start by the land it started on.'
              : 'How big fires got, and how long satellites kept seeing them, by the land they burned in.'}</p>
            <Numbers title="Fire size by land type (EFFIS)" open name="fire-size" expert={expert} credit={credit} header={['Land type', 'Fires', 'Median ha', '90th percentile ha', 'Largest ha']}
              rows={d.fields.filter((f) => d.effis.spread[f.id]).map((f) => { const s = d.effis.spread[f.id]; return [f.label, s.n, s.median_ha, s.p90_ha, s.max_ha]; })} />
            <Numbers title={`Days visible by land type (${SENSOR_NAME[sensor]})`} open name={`days-visible-${sensor}`} expert={expert} credit={credit} header={['Land type', 'Fire starts', 'Median days', '90th percentile days']}
              rows={d.groups.filter((g) => st.duration[g.id]).map((g) => { const s = st.duration[g.id]; return [g.label, s.n, s.median_days, s.p90_days]; })} />
          </section>

          <section aria-labelledby="ls-methods-h">
            <IconHeading icon="info" id="ls-methods-h" className="h3">Methods and limits</IconHeading>
            <details open={expert}>
              <summary>How this was worked out</summary>
              <ul className="small">
                <li>A fire start is the first satellite sighting of a group of detections, not a confirmed ignition. Detections are hot pixels, not fires.</li>
                <li>Land comes from CORINE Land Cover on a 100 m grid, using the edition at or before each fire's year (2000, 2006, 2012 or 2018); the map shows 2018. Editions differ in method, so some change between them is mapping change, not land change.</li>
                <li>Each detection's footprint (its pixel, 375 m to about 1 km wide) is shared over the land beneath it. Real footprints are not rectangles, so the shares are approximate.</li>
                <li>Factories and other fixed heat sources (FIRMS type 2) are left out. Detection charts stop at 2025 because near-real-time data cannot tell those sources apart.</li>
                <li>The archive holds only detections inside the country, so a fire that crossed the border counts from its first sighting inside.</li>
                <li>EFFIS charts count fires of 30 ha and up, as EFFIS's own statistics do; each fire's land-cover shares are applied to its part inside the border.</li>
                <li>NASA MCD64A1 maps burned 500 m cells each month and misses small and short fires.</li>
              </ul>
            </details>
            {expert && <p className="small">Download: <a href={`/data/${LANDSCAPE_PATH}`} download>what-burns.json</a> · <a href={`/data/${BURNED_PATH}`} download>burned-areas.geojson</a></p>}
            <p className="hint">{credit}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
