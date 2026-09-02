import Link from "next/link";

export default function Home() {
  return (
    <main className="landing-shell">
      <nav className="site-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/">
          Slow Garden
        </Link>
        <Link className="quiet-link" href="/login">
          Enter your garden
        </Link>
      </nav>

      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">A private place for unfinished thought</p>
          <h1>Let an idea stay quiet long enough to become itself.</h1>
          <p className="hero-lede">
            Capture fragments without interruption. Return later to a small,
            source-linked set of connections—never a feed, never a performance.
          </p>
          <div className="hero-actions">
            <Link className="primary-button" href="/login">
              Begin a private garden
            </Link>
            <a className="text-link" href="#privacy">
              How privacy works
            </a>
          </div>
        </div>

        <div
          className="garden-preview"
          role="img"
          aria-label="A quiet garden of thoughts represented by two seeds becoming a later bloom"
        >
          <div className="seed-card seed-card-one">
            <span>Seed</span>
            What keeps returning when the noise settles?
          </div>
          <div className="seed-card seed-card-two">
            <span>Seed</span>
            A question can remain open without being abandoned.
          </div>
          <div className="bloom-card">
            <span>Bloom · later</span>
            Both notes protect attention by refusing a premature answer.
          </div>
        </div>
      </section>

      <section className="principles" id="privacy">
        <article>
          <span className="principle-number">01</span>
          <h2>Private by default</h2>
          <p>
            Every account is an isolated tenant. There are no public profiles,
            anonymous garden links, or shared notes in this first release.
          </p>
        </article>
        <article>
          <span className="principle-number">02</span>
          <h2>Your words stay yours</h2>
          <p>
            Source revisions are append-only. System interpretations remain
            visibly separate and traceable to the exact notes that support them.
          </p>
        </article>
        <article>
          <span className="principle-number">03</span>
          <h2>Nothing interrupts</h2>
          <p>
            No autocomplete, live critique, or automatic rearrangement. The
            foreground belongs to you; background processing returns later.
          </p>
        </article>
      </section>
    </main>
  );
}
