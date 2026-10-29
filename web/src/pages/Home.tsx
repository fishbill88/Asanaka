import { useEffect } from 'react';
import { follow, href } from '../lib/router';

const PLAN_URL = 'https://github.com/fishbill88/Asanaka/blob/main/PLAN.md';

// The front door until phase 5 brings the full landing page in design B.
export function Home({ signedIn }: { signedIn: boolean }) {
  useEffect(() => { document.title = 'Asanaka'; }, []);
  const to = signedIn ? '/board' : '/signin';
  return (
    <div className="page">
      <header className="nav">
        <span className="wordmark"><span className="dot" aria-hidden="true" />Asanaka</span>
      </header>
      <main className="hero">
        <div className="copy">
          <h1><span>Asa na ka?</span><span>The board knows.</span></h1>
          <p>Cebuano for “where are you now?” Asanaka is a kanban board for a small team. Drag a card and everyone sees where it went.</p>
          <div className="copy-actions">
            <a className="btn" href={href(to)} onClick={(e) => follow(e, to)}>{signedIn ? 'Open the board' : 'Sign in'}</a>
            <a className="btn btn--tone" href={PLAN_URL}>Read the plan</a>
          </div>
        </div>
        <div className="stage" aria-hidden="true" />
      </main>
    </div>
  );
}
