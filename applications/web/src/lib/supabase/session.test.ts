import { describe, expect, it, vi } from "vitest";
import { confirmedSession } from "./session";

type Answer = Awaited<ReturnType<Parameters<typeof confirmedSession>[0]["auth"]["getUser"]>>;
function client(result: Answer) {
  const getUser = vi.fn(async () => result);
  const getClaims = vi.fn(async () => ({
    data: { claims: { sub: "from-the-token", email: "token@example.test" } },
    error: null,
  }));
  return { db: { auth: { getUser, getClaims } }, getUser, getClaims };
}

describe("confirmedSession", () => {
  it("asks the auth server once and answers with the account it names", async () => {
    const { db, getUser, getClaims } = client({
      data: { user: { id: "tenant-1", email: "ada@example.test" } },
      error: null,
    });
    expect(await confirmedSession(db)).toEqual({ tenantId: "tenant-1", email: "ada@example.test" });
    expect(getUser).toHaveBeenCalledTimes(1);
    // One round trip per request: the token is not also verified locally.
    expect(getClaims).not.toHaveBeenCalled();
  });

  it("is signed out when the session was revoked, even though the token still verifies", async () => {
    // What auth-js returns for the auth server's `session_not_found`, e.g.
    // after "Sign out on all devices" on another browser.
    const { db } = client({
      data: { user: null },
      error: { name: "AuthSessionMissingError", message: "Auth session missing!" },
    });
    expect(await confirmedSession(db)).toBeNull();
  });

  it("is signed out when the auth server cannot be reached or names nobody", async () => {
    expect(
      await confirmedSession(client({ data: { user: null }, error: { name: "AuthRetryableFetchError" } }).db),
    ).toBeNull();
    expect(await confirmedSession(client({ data: { user: null }, error: null }).db)).toBeNull();
    expect(await confirmedSession(client({ data: { user: { id: "" } }, error: null }).db)).toBeNull();
  });

  it("has no email when the account has none", async () => {
    expect(await confirmedSession(client({ data: { user: { id: "tenant-1" } }, error: null }).db)).toEqual({
      tenantId: "tenant-1",
      email: null,
    });
  });
});

describe("confirmedSession with the real auth client", () => {
  // An unexpired, well-formed token: local checks have nothing to object to.
  const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const token = `${b64({ alg: "ES256", kid: "k1", typ: "JWT" })}.${b64({
    sub: "tenant-1",
    session_id: "session-1",
    exp: Math.floor(Date.now() / 1000) + 3000,
  })}.c2ln`;
  const stored = JSON.stringify({
    access_token: token,
    refresh_token: "refresh",
    token_type: "bearer",
    expires_in: 3000,
    expires_at: Math.floor(Date.now() / 1000) + 3000,
    user: { id: "tenant-1", email: "ada@example.test" },
  });

  async function ask(respond: () => Response) {
    const { createClient } = await import("@supabase/supabase-js");
    const requests: string[] = [];
    const db = createClient("http://auth.invalid", "publishable", {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "session",
        storage: { getItem: () => stored, setItem: () => {}, removeItem: () => {} },
      },
      global: {
        fetch: async (input) => {
          requests.push(String(input instanceof Request ? input.url : input));
          return respond();
        },
      },
    });
    return { session: await confirmedSession(db), requests };
  }

  it("makes exactly one call, to the auth server's user endpoint, carrying the session's token", async () => {
    const { session, requests } = await ask(() =>
      Response.json({ id: "tenant-1", email: "ada@example.test", aud: "authenticated" }),
    );
    expect(session).toEqual({ tenantId: "tenant-1", email: "ada@example.test" });
    expect(requests).toEqual(["http://auth.invalid/auth/v1/user"]);
  });

  it("is signed out when that endpoint refuses the token, as it does once the session is gone", async () => {
    // The refusal recorded in VERIFICATION_2026-11-16 after a global sign-out
    // (401 or 403 from /auth/v1/user). Any refusal signs the request out.
    for (const status of [401, 403]) {
      const { session, requests } = await ask(() =>
        Response.json(
          { code: status, error_code: "session_not_found", msg: "Session from session_id claim in JWT does not exist" },
          { status, headers: { "x-supabase-api-version": "2024-01-01" } },
        ),
      );
      expect(session).toBeNull();
      expect(requests).toHaveLength(1);
    }
  });
});
