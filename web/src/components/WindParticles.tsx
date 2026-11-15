import { useEffect, useRef } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { sampleField, type Field } from '../lib/wind-field';
import { INK, inkOf, useBasemap } from './MapView';

const SPEED = 30;     // screen px per second per m/s, the same on every zoom: motion is sped up; its direction and relative speed are the model's
const FADE = 0.08;    // trail fade per drawn frame (drawing is capped near 60 frames a second, also on 120 Hz screens)
const OUT_FRAMES = 12; // frames a particle keeps fading after leaving the country (about 2-4 km at country zoom)
const DEG_PX = 40075016.686 / 111320 / 512; // degrees of longitude per screen px at zoom 0

/** Country mask rasterised once at 0.005° so the per-frame inside test is a lookup, not a 2,000-vertex polygon test. */
function rasterMask(geom: GeoJSON.Geometry) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const pts = polys.flat(2);
  if (!pts.length) return null;
  const res = 0.005;
  const x0 = Math.min(...pts.map((p) => p[0])); const y1 = Math.max(...pts.map((p) => p[1]));
  const w = Math.ceil((Math.max(...pts.map((p) => p[0])) - x0) / res) + 1; const h = Math.ceil((y1 - Math.min(...pts.map((p) => p[1]))) / res) + 1;
  const ctx = Object.assign(document.createElement('canvas'), { width: w, height: h }).getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.beginPath();
  for (const ring of polys.flat()) ring.forEach(([lon, lat], i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, (lon - x0) / res, (y1 - lat) / res));
  ctx.fill('evenodd');
  const a = ctx.getImageData(0, 0, w, h).data;
  return {
    bbox: [x0, y1 - h * res, x0 + w * res, y1] as const,
    inside: (lon: number, lat: number) => { const x = Math.floor((lon - x0) / res); const y = Math.floor((y1 - lat) / res); return x >= 0 && y >= 0 && x < w && y < h && a[(y * w + x) * 4 + 3] > 127; },
  };
}

/** Streaks advected along a bilinearly interpolated wind field (a forecast hour, or a past day's mean), inside North Macedonia only.
 *  A 2D canvas over the map (a MapLibre canvas source would re-render the whole map every frame). Paused while the tab is hidden. */
export function WindParticles({ map, field: fieldIn, boundary, density = 1 }: { map: MLMap; field: Field | null; boundary: GeoJSON.Geometry; density?: number }) {
  const basemap = useBasemap();
  const field = useRef(fieldIn);
  field.current = fieldIn;
  const color = useRef(INK[inkOf(basemap)].fg);
  color.current = INK[inkOf(basemap)].fg;

  useEffect(() => {
    const mask = rasterMask(boundary);
    if (!mask) return;
    const host = map.getCanvasContainer();
    const canvas = Object.assign(document.createElement('canvas'), { className: 'wind-canvas' });
    canvas.setAttribute('aria-hidden', 'true');
    host.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0; let H = 0;
    const box = map.getContainer(); // the canvas container itself has no height; the overlay is sized to the map
    const size = () => { W = box.clientWidth; H = box.clientHeight; canvas.width = W * dpr; canvas.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
    size();
    // About one particle per 900 px² of screen, 250-1,500: ~300 on a phone, 1,500 on a laptop.
    const n = () => Math.round(Math.max(250, Math.min(1500, (W * H) / 900)) * density); // density < 1: lighter streaks over a small model area
    type P = { lon: number; lat: number; age: number; max: number; out: number; x: number; y: number; live: boolean };
    let ps: P[] = [];
    const spawn = (p: P) => {
      const b = map.getBounds();
      const [x0, y0, x1, y1] = [Math.max(b.getWest(), mask.bbox[0]), Math.max(b.getSouth(), mask.bbox[1]), Math.min(b.getEast(), mask.bbox[2]), Math.min(b.getNorth(), mask.bbox[3])];
      p.live = false;
      if (x0 >= x1 || y0 >= y1) return;
      for (let k = 0; k < 12; k++) {
        const lon = x0 + Math.random() * (x1 - x0); const lat = y0 + Math.random() * (y1 - y0);
        if (!mask.inside(lon, lat)) continue;
        const s = map.project([lon, lat]);
        Object.assign(p, { lon, lat, x: s.x, y: s.y, age: 0, max: 50 + Math.random() * 90, out: OUT_FRAMES, live: true });
        return;
      }
    };
    const reset = () => {
      const m = n();
      ps = Array.from({ length: m }, () => ({ lon: 0, lat: 0, age: 0, max: 0, out: OUT_FRAMES, x: 0, y: 0, live: false }));
      ps.forEach((p) => { spawn(p); p.age = Math.random() * p.max; });
    };
    reset();

    let moved = true; let raf = 0; let last = 0;
    const onMove = () => { moved = true; };
    const onResize = () => { size(); reset(); moved = true; };
    const onMoveEnd = () => { if (ps.filter((p) => p.live).length < ps.length / 3) reset(); };
    map.on('move', onMove); map.on('resize', onResize); map.on('moveend', onMoveEnd);

    const BUCKETS = 4;
    const paths = Array.from({ length: BUCKETS }, () => new Path2D());
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < 15) return;
      const dt = last ? Math.min(0.05, (t - last) / 1000) : 1 / 60;
      last = t;
      const f = field.current;
      if (!f) return;
      if (moved) { ctx.clearRect(0, 0, W, H); moved = false; }
      else { ctx.globalCompositeOperation = 'destination-out'; ctx.fillStyle = `rgba(0,0,0,${FADE})`; ctx.fillRect(0, 0, W, H); ctx.globalCompositeOperation = 'source-over'; }
      const step = (SPEED * dt * DEG_PX) / 2 ** map.getZoom(); // degrees per m/s this frame
      for (let b = 0; b < BUCKETS; b++) paths[b] = new Path2D();
      for (const p of ps) {
        if (!p.live || ++p.age > p.max) { spawn(p); continue; }
        const uv = sampleField(f, p.lon, p.lat);
        if (!uv) { spawn(p); continue; }
        const [u, v] = uv;
        p.lon += u * step;
        p.lat += v * step * Math.cos((p.lat * Math.PI) / 180);
        if (!mask.inside(p.lon, p.lat) && --p.out <= 0) { spawn(p); continue; }
        const s = map.project([p.lon, p.lat]);
        const speed = Math.hypot(u, v);
        // Brighter for stronger wind and fading out past the border; four buckets keep it to four strokes per frame.
        const level = Math.min(BUCKETS - 1, Math.floor((speed / 10) * BUCKETS * (p.out / OUT_FRAMES)));
        paths[level].moveTo(p.x, p.y); paths[level].lineTo(s.x, s.y);
        p.x = s.x; p.y = s.y;
      }
      ctx.lineWidth = 1.5; ctx.lineCap = 'round'; ctx.strokeStyle = color.current;
      for (let b = 0; b < BUCKETS; b++) { ctx.globalAlpha = 0.3 + (0.6 * b) / (BUCKETS - 1); ctx.stroke(paths[b]); }
      ctx.globalAlpha = 1;
    };
    const run = () => { cancelAnimationFrame(raf); last = 0; if (document.visibilityState === 'visible') { moved = true; raf = requestAnimationFrame(frame); } };
    document.addEventListener('visibilitychange', run);
    run();
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', run);
      map.off('move', onMove); map.off('resize', onResize); map.off('moveend', onMoveEnd);
      canvas.remove();
    };
  }, [map, boundary]);

  return null;
}
