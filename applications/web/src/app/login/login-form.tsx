"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useGardenStore } from "@/lib/garden/store/context";

const RESEND_COOLDOWN_MS = 60_000; // matches Supabase auth.email.max_frequency

export function LoginForm({
  configured,
  onSignedIn,
}: {
  configured: boolean;
  /** Where to go once the code is accepted; by default, the garden. */
  onSignedIn?: () => void;
}) {
  const router = useRouter();
  const store = useGardenStore();
  const supabase = configured ? store : null;
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

  // Browser mode: no server checks the session before this page renders, so a
  // signed-in visitor is sent on to the garden from here.
  useEffect(() => {
    if (!configured || store.kind !== "browser" || onSignedIn) return;
    let current = true;
    store.getSession().then(
      (session) => {
        if (current && session.signedIn) router.replace("/garden");
      },
      () => {},
    );
    return () => {
      current = false;
    };
  }, [configured, store, onSignedIn, router]);

  function startResendCooldown() {
    const current = Date.now();
    setClock(current);
    setResendAt(current + RESEND_COOLDOWN_MS);
  }

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setHasError(false);
    startResendCooldown();
    const result = await supabase.requestEmailCode(email, { createAccount: true });
    setPending(false);
    if (!result.ok) {
      setHasError(true);
      setMessage(result.message);
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
    const result = await supabase.requestEmailCode(email, { createAccount: true });
    setPending(false);
    if (!result.ok) {
      setHasError(true);
      setMessage(result.message);
      return;
    }
    setMessage("A new code is on its way. Only the newest code works.");
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setPending(true);
    setHasError(false);
    const result = await supabase.verifyEmailCode(email, code);
    setPending(false);
    if (!result.ok) {
      setHasError(true);
      setMessage(result.message);
      return;
    }
    if (onSignedIn) return onSignedIn();
    router.replace("/garden");
    router.refresh();
  }

  return (
    <section className="auth-panel" aria-labelledby="sign-in-title">
      <p className="panel-kicker">{codeSent ? "Check your email" : "Private account"}</p>
      <h2 id="sign-in-title">{codeSent ? "Enter your code" : "Sign in to your garden"}</h2>
      {!codeSent && (
        <p>
          No password. We’ll email you a six-digit code; type it here to open
          your garden. New here? The same step creates your account.
        </p>
      )}

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
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              enterKeyHint="send"
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
            {pending ? "Sending…" : "Email me a sign-in code"}
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
              enterKeyHint="done"
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
        You stay signed in on this browser between visits. On a shared
        device, sign out when you finish.
      </p>
    </section>
  );
}
