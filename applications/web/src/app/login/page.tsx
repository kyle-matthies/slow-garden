import type { Metadata } from "next";
import Link from "next/link";
import { isSupabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="auth-page">
      <div className="auth-shell">
        <section className="auth-copy">
          <Link className="wordmark" href="/">Slow Garden</Link>
          <h1>Your garden is yours alone.</h1>
          <p>
            Each account is isolated at the database boundary. Signing in does
            not create a public profile or expose your notes to other people.
          </p>
        </section>
        <LoginForm configured={isSupabaseConfigured()} />
      </div>
    </main>
  );
}
