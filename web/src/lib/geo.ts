type Ring = number[][];

function inRing(lon: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]; const [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Ray-casting point-in-polygon on WGS84 coordinates (holes respected). Points exactly on an edge may fall either side. */
export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Geometry): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.some(([outer, ...holes]) => inRing(lon, lat, outer) && !holes.some((h) => inRing(lon, lat, h)));
}

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}

export type Bounds = [number, number, number, number];

export function boundsOf(coords: number[][]): Bounds {
  const b: Bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }
  return b;
}

export function geometryCoords(g: GeoJSON.Geometry): number[][] {
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'Polygon') return g.coordinates.flat();
  if (g.type === 'MultiPolygon') return g.coordinates.flat(2);
  return [];
}

/** Point at a distance (km) and bearing (degrees clockwise from north); flat-earth step, fine below ~20 km. */
export function offset(lat: number, lon: number, bearingDeg: number, km: number): [number, number] {
  const b = (bearingDeg * Math.PI) / 180;
  return [lon + (km * Math.sin(b)) / (111.32 * Math.cos((lat * Math.PI) / 180)), lat + (km * Math.cos(b)) / 111.32];
}

/** Closed polygon ring for a sector from (lat, lon) towards `toDeg` ± `halfDeg`, `km` long. */
export function wedge(lat: number, lon: number, toDeg: number, halfDeg: number, km: number): number[][] {
  const arc = Array.from({ length: 9 }, (_, i) => offset(lat, lon, toDeg - halfDeg + (i * 2 * halfDeg) / 8, km));
  return [[lon, lat], ...arc, [lon, lat]];
}

/** Largest angular distance (degrees) of a set of bearings from their circular mean. */
export function bearingSpread(degs: number[]): { mean: number; spread: number } {
  const r = Math.PI / 180;
  const x = degs.reduce((a, d) => a + Math.cos(d * r), 0); const y = degs.reduce((a, d) => a + Math.sin(d * r), 0);
  const mean = ((Math.atan2(y, x) / r) + 360) % 360;
  const spread = Math.max(0, ...degs.map((d) => Math.abs((((d - mean) % 360) + 540) % 360 - 180)));
  return { mean, spread };
}
