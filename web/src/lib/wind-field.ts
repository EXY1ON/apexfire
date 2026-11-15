// The model wind of one forecast hour as a continuous field: u/v on the regular grid of requested points, bilinear in between.
// Particles on the map move with this field, so the motion is the model's, not decoration.

export interface FieldPoint { requested: [number, number]; speed: number[]; dir: number[] } // m/s; degrees the wind blows FROM
export interface Field { lat0: number; lon0: number; stepLat: number; stepLon: number; nLat: number; nLon: number; u: Float32Array; v: Float32Array }

/** u (towards east) and v (towards north) in m/s at every grid node for `hour`; null if the points do not form a full grid. */
export function buildField(points: FieldPoint[], hour: number): Field | null {
  const lats = [...new Set(points.map((p) => p.requested[0]))].sort((a, b) => a - b);
  const lons = [...new Set(points.map((p) => p.requested[1]))].sort((a, b) => a - b);
  if (lats.length < 2 || lons.length < 2 || lats.length * lons.length !== points.length) return null;
  const stepLat = lats[1] - lats[0]; const stepLon = lons[1] - lons[0];
  const u = new Float32Array(points.length).fill(NaN);
  const v = new Float32Array(points.length).fill(NaN);
  for (const p of points) {
    const i = Math.round((p.requested[0] - lats[0]) / stepLat); const j = Math.round((p.requested[1] - lons[0]) / stepLon);
    const s = p.speed[hour]; const r = (p.dir[hour] * Math.PI) / 180;
    u[i * lons.length + j] = -s * Math.sin(r);
    v[i * lons.length + j] = -s * Math.cos(r);
  }
  if (u.some(Number.isNaN)) return null;
  return { lat0: lats[0], lon0: lons[0], stepLat, stepLon, nLat: lats.length, nLon: lons.length, u, v };
}

/** A field straight from u/v components on a regular grid (lat-major, both axes ascending); null if any node is missing. */
export function fieldFromComponents(lats: number[], lons: number[], u: (number | null)[], v: (number | null)[]): Field | null {
  if (lats.length < 2 || lons.length < 2 || u.length !== lats.length * lons.length || v.length !== u.length) return null;
  if (u.some((x) => x === null || !Number.isFinite(x)) || v.some((x) => x === null || !Number.isFinite(x))) return null;
  return { lat0: lats[0], lon0: lons[0], stepLat: lats[1] - lats[0], stepLon: lons[1] - lons[0], nLat: lats.length, nLon: lons.length,
    u: Float32Array.from(u as number[]), v: Float32Array.from(v as number[]) };
}

/** Bilinear u/v at a point, or null outside the grid (no extrapolation). */
export function sampleField(f: Field, lon: number, lat: number): [number, number] | null {
  const y = (lat - f.lat0) / f.stepLat; const x = (lon - f.lon0) / f.stepLon;
  if (!(x >= 0 && y >= 0 && x <= f.nLon - 1 && y <= f.nLat - 1)) return null;
  const i = Math.min(Math.floor(y), f.nLat - 2); const j = Math.min(Math.floor(x), f.nLon - 2);
  const fy = y - i; const fx = x - j; const k = i * f.nLon + j; const n = f.nLon;
  const w00 = (1 - fx) * (1 - fy); const w01 = fx * (1 - fy); const w10 = (1 - fx) * fy; const w11 = fx * fy;
  return [f.u[k] * w00 + f.u[k + 1] * w01 + f.u[k + n] * w10 + f.u[k + n + 1] * w11,
    f.v[k] * w00 + f.v[k + 1] * w01 + f.v[k + n] * w10 + f.v[k + n + 1] * w11];
}
