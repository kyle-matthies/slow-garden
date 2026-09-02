"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const supabase = useMemo(() => (configured ? createClient() : null), [configured]);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState(configured ? "" : "Service configuration is pending.");
  const [hasError, setHasError] = useState(false);

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setHasError(false);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    setPending(false);
    if (error) {
      setHasError(true);
      setMessage(error.message);
      return;
    }
    setCodeSent(true);
    setMessage("A six-digit sign-in code is on its way.");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setHasError(false);
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code.trim(),
      type: "email",
    });
    setPending(false);
    if (error) {
      setHasError(true);
      setMessage(error.message);
      return;
    }
    router.push("/garden");
    router.refresh();
  }

  return (
    <section className="auth-panel" aria-labelledby="sign-in-title">
      <p className="panel-kicker">Private account</p>
      <h2 id="sign-in-title">Enter quietly</h2>
      <p>No password to remember. We’ll email a short-lived code.</p>

      {!codeSent ? (
        <form className="form-stack" onSubmit={sendCode}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input id="email" name="email" type="email" autoComplete="email" inputMode="email" required disabled={!configured || pending} value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
          <button className="primary-button" type="submit" disabled={!configured || pending}>
            {pending ? "Sending…" : "Send private sign-in code"}
          </button>
        </form>
      ) : (
        <form className="form-stack" onSubmit={verifyCode}>
          <div className="field">
            <label htmlFor="code">Six-digit code</label>
            <input id="code" name="code" type="text" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required disabled={pending} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} />
          </div>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Open my garden"}
          </button>
          <button className="plain-button" type="button" onClick={() => { setCodeSent(false); setCode(""); setMessage(""); }}>
            Use another email
          </button>
        </form>
      )}

      <p className="status-message" data-error={hasError} aria-live="polite">{message}</p>
      <p className="form-note">
        Personal notes are private by default. Slow Garden has no anonymous
        garden access or public profile in this release.
      </p>
    </section>
  );
}
