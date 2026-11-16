import { validateCatalog, SENSOR_KEYS } from '../lib/data';
import { useData } from '../lib/useData';
import { fmtInt, fmtUTC } from '../lib/format';
import { SENSOR_LABEL } from '../lib/history';
import { FIRST_YEAR, LAST_YEAR } from '../lib/explore-state';
import { Link } from '../lib/router';
import { setExpert, useExpert } from '../lib/mode';
import { cellState, CoverageMatrix } from '../components/CoverageMatrix';
import { Icon, IconHeading, Tech } from '../components/Icon';

const SOURCES: { name: string; cls: string; use: string; time: string; rights: string; url: string }[] = [
  { name: 'NASA FIRMS MODIS C6/C6.1 & VIIRS 375 m (archive CSVs)', cls: 'satellite_detection', use: 'History explorer, calendar, exports, case hotspots', time: 'MODIS Nov 2000–2025 (2013 missing); NOAA-20 Apr 2018–2025; S-NPP 2024–2025 (local)', rights: 'NASA open data; cite LANCE/FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/download/' },
  { name: 'NASA FIRMS area API: gap years and near-real-time', cls: 'satellite_detection', use: 'S-NPP 2012–2023, NOAA-21 2023–2026, MODIS 2013, all sensors 2026 (standard processing to Jul/Aug, then near-real-time); Fires now', time: 'Archive gaps retrieved 14–15 Nov 2026 in 5-day requests; Fires now refreshed every 15 minutes since 15 Nov 2026 by a Firebase scheduled function', rights: 'NASA open data; MAP_KEY kept on the server side', url: 'https://firms.modaps.eosdis.nasa.gov/api/' },
  { name: 'FireSpread_MedEU v2 (Zenodo 18200075)', cls: 'observed_burned_area', use: 'Brvenica 2017 replay', time: '23 Jul–15 Aug 2017', rights: 'CC BY 4.0', url: 'https://zenodo.org/records/18200075' },
  { name: 'EFFIS burned-area WFS & statistics API', cls: 'incident_reference / seasonal_burned_area_statistics', use: 'Brvenica official perimeter; live season panel (Expert, Fires now), requested by your browser; Landscape burned areas 2016 to now (layer and charts)', time: 'Event 12376 (2017); this year weekly, annual since 2006; burned areas 2016 to now', rights: 'CC BY 4.0, Copernicus EMS / EFFIS', url: 'https://forest-fire.emergency.copernicus.eu/applications/data-and-services' },
  { name: 'CORINE Land Cover 2000, 2006, 2012, 2018 (EEA, Copernicus Land Monitoring Service)', cls: 'land_cover', use: 'Landscape: land under each fire start and burned cell, land shares, land-cover layer', time: 'Editions 2000, 2006, 2012, 2018 on a 100 m grid', rights: '© European Union, Copernicus Land Monitoring Service, EEA; free with attribution', url: 'https://land.copernicus.eu/en/products/corine-land-cover' },
  { name: 'NASA MODIS MCD64A1 v061 burned area (LP DAAC)', cls: 'observed_burned_area', use: 'Landscape: burned area by land type; Mariovo evidence', time: 'Monthly 2001–2025, tile h19v04', rights: 'NASA open data', url: 'https://lpdaac.usgs.gov/products/mcd64a1v061/' },
  { name: 'WorldFires Mariovo geometry (EFFIS-attributed)', cls: 'incident_reference (unconfirmed)', use: 'Mariovo reference perimeter', time: 'Sep 2024', rights: 'Attribution as stated by WorldFires; original not matched in EFFIS 2024 WFS', url: 'https://worldfires.org/en/fire/mariovo-2024-09' },
  { name: 'MODIS MCD64A1 C6.1, HLS S30 v2.0, NASADEM', cls: 'observed_burned_area / imagery', use: 'Mariovo evidence', time: 'Aug–Sep 2024', rights: 'NASA open data', url: 'https://lpdaac.usgs.gov/' },
  { name: 'ESA WorldCover 2021', cls: 'context', use: 'Mariovo cover context', time: '2021', rights: 'CC BY 4.0', url: 'https://esa-worldcover.org/' },
  { name: 'Pyretechnics 2026.10.20 + EFFIS fuel map, NASADEM, WorldCover', cls: 'experimental_spread_scenarios', use: 'Spread Lab', time: 'What-if runs; real afternoons 2017–2025 (ERA5); backtests Negotino 25–27 Jul 2022 and Makedonski Brod 13–17 Sep 2019', rights: 'Pyretechnics dual licence; EFFIS, WorldCover CC BY 4.0', url: '/data/spread/PYRETECHNICS-LICENSE.txt' },
  { name: 'ERA5 hourly at Mariovo (Open-Meteo archive)', cls: 'reanalysis_weather', use: 'Spread Lab wind and dryness climatology, real-day runs', time: '2016–2025, hourly', rights: 'Copernicus C3S; Open-Meteo CC BY 4.0', url: 'https://open-meteo.com/en/docs/historical-weather-api' },
  { name: 'Open-Meteo (ERA5, ECMWF IFS archive)', cls: 'modeled weather', use: 'Brvenica/Mariovo context; model forcing', time: '2017; 2024', rights: 'CC BY 4.0 data; free service noncommercial', url: 'https://open-meteo.com/' },
  { name: 'Live weather and wind: ECMWF IFS via Open-Meteo', cls: 'modeled weather', use: 'Fires now: wind arrows and downwind sectors, weather and Fire Weather Index at a fire or point, and named-point weather for Skopje and Mariovo (Expert), requested by your browser', time: '60 days back to 3 days ahead, hourly', rights: 'Open-Meteo CC BY 4.0 (free non-commercial service); ECMWF open data CC BY 4.0', url: 'https://open-meteo.com/en/docs' },
  { name: 'Saved wind forecast grid: ECMWF IFS via Open-Meteo', cls: 'modeled weather', use: 'Now: wind arrows, timebar and wind at any point (saved sample)', time: '77 points at 0.25°, 48 h from 14 Nov 2026 22:00 UTC', rights: 'Open-Meteo CC BY 4.0; ECMWF open data CC BY 4.0', url: 'https://open-meteo.com/en/docs' },
  { name: 'CAMS European ensemble via Open-Meteo', cls: 'modeled_air_quality', use: 'Live air-quality card for Skopje (Expert), requested by your browser', time: '1 day back to 2 days ahead, hourly', rights: 'Copernicus CAMS licence; credit CAMS ENSEMBLE + Open-Meteo', url: 'https://air-quality-api.open-meteo.com/' },
  { name: 'NASA GIBS MODIS Terra true colour', cls: 'imagery_context', use: 'Optional Mariovo imagery (tiles fetched on request)', time: '2 Sep 2024', rights: 'NASA open data; NASA EOSDIS GIBS credit', url: 'https://gibs.earthdata.nasa.gov/' },
  { name: 'geoBoundaries MKD ADM0 (2016)', cls: 'reference_boundary', use: 'Map outline; inside/outside test for current samples', time: 'Represented year 2016', rights: 'CC BY 4.0, EuroGeographics via geoBoundaries', url: 'https://www.geoboundaries.org/' },
  { name: 'GeoNames MK populated places', cls: 'gazetteer_place', use: 'Offline place search, nearest place', time: 'Downloaded 14 Nov 2026', rights: 'CC BY 4.0, GeoNames', url: 'https://www.geonames.org/' },
  { name: 'OpenFreeMap / OpenMapTiles / OpenStreetMap', cls: 'basemap', use: 'Night (recoloured dark), Light (positron) and Terrain (liberty) basemaps', time: 'Live tiles', rights: '© OpenStreetMap contributors (ODbL); OpenMapTiles', url: 'https://openfreemap.org/' },
  { name: 'Terrain Tiles (Mapzen, AWS Open Data)', cls: 'basemap relief', use: 'Hillshade on every basemap', time: 'Live tiles', rights: 'Attribution per Tilezen: SRTM, GMTED, ETOPO1 and others', url: 'https://github.com/tilezen/joerd/blob/master/docs/attribution.md' },
  { name: 'Sentinel-2 cloudless 2024 (EOX)', cls: 'basemap imagery', use: 'Satellite basemap', time: '2024 mosaic', rights: 'CC BY-NC-SA 4.0, modified Copernicus Sentinel data; non-commercial use only', url: 'https://s2maps.eu' },
  { name: 'Spectral and Golos Text typefaces', cls: 'interface', use: 'Headings and interface text, served with the site', time: 'n/a', rights: 'SIL Open Font License 1.1', url: 'https://fontsource.org/' },
];

