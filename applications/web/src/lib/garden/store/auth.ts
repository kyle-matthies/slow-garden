/**
 * Email one-time-code sign-in. It already runs in the browser on both paths
 * (login-form.tsx, delete-reauth.tsx), so both stores share this code.
 */
import type { Db } from "./queries";
import type { AuthStepResult } from "./types";

export async function requestEmailCode(
  db: Db,
  email: string,
  options: { createAccount?: boolean } = {},
): Promise<AuthStepResult> {
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: options.createAccount ?? true },
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}

export async function verifyEmailCode(
  db: Db,
  email: string,
  code: string,
): Promise<AuthStepResult> {
  const { error } = await db.auth.verifyOtp({
    email,
    token: code.trim(),
    type: "email",
  });
  return error ? { ok: false, message: error.message } : { ok: true };
}
