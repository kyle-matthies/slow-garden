import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
const require = createRequire(
  new URL("../applications/web/package.json", import.meta.url),
);
const { createClient } = require("@supabase/supabase-js");
const { createServerClient, createChunks } = require("@supabase/ssr");
const settings = JSON.parse(
  await readFile(".local-runtime/status.json", "utf8"),
);
if (settings.API_URL !== "http://127.0.0.1:55321")
  throw Error("Only the dedicated local test stack is permitted.");
const admin = createClient(settings.API_URL, settings.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const email = `http-smoke-${Date.now()}@example.test`;
const { data: link, error: linkError } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email,
});
assert.equal(linkError, null);
try {
  let cookies = [];
  const db = createServerClient(settings.API_URL, settings.PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => cookies,
      setAll: (items) => {
        cookies = items;
      },
    },
  });
  const { data: session, error: authError } = await db.auth.verifyOtp({
    email,
    token: link.properties.email_otp,
    type: "email",
  });
  assert.equal(authError, null);
  assert.ok(session.session);
  const { error: reuse } = await createClient(
    settings.API_URL,
    settings.PUBLISHABLE_KEY,
  ).auth.verifyOtp({ email, token: link.properties.email_otp, type: "email" });
  assert.ok(reuse, "OTP must not be reusable");
  const gardenId = crypto.randomUUID(),
    plotId = crypto.randomUUID(),
    seedId = crypto.randomUUID(),
    entryId = crypto.randomUUID();
  for (const [table, row] of [
    ["gardens", { id: gardenId, name: "HTTP fixture" }],
    ["plots", { id: plotId, garden_id: gardenId, name: "Synthetic plot" }],
    [
      "seeds",
      {
        id: seedId,
        garden_id: gardenId,
        plot_id: plotId,
        title: "Synthetic seed",
      },
    ],
  ]) {
    const { error } = await db.from(table).insert(row);
    assert.equal(error, null);
  }
  const body = "Synthetic export fixture.\n\nExact source bytes: café — 🌱";
  const revisionId = crypto.randomUUID();
  const { error: saveError } = await db.rpc("save_entry", {
    p_seed_id: seedId,
    p_entry_id: entryId,
    p_revision_id: revisionId,
    p_body: body,
  });
  assert.equal(saveError, null);
  const headers = {
    cookie: cookies.map((c) => `${c.name}=${c.value}`).join("; "),
  };
  const exported = await fetch("http://localhost:3148/garden/export", {
    headers,
  });
  assert.equal(exported.status, 200);
  assert.match(exported.headers.get("cache-control"), /no-store/);
  const value = await exported.json();
  assert.equal(value.revisions.find((r) => r.id === revisionId).body, body);
  assert.equal(
    value.gardens.length,
    1,
    "tenant export must not include other accounts",
  );
  const markdown = await fetch(
    "http://localhost:3148/garden/export?format=md",
    {
      headers,
    },
  );
  assert.equal(markdown.status, 200);
  assert.ok((await markdown.text()).includes(body));
  const history = await fetch(
    `http://localhost:3148/garden/history?entry=${entryId}`,
    { headers },
  );
  assert.equal(history.status, 200);
  assert.equal((await history.json())[0].body, body);
  assert.equal(
    (await fetch("http://localhost:3148/garden/export")).status,
    401,
  );
  // Expired access token with a valid local refresh token must refresh through Proxy,
  // including when the page then redirects an authenticated visitor away from /login.
  const payload = JSON.parse(
    Buffer.from(session.session.access_token.split(".")[1], "base64url"),
  );
  payload.exp = Math.floor(Date.now() / 1000) - 60;
  const jwtHead = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const jwtPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signed = `${jwtHead}.${jwtPayload}`;
  const expired = `${signed}.${createHmac("sha256", settings.JWT_SECRET).update(signed).digest("base64url")}`;
  const staleSession = {
    ...session.session,
    access_token: expired,
    expires_at: payload.exp,
  };
  const cookieName = cookies
    .find((c) => c.name.includes("auth-token") && !c.name.includes("verifier"))
    .name.replace(/\.\d+$/, "");
  const staleCookies = createChunks(
    cookieName,
    "base64-" + Buffer.from(JSON.stringify(staleSession)).toString("base64url"),
  );
  const refreshedPage = await fetch("http://localhost:3148/login", {
    redirect: "manual",
    headers: {
      cookie: staleCookies.map((c) => `${c.name}=${c.value}`).join("; "),
    },
  });
  // Next may stream a redirect after the loading boundary has flushed HTTP 200.
  const refreshHtml = await refreshedPage.text();
  assert.ok(
    (refreshedPage.status === 307 &&
      refreshedPage.headers.get("location") === "/garden") ||
      (refreshedPage.status === 200 &&
        /http-equiv="refresh"[^>]*url=\/garden/.test(refreshHtml)),
    "authenticated redirect after refresh",
  );
  assert.ok(
    refreshedPage.headers.getSetCookie().some((c) => c.startsWith(cookieName)),
    "refresh cookies survive redirect",
  );
  assert.match(refreshedPage.headers.get("cache-control"), /no-store/);
  console.log(
    "PASS: expired access token refreshed and replacement cookies preserved through login redirect",
  );
  // Independent session survives local sign-out; global sign-out revokes remaining sessions.
  const otherLink = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  assert.equal(otherLink.error, null);
  const other = createClient(settings.API_URL, settings.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const otherLogin = await other.auth.verifyOtp({
    email,
    token: otherLink.data.properties.email_otp,
    type: "email",
  });
  assert.equal(otherLogin.error, null);
  assert.equal((await db.auth.signOut({ scope: "local" })).error, null);
  assert.equal(
    (await other.auth.refreshSession()).error,
    null,
    "another device survives local signout",
  );
  const otherToken = (await other.auth.getSession()).data.session.refresh_token;
  assert.equal((await other.auth.signOut({ scope: "global" })).error, null);
  assert.ok(
    (
      await createClient(
        settings.API_URL,
        settings.PUBLISHABLE_KEY,
      ).auth.refreshSession({ refresh_token: otherToken })
    ).error,
    "global signout revokes refresh token",
  );
  console.log(
    "PASS: OTP single-use; private source exports/history; anonymous denial; local and global session scopes.",
  );
} finally {
  // Remove only this script's synthetic identity and cascading fixtures.
  const { error: deleteError } = await admin.auth.admin.deleteUser(
    link.user.id,
  );
  assert.equal(deleteError, null);
}
