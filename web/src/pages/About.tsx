import { Link } from '../lib/router';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading } from '../components/Icon';

const ROWS: [string, 'Implemented' | 'Saved sample' | 'Built, not deployed' | 'Pending', string][] = [
  ['Fires now: detections grouped into fires with last seen, size, nearby settlements, downwind sector, live weather and Fire Weather Index', 'Implemented', 'Detections refresh every 15 minutes from NASA FIRMS; weather and fire danger are computed live'],
  ['Follow a fire (5 km watch area on this device) and share a link to it', 'Implemented', 'No account; counts new detections when data loads'],
  ['Archive 2000–2026: map with numbered groups, calendar, list, details, CSV/GeoJSON/provenance export, place search', 'Implemented', 'Four sensors; gap years from the FIRMS API'],
  ['MODIS–VIIRS harmonization with held-out tests', 'Implemented', 'Fire-active cell-days; see the Harmonization page'],
  ['Night, Light, Terrain and Satellite basemaps with relief', 'Implemented', 'OpenFreeMap, Terrain Tiles, Sentinel-2 cloudless'],
  ['Brvenica 2017 replay, Mariovo 2024 evidence, Spread Lab scenarios and backtest', 'Implemented', 'Observed, reference and model evidence kept apart'],
  ['Automatic refresh every 15 minutes', 'Implemented', 'Firebase scheduled function, running since 15 Nov 2026; the map checks every 5 minutes and marks data stale after 30 minutes without an update'],
  ['Simple and Expert views', 'Implemented', 'Simple (default) uses plain words; Expert shows sensors, model details, filters and exports. The choice is remembered in this browser'],
  ['Push or email alerts', 'Pending', 'Needs a delivery channel and opt-in'],
  ['Photos on fires', 'Pending', 'Deferred: needs moderation, storage and privacy handling'],
  ['What-if spread runs with new inputs', 'Pending', 'Requires executing the engine on demand'],
  ['National fire-danger (MKFFIS) layers', 'Pending', 'Link only until rights, methods and delivery are clear'],
];

export function About() {
  const expert = useExpert();
  const table = (
    <div className="table-scroll"><table className="stack-table">
      <thead><tr><th scope="col">Capability</th><th scope="col">Status</th><th scope="col">Note</th></tr></thead>
      <tbody>{ROWS.map(([c, s, n]) => <tr key={c}><th scope="row">{c}</th><td data-label="Status"><span className={`badge ${s === 'Implemented' ? 'ok' : s === 'Saved sample' ? 'sample' : s === 'Built, not deployed' ? 'stale' : 'off'}`}>{s}</span></td><td data-label="Note">{n}</td></tr>)}</tbody>
    </table></div>
  );
  return (
    <div className="page prose">
      <h1 id="page-title" tabIndex={-1}>About ApexFire</h1>
      <p className="lede">ApexFire is a NASA Space Apps 2026 prototype for North Macedonia: it makes satellite fire activity, real incident evidence and an experimental spread model understandable, with each source's limits in view.</p>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="flame" size={18} /></span><span><strong>A fire tracker</strong>Where satellites see heat now, how recent it is, which way the wind carries smoke and how dry the weather is.</span></li>
        <li><span className="ih-icon"><Icon name="database" size={18} /></span><span><strong>An evidence archive</strong>Every satellite sighting of heat since 2000, with sources and downloads.</span></li>
        <li><span className="ih-icon"><Icon name="info" size={18} /></span><span><strong>Not an emergency service</strong>For official information use the MKFFIS (CUK) portal.</span></li>
        <li><span className="ih-icon"><Icon name="shield" size={18} /></span><span><strong>No tracking</strong>No sign-in, cookies or analytics. "Locate me" asks for your location only when you tap it, and it never leaves your browser.</span></li>
      </ul>}
      <p>Three things in one place. A <strong>fire tracker</strong> for anyone in North Macedonia: where satellites see heat now, how recent it is, which way the wind carries smoke and how dry the weather is. An <strong>evidence archive</strong> for journalists and researchers: every satellite detection since 2000 with sources, filters and exports. And an answer to the Space Apps challenge “Harmonization of MODIS and VIIRS Hot Spots”: a tested conversion that puts both sensor generations on <Link href="/harmonization">one scale</Link>.</p>
      <IconHeading icon="eye">Who it is for</IconHeading>
      <p>Judges, researchers and interested public. It is not an emergency service: operational use would need validation and an operating partner. For official information use the <a href="https://mkffis.cuk.gov.mk/index.php/pocetna_strana/pocetna?lang=en" rel="noopener" target="_blank">MKFFIS (CUK) portal</a>.</p>
      <IconHeading icon="layers">What works now</IconHeading>
      <p>Satellite records go back to November 2000; newer satellites joined in 2012, 2018 and 2023. See <Link href="/data-methods#coverage">coverage by year and sensor</Link>.</p>
      {expert ? table : <details><summary>Show what is built and what is pending</summary>{table}</details>}
      <IconHeading icon="shield">Privacy</IconHeading>
      <p>No sign-in, cookies or analytics. The map's locate button asks for your location only when you tap it; the position is used in your browser to centre the map and is not sent to ApexFire. Map tiles, weather (Open-Meteo) and the live detection feed (Firebase) are fetched from those providers. See <Link href="/data-methods#privacy">Data &amp; methods</Link>.</p>
      <p className="hint">Interface in English; Macedonian place names are kept in their original form, e.g. <span lang="mk">Полошки, Прилеп, Ѓевгелија, Кочани</span>.</p>
    </div>
  );
}
