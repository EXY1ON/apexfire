import { useEffect, useId, type ReactNode } from 'react';
import { FLAME, FLAME_CORE, PIN, PIN_HOLE, WIND_ARROW } from './MapView';

export interface LayerToggle { id: string; label: string; detail?: string; checked: boolean; onChange: (on: boolean) => void; disabled?: boolean }
export interface LegendItem { glyph: ReactNode; label: string; note?: string }

/** Top-centre "Layers & legend" tab that drops a sheet with layer switches and every symbol explained. */
export function LayersDrawer({ open, onOpenChange, layers, legend, footer }: {
  open: boolean; onOpenChange: (open: boolean) => void; layers: LayerToggle[]; legend: LegendItem[]; footer?: ReactNode;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onOpenChange]);
  return (
    <div className="drawer-anchor">
      <button type="button" className="drawer-tab" aria-expanded={open} aria-controls={id} onClick={() => onOpenChange(!open)}>
        Layers &amp; legend
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
      </button>
      {open && (
        <section id={id} className="drawer" aria-label="Layers and legend">
          <div>
            <h2>Layers</h2>
            <ul className="layer-list">
              {layers.map((l) => (
                <li key={l.id}>
                  <label className="check">
                    <input type="checkbox" checked={l.checked} disabled={l.disabled} onChange={(e) => l.onChange(e.target.checked)} />
                    <span>{l.label}{l.detail && <small className="muted" style={{ display: 'block', fontSize: '0.75rem' }}>{l.detail}</small>}</span>
                  </label>
                </li>
              ))}
            </ul>
            {footer}
          </div>
          <div>
            <h2>Legend</h2>
            <ul className="legend-grid">
              {legend.map((g) => (
                <li key={g.label}><span className="glyph" aria-hidden="true">{g.glyph}</span><span>{g.label}{g.note && <small>{g.note}</small>}</span></li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}

export function WindGlyph({ size = 18, rotate = 45 }: { size?: number; rotate?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d={WIND_ARROW} fill="currentColor" stroke="var(--ink-0)" strokeWidth="1" transform={`rotate(${rotate} 8 8)`} />
    </svg>
  );
}

export const LineGlyph = ({ dash, color = 'currentColor' }: { dash?: string; color?: string }) => (
  <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true"><line x1="1" y1="5" x2="23" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dash} /></svg>
);

export const RingGlyph = ({ color = '#FF6A00' }: { color?: string }) => (
  <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7" fill="none" stroke={color} strokeWidth="2.5" /></svg>
);

const Mark = ({ outer, inner, innerFill, height = 21 }: { outer: string; inner: string; innerFill: string; height?: number }) => (
  <svg className="mark-glyph" width={(height * 17) / 21} height={height} viewBox="-0.5 -0.5 17 21" aria-hidden="true" focusable="false">
    <path d={outer} fill="#FF6A00" stroke="#0C0D0A" strokeWidth="1.3" strokeLinejoin="round" /><path d={inner} fill={innerFill} /></svg>
);
/** The map's fire mark; `height` in px (the fire list sizes it by heat, like the map). */
export const FlameGlyph = ({ height }: { height?: number }) => <Mark outer={FLAME} inner={FLAME_CORE} innerFill="#0C0D0A" height={height} />;
export const PinGlyph = () => <Mark outer={PIN} inner={PIN_HOLE} innerFill="#f6f2ea" />;
