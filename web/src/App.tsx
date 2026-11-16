import { useEffect, useRef, useState } from 'react';
import { Link, navigate, useLocation } from './lib/router';
import { setExpert, useExpert } from './lib/mode';
import { Explore } from './pages/Explore';
import { Landscape } from './pages/Landscape';
import { Stories } from './pages/Stories';
import { Brvenica } from './pages/Brvenica';
import { Mariovo } from './pages/Mariovo';
import { FireStory } from './pages/FireStory';
import { SpreadLab } from './pages/SpreadLab';
import { DataMethods } from './pages/DataMethods';
import { About, REPO_URL } from './pages/About';
import { Icon, type IconName } from './components/Icon';
import { Harmonization } from './pages/Harmonization';

// [href, Expert label, Simple label, icon]
const NAV: readonly (readonly [string, string, string, IconName])[] = [['/explore', 'Map', 'Fire map', 'map'], ['/landscape', 'Landscape', 'Landscape', 'leaf'], ['/harmonization', 'Harmonization', 'Satellites compared', 'compare'],
  ['/stories', 'Stories', 'Fire stories', 'book'], ['/spread-lab', 'Spread Lab', 'How fire spreads', 'spread'], ['/data-methods', 'Data & Methods', 'Sources', 'database'],
  ['/about', 'About', 'About', 'info']];

const TITLES: Record<string, string> = {
  '/explore': 'Fire map', '/landscape': 'Landscape', '/stories': 'Fire stories', '/stories/brvenica-2017': 'Brvenica 2017', '/stories/mariovo-2024': 'Mariovo 2024',
  '/spread-lab': 'Spread Lab', '/harmonization': 'Harmonization', '/data-methods': 'Data & methods', '/about': 'About',
};

function route(path: string) {
  switch (path.replace(/\/+$/, '') || '/') {
    case '/explore': return <Explore />;
    case '/landscape': return <Landscape />;
    case '/stories': return <Stories />;
    case '/stories/brvenica-2017': return <Brvenica />;
    case '/stories/mariovo-2024': return <Mariovo />;
    case '/spread-lab': return <SpreadLab />;
    case '/harmonization': return <Harmonization />;
    case '/data-methods': return <DataMethods />;
    case '/about': return <About />;
    default: {
      const story = /^\/stories\/([a-z0-9-]+)$/.exec(path.replace(/\/+$/, ''));
      return story ? <FireStory key={story[1]} id={story[1]} /> : null;
    }
  }
}

export function ModeSwitch() {
  const expert = useExpert();
  return (
    <div className="seg mode-switch" role="group" aria-label="Level of detail">
      <button type="button" aria-pressed={!expert} onClick={() => setExpert(false)} title="Plain words, fewer numbers">Simple</button>
      <button type="button" aria-pressed={expert} onClick={() => setExpert(true)} title="Sensors, model details, filters and exports">Expert</button>
    </div>
  );
}

export function App() {
  const loc = useLocation();
  const expert = useExpert();
  const first = useRef(true);
  const [menu, setMenu] = useState(false);
  useEffect(() => { if (loc.pathname === '/') navigate('/explore', { replace: true }); }, [loc.pathname]);
  useEffect(() => {
    setMenu(false);
    if (first.current) { first.current = false; return; }
    document.getElementById('page-title')?.focus();
  }, [loc.pathname]);
  // On first load, a #section in the address is scrolled to once the page has rendered (the browser tries before React has drawn it).
  useEffect(() => {
    const id = decodeURIComponent(location.hash.slice(1));
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView());
  }, []);
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setMenu(false); document.getElementById('menu-btn')?.focus(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);
  const page = route(loc.pathname);
  useEffect(() => { document.documentElement.dataset.mode = expert ? 'expert' : 'simple'; }, [expert]);
  useEffect(() => {
    const t = TITLES[loc.pathname.replace(/\/+$/, '')];
    document.title = t ? `${t} · ApexFire` : 'ApexFire';
  }, [loc.pathname]);

  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className={`site-header${menu ? ' menu-open' : ''}`}>
        <Link href="/explore" className="brand" aria-label="ApexFire home">
          <img src="/apexfire-icon.svg" alt="" width="30" height="30" /> <span>ApexFire</span>
        </Link>
        <nav aria-label="Main" id="main-nav">
          <ul>
            {NAV.map(([href, label, simple, icon]) => {
              const active = loc.pathname === href || (href !== '/explore' && loc.pathname.startsWith(href));
              return <li key={href}><Link href={href} aria-current={active ? 'page' : undefined}><Icon name={icon} size={15} />{expert ? label : simple}</Link></li>;
            })}
          </ul>
        </nav>
        <div className="header-end">
          <Link href="/data-methods#coverage" className="status-chip" title="Coverage by year and sensor">Archive since Nov 2000</Link>
          <ModeSwitch />
          <button type="button" id="menu-btn" className="menu-btn" aria-expanded={menu} aria-controls="main-nav" onClick={() => setMenu((m) => !m)}>
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d={menu ? 'M4 4L14 14M14 4L4 14' : 'M2 4.5H16M2 9H16M2 13.5H16'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            <span>Menu</span>
          </button>
        </div>
      </header>
      <main id="main">
        {page ?? (loc.pathname === '/' ? null : (
          <div className="page prose"><h1 id="page-title" tabIndex={-1}>Page not found</h1><p>There is no page at <code>{loc.pathname}</code>. <Link href="/explore">Go to the map</Link>.</p></div>
        ))}
      </main>
      <footer className="site-footer">
        <p>ApexFire, a NASA Space Apps 2026 prototype for North Macedonia. Satellite detections are not confirmed fires; saved data is labelled with its time and is not live. <Link href="/data-methods">Sources &amp; methods</Link> · <Link href="/about">About</Link> · <a href={REPO_URL} rel="noopener" target="_blank">Source code on GitHub</a></p>
      </footer>
    </>
  );
}
