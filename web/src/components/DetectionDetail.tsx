import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { Detection } from '../lib/data';
import { SENSOR_LABEL, TYPE_LABEL, VIIRS_CONF } from '../lib/history';
import { fmt1, fmtSkopje, fmtUTC, skopjeParts } from '../lib/format';
import { haversineKm } from '../lib/geo';
import { useData } from '../lib/useData';
import { validatePlaces } from './PlaceSearch';
import { SensorMark } from './MapView';
import { useExpert } from '../lib/mode';

/** One detection, Watch-Fire-style: place title, four key figures, then the full native record. */
export function DetectionDetail({ d, outsideFilters, onClose, children }: { d: Detection; outsideFilters: boolean; onClose: () => void; children?: ReactNode }) {
  const expert = useExpert();
  const heading = useRef<HTMLHeadingElement>(null);
  const places = useData('places.json', validatePlaces);
  useEffect(() => { heading.current?.focus(); }, [d.id]);
  const nearest = useMemo(() => {
    if (!places.data) return null;
    let best = places.data[0]; let bestKm = Infinity;
    for (const p of places.data) { const km = haversineKm(d.lat, d.lon, p.lat, p.lon); if (km < bestKm) { bestKm = km; best = p; } }
    return { p: best, km: bestKm };
  }, [places.data, d.lat, d.lon]);
  const modis = d.sensor === 'modis';
  const [date, time] = fmtUTC(d.t).split(' ');

  return (
    <section className="detail" aria-labelledby="detail-h" onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div className="detail-head">
        <div>
          <span className="eyebrow"><SensorMark sensor={d.sensor} size={11} />{SENSOR_LABEL[d.sensor]} {expert ? 'detection' : 'satellite sighting'}</span>
          <h2 id="detail-h" ref={heading} tabIndex={-1}>
            {nearest ? <>Near {nearest.p.name}{nearest.p.cyr[0] && nearest.p.cyr[0] !== nearest.p.name && <span lang="mk" className="alt-name">{nearest.p.cyr[0]}</span>}</> : `Detection ${d.id}`}
          </h2>
        </div>
        <button type="button" className="icon-btn btn-quiet" onClick={onClose} aria-label="Back to all detections">×</button>
      </div>
      <p className="kind-tag">{expert ? 'One hot pixel seen by a satellite, not a confirmed or unique fire' : 'A satellite saw heat here on one pass. It may be a wildfire, a field burn or another hot surface.'}</p>
      {outsideFilters && <p className="warn small">Outside the current filters.</p>}
      {!expert && <dl className="figures">
        <div><dt>Seen</dt><dd className="num">{skopjeParts(d.t)[1]}<br /><small>{skopjeParts(d.t)[0]}</small></dd></div>
        <div><dt>When</dt><dd>{d.dn === 'D' ? 'Daytime' : 'Night-time'}<br /><small>satellite pass</small></dd></div>
      </dl>}
      {!expert && children}
      {!expert && nearest && <p className="small">Nearest place: {nearest.p.name}, {fmt1(nearest.km)} km away. The place name is for finding it, not the name of a fire.</p>}
      {expert && <><dl className="figures">
        <div><dt>Acquired</dt><dd className="num">{time} <small>UTC</small><br /><small>{date}</small></dd></div>
        <div><dt>Radiant power</dt><dd className="num">{fmt1(d.frp)} <small>MW</small><br /><small>not area burned</small></dd></div>
        <div><dt>Confidence</dt><dd>{modis ? <>{d.conf}<small> / 100</small></> : VIIRS_CONF[d.conf as string]}<br /><small>{modis ? 'MODIS scale' : 'VIIRS class'}, not a probability</small></dd></div>
        <div><dt>Pixel</dt><dd className="num">{d.scan} × {d.track} <small>km</small><br /><small>footprint, not extent</small></dd></div>
      </dl>
      {children}
      <dl className="facts">
        <dt>Local time</dt><dd>{fmtSkopje(d.t)} <span className="muted">(Europe/Skopje)</span></dd>
        <dt>Satellite</dt><dd>{d.sat} · {modis ? 'MODIS' : 'VIIRS'} · {d.dn === 'D' ? 'day' : 'night'} pass</dd>
        <dt>Pixel centre</dt><dd className="mono">{d.lat.toFixed(4)}, {d.lon.toFixed(4)}</dd>
        <dt>Brightness temp.</dt><dd>{modis ? 'Ch21/22' : 'I4'} {fmt1(d.bt)} K · {modis ? 'Ch31' : 'I5'} {fmt1(d.bt2)} K <span className="muted">(not air temperature)</span></dd>
        <dt>Algorithm label</dt><dd>{d.type} · {TYPE_LABEL[d.type]} <span className="muted">(not a confirmed cause)</span></dd>
        <dt>Version (raw)</dt><dd>{d.ver}</dd>
        <dt>Source record</dt><dd><code>{d.id}</code><br /><span className="muted">{d.file}</span></dd>
        <dt>Nearest place</dt>
        <dd>{nearest ? <>{nearest.p.name}, {fmt1(nearest.km)} km <span className="muted">(GeoNames; not an incident name)</span></> : places.error ? 'Place list unavailable' : '…'}</dd>
      </dl></>}
    </section>
  );
}
