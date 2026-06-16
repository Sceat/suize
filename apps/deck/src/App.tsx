import { useEffect, useState } from 'react';
import { tracks } from './tracks';
import { Index, TrackPageView } from './views';

const routeOf = () => window.location.pathname.replace(/^\/+/, '');

export function App() {
  const [route, setRoute] = useState(routeOf);

  useEffect(() => {
    const on = () => setRoute(routeOf());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const go = (id: string) => {
    window.history.pushState({}, '', id ? `/${id}` : '/');
    setRoute(id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const page = tracks.find((t) => t.id === route);

  return (
    <>
      <div className="amb" />
      <div className="watermark" />
      <div className="grain" />
      <div className="shell">
        <header className="mast">
          <button className="mast__brand" onClick={() => go('')}>
            <img className="mast__logo" src="/logo.png" alt="" width="44" height="44" />
            <div className="mast__words">
              <div className="wordmark">suize</div>
              <div className="tagline">
                The building blocks for <b>agentic payments on Sui</b>.
              </div>
            </div>
          </button>
          <span className="livepill">testnet-proven · mainnet-ready</span>
        </header>

        <nav className="tabs" role="tablist">
          <button role="tab" aria-selected={route === ''} className="tab" onClick={() => go('')}>
            Home
          </button>
          {tracks.map((t) => (
            <button key={t.id} role="tab" aria-selected={route === t.id} className="tab" onClick={() => go(t.id)}>
              {t.tab}
            </button>
          ))}
        </nav>

        {page ? <TrackPageView page={page} key={page.id} /> : <Index onJump={go} />}

        <footer className="foot">
          <span>Suize · built on Sui · x402 V2 “exact” · gasless USDC</span>
          <span className="mono">api.suize.io</span>
        </footer>
      </div>
    </>
  );
}
