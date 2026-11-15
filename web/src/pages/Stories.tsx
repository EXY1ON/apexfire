import { Link } from '../lib/router';
import { useExpert } from '../lib/mode';
import { useData } from '../lib/useData';
import { fmtInt } from '../lib/format';
import { Chip, Icon, IconHeading } from '../components/Icon';
import { validateFireStoryIndex } from './FireStory';

const fmtDay = (d: string) => new Date(`${d}T12:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export function Stories() {
  const expert = useExpert();
  const fires = useData('stories/fires/index.json', validateFireStoryIndex);
  return (
    <div className="page prose wide">
      <h1 id="page-title" tabIndex={-1}>Fire stories</h1>
      <p className="lede">Real North Macedonian fires, each told with the evidence it actually has: officially mapped burned areas, satellite heat detections day by day, and the wind and weather of each day. Observed mapping, reference perimeters and model experiments are kept apart.</p>
      <IconHeading icon="flame" id="mapped-h">Officially mapped fires, day by day</IconHeading>
      <p className="small muted">Burned areas mapped by EFFIS, with every satellite detection inside them and ERA5 weather for each day.</p>
      {fires.error && <p className="error small" role="alert">Fire stories failed to load: {fires.error}</p>}
      <div className="cards">
        {(fires.data?.stories ?? []).slice().sort((x, y) => (x.start < y.start ? 1 : -1)).map((f) => (
          <article key={f.id} className="card">
            <p className="kind-tag">EFFIS mapped area · satellite detections · ERA5 weather</p>
            <h3 className="ih h3"><Chip icon="flame" /><span><Link href={`/stories/${f.id}`}>{f.title}</Link></span></h3>
            <p><span lang="mk">{f.place_mk}</span> · {f.municipality}</p>
            <dl className="mini-facts">
              <div><dt>Mapped</dt><dd className="num">{fmtInt(f.area_ha)} ha</dd></div>
              <div><dt>{expert ? 'Detections' : 'Sightings'}</dt><dd className="num">{fmtInt(f.detections)}</dd></div>
              <div><dt>Busiest day</dt><dd>{fmtDay(f.peak_day)}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      <IconHeading icon="book" id="case-h">Case studies</IconHeading>
      {!expert && <ul className="summary-card">
        <li><span className="ih-icon"><Icon name="satellite" size={18} /></span><span><strong>Brvenica 2017: seen from space</strong>Eight dated satellite maps of the burned area, with the missing or cloudy days left visible.</span></li>
        <li><span className="ih-icon"><Icon name="search" size={18} /></span><span><strong>Mariovo 2024: an evidence study</strong>Before and after images, burn dates and satellite sightings of heat, around an outline that is not confirmed.</span></li>
        <li><span className="ih-icon"><Icon name="spread" size={18} /></span><span><strong>The model is separate</strong>The Spread Lab runs an experimental model nearby; it does not rebuild the Mariovo fire.</span></li>
      </ul>}
      <div className="cards">
        <article className="card">
          <p className="kind-tag">Observed satellite-derived progression</p>
          <IconHeading icon="satellite"><Link href="/stories/brvenica-2017">Brvenica, July–August 2017</Link></IconHeading>
          <p><span lang="mk">Полошки</span> region · EFFIS event 12376</p>
          <p>Eight dated burned-area mappings from Planet imagery between 30 Jul and 15 Aug, with fifteen missing or cloudy days kept visible. Compared against the official EFFIS perimeter, which reports a different area and dates.</p>
        </article>
        <article className="card">
          <p className="kind-tag">Evidence study; reference extent unconfirmed</p>
          <IconHeading icon="search"><Link href="/stories/mariovo-2024">Mariovo / Prilep, September 2024</Link></IconHeading>
          <p>Before/after Sentinel-2 (HLS), MODIS burned-area dates, hotspot detections, terrain and weather around a secondary reference perimeter that an original EFFIS query did not confirm.</p>
          <p className="small">The separate <Link href="/spread-lab">Spread Lab</Link> runs an experimental model nearby; it does not reconstruct this fire.</p>
        </article>
      </div>
      <p className="hint">Šerta 2024 has acquired inputs but no finished analysis, so it is not shown.</p>
    </div>
  );
}
