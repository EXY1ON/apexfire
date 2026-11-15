import { Link } from '../lib/router';
import { useExpert } from '../lib/mode';
import { Icon, IconHeading } from '../components/Icon';

export const REPO_URL = 'https://github.com/EXY1ON/apexfire';

// Aspirations, not claims: each is unbuilt or unvalidated today (see Data & methods for what exists).
const AIMS: [string, string][] = [
  ['Warn people in time', 'Opt-in phone or email alerts when satellites see heat near a place or fire you follow, without needing an account.'],
  ['See fires sooner', 'Add Europe\'s geostationary MTG satellite, which looks every 10 minutes, so new fires show up between the passes of the orbiting satellites.'],
  ['Become a trusted national picture', 'Work with the Crisis Management Centre, firefighters and municipalities; show official fire-danger maps once their use is agreed; offer the site in Macedonian.'],
  ['Earn trust for spread forecasts', 'Calibrate the Spread Lab model on many mapped fires with local fuel, moisture and wind data, and show uncertainty, before any forecast is offered.'],
  ['Keep the evidence open', 'A public, sourced record of every fire for journalists, researchers and institutions: all officially mapped burned areas and a story for each major fire.'],
  ['Grow region by region', 'Extend from North Macedonia to its neighbours and the wider Balkans, testing each region locally before adding it, since fires cross borders.'],
];

export function About() {
  const expert = useExpert();
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
      <IconHeading icon="spread">What ApexFire aspires to accomplish</IconHeading>
      <p>Today ApexFire is a working prototype. The goal is a fire service people in North Macedonia can rely on, built openly and in step with the people who fight fires:</p>
      <ul className="aims">{AIMS.map(([t, d]) => <li key={t}><strong>{t}.</strong> {d}</li>)}</ul>
      <p>Throughout, the same principles: no tracking, sources and limits always visible, and never presenting itself as an emergency service.</p>
      <IconHeading icon="book">Open source</IconHeading>
      <p>The code is public on <a href={REPO_URL} rel="noopener" target="_blank">GitHub (EXY1ON/apexfire)</a> under the MIT licence; each data source keeps its own licence, listed in <Link href="/data-methods">Data &amp; methods</Link>. Corrections, ideas and local knowledge are welcome there.</p>
      <IconHeading icon="shield">Privacy</IconHeading>
      <p>No sign-in, cookies or analytics. The map's locate button asks for your location only when you tap it; the position is used in your browser to centre the map and is not sent to ApexFire. Map tiles, weather (Open-Meteo) and the live detection feed (Firebase) are fetched from those providers. See <Link href="/data-methods#privacy">Data &amp; methods</Link>.</p>
      <p className="hint">Interface in English; Macedonian place names are kept in their original form, e.g. <span lang="mk">Полошки, Прилеп, Ѓевгелија, Кочани</span>.</p>
    </div>
  );
}
