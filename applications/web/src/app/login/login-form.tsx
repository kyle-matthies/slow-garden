"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({ configured }: { configured: boolean }) {
  const router = useRouter();
  const supabase = useMemo(
    () => (configured ? createClient() : null),
    [configured],
  );
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [pending, setPending] = useState(false);
  const [resendAt, setResendAt] = useState(0);
  const [clock, setClock] = useState(() => Date.now());
  const [message, setMessage] = useState(
    configured ? "" : "Service configuration is pending.",
  );
  const [hasError, setHasError] = useState(false);
  const resendSeconds = Math.max(0, Math.ceil((resendAt - clock) / 1000));

  useEffect(() => {
    if (!resendAt) return;
    const interval = window.setInterval(() => {
      const current = Date.now();
      setClock(current);
      if (current >= resendAt) setResendAt(0);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [resendAt]);

  function startResendCooldown() {
    const current = Date.now();
    setClock(current);
    setResendAt(current + 30_000);
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setHasError(false);
    startResendCooldown();
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

  async function resendCode() {
    if (!supabase || resendSeconds > 0) return;
    setPending(true);
    setHasError(false);
    setCode("");
    startResendCooldown();
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
    setMessage("A new code is on its way. Only the newest code works.");
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
    router.replace("/garden");
    router.refresh();
  }

  return (
    <section className="auth-panel" aria-labelledby="sign-in-title">
      <p className="panel-kicker">Private account</p>
      <h2 id="sign-in-title">Sign in to your garden</h2>
      <p>
        No password. Enter your email and we’ll send a six-digit code that
        works for a few minutes. Type it here to open your garden.
      </p>
      <p>
        You stay signed in on this browser between visits. On a shared device,
        sign out when you finish.
      </p>

      {!codeSent ? (
        <form className="form-stack" onSubmit={sendCode}>
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              disabled={!configured || pending}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <button
            className="primary-button"
            type="submit"
            disabled={!configured || pending}
          >
            {pending ? "Sending…" : "Send private sign-in code"}
          </button>
        </form>
      ) : (
        <form className="form-stack" onSubmit={verifyCode}>
          <p>
            Enter the six-digit code we emailed to <strong>{email}</strong>.
            Check spam if it hasn’t arrived within a minute.
          </p>
          <div className="field">
            <label htmlFor="code">Six-digit code</label>
            <input
              id="code"
              name="code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              disabled={pending}
              value={code}
              onChange={(event) =>
                setCode(event.target.value.replace(/\D/g, ""))
              }
            />
          </div>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Verifying…" : "Open my garden"}
          </button>
          <div className="action-row">
            <button
              className="plain-button"
              type="button"
              onClick={() => {
                setCodeSent(false);
                setCode("");
                setMessage("");
              }}
            >
              Use another email
            </button>
            <button
              className="plain-button"
              type="button"
              onClick={resendCode}
              disabled={pending || resendSeconds > 0}
            >
              {resendSeconds > 0
                ? `Resend code in ${resendSeconds}s`
                : "Resend code"}
            </button>
          </div>
        </form>
      )}

      <p className="status-message" data-error={hasError} aria-live="polite">
        {message}
      </p>
      <p className="form-note">
        Personal notes are private by default. Slow Garden has no anonymous
        garden access or public profile in this release.
      </p>
    </section>
  );
}
