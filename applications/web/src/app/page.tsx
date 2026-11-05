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
          <Link className="quiet-link" href="/login">Sign in</Link>
        </div>
      </nav>

      <section className="landing-frame landing-hero" id="main-content" aria-labelledby="landing-title">
        <div>
          <p className="eyebrow">Private notes. Room to think.</p>
          <h1 id="landing-title">Keep your thoughts.<br />Find your thread.</h1>
          <p className="landing-lede">
            A quiet garden for journal entries, work in progress, and questions
            you aren&apos;t ready to answer. Write a little, leave it unfinished,
            and return to the same thought when there&apos;s more to say.
          </p>
          <div className="landing-actions">
            <Link className="primary-button" href="/login">
              Start your garden
            </Link>
            <a className="text-link" href="#privacy">
              Your writing stays private
            </a>
          </div>
          <p className="landing-signin-note">Use an email code to sign in. No password to remember.</p>
        </div>
        <GardenExample />
      </section>

      <section className="landing-frame landing-method" id="how-it-works" aria-labelledby="method-title">
        <div className="landing-section-intro">
          <p className="eyebrow">A garden you can return to</p>
          <h2 id="method-title">One thought can hold more than one day.</h2>
          <p>Start with an idea, a decision, or something you noticed. You don&apos;t need a finished piece or a system of tags.</p>
        </div>
        <ol className="landing-steps">
          <li><span aria-hidden="true">01</span><h3>Write what&apos;s here</h3><p>Give a thought a home in a topic. Add a dated entry, even if it&apos;s only a sentence.</p></li>
          <li><span aria-hidden="true">02</span><h3>Leave room for later</h3><p>Return to that thought and add another entry. Your earlier words stay available in its history.</p></li>
          <li><span aria-hidden="true">03</span><h3>Pick up your thread</h3><p>Browse the garden, use the list, or search your writing to find where you left off.</p></li>
        </ol>
      </section>

      <section className="landing-frame landing-ai-note" aria-labelledby="ai-title">
        <p className="eyebrow">Optional AI · being tested</p>
        <h2 id="ai-title">Your garden is useful before a reflection arrives.</h2>
        <p>AI tending is being tested separately. When enabled, it can lightly catalogue allowed topics and offer a few source-linked connections. It doesn&apos;t rewrite your entries. Automatic overnight delivery is not generally active, and a pass may return no connection at all.</p>
        <p>You can write, revisit, search, and export without waiting for AI.</p>
      </section>

      <section className="landing-frame landing-privacy" id="privacy" aria-labelledby="privacy-title">
        <div className="landing-section-intro">
          <p className="eyebrow">A personal place</p>
          <h2 id="privacy-title">Your writing belongs in your garden.</h2>
        </div>
        <div className="landing-privacy-grid">
        <article>
          <h3>Only your account</h3>
          <p>
            Notes are private to your account. This release has no public profiles,
            shared gardens, or anonymous links to your writing.
          </p>
        </article>
        <article>
          <h3>A way back, and a way out</h3>
          <p>
            Revisit earlier versions and export your writing. When AI is enabled,
            its reflections are kept separate from your entries and link to the
            writing they cite.
          </p>
        </article>
        <article>
          <h3>Permission comes first</h3>
          <p>
            You choose which topics may be read by AI when the service is enabled.
            Cross-pollination between topics has its own permission. There&apos;s no
            autocomplete or live critique while you write.
          </p>
        </article>
        </div>
      </section>

      <section className="landing-frame landing-start" aria-labelledby="start-title">
        <h2 id="start-title">Start with one unfinished thought.</h2>
        <p>A question you&apos;re holding. A line from today. An idea you want to keep.</p>
        <Link className="primary-button" href="/login">Start your garden</Link>
      </section>
      <footer className="landing-frame landing-footer">
        <span>Slow Garden</span>
        <a className="text-link" href="#privacy">Privacy and permissions</a>
      </footer>
    </main>
  );
}
