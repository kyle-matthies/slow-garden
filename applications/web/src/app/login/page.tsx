import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";
import { Sprout } from "./sprout";
import "./login.css";

export const metadata: Metadata = { title: "Sign in" };

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (isSupabaseConfigured()) {
    const db = await createClient();
    const { data, error } = await db.auth.getClaims();
    if (!error && data?.claims?.sub) redirect("/garden");
  }
  return (
    <main className="calm-page">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <div className="calm-shell" id="main-content">
        <section className="calm-copy">
          <Link className="wordmark" href="/">
            <Sprout />
            Slow Garden
          </Link>
          <h1>Write by day. <em>Wake to a bloom.</em></h1>
          <p>
            Your garden is yours alone. Signing in does not create a public
            profile or show your notes to anyone else.
          </p>
          <ol className="calm-steps" aria-label="How signing in works">
            <li><span><strong>Enter your email.</strong> There is no password to choose or remember.</span></li>
            <li><span><strong>We send a six-digit code.</strong> It works for a few minutes, and only the newest one counts.</span></li>
            <li><span><strong>Type it here.</strong> First time? The same code opens a new garden for you.</span></li>
          </ol>
        </section>
        <LoginForm configured={isSupabaseConfigured()} />
      </div>
    </main>
  );
}
