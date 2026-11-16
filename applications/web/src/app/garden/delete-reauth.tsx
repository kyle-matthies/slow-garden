"use client";
import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Shown inside the account-deletion dialog when the database asks for a
 * recent sign-in. The same email-code flow as the sign-in page, without
 * leaving the dialog: a verified code starts a new session, then the person
 * is back at the confirmation they had already filled in.
 */
export function DeleteReauth({
  email,
  onDone,
}: {
  /** The account's email address; empty when the session carries none. */
  email: string;
  onDone: () => void;
}) {
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function send() {
    setPending(true);
    setMessage("");
    try {
      const { error } = await createClient().auth.signInWithOtp({
        email,
        options: { shouldCreateUser: false },
      });
      if (error) throw error;
      setSent(true);
      setMessage("A six-digit code is on its way. Only the newest code works.");
    } catch {
      setMessage("Could not send a code just now. Wait a minute, then try again.");
    }
    setPending(false);
  }
  async function verify() {
    if (code.length !== 6) return;
    setPending(true);
    setMessage("");
    try {
      const { error } = await createClient().auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (error) throw error;
      setPending(false);
      onDone();
      return;
    } catch {
      setMessage("That code did not work. Check it, or send a new one.");
    }
    setPending(false);
  }

  return (
    <div className="delete-reauth">
      <p>
        <strong>Please sign in again first.</strong> For your safety, deleting
        an account needs a sign-in from the last ten minutes. Nothing was
        erased, and nothing you typed here is lost.
      </p>
      {!email ? (
        <p>
          Close this, sign out from the More menu, sign in again, then return
          to Settings to delete your account.
        </p>
      ) : !sent ? (
        <button
          type="button"
          className="secondary-button"
          onClick={send}
          disabled={pending}
        >
          {pending ? "Sending…" : "Email me a sign-in code"}
        </button>
      ) : (
        <div className="delete-reauth-code">
          <label className="delete-confirm">
            <span>Six-digit code sent to {email}</span>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
              onKeyDown={(event) => {
                // Enter confirms the code; it must never submit the deletion form around it.
                if (event.key === "Enter") {
                  event.preventDefault();
                  verify();
                }
              }}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
            />
          </label>
          <div className="delete-actions">
            <button
              type="button"
              className="plain-button"
              onClick={send}
              disabled={pending}
            >
              Send a new code
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={verify}
              disabled={pending || code.length !== 6}
            >
              {pending ? "Checking…" : "Confirm code"}
            </button>
          </div>
        </div>
      )}
      <p role="status" className="delete-reauth-status">
        {message}
      </p>
    </div>
  );
}
