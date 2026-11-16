import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import Link from "next/link";
import { GardenExample } from "./landing/garden-example";
import "./landing/landing.css";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (isSupabaseConfigured()) {
    const db = await createClient();
    const { data, error } = await db.auth.getClaims();
    if (!error && data?.claims?.sub) redirect("/garden");
  }
  // Overnight tending stays off in production until its evaluation gate passes.
  const tendingLive = process.env.GARDEN_AI_ENABLED === "true";
  return (
    <main className="landing-shell growth-landing">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <nav className="landing-frame landing-nav" aria-label="Primary navigation">
        <Link className="wordmark" href="/">
          Slow Garden
        </Link>
        <div className="landing-nav-links">
          <a className="text-link" href="#how-it-works">How it works</a>
          <a className="text-link" href="#privacy">Privacy</a>
          <Link className="quiet-link" href="/login">Sign in</Link>
        </div>
      </nav>

      <section className="landing-frame landing-hero" id="main-content" aria-labelledby="landing-title">
        <div className="landing-hero-copy">
          <p className="eyebrow">A private journal with a method</p>
          <h1 id="landing-title">Write by day. <span>Wake to a bloom.</span></h1>
          <p className="landing-lede">
            You write, uninterrupted. Overnight, an AI pass tends what you
            wrote and returns at most three blooms: connections, tensions and
            questions that quote your own words. The thinking stays yours.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/login">
              Start your garden
            </Link>
            <a className="text-link" href="#how-it-works">
              See how it works
            </a>
          </div>
          {!tendingLive && (
            <p className="landing-preview-note">
              Overnight tending is in private preview; writing, history and
              export work today.
            </p>
          )}
        </div>
        <GardenExample />
      </section>

      <section className="landing-frame landing-method" id="how-it-works" aria-labelledby="method-title">
        <div className="landing-section-intro">
          <p className="eyebrow">How it works</p>
          <h2 id="method-title">Slow on purpose.</h2>
          <p>
            An instant answer changes what you were about to think. So the
            garden waits until you’ve stopped writing.
          </p>
        </div>
        <ol className="landing-steps">
          <li>
            <span aria-hidden="true">01</span>
            <h3>Write by day</h3>
            <p>
              Keep a thought in a topic and add a dated entry whenever
              there’s more to say. No chat, no suggestions. Earlier versions
              stay in its history.
            </p>
          </li>
          <li>
            <span aria-hidden="true">02</span>
            <h3>Leave it overnight</h3>
            <p>
              A single AI pass reads across the topics you’ve allowed,
              looking for what connects, what pulls apart, and what changed.
              Connecting across topics needs its own permission.
            </p>
          </li>
          <li className="landing-step-return">
            <span aria-hidden="true">03</span>
            <h3>Wake to a bloom, or to nothing</h3>
            <p>
              At most three blooms come back, each linked to the lines it
              quotes. Keep one, correct it, or prune it. If there’s nothing
              worth saying, nothing is returned.
            </p>
          </li>
        </ol>
        {!tendingLive && (
          <p className="landing-preview-note landing-preview-wide">
            Steps two and three describe the method. Overnight tending is in
            private preview; writing, history and export work today.
          </p>
        )}
      </section>

      <section className="landing-frame landing-never" aria-labelledby="never-title">
        <div className="landing-section-intro">
          <p className="eyebrow">Boundaries</p>
          <h2 id="never-title">What the AI will never do.</h2>
        </div>
        <ul className="landing-never-list">
          <li><h3>Interrupt you</h3><p>Nothing appears while you write. There is no chat and no live critique.</p></li>
          <li><h3>Finish your sentences</h3><p>No autocomplete, no suggested next line.</p></li>
          <li><h3>Rewrite your entries</h3><p>Your writing is the original. A bloom sits beside it, clearly marked, and never replaces it.</p></li>
          <li><h3>Read what you haven’t allowed</h3><p>Tending is a permission you set topic by topic.</p></li>
          <li><h3>Act for you</h3><p>It does not post, send or publish. It can prepare; anything consequential needs your approval.</p></li>
          <li><h3>Use your writing for training</h3><p>Not for model training, public examples or product analytics, unless you give an explicit, named opt-in.</p></li>
        </ul>
      </section>

      <section className="landing-frame landing-privacy" id="privacy" aria-labelledby="privacy-title">
        <div className="landing-section-intro">
          <p className="eyebrow">Privacy and ownership</p>
          <h2 id="privacy-title">Your writing belongs in your garden.</h2>
        </div>
        <div className="landing-privacy-grid">
          <article>
            <h3>Only your account</h3>
            <p>
              Notes are private to your account. This release has no public
              profiles, shared gardens, or anonymous links to your writing.
            </p>
          </article>
          <article>
            <h3>Take it with you</h3>
            <p>
              Export your writing whenever you like, and revisit earlier
              versions of any entry. Blooms are stored apart from your
              entries and link to the writing they cite.
            </p>
          </article>
          <article>
            {/* Deletion is described only where it is switched on (after its migration is applied). */}
            {process.env.GARDEN_DELETION_ENABLED === "true" ? (
              <>
                <h3>Archive hides. Delete erases.</h3>
                <p>
                  Archive puts anything out of view and can be undone. Delete
                  permanently erases an entry, a thought, a topic, a garden or
                  your whole account, with every saved version and any blooms
                  drawn from it. Copies in our database provider’s routine
                  backups are not reachable from the app and expire on the
                  provider’s schedule.
                </p>
              </>
            ) : (
              <>
                <h3>Archive now, deletion before wider release</h3>
                <p>
                  Today you can archive anything to put it out of view, and
                  export all of it. In-app deletion is not available yet; we
                  have made complete deletion a requirement before Slow
                  Garden opens more widely.
                </p>
              </>
            )}
          </article>
        </div>
      </section>

      <section className="landing-frame landing-start" aria-labelledby="start-title">
        <h2 id="start-title">Start with one unfinished thought.</h2>
        <p>A question you’re holding. A line from today. An idea you want to keep.</p>
        <Link className="primary-button" href="/login">Start your garden</Link>
        <p className="landing-signin-note">Sign in with an email code. No password to remember.</p>
      </section>
      <footer className="landing-frame landing-footer">
        <span>Slow Garden</span>
        <a className="text-link" href="#privacy">Privacy and permissions</a>
      </footer>
    </main>
  );
}
