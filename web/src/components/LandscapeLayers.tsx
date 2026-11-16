import { useEffect } from 'react';
import type { Map as MLMap } from 'maplibre-gl';
import { addLayers, setGeoJSON, setImage } from './MapView';
import type { LegendItem } from './LayersDrawer';
import { useData } from '../lib/useData';
import { validateLandscape, type LandscapeDoc } from '../lib/landscape';

export const LANDSCAPE_PATH = 'landscape/what-burns.json';
export const BURNED_PATH = 'landscape/burned-areas.geojson';
const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const LANDCOVER_CREDIT = '© EU, Copernicus Land Monitoring Service, EEA (CORINE 2018)';

/** CORINE 2018 land cover as an image under the data layers (D7); the landscape file loads only while the layer is on. */
export function useLandCover(map: MLMap | null, on: boolean) {
  const doc = useData(on ? LANDSCAPE_PATH : null, validateLandscape);
  useEffect(() => {
    if (!map) return;
    const d = doc.data;
    setImage(map, 'fw-landcover', on && d ? `/data/${d.image.path}` : null, d?.image.corners ?? [], { opacity: 0.55 });
  }, [map, on, doc.data]);
  return doc;
}

/** Legend rows for the ten land-cover groups. */
export const landCoverLegend = (d: LandscapeDoc | null): LegendItem[] =>
  (d ? [...d.groups.map((g) => ({ glyph: <span className="swatch" style={{ background: g.color }} />, label: g.label })),
    { glyph: <span />, label: 'Land cover', note: LANDCOVER_CREDIT }] : []);

/** EFFIS mapped burned areas (caller filters the features); fires under 30 ha get a dashed outline (D5). */
export function useBurnedLayer(map: MLMap | null, fc: GeoJSON.FeatureCollection | null) {
  useEffect(() => {
    if (!map) return;
    setGeoJSON(map, 'fw-burned', fc ?? EMPTY, 'Burned areas: EFFIS (CC BY 4.0)');
    addLayers(map, [
      { id: 'fw-burned-fill', type: 'fill', source: 'fw-burned', paint: { 'fill-color': '#FF6A00', 'fill-opacity': 0.22 } },
      { id: 'fw-burned-line', type: 'line', source: 'fw-burned', filter: ['!', ['get', 'small']], paint: { 'line-color': '#ff8a3d', 'line-width': 1.2 } },
      { id: 'fw-burned-small', type: 'line', source: 'fw-burned', filter: ['get', 'small'], paint: { 'line-color': '#ff8a3d', 'line-width': 1, 'line-dasharray': [1.5, 1.5] } },
    ]);
  }, [map, fc]);
}

export const BURNED_LEGEND: LegendItem = {
  glyph: <span className="swatch" style={{ background: 'rgba(255,106,0,0.35)', border: '1px solid #ff8a3d' }} />,
  label: 'Mapped burned area', note: 'EFFIS, from 2016; dashed = under 30 ha',
};
