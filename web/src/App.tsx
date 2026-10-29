const PLAN_URL = 'https://github.com/fishbill88/Asanaka/blob/main/PLAN.md';

// Phase 1 placeholder: the real landing page, sign-in and board arrive in phases 4 and 5.
export function App() {
  return (
    <div className="page">
      <header className="nav">
        <span className="wordmark"><span className="dot" aria-hidden="true" />Asanaka</span>
      </header>
      <main className="hero">
        <div className="copy">
          <h1><span>Asa na ka?</span><span>Board coming soon.</span></h1>
          <p>Cebuano for “where are you now?” Asanaka is a kanban board for a small team. This is its address; the board opens here once it’s built.</p>
          <a className="btn" href={PLAN_URL}>Read the plan</a>
        </div>
        <div className="stage" aria-hidden="true" />
      </main>
    </div>
  );
}
