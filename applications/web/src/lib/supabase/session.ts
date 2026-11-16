/**
 * Who is signed in, confirmed by the auth server.
 *
 * `auth.getClaims()` only checks the access token's signature and expiry, so a
 * session ended elsewhere ("Sign out on all devices", an account deletion)
 * keeps passing it until the token expires, an hour by default. `auth.getUser()`
 * asks the auth server, which answers `session_not_found` once the session
 * named in the token is gone (auth-js turns that into AuthSessionMissingError).
 * Every server-side read and write of the garden goes through this instead, so
 * a revoked session stops working on its next request to this app.
 *
 * Cost and limits:
 * - One auth round trip per request, here. The proxy still verifies the token
 *   locally, and refreshes it when it has expired, which is its own round trip
 *   about once per token lifetime. (A project that signs tokens with a shared
 *   secret has no local verification: there the proxy's check is also a call.)
 * - Failing closed: if the auth server cannot be reached, nobody is signed in.
 * - This guards this app's server only. The data API still accepts the signed
 *   token itself until it expires; ending that needs a session check in the
 *   database policies or a shorter token lifetime.
 */
export type ConfirmedSession = { tenantId: string; email: string | null };

type SessionClient = {
  auth: {
    getUser(): PromiseLike<{
      data: { user: { id?: string; email?: string | null } | null } | null;
      error: unknown;
    }>;
  };
};

export async function confirmedSession(db: SessionClient): Promise<ConfirmedSession | null> {
  const { data, error } = await db.auth.getUser();
  const user = data?.user;
  if (error || !user?.id) return null;
  return { tenantId: user.id, email: typeof user.email === "string" ? user.email : null };
}
