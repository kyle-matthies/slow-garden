"use client";

export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="auth-page">
      <section className="auth-shell">
        <div className="auth-copy">
          <p className="panel-kicker">The garden paused safely</p>
          <h1>Nothing was silently lost.</h1>
          <p>Slow Garden could not complete that request. Try again when the connection is stable.</p>
          <button className="primary-button" type="button" onClick={reset}>Try again</button>
        </div>
      </section>
    </main>
  );
}
