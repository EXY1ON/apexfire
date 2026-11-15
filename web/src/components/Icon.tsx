import type { ReactNode } from 'react';
import { FLAME, FLAME_CORE } from './MapView';

// One monoline icon set (24 px grid, currentColor stroke) so headings, nav and buttons share a visual language.
const PATHS = {
  clock: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 7v5l3.5 2',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  eye: 'M2 12s3.6-7 10-7s10 7 10 7s-3.6 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6',
  shield: 'M12 3l8 3v6c0 4.4-3.4 8-8 9c-4.6-1-8-4.6-8-9V6z M9 12l2 2l4-4',
  thermo: 'M10 14V5a2 2 0 1 1 4 0v9a4 4 0 1 1-4 0zM12 9v7',
  drop: 'M12 3s6 6.4 6 11a6 6 0 0 1-12 0c0-4.6 6-11 6-11z',
  wind: 'M3 9h11a3 3 0 1 0-3-3M3 15h15a3 3 0 1 1-3 3M3 12h7',
  pin: 'M12 21s-7-6.4-7-12a7 7 0 0 1 14 0c0 5.6-7 12-7 12zM12 6.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5',
  satellite: 'M13 4l7 7l-3 3l-7-7zM10 7l-6 6M17 14l-6 6M8.5 15.5l-3 3M14 10l-4 4',
  layers: 'M12 3l9 5l-9 5l-9-5zM3 13l9 5l9-5',
  share: 'M12 15V3M7 8l5-5l5 5M5 13v7h14v-7',
  download: 'M12 3v12M7 10l5 5l5-5M5 20h14',
  info: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18M12 11v6M12 7.5v.5',
  book: 'M4 5c3-1.5 5.5-1.5 8 0v15c-2.5-1.5-5-1.5-8 0zM12 5c2.5-1.5 5-1.5 8 0v15c-3-1.5-5.5-1.5-8 0',
  compare: 'M6 20V9M12 20V4M18 20v-7M3 20h18',
  spread: 'M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 5a7 7 0 1 1-7 7M12 1.5a10.5 10.5 0 1 1-10.5 10.5',
  database: 'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3s-3.6 3-8 3s-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  map: 'M3 6l6-3l6 3l6-3v15l-6 3l-6-3l-6 3zM9 3v15M15 6v15',
  search: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.5 15.5L21 21',
  chart: 'M4 4v16h16M8 16v-4M12 16V8M16 16v-6',
  gauge: 'M4 16a8 8 0 1 1 16 0M12 16l4-5M4 20h16',
  leaf: 'M5 19c0-8 5-13 14-14c0 9-5 14-13 14zM5 19l7-7',
  cloud: 'M7 18h10a4 4 0 0 0 .5-7.97A6 6 0 0 0 6.1 9.5A4.25 4.25 0 0 0 7 18z',
} as const;
export type IconName = keyof typeof PATHS | 'flame';

export function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  if (name === 'flame') {
    return (
      <svg className="icon" width={size} height={size} viewBox="-2 -1 20 22" aria-hidden="true" focusable="false">
        <path d={FLAME} fill="currentColor" /><path d={FLAME_CORE} fill="var(--ink-0)" />
      </svg>
    );
  }
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The ember icon chip; `small` for Expert-style small-caps labels. Decorative: the text beside it carries the meaning. */
export const Chip = ({ icon, small }: { icon: IconName; small?: boolean }) => <span className={`ih-icon${small ? ' ih-sm' : ''}`}><Icon name={icon} size={small ? 12 : 17} /></span>;

/** A heading led by an icon chip. With className "eyebrow" (Expert labels) the chip is small. */
export function IconHeading({ icon, as: Tag = 'h2', id, children, className }: { icon: IconName; as?: 'h1' | 'h2' | 'h3'; id?: string; children: ReactNode; className?: string }) {
  const small = !!className?.split(' ').includes('eyebrow');
  return <Tag id={id} className={`ih${className ? ` ${className}` : ''}`}>{Tag === 'h1' ? <span className="ih-icon"><Icon name={icon} size={22} /></span> : <Chip icon={icon} small={small} />}<span>{children}</span></Tag>;
}

/** Simple mode folds technical detail behind a disclosure; Expert shows it inline. */
export function Tech({ expert, children }: { expert: boolean; children: ReactNode }) {
  return expert ? <>{children}</> : <details><summary>Show the technical detail</summary>{children}</details>;
}