/** Expert sees the content as is; Simple gets it folded behind one summary line. */
export function DataMethods() {
  const cat = useData('catalog.json', validateCatalog);
  const expert = useExpert();
  const years = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);
  return (
    <div className="page prose wide">
      <h1 id="page-title" tabIndex={-1}>Data &amp; methods</h1>
      <p className="lede">Every number in ApexFire should trace to a dataset and a transformation. This page lists them, with the limits that matter.</p>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="book" size={18} /></span><span><strong>Every number should have a source</strong>Each figure should trace to a dataset and the steps applied to it; the sources are listed below.</span></li>
        <li><span className="ih-icon"><Icon name="satellite" size={18} /></span><span><strong>A sighting is not a confirmed fire</strong>A satellite flags one hot pixel at one pass. One fire can give many sightings, and clouds can hide a fire completely.</span></li>
        <li><span className="ih-icon"><Icon name="layers" size={18} /></span><span><strong>Kinds of evidence stay apart</strong>Satellite sightings, burned-area maps, official outlines and model experiments are never mixed.</span></li>
        <li><span className="ih-icon"><Icon name="shield" size={18} /></span><span><strong>No tracking</strong>No account, cookies or analytics. Your location is used only in your browser, only when you tap "Locate me".</span></li>
      </ul>}

      <nav aria-label="On this page" className="toc">
        <a href="#classes">Data classes</a> · <a href="#sources">Sources</a> · <a href="#coverage">Coverage</a> · <a href="#processing">Processing</a> · <a href="#harmonization">Normalization vs harmonization</a> · <a href="#rules">Interpretation rules</a> · <a href="#downloads">Downloads</a> · <a href="#privacy">Privacy &amp; dependencies</a>
      </nav>

      <IconHeading icon="layers" id="classes">Data classes kept apart</IconHeading>
      <dl className="facts">
        <dt>Satellite detection</dt><dd>A pixel flagged as a thermal anomaly at one overpass. Many detections can come from one fire; one fire can be missed under cloud.</dd>
        <dt>Observed burned area</dt><dd>A burned-area mapping from imagery at an acquisition time (Brvenica frames, MCD64A1 cells).</dd>
        <dt>Incident reference</dt><dd>A perimeter or record published by an agency or mirror (EFFIS event 12376; the unconfirmed Mariovo reference).</dd>
        <dt>Experimental spread scenario</dt><dd>Model output under stated assumptions (Spread Lab). Never mixed into an observed timeline.</dd>
        <dt>Modeled environment</dt><dd>Weather and air quality from numerical models, with their grid point and time.</dd>
        <dt>Seasonal statistics</dt><dd>EFFIS mapped burned area and mapped events, a different product from detection counts.</dd>
      </dl>

      <IconHeading icon="book" id="sources">Sources and credits</IconHeading>
      <Tech expert={expert}>
      <div className="table-scroll"><table className="stack-table">
        <thead><tr><th scope="col">Source</th><th scope="col">Class</th><th scope="col">Used for</th><th scope="col">Time</th><th scope="col">Rights / credit</th></tr></thead>
        <tbody>{SOURCES.map((s) => <tr key={s.name}><th scope="row"><a href={s.url} rel="noopener" target={s.url.startsWith('/') ? undefined : '_blank'}>{s.name}</a></th>
          <td data-label="Class">{s.cls}</td><td data-label="Used for">{s.use}</td><td data-label="Time">{s.time}</td><td data-label="Rights">{s.rights}</td></tr>)}</tbody>
      </table></div>
      <p className="small">Not used: MKFFIS fire-danger layers (link only; rights, methods and secure delivery pending), protected-area, population, news and aircraft sources.</p>
      </Tech>

      <IconHeading icon="calendar" id="coverage">Coverage by year and sensor</IconHeading>
      {cat.error && <p className="error" role="alert">The coverage catalog failed to load ({cat.error}), so coverage cannot be shown. This is a loading failure, not missing data.</p>}
      {!expert && <>
        <p>Satellite records go back to November 2000; newer satellites joined in 2012, 2018 and 2023, so recent years are seen in more detail and yearly totals are not directly comparable.</p>
        <p><button type="button" className="btn-quiet" onClick={() => setExpert(true)}>Show the full matrix (Expert mode)</button></p>
      </>}
      {expert && cat.data && <>
        <p>{fmtInt(cat.data.history.records)} detections in {cat.data.history.files.length} source files. Select a cell to open that year and sensor in the Archive. {cat.data.history.source_selection}</p>
        <CoverageMatrix catalog={cat.data} />
        <details>
          <summary>Show as a table</summary>
          <div className="table-scroll"><table className="compact coverage">
            <thead><tr><th scope="col">Year</th>{SENSOR_KEYS.map((s) => <th key={s} scope="col">{SENSOR_LABEL[s]}</th>)}<th scope="col">Note</th></tr></thead>
            <tbody>{years.map((y) => {
              const note = y === 2000 ? 'MODIS starts 1 Nov 2000' : y === 2012 ? 'S-NPP starts 20 Jan 2012 (API)' : y === 2013 ? 'MODIS from the API (archive file missing)' : y === 2018 ? 'NOAA-20 starts 1 Apr 2018' : y === 2023 ? 'NOAA-21 starts 1 Mar 2023 (API)' : y === 2026 ? 'Partial year to 14 Nov; standard then near-real-time' : '';
              return <tr key={y}><th scope="row"><Link href={`/explore?mode=history&year=${y}`}>{y}</Link></th>{SENSOR_KEYS.map((s) => {
                const c = cellState(cat.data!, s, y);
                return <td key={s} className={c.kind === 'data' ? '' : 'gap'}>{c.kind === 'data' ? `${fmtInt(c.records)}${c.partial ? ' (partial)' : ''}` : c.kind === 'before' ? <span className="muted">before record start</span> : 'gap: no file'}</td>;
              })}<td className="small">{note}</td></tr>;
            })}</tbody>
          </table></div>
        </details>
        <p className="small">Export {cat.data.transformation_version}, generated {fmtUTC(cat.data.generated_utc)}. Source SHA-256 hashes and record counts are re-verified against the audit inventory at every export.</p>
      </>}

      <IconHeading icon="database" id="processing">Processing and quality policy</IconHeading>
      <Tech expert={expert}><ul>
        <li>Selection: the 35 North Macedonia country files named by the archive audit (hashes re-verified), plus gap years from the FIRMS area API over a bounding box, clipped to the geoBoundaries 2016 polygon and de-duplicated. The 24 GB global archive never reaches the browser.</li>
        <li>Time: UTC from <code>acq_date</code> + zero-padded <code>acq_time</code> (FIRMS drops leading zeros: “32” = 00:32). Invalid clock values stop the export. Calendar days are UTC; local Europe/Skopje time is shown only in details.</li>
        <li>Identity: each record keeps a deterministic ID (sensor-year-row) and its source file. Detections from different sensors are never merged into one “fire”.</li>
        <li>Quality: nothing is excluded at export. Confidence filters use each sensor's native scale (MODIS 0–100; VIIRS low/nominal/high). Type labels are kept; near-real-time files carry no type, shown as "not reported". The share of type 2 (static land source) drops sharply around 2020–2021 in both MODIS and VIIRS, which is why harmonization does not filter on it.</li>
        <li>Versions: MODIS raw version strings 6.2 (2000–2017), 6.03 (2018–2022), 61.03 (2023–2025); VIIRS 2. Whether each file is standard or near-real-time processing is not established, so versions are shown raw.</li>
        <li>Gaps: a missing file is shown as a gap; a covered day without rows means “no detections recorded”, not “no fire”. Observation opportunities and cloud cover are unknown.</li>
      </ul></Tech>

      <IconHeading icon="compare" id="harmonization">Normalization and harmonization</IconHeading>
      <p>ApexFire puts MODIS and VIIRS records into one schema and shows them side by side (normalization). It also converts between them with a model tested on held-out years, using fire-active cell-days as the common statistic; the results, method and limits are on the <Link href="/harmonization">Harmonization</Link> page. Raw sensor counts are never added into one trend.</p>

      <IconHeading icon="thermo" id="danger">Fire danger and fire groups</IconHeading>
      {!expert && <p>Fire danger is worked out from the weather, with the same method the European Forest Fire Information System (EFFIS) uses; it rates how dangerous the weather is at a place, not whether a fire is burning or where it will go. Satellite sightings close together in place and time are grouped into one likely fire, which is not a confirmed incident. Official danger for North Macedonia is MKFFIS.</p>}
      <Tech expert={expert}><ul>
        <li><strong>Fire Weather Index.</strong> The Canadian FWI System (Van Wagner 1987), the method EFFIS uses, computed in the browser from Open-Meteo ECMWF IFS weather at 11:00 UTC (noon local standard time) with 24 h rain, over 60 days from standard start values (FFMC 85, DMC 6, DC 15). The code reproduces the published reference day to 0.05. Danger classes follow EFFIS (5.2, 11.2, 21.3, 38, 50). It rates weather-driven danger at a point; it does not say a fire is burning or how it will spread. Official danger for North Macedonia is MKFFIS.</li>
        <li><strong>Fire groups.</strong> Detections within 2 km and 24 h of each other are linked into one group (single linkage), summarized by first and last detection, count, peak radiant power and the nearest GeoNames places. A group is probably one burning area, not a confirmed incident; first detection is not ignition.</li>
        <li><strong>Downwind sectors.</strong> For each group, the direction the wind blows towards over the next 6 h at the nearest forecast point, 15–45° wide by how much the direction varies, 2–12 km long by wind speed. This is wind context for smoke and embers, not a spread forecast.</li>
      </ul></Tech>

      <IconHeading icon="eye" id="rules">Interpretation rules</IconHeading>
      <ul>
        <li>Detections are not unique fires; first detection is not confirmed ignition.</li>
        <li>FRP (MW) is radiant power, not hectares; pixel footprint is not burned extent; brightness temperature is not air temperature.</li>
        <li>Saved samples are dated and never presented as a live feed.</li>
        <li>EFFIS mapped area/events differ from FIRMS detections and from MODIS burned-area cells.</li>
        <li>CAMS concentrations are modeled air quality, not wildfire-attributed smoke.</li>
        <li>Spread Lab runs are uncalibrated surface-fire model output under stated assumptions. Against two mapped fires it reaches most of each burn but ends 3–9 times too large (Makedonski Brod 2019, Negotino 2022), and is too slow early on in Makedonski Brod (no firefighting, coarse fuels); it is not a forecast.</li>
      </ul>

      <IconHeading icon="download" id="downloads">Downloads</IconHeading>
      <ul>
        <li><a href="/data/catalog.json">catalog.json</a>: every public data file with size and SHA-256, coverage and source hashes.</li>
        <li>Per sensor-year partitions: <code>/data/history/&lt;sensor&gt;-&lt;year&gt;.json</code> (columnar). Filtered CSV/GeoJSON exports are available from <Link href="/explore">Explore</Link>.</li>
        <li><a href="/data/stories/brvenica-2017.json">Brvenica story data</a>, <a href="/data/stories/mariovo-2024.json">Mariovo story data</a>, <a href="/data/spread/lab/index.json">Spread Lab runs (summaries, weather, assumptions)</a>, <a href="/data/spread/mariovo-scenario.json">original spread run</a>, <a href="/data/current/wind-grid.json">saved wind forecast grid</a>.</li>
      </ul>

      <IconHeading icon="shield" id="privacy">Privacy and external dependencies</IconHeading>
      <p>No account, cookies or analytics. The map's locate button asks the browser for your position only when you tap it; it is drawn on the map and never sent to ApexFire or any other service. Your browser contacts: OpenFreeMap (basemap tiles), Amazon S3 (Terrain Tiles relief), EOX (Satellite basemap), Open-Meteo (wind, weather and fire-danger inputs for the places you open; air quality for Skopje in Expert view), the ApexFire Firebase Realtime Database in Belgium (the live detection feed, read-only) and, if you turn it on, NASA GIBS imagery. Those services receive ordinary requests including your IP address and the area or point viewed. Your basemap, Simple/Expert choice, followed fires and last visit are remembered in this browser only. Everything else is served with the site.</p>
    </div>
  );
}
