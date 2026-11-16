// Browser journeys against a disposable local Supabase stack and a running web
// server. Uses only generated synthetic identities (…@example.test); never
// connects to a hosted project.
//
// Environment (all optional; defaults are the `.local-runtime` stack and :3148):
//   GARDEN_TEST_STATUS    JSON from `supabase status -o json` for the local stack
//   GARDEN_TEST_API_URL   must equal that file's API_URL; loopback only, never :54321
//   GARDEN_TEST_BASE      the web server under test (loopback only)
//   GARDEN_TEST_STORE     "server" (default) or "browser": which store the server
//                         under test was BUILT with (NEXT_PUBLIC_GARDEN_STORE)
//   GARDEN_TEST_SESSION   "cookies" (default) or "storage": where the build under
//                         test keeps the session. "storage" is the static export
//                         (GARDEN_STATIC_EXPORT=1), served by any static file
//                         server; it requires GARDEN_TEST_STORE=browser
//   GARDEN_TEST_DEVICE    "desktop" (1440x900, default) or "phone" (iPhone 14)
//   GARDEN_DELETION_ENABLED  "true" when the server under test was started with
//                         it and the stack's deletion switch is on; off expects
//                         no delete control anywhere
//   GARDEN_TEST_DB_CONTAINER  the local stack's database container
//                         (supabase_db_<project_id>); when set, the deletion
//                         journey ages its own session to reach the re-sign-in
//                         step of account deletion
//   GARDEN_TEST_ONLY      comma-separated journey names to run (default: all)
//   GARDEN_TEST_ARTIFACTS directory for failure screenshots and downloads
//   AXE_CHROMIUM          a preinstalled Chromium when Playwright's own is absent
//
// Sign-in is by the emailed six-digit code, read from the stack's local inbox
// (Mailpit). The stack's hourly email limit and per-address resend interval must
// allow one run (about 25 codes); the committed config.toml values (2 an hour,
// 60 s) are for the hosted project and are raised only in a scratch copy.
// Output is content-free: journey names, counts and statuses only.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
const require = createRequire(
  new URL("../applications/web/package.json", import.meta.url),
);
const browserRequire = createRequire(
  new URL("../applications/web/accessibility/package.json", import.meta.url),
);
const { chromium, devices, expect } = browserRequire("@playwright/test");
const { createClient } = require("@supabase/supabase-js");

const config = JSON.parse(
  await readFile(
    process.env.GARDEN_TEST_STATUS ?? ".local-runtime/status.json",
    "utf8",
  ),
);
const expectedApi = process.env.GARDEN_TEST_API_URL ?? "http://127.0.0.1:55321";
const loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;
const base = process.env.GARDEN_TEST_BASE ?? "http://localhost:3148";
assert.equal(config.API_URL, expectedApi);
assert.ok(
  loopback.test(expectedApi) &&
    !expectedApi.endsWith(":54321") &&
    loopback.test(base) &&
    loopback.test(config.MAILPIT_URL ?? ""),
  "Only a dedicated local test stack is permitted.",
);
const storeMode = process.env.GARDEN_TEST_STORE === "browser" ? "browser" : "server";
const sessionIn = process.env.GARDEN_TEST_SESSION === "storage" ? "storage" : "cookies";
assert.ok(
  sessionIn === "cookies" || storeMode === "browser",
  "A build that keeps the session in browser storage has no server store.",
);
const deviceName = process.env.GARDEN_TEST_DEVICE === "phone" ? "phone" : "desktop";
const phone = deviceName === "phone";
const deletionOn = process.env.GARDEN_DELETION_ENABLED === "true";
const only = (process.env.GARDEN_TEST_ONLY ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const artifacts = path.resolve(
  process.env.GARDEN_TEST_ARTIFACTS ?? ".local-runtime",
);
await mkdir(artifacts, { recursive: true });
const launchOptions = process.env.AXE_CHROMIUM
  ? { executablePath: process.env.AXE_CHROMIUM }
  : {};
// iPhone 14 metrics (390x664 viewport, dsf 3, touch, mobile) driven by Chromium;
// the WebKit default browser of the descriptor is not used.
const { defaultBrowserType: _ignored, ...iphone } = devices["iPhone 14"];
const contextOptions = phone
  ? iphone
  : { viewport: { width: 1440, height: 900 } };
const viewportHeight = contextOptions.viewport.height;

const admin = createClient(config.API_URL, config.SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const created = new Set();
let serial = 0;
const address = (label) => `ux-${label}-${run}-${++serial}@example.test`;

// ---- local inbox -----------------------------------------------------------
const usedMail = new Set();
/** The newest unread six-digit code mailed to `to`. Only the digits are read. */
async function mailedCode(to) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const found = await fetch(
      `${config.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:"${to}"`)}`,
    ).then((r) => r.json());
    const message = (found.messages ?? []).find((m) => !usedMail.has(m.ID));
    if (message) {
      usedMail.add(message.ID);
      const full = await fetch(
        `${config.MAILPIT_URL}/api/v1/message/${message.ID}`,
      ).then((r) => r.json());
      const code = /\b(\d{6})\b/.exec(full.Text ?? "")?.[1];
      assert.ok(code, "the sign-in email carries a six-digit code");
      return code;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error("no sign-in email arrived in the local inbox");
}

// ---- accounts and fixtures -------------------------------------------------
/** A REST client holding the person's own session (publishable key, RLS applies). */
async function sessionClient(email) {
  const link = await admin.auth.admin.generateLink({ type: "magiclink", email });
  assert.equal(link.error, null);
  lastCode.set(email, Date.now());
  created.add(link.data.user.id);
  const client = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const verified = await client.auth.verifyOtp({
    email,
    token: link.data.properties.email_otp,
    type: "email",
  });
  assert.equal(verified.error, null);
  return { client, userId: link.data.user.id };
}
async function userIdOf(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  assert.equal(error, null);
  return data.users.find((u) => u.email === email)?.id;
}
/**
 * An account with two gardens, two topics, two thoughts and (optionally) saved
 * entries, written through the person's own session.
 */
async function fixtureAccount(label, { entries = [] } = {}) {
  const email = address(label);
  const { client, userId } = await sessionClient(email);
  const ids = Object.fromEntries(
    ["garden", "other", "topic", "topic2", "thought", "thought2"].map((k) => [
      k,
      crypto.randomUUID(),
    ]),
  );
  const rows = [
    ["gardens", { id: ids.garden, tenant_id: userId, name: "Test Garden" }],
    ["gardens", { id: ids.other, tenant_id: userId, name: "Other Garden" }],
    [
      "plots",
      {
        id: ids.topic,
        tenant_id: userId,
        garden_id: ids.garden,
        name: "Reading",
        ai_enabled: true,
        cross_pollinate: true,
      },
    ],
    [
      "plots",
      { id: ids.topic2, tenant_id: userId, garden_id: ids.garden, name: "Making" },
    ],
    [
      "seeds",
      {
        id: ids.thought,
        tenant_id: userId,
        garden_id: ids.garden,
        plot_id: ids.topic,
        title: "A question",
      },
    ],
    [
      "seeds",
      {
        id: ids.thought2,
        tenant_id: userId,
        garden_id: ids.garden,
        plot_id: ids.topic2,
        title: "A sketch",
      },
    ],
  ];
  for (const [table, row] of rows)
    assert.equal((await client.from(table).insert(row)).error, null);
  ids.entries = [];
  for (const body of entries) {
    const entryId = crypto.randomUUID();
    const saved = await client.rpc("save_entry", {
      p_seed_id: ids.thought,
      p_entry_id: entryId,
      p_revision_id: crypto.randomUUID(),
      p_body: body,
    });
    assert.equal(saved.error, null);
    ids.entries.push(entryId);
  }
  return { email, userId, ids, client };
}
const count = async (table, column, value) => {
  const { count: n, error } = await admin
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq(column, value);
  assert.equal(error, null);
  return n;
};

// ---- browser ---------------------------------------------------------------
let browser;
let context;
let page;
const consoleErrors = [];
function watch(p) {
  p.on("dialog", (dialog) => dialog.accept());
  p.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text().slice(0, 160));
  });
  p.on("pageerror", (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));
}
async function freshContext() {
  if (context) await context.close();
  context = await browser.newContext({ ...contextOptions, acceptDownloads: true });
  context.setDefaultTimeout(15000);
  page = await context.newPage();
  watch(page);
}
const tools = () => page.getByRole("navigation", { name: "Garden tools" });
async function fromMore(name) {
  await tools().getByRole("button", { name: "More", exact: true }).click();
  await tools()
    .locator(".tools-secondary")
    .getByRole(name === "Import notes" ? "link" : "button", { name, exact: true })
    .click();
}
const openTopic = (name) =>
  page.locator(".bed-card").filter({ hasText: name }).click();
const openThought = (title) =>
  page.locator(".specimen-card").filter({ hasText: title }).click();
const ring = () => page.getByRole("region", { name: "All your gardens" });
const entriesOnPage = () => page.locator(".journal-entry");
const newEntry = () => page.getByRole("textbox", { name: "New entry", exact: true });
const heading = (name) => page.getByRole("heading", { name, exact: true });
const pagesUrl = (ids, extra = "") =>
  `${base}/garden?garden=${ids.garden}${extra}&view=list`;
const thoughtUrl = (ids, view = "list") =>
  `${base}/garden?garden=${ids.garden}&topic=${ids.topic}&thought=${ids.thought}&view=${view}`;
async function noSidewaysScroll(where) {
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
    `no horizontal overflow: ${where}`,
  );
}
// The auth service refuses a second code for one address inside its resend
// interval (1 s in the scratch stack's config); codes are spaced past it.
const lastCode = new Map();
const RESEND_MS = Number(process.env.GARDEN_TEST_RESEND_MS) || 2000;
async function spaceCodes(email) {
  const wait = (lastCode.get(email) ?? 0) + RESEND_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCode.set(email, Date.now());
}
/** The sign-in form, wherever it is shown, with the code read from the inbox. */
async function completeSignIn(email) {
  await spaceCodes(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  await page.getByLabel("Six-digit code").fill(await mailedCode(email));
  await page.getByRole("button", { name: "Open my garden" }).click();
}
async function signIn(email) {
  await page.goto(`${base}/login`);
  await completeSignIn(email);
  await expect(page).toHaveURL(/\/garden/);
}
async function signedOutAt(pathname) {
  await page.goto(base + pathname);
  // Server store: the server redirects to /login. Browser store: the sign-in
  // screen is rendered in place and nothing is redirected.
  await expect(page.getByLabel("Email address")).toBeVisible();
  if (storeMode === "server") await expect(page).toHaveURL(/\/login/);
  await expect(page.locator(".journal-entry, .bed-card, .garden-scene")).toHaveCount(0);
}
async function download(trigger) {
  const [file] = await Promise.all([page.waitForEvent("download"), trigger()]);
  const target = path.join(artifacts, `download-${Date.now()}-${file.suggestedFilename()}`);
  await file.saveAs(target);
  const text = await readFile(target, "utf8");
  await rm(target);
  return { name: file.suggestedFilename(), text };
}

/** The session JSON the Supabase browser client keeps in (chunked) cookies. */
function sessionFromCookies(cookies) {
  const parts = cookies
    .filter((c) => /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
  if (!parts.length) return null;
  const raw = decodeURIComponent(parts.map((c) => c.value).join(""));
  try {
    return JSON.parse(
      raw.startsWith("base64-")
        ? Buffer.from(raw.slice(7), "base64url").toString("utf8")
        : raw,
    );
  } catch {
    return null;
  }
}
/** The session JSON a static export keeps in this origin's localStorage. */
function sessionFromStorage(state) {
  const item = state.origins
    .flatMap((o) => o.localStorage)
    .find((i) => /^sb-.*-auth-token$/.test(i.name) && i.value);
  if (!item) return null;
  try {
    return JSON.parse(item.value);
  } catch {
    return null;
  }
}
/** The session this browser holds, wherever the build under test keeps it. */
async function heldSession(ctx = context) {
  return sessionIn === "storage"
    ? sessionFromStorage(await ctx.storageState())
    : sessionFromCookies(await ctx.cookies());
}
/** How many session entries this browser holds (cookies, or localStorage items). */
async function heldSessionEntries(ctx = context) {
  if (sessionIn === "storage")
    return (await ctx.storageState()).origins
      .flatMap((o) => o.localStorage)
      .filter((i) => /auth-token/.test(i.name) && i.value).length;
  return (await ctx.cookies()).filter((c) => /auth-token/.test(c.name) && c.value).length;
}
/**
 * Make this identity's sessions eleven minutes old, to reach the ten-minute
 * rule on account deletion. Only with GARDEN_TEST_DB_CONTAINER naming the
 * local stack's database container; returns false when it is not set.
 */
function ageSessions(userId) {
  assert.match(userId, /^[0-9a-f-]{36}$/);
  return localSql(
    `update auth.sessions set created_at = now() - interval '11 minutes' where user_id = '${userId}'`,
  );
}
/** One transaction in the local stack's database; false when no container is named or it fails. */
function localSql(statement) {
  const container = process.env.GARDEN_TEST_DB_CONTAINER;
  if (!container) return false;
  assert.match(container, /^supabase_db_[\w-]+$/);
  try {
    execFileSync(
      "docker",
      ["exec", "-i", container, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-1"],
      { input: statement, stdio: ["pipe", "ignore", "pipe"] },
    );
    return true;
  } catch (error) {
    if (process.env.GARDEN_TEST_DEBUG) console.log(String(error.stderr).slice(0, 400));
    return false;
  }
}

// ---- journeys --------------------------------------------------------------
const journeys = [];
const journey = (name, fn, { when = true } = {}) =>
  journeys.push({ name, fn, when });
const results = [];
const pass = (text) => console.log(`  ok   ${text}`);

journey("sign-in", async () => {
  const { email, ids } = await fixtureAccount("signin");
  await signedOutAt("/garden");
  pass("signed out, /garden shows only the sign-in screen");
  // A wrong code is refused and nothing is opened.
  await page.goto(`${base}/login`);
  await spaceCodes(email);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a sign-in code" }).click();
  const code = await mailedCode(email);
  const wrong = String((Number(code) + 1) % 1_000_000).padStart(6, "0");
  await page.getByLabel("Six-digit code").fill(wrong);
  await page.getByRole("button", { name: "Open my garden" }).click();
  await expect(page.locator('.status-message[data-error="true"]')).toContainText(/\S/);
  await expect(page.getByLabel("Six-digit code")).toBeVisible();
  pass("a wrong code is refused");
  await page.getByLabel("Six-digit code").fill(code);
  await page.getByRole("button", { name: "Open my garden" }).click();
  await expect(page).toHaveURL(/\/garden/);
  await expect(page.locator(".garden-scene, .level-page").first()).toBeVisible();
  pass("the emailed six-digit code from the local inbox opens the garden");
  for (const pathname of ["/", "/login"]) {
    await page.goto(base + pathname);
    await expect(page).toHaveURL(/\/garden/);
  }
  pass("/ and /login send a signed-in person to the garden");
  if (sessionIn === "storage") {
    assert.ok((await heldSession())?.refresh_token, "the session is kept in browser storage");
    assert.equal(
      (await context.cookies()).filter((c) => /auth-token/.test(c.name)).length,
      0,
      "a static export keeps no session cookie",
    );
  } else
    assert.ok(
      (await context.cookies()).some(
        (c) =>
          c.name.includes("auth-token") && c.expires > Date.now() / 1000 + 86400,
      ),
      "persistent auth cookies",
    );
  // A browser restart keeps the session: same cookies and storage in a new context.
  const state = await context.storageState();
  await context.close();
  context = await browser.newContext({ ...contextOptions, storageState: state });
  context.setDefaultTimeout(15000);
  page = await context.newPage();
  watch(page);
  await page.goto(pagesUrl(ids));
  await expect(heading("Test Garden")).toBeVisible();
  pass("the session persists into a new browser context");
});

journey("first-run-own", async () => {
  // A new identity with no garden: no required onboarding. A seed pack can be
  // opened and closed without a write; the blank page is enough.
  const email = address("new");
  await page.goto(`${base}/login`);
  await completeSignIn(email);
  await expect(heading("Begin with one thought.")).toBeVisible();
  const userId = await userIdOf(email);
  created.add(userId);
  assert.equal(await count("gardens", "tenant_id", userId), 0);
  const packet = page.locator(".seed-packet").first();
  await packet.click();
  await expect(page.locator(".seed-beds").first()).toBeVisible();
  await expect(page.locator(".seed-packs-tally")).toContainText(
    "will be planted when you save",
  );
  await packet.click();
  await expect(page.locator(".seed-packs-tally")).toContainText("No pack opened");
  assert.equal(await count("gardens", "tenant_id", userId), 0);
  pass("a seed pack opens and closes without a write");
  await noSidewaysScroll("first run");
  await page.getByLabel("Name your garden", { exact: true }).fill("First Garden");
  await page
    .getByLabel("Write a first entry", { exact: true })
    .fill("Synthetic first-run entry.");
  await page.locator(".first-run-sheet .primary-button").click();
  await expect(page).toHaveURL(/thought=/);
  await expect(entriesOnPage()).toContainText("Synthetic first-run entry.");
  assert.equal(await count("gardens", "tenant_id", userId), 1);
  assert.equal(await count("plots", "tenant_id", userId), 1);
  assert.equal(await count("seed_revisions", "tenant_id", userId), 1);
  pass("plant your own: 1 garden, 1 topic, 1 thought, 1 entry saved");
});

journey("first-run-pack", async () => {
  const email = address("pack");
  await page.goto(`${base}/login`);
  await completeSignIn(email);
  await expect(heading("Begin with one thought.")).toBeVisible();
  const userId = await userIdOf(email);
  created.add(userId);
  await page.locator(".seed-packet").first().click();
  const beds = page.locator(".seed-beds").first();
  await expect(beds).toBeVisible();
  const boxes = beds.getByRole("checkbox");
  const offered = await boxes.count();
  assert.ok(offered >= 3, "the pack offers topics");
  const kept = [];
  for (let i = 0; i < offered; i++)
    kept.push(await boxes.nth(i).evaluate((n) => n.closest("label").textContent.trim()));
  // Keep all but the last topic.
  await boxes.nth(offered - 1).uncheck();
  const dropped = kept.pop();
  await expect(page.locator(".seed-packs-tally")).toContainText(
    `${offered - 1} topics will be planted when you save`,
  );
  // "Start here" takes the topic's question as the first thought's title.
  await beds.getByRole("button", { name: /Start here$/ }).first().click();
  await page
    .getByLabel("Write a first entry", { exact: true })
    .fill("Synthetic entry under a seed-pack question.");
  await page.locator(".first-run-sheet .primary-button").click();
  await expect(page).toHaveURL(/thought=/);
  await expect(entriesOnPage()).toContainText(
    "Synthetic entry under a seed-pack question.",
  );
  const { data: plots } = await admin.from("plots").select("name").eq("tenant_id", userId);
  const names = plots.map((p) => p.name);
  for (const name of kept)
    assert.ok(names.includes(name), "each kept pack topic was planted");
  assert.ok(!names.includes(dropped), "the unticked pack topic was not planted");
  assert.equal(await count("gardens", "tenant_id", userId), 1);
  assert.equal(await count("seeds", "tenant_id", userId), 1);
  assert.equal(await count("seed_revisions", "tenant_id", userId), 1);
  pass(`seed pack: ${names.length} topics planted (${offered - 1} kept from the pack, 1 left out), 1 thought, 1 entry`);
  await page.goto(`${base}/garden?view=list`);
  await expect(page.locator(".bed-card")).toHaveCount(names.length);
  await noSidewaysScroll("pages after a seed pack");
  pass("Pages shows every planted topic");
});

journey("write-revise", async () => {
  const { email, ids, userId } = await fixtureAccount("write");
  await signIn(email);
  // Pages is the structured view.
  await page.goto(pagesUrl(ids));
  await openTopic("Reading");
  await openThought("A question");
  await expect(page).toHaveURL(new RegExp(`thought=${ids.thought}`));
  await newEntry().fill("Synthetic first entry, saved and findable.");
  await page.getByRole("button", { name: "Save entry", exact: true }).click();
  await expect(entriesOnPage()).toHaveCount(1);
  await expect(entriesOnPage().locator("time").first()).toContainText(/\d+:\d+/);
  await expect(entriesOnPage()).toContainText("Synthetic first entry");
  pass("an entry is saved and dated");
  await page.getByRole("button", { name: "Revise", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Revise entry", exact: true })
    .fill("Synthetic revised entry.");
  await page.getByRole("button", { name: "Save revision", exact: true }).click();
  await expect(entriesOnPage()).toContainText("Synthetic revised entry.");
  await expect(entriesOnPage()).toContainText("Revision 2");
  await page.getByRole("button", { name: "Revision history", exact: true }).click();
  const history = page.getByRole("list", { name: "Revision history" });
  await expect(history.getByRole("listitem")).toHaveCount(2);
  await expect(history).toContainText("Synthetic first entry, saved and findable.");
  await page.getByRole("button", { name: "Close history", exact: true }).click();
  assert.equal(await count("seed_revisions", "tenant_id", userId), 2);
  assert.equal(await count("entries", "tenant_id", userId), 1);
  pass("revising keeps both versions: 1 entry, 2 revisions, history lists both");
  await newEntry().fill("Synthetic second entry.");
  // Ctrl+Enter saves from the page.
  await newEntry().press("Control+Enter");
  await expect(entriesOnPage()).toHaveCount(2);
  await expect(entriesOnPage().first()).toContainText("Synthetic second entry.");
  pass("a second entry is saved with Ctrl+Enter and listed newest first");
  await page.reload();
  await expect(heading("A question")).toBeVisible();
  await expect(entriesOnPage()).toHaveCount(2);
  // An unsaved draft stays in this browser across leaving and coming back.
  await expect(newEntry()).toBeEnabled();
  await newEntry().fill("Unsaved draft");
  await expect(page.locator(".thinking-garden")).toContainText(/Draft kept|kept privately/);
  await page.waitForTimeout(1200);
  await page.goto(pagesUrl(ids));
  await expect(heading("Test Garden")).toBeVisible();
  await page.goto(thoughtUrl(ids));
  await expect(newEntry()).toHaveValue("Unsaved draft");
  await newEntry().fill("");
  pass("an unsaved draft is recovered after leaving the page");
  await page.goto(pagesUrl(ids));
  await page.locator(".recent-writing > summary").click();
  await page.locator(".recent-writing li button").first().click();
  await expect(entriesOnPage().first()).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`thought=${ids.thought}`));
  pass("Continue writing opens the most recent thought");
  await noSidewaysScroll("thought page");
});

journey("archive-restore", async () => {
  const { email, ids } = await fixtureAccount("archive", {
    entries: ["Synthetic entry one.", "Synthetic entry two."],
  });
  await signIn(email);
  const openQuestion = async () => {
    await openTopic("Reading");
    await openThought("A question");
  };
  await page.goto(thoughtUrl(ids));
  await expect(entriesOnPage()).toHaveCount(2);
  await entriesOnPage()
    .first()
    .getByRole("button", { name: "Archive entry", exact: true })
    .click();
  await expect(entriesOnPage()).toHaveCount(1);
  await fromMore("Archive");
  await openQuestion();
  await expect(entriesOnPage()).toHaveCount(1);
  await page.getByRole("button", { name: "Restore entry", exact: true }).click();
  await expect(entriesOnPage()).toHaveCount(0);
  await fromMore("Leave archive");
  await page.goto(thoughtUrl(ids));
  await expect(entriesOnPage()).toHaveCount(2);
  pass("an entry is archived, found in Archive, and restored");
  await page.getByRole("button", { name: "Archive thought", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore this thought" }),
  ).toBeVisible();
  await fromMore("Archive");
  await openQuestion();
  await expect(entriesOnPage()).toHaveCount(2);
  await page.getByRole("button", { name: "Restore this thought" }).click();
  await expect(page.getByRole("button", { name: "Archive thought" })).toBeVisible();
  pass("a thought is archived and restored with its entries");
  await page.goto(pagesUrl(ids, `&topic=${ids.topic}`));
  await page.getByText("Topic settings ·", { exact: false }).click();
  await page.getByRole("button", { name: "Archive topic", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Restore topic", exact: true }).first(),
  ).toBeVisible();
  await fromMore("Archive");
  await openQuestion();
  // An archived parent holds its children still: no write to a thought inside it.
  await expect(
    page.getByRole("button", { name: "Archive thought", exact: true }),
  ).toBeDisabled();
  await expect(entriesOnPage()).toHaveCount(2);
  await page.getByRole("button", { name: "Restore topic", exact: true }).click();
  await fromMore("Leave archive");
  await expect(page).not.toHaveURL(/view=archive/);
  await page.goto(pagesUrl(ids));
  await expect(page.locator(".bed-card").filter({ hasText: "Reading" })).toBeVisible();
  pass("a topic is archived (children held read-only) and restored");
});

journey("timeline-search", async () => {
  const { email, ids } = await fixtureAccount("search", {
    entries: [
      "Alpha synthetic entry about tides.",
      "Beta synthetic entry about lanterns.",
    ],
  });
  await signIn(email);
  await page.goto(pagesUrl(ids));
  const search = page.getByRole("searchbox", {
    name: "Search thought titles and entries",
  });
  await search.fill("lanterns");
  const found = page.getByRole("region", { name: "Search results" });
  await expect(found.getByRole("status")).toContainText("1 match");
  await expect(found.locator("mark")).toHaveText("lanterns");
  await search.fill("zzzz-not-written");
  await expect(found.getByRole("status")).toContainText("Nothing matches");
  await search.fill("question");
  await expect(found.getByRole("status")).toContainText("1 match");
  await expect(found.locator(".lens-item")).toContainText("Thought");
  await search.fill("tides");
  await found.locator(".lens-item").first().click();
  await expect(page).toHaveURL(new RegExp(`thought=${ids.thought}`));
  await expect(entriesOnPage()).toHaveCount(2);
  pass("search finds entry text and thought titles, says when nothing matches, and opens the entry");
  await page.goto(pagesUrl(ids));
  await page.getByRole("button", { name: "Timeline", exact: true }).click();
  await expect(page).toHaveURL(/view=timeline/);
  await expect(page.locator(".level-timeline").getByRole("status").first()).toContainText(
    "2 entries across 1 day",
  );
  await noSidewaysScroll("timeline");
  await page
    .locator(".level-timeline")
    .getByRole("button", { name: /A question/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`thought=${ids.thought}`));
  pass("the timeline lists saved entries by day and opens one");
});

journey("import", async () => {
  const { email, ids, userId } = await fixtureAccount("import");
  await signIn(email);
  await page.goto(pagesUrl(ids));
  await fromMore("Import notes");
  await expect(heading("Bring in existing notes")).toBeVisible();
  await expect(page.getByLabel("Topic", { exact: true })).toHaveValue(/.+/);
  await page.getByLabel("Topic", { exact: true }).selectOption({ label: "Reading" });
  await page.locator("#import-files").setInputFiles({
    name: "synthetic-notes.md",
    mimeType: "text/markdown",
    buffer: Buffer.from(
      "# Synthetic notes\n\n## 2024-03-05\n\nFirst imported synthetic entry.\n\n## 2024-03-06\n\nSecond imported synthetic entry.\n",
    ),
  });
  // Previewing happens in the browser; nothing is saved until confirmed.
  await expect(page.getByRole("status").filter({ hasText: "selected for" })).toContainText(
    "1 thought selected for Reading",
  );
  assert.equal(await count("seeds", "tenant_id", userId), 2);
  await noSidewaysScroll("import preview");
  await page.getByRole("button", { name: "Import 1 thought into Reading" }).click();
  await expect
    .poll(() => count("seeds", "tenant_id", userId), { timeout: 15000 })
    .toBe(3);
  assert.equal(await count("entries", "tenant_id", userId), 2);
  const { data: dated } = await admin
    .from("entries")
    .select("created_at")
    .eq("tenant_id", userId)
    .order("created_at");
  assert.deepEqual(
    dated.map((d) => d.created_at.slice(0, 10)),
    ["2024-03-05", "2024-03-06"],
  );
  pass("a Markdown file becomes 1 thought with 2 entries dated from its headings");
  await page.getByRole("link", { name: "Back to garden" }).click();
  await page.goto(pagesUrl(ids, `&topic=${ids.topic}`));
  await expect(page.locator(".specimen-card")).toHaveCount(2);
  pass("the imported thought appears in its topic");
});

journey("export", async () => {
  const body = "Synthetic export fixture.\n\nExact source bytes: café — 🌱";
  const { email, ids } = await fixtureAccount("export", { entries: [body] });
  await signIn(email);
  await page.goto(pagesUrl(ids));
  await fromMore("Settings & export");
  const settings = page.locator(".garden-settings");
  const take = (name) =>
    download(() => settings.getByRole("link", { name, exact: true }).click());
  const allJson = await take("Export all sources · JSON");
  const allMd = await take("Export all sources · Markdown");
  const oneJson = await take("Export this garden · JSON");
  const oneMd = await take("Export this garden · Markdown");
  assert.match(allJson.name, /\.json$/);
  assert.match(allMd.name, /\.md$/);
  const all = JSON.parse(allJson.text);
  const one = JSON.parse(oneJson.text);
  assert.equal(all.schema, "slow-garden-export-v2");
  assert.equal(all.source.authorship, "user");
  assert.equal(all.derived.blooms.authorship, "ai-derived");
  assert.equal(all.source.gardens.length, 2);
  assert.equal(one.source.gardens.length, 1);
  assert.equal(one.source.gardens[0].id, ids.garden);
  assert.equal(all.source.revisions.length, 1);
  assert.equal(all.source.revisions[0].body, body, "exact source bytes");
  assert.equal(one.source.revisions[0].body, body);
  assert.ok(allMd.text.includes(body) && oneMd.text.includes(body));
  assert.ok(allMd.text.includes("Other Garden") && !oneMd.text.includes("Other Garden"));
  assert.notEqual(allJson.name, oneJson.name);
  pass("four exports download: JSON v2 and Markdown, whole account (2 gardens) and this garden (1), source bytes exact, user and AI-derived sections separate");
  // What the browser was told to do with the file.
  if (storeMode === "server") {
    const response = await page.request.get(`${base}/garden/export`);
    assert.equal(response.status(), 200);
    assert.match(response.headers()["cache-control"], /no-store/);
    pass("server store: the export route answers 200 with no-store");
  }
});

journey("returns-settings", async () => {
  const { email, ids, userId } = await fixtureAccount("returns", {
    entries: ["Synthetic entry for returns."],
  });
  await signIn(email);
  await page.goto(pagesUrl(ids, `&topic=${ids.topic}`));
  // Returns is a top-level place; the full record opens inside it.
  await tools().getByRole("button", { name: /^Returns/ }).click();
  await expect(heading("What the garden returned")).toBeVisible();
  await expect(page.locator(".level-returns")).toContainText(
    "Nothing has been returned. Tending is not active for this account yet, so no AI has read your writing.",
  );
  await page.getByRole("button", { name: "Open the full record", exact: true }).click();
  await expect(
    page
      .getByText(/Tending is not active for this account yet\. Your tending choices are saved/)
      .first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Invite a reflection" })).toHaveCount(0);
  await noSidewaysScroll("returns");
  pass("Returns: nothing fabricated, tending inactive, no way to start a pass");
  assert.equal(await count("garden_passes", "tenant_id", userId), 0);
  assert.equal(await count("blooms", "tenant_id", userId), 0);
  // Settings: the overnight preference saves; it starts nothing.
  await page.goto(pagesUrl(ids));
  await fromMore("Settings & export");
  const tending = page.getByRole("region", { name: "Overnight tending" });
  await tending.getByRole("checkbox", { name: "Tend my garden overnight" }).check();
  await expect(tending.getByRole("status")).toContainText("Preference saved for");
  await tending.getByLabel("Your time zone").selectOption("Europe/Paris");
  await expect(tending.getByRole("status")).toContainText("Preference saved for Europe/Paris");
  const { data: account } = await admin
    .from("accounts")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  assert.ok(
    account && Object.values(account).includes("Europe/Paris"),
    "the time zone is stored on the account",
  );
  await tending.getByRole("checkbox", { name: "Tend my garden overnight" }).uncheck();
  await expect(tending.getByRole("status")).toContainText("overnight tending is off");
  assert.equal(await count("garden_passes", "tenant_id", userId), 0);
  await noSidewaysScroll("settings");
  pass("settings: overnight preference and time zone save and start no pass");
  // Topic settings: tending per topic.
  await fromMore("Close settings");
  await page.goto(pagesUrl(ids, `&topic=${ids.topic2}`));
  await page.getByText("Topic settings ·", { exact: false }).click();
  await page.locator(".tending-choice label").nth(1).click();
  await expect(page.locator(".save-notice")).toContainText("saved for this topic");
  const { data: topic } = await admin
    .from("plots")
    .select("ai_enabled,cross_pollinate")
    .eq("id", ids.topic2)
    .single();
  assert.deepEqual(topic, { ai_enabled: true, cross_pollinate: false });
  assert.equal(await count("garden_passes", "tenant_id", userId), 0);
  pass("topic settings: Tending on is saved for one topic and starts nothing");
});

journey("gardens-topics", async () => {
  const { email, ids, userId } = await fixtureAccount("gardens");
  await signIn(email);
  await page.goto(pagesUrl(ids));
  const allGardens = async () => {
    await expect(heading("Test Garden")).toBeVisible();
    const top = tools().locator(".gardens-button");
    if (await top.isVisible()) await top.click();
    else await fromMore("All gardens");
    await expect(ring()).toBeVisible();
  };
  // New gardens are planted from the ring of all gardens.
  await allGardens();
  await ring().getByRole("button", { name: "＋ New garden", exact: true }).click();
  await expect(page.getByLabel("Name your garden")).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    ring().getByRole("button", { name: "＋ New garden", exact: true }),
  ).toBeVisible();
  assert.equal(await count("gardens", "tenant_id", userId), 2);
  await noSidewaysScroll("ring of gardens");
  pass("New garden opens with its name field focused; cancel creates nothing");
  await ring().getByRole("button", { name: "＋ New garden", exact: true }).click();
  await page.getByLabel("Name your garden").fill("Third Garden");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect.poll(() => count("gardens", "tenant_id", userId)).toBe(3);
  await expect(page).toHaveURL(/garden=/);
  await expect(page).not.toHaveURL(new RegExp(ids.garden));
  pass("a third garden is created and entered");
  await page.goto(pagesUrl(ids));
  await page.getByRole("button", { name: "＋ New topic", exact: true }).click();
  await page.getByLabel("Name your topic").fill("New topic fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(heading("New topic fixture")).toBeVisible();
  await page.getByRole("button", { name: "＋ New thought", exact: true }).click();
  await page.getByLabel("Name your thought").fill("New thought fixture");
  await page.getByRole("button", { name: "Create", exact: true }).click();
  await expect(heading("New thought fixture")).toBeVisible();
  pass("a topic and a thought are created from Pages");
  await page.goto(pagesUrl(ids));
  await allGardens();
  await ring().getByRole("button", { name: /^Other Garden/ }).press("Enter");
  await ring().getByRole("button", { name: "Enter Other Garden", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`garden=${ids.other}`));
  await tools().getByRole("button", { name: "Pages", exact: true }).click();
  await expect(heading("Other Garden")).toBeVisible();
  pass("the ring switches gardens");
  await page.goto(`${base}/garden?garden=${ids.garden}&topic=missing&thought=missing`);
  await expect(page.getByText(/That location is no longer available/)).toBeVisible();
  // The notice stays; it is not a flash before the address is tidied.
  await page.waitForTimeout(1500);
  await expect(page.getByText(/That location is no longer available/)).toBeVisible();
  await expect(heading("Test Garden")).toBeVisible();
  pass("a stale location falls back to its nearest parent and says so");
  // Pages was chosen above and is remembered; Meadow is chosen back here.
  await page.goto(`${base}/garden?garden=${ids.garden}`);
  await expect(page).toHaveURL(/view=list/);
  await tools().getByRole("button", { name: "Meadow", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Test Garden, a living garden" }),
  ).toBeVisible();
  await noSidewaysScroll("meadow");
  await page.goto(`${base}/garden?garden=${ids.garden}`);
  await expect(
    page.getByRole("region", { name: "Test Garden, a living garden" }),
  ).toBeVisible();
  await expect(page).not.toHaveURL(/view=/);
  pass("the remembered view (Pages, then Meadow) is the one a plain address opens");
});

journey(
  "phone-tab-bar",
  async () => {
    const { email, ids } = await fixtureAccount("phone", {
      entries: ["Synthetic entry for the phone bar."],
    });
    await signIn(email);
    // The navigation is a bar at the bottom of the screen: Meadow, Pages,
    // Write, Returns, More. Write is one tap from anywhere and puts the caret
    // on a page; More opens upward as a sheet.
    await page.goto(pagesUrl(ids));
    for (const name of ["Meadow", "Pages", "Write", "More"])
      await expect(tools().getByRole("button", { name, exact: true })).toBeVisible();
    await expect(tools().getByRole("button", { name: /^Returns/ })).toBeVisible();
    const bar = await page.locator(".garden-top").boundingBox();
    assert.ok(
      bar && bar.y + bar.height >= viewportHeight - 1 && bar.y > viewportHeight / 2,
      "tab bar sits at the bottom",
    );
    for (const name of ["Meadow", "Pages", "Write", "More"]) {
      const box = await tools().getByRole("button", { name, exact: true }).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44, `${name} is at least 44x44`);
    }
    await noSidewaysScroll("pages");
    await tools().getByRole("button", { name: "Write", exact: true }).tap();
    await expect(newEntry()).toBeFocused();
    await noSidewaysScroll("writing page");
    pass("tab bar at the bottom, 44px targets, Write lands with the caret on a page");
    await page.goto(pagesUrl(ids));
    await tools().getByRole("button", { name: "More", exact: true }).tap();
    const signOut = tools().getByRole("button", { name: "Sign out", exact: true });
    await expect(signOut).toBeVisible();
    const sheet = await tools().locator(".tools-secondary").boundingBox();
    assert.ok(sheet.y + sheet.height <= bar.y + 1, "the More sheet opens above the bar");
    await page.keyboard.press("Escape");
    await expect(signOut).toBeHidden();
    pass("More opens upward as a sheet and closes");
    for (const view of ["", "returns", "gardens", "timeline", "archive"]) {
      await page.goto(`${base}/garden?garden=${ids.garden}&view=${view}`);
      await expect(page.locator(".thinking-garden")).toBeVisible();
      await noSidewaysScroll(view || "meadow");
    }
    pass("no sideways scroll in Meadow, Returns, All gardens, Timeline or Archive");
  },
  { when: phone },
);

journey(
  "keyboard",
  async () => {
    const { email, ids } = await fixtureAccount("keys");
    await signIn(email);
    await page.goto(pagesUrl(ids));
    await expect(heading("Test Garden")).toBeVisible();
    await page.keyboard.press("Tab");
    assert.equal(
      await page.evaluate(() => document.activeElement?.className),
      "skip-link",
    );
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#garden-content$/);
    pass("the first Tab stop is the skip link to the content");
  },
  { when: !phone },
);

journey("sign-out", async () => {
  const { email, ids } = await fixtureAccount("signout", {
    entries: ["Synthetic entry."],
  });
  await signIn(email);
  await page.goto(pagesUrl(ids));
  await fromMore("Sign out");
  await expect(page).toHaveURL(/\/login/);
  assert.equal(await heldSessionEntries(), 0, "no session is left in this browser after sign-out");
  await signedOutAt("/garden");
  await signedOutAt(`/garden/import?garden=${ids.garden}`);
  if (storeMode === "server") {
    assert.equal((await page.request.get(`${base}/garden/export`)).status(), 401);
    assert.equal(
      (await page.request.get(`${base}/garden/history?entry=${crypto.randomUUID()}`)).status(),
      401,
    );
  }
  pass("device sign-out: back at sign-in, no session cookie, no garden behind it");
  // Sign out everywhere revokes every session of the account.
  await signIn(email);
  const kept = await context.cookies();
  const keptState = await context.storageState();
  const session = await heldSession();
  assert.ok(session?.refresh_token, "the stored session holds a refresh token");
  const archivedAt = async () =>
    (await admin.from("entries").select("archived_at").eq("id", ids.entries[0]).single()).data
      .archived_at;
  // Server store: keep one real server action (archive this entry) to replay
  // later, undo it, and prove the replay works while the session is alive.
  let action = null;
  const replayAction = (requester) =>
    requester.post(action.url, { headers: action.headers, data: action.body });
  if (storeMode === "server") {
    await page.goto(thoughtUrl(ids));
    const [sent] = await Promise.all([
      page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]),
      page.getByRole("button", { name: "Archive entry", exact: true }).click(),
    ]);
    const headers = sent.headers();
    action = {
      url: sent.url(),
      body: sent.postData(),
      headers: Object.fromEntries(
        ["next-action", "content-type", "accept", "next-router-state-tree"]
          .filter((h) => headers[h])
          .map((h) => [h, headers[h]]),
      ),
    };
    await expect.poll(archivedAt).not.toBeNull();
    const restore = async () => {
      assert.equal(
        (await admin.from("entries").select("id").eq("id", ids.entries[0])).error,
        null,
      );
      await page.goto(`${base}/garden?garden=${ids.garden}&topic=${ids.topic}&thought=${ids.thought}&view=archive`);
      await page.getByRole("button", { name: "Restore entry", exact: true }).click();
      await expect.poll(archivedAt).toBeNull();
    };
    await restore();
    const alive = await replayAction(context.request);
    await expect.poll(archivedAt).not.toBeNull();
    await restore();
    pass(`server store: a captured server action replays while signed in (${alive.status()}), then is undone`);
  }
  await page.goto(pagesUrl(ids));
  await fromMore("Settings & export");
  await expect(page.locator(".garden-settings")).toContainText(
    storeMode === "server"
      ? "Other browsers are asked to sign in again the next time they load or save."
      : "Other browsers can keep working until the access they already hold runs out, within about an hour",
  );
  await page.getByRole("button", { name: "Sign out on all devices", exact: true }).click();
  await expect(page).toHaveURL(/\/login/);
  const signedOutAtMs = Date.now();
  const reuse = await createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.refreshSession({ refresh_token: session.refresh_token });
  assert.ok(reuse.error, "a copied refresh token is refused after sign out everywhere");
  const who = await fetch(`${config.API_URL}/auth/v1/user`, {
    headers: {
      apikey: config.PUBLISHABLE_KEY,
      authorization: `Bearer ${session.access_token}`,
    },
  });
  assert.ok(who.status === 401 || who.status === 403, "the auth service refuses the old access token");
  pass("sign out on all devices: the copied refresh token and access token are refused by the auth service");
  // The cookies copied beforehand, replayed in another browser.
  const replay = await browser.newContext(
    sessionIn === "storage" ? { ...contextOptions, storageState: keptState } : { ...contextOptions },
  );
  if (sessionIn === "cookies") await replay.addCookies(kept);
  const other = await replay.newPage();
  if (storeMode === "server") {
    // The server confirms the session with the auth service on every request
    // (D-029): the copy is refused on its next page load, action and route.
    for (const address of [pagesUrl(ids), thoughtUrl(ids), `${base}/garden/import?garden=${ids.garden}`]) {
      await other.goto(address);
      await expect(other.getByLabel("Email address")).toBeVisible();
      await expect(other).toHaveURL(/\/login/);
      await expect(other.locator(".journal-entry, .bed-card, .garden-scene")).toHaveCount(0);
      assert.ok(!(await other.content()).includes("Synthetic entry."), "no writing in the refused page");
    }
    const refusedAction = await replayAction(replay.request);
    const refusedText = await refusedAction.text();
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await archivedAt(), null, "the replayed server action changed nothing");
    assert.ok(!refusedText.includes("Synthetic entry."));
    const exported = await replay.request.get(`${base}/garden/export`);
    const exportedMd = await replay.request.get(`${base}/garden/export?format=md&garden=${ids.garden}`);
    const history = await replay.request.get(`${base}/garden/history?entry=${ids.entries[0]}`);
    assert.equal(exported.status(), 401);
    assert.equal(exportedMd.status(), 401);
    assert.equal(history.status(), 401);
    for (const r of [exported, exportedMd, history])
      assert.ok(!(await r.text()).includes("Synthetic entry."));
    pass(`copied cookies after sign out everywhere, server store: 3 garden pages show sign-in at /login; the replayed server action (${refusedAction.status()}) changed nothing; export 401, export Markdown 401, history 401`);
  } else {
    await other.goto(pagesUrl(ids));
    await other.waitForTimeout(2500);
    const shown = await other.locator(".bed-card").count();
    console.log(
      `  note browser store, copied ${sessionIn === "storage" ? "storage" : "cookies"} replayed after sign out everywhere: ${shown ? "the garden was still shown (this store never asks the app's server; the token is honoured until it expires, D-029)" : "the sign-in screen was shown"}`,
    );
  }
  await replay.close();
  // Recorded, not asserted: the data API with the copied access token alone.
  const claims = JSON.parse(Buffer.from(session.access_token.split(".")[1], "base64url").toString());
  const direct = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { authorization: `Bearer ${session.access_token}` } },
  });
  const read = await direct.from("seed_revisions").select("id");
  const before = (await admin.from("plots").select("name").eq("id", ids.topic2).single()).data.name;
  const write = await direct.from("plots").update({ name: "Renamed after sign-out" }).eq("id", ids.topic2).select("id");
  const wrote = !write.error && (write.data ?? []).length === 1;
  if (wrote) await direct.from("plots").update({ name: before }).eq("id", ids.topic2);
  console.log(
    `  note data API with the copied access token after sign out everywhere: read ${read.error ? `refused (${read.error.code ?? read.status})` : `answered ${read.data.length} row(s)`}; write ${wrote ? "accepted (undone)" : `refused (${write.error?.code ?? "0 rows"})`}; token lifetime ${claims.exp - claims.iat} s, ${claims.exp - Math.round(signedOutAtMs / 1000)} s left at sign-out`,
  );
});

journey(
  "deletion-off",
  async () => {
    const { email, ids } = await fixtureAccount("nodelete", {
      entries: ["Synthetic entry."],
    });
    await signIn(email);
    await page.goto(thoughtUrl(ids));
    await expect(entriesOnPage()).toHaveCount(1);
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await page.goto(pagesUrl(ids, `&topic=${ids.topic}`));
    await page.getByText("Topic settings ·", { exact: false }).click();
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await fromMore("Settings & export");
    await expect(page.locator(".garden-settings")).toBeVisible();
    await expect(page.getByRole("button", { name: /^Delete / })).toHaveCount(0);
    pass("deletion off: no delete control on an entry, a thought, a topic or in settings");
  },
  { when: !deletionOn },
);

journey(
  "deletion",
  async () => {
    const { email, ids, userId } = await fixtureAccount("delete", {
      entries: ["Synthetic entry one.", "Synthetic entry two.", "Synthetic entry three."],
    });
    await signIn(email);
    // Entry: cancel leaves everything; confirm erases one entry and its versions.
    await page.goto(thoughtUrl(ids));
    await expect(entriesOnPage()).toHaveCount(3);
    const deleteEntry = page.getByRole("button", { name: "Delete entry…", exact: true });
    await deleteEntry.first().click();
    const entryDialog = page.getByRole("dialog", { name: "Delete this entry permanently?" });
    await expect(entryDialog).toContainText("Archive hides. Delete erases, permanently.");
    await expect(entryDialog).toContainText("This will erase:");
    await entryDialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(entryDialog).toHaveCount(0);
    assert.equal(await count("entries", "tenant_id", userId), 3);
    await deleteEntry.first().click();
    await expect(entryDialog).toContainText("This entry, with 1 saved version");
    await entryDialog
      .getByRole("button", { name: "Delete entry permanently", exact: true })
      .click();
    await expect(entriesOnPage()).toHaveCount(2);
    assert.equal(await count("entries", "tenant_id", userId), 2);
    assert.equal(await count("seed_revisions", "tenant_id", userId), 2);
    pass("entry: cancel keeps 3; confirm erases 1 entry and its version (3 -> 2)");
    // Thought: a plain confirm; its entries go with it.
    await page.getByRole("button", { name: "Delete thought…", exact: true }).click();
    const thoughtDialog = page.getByRole("dialog", { name: "Delete “A question” permanently?" });
    await expect(thoughtDialog).toContainText("2 entries, with 2 saved versions");
    await thoughtDialog
      .getByRole("button", { name: "Delete thought permanently", exact: true })
      .click();
    await expect(thoughtDialog).toHaveCount(0);
    await expect.poll(() => count("seeds", "tenant_id", userId)).toBe(1);
    assert.equal(await count("entries", "tenant_id", userId), 0);
    assert.equal(await count("seed_revisions", "tenant_id", userId), 0);
    await expect(page).not.toHaveURL(new RegExp(`thought=${ids.thought}`));
    pass("thought: erased with its 2 entries; the page moves to its topic");
    // Topic: confirmed by typing its name.
    await page.goto(pagesUrl(ids, `&topic=${ids.topic2}`));
    await page.getByText("Topic settings ·", { exact: false }).click();
    await page.getByRole("button", { name: "Delete topic…", exact: true }).click();
    const topicDialog = page.getByRole("dialog", { name: "Delete “Making” permanently?" });
    const eraseTopic = topicDialog.getByRole("button", {
      name: "Delete topic permanently",
      exact: true,
    });
    await expect(topicDialog).toContainText("1 thought");
    await expect(eraseTopic).toBeDisabled();
    await topicDialog.getByRole("textbox").fill("making");
    await expect(eraseTopic).toBeDisabled();
    await topicDialog.getByRole("textbox").fill("Making");
    await eraseTopic.click();
    await expect(topicDialog).toHaveCount(0);
    await expect.poll(() => count("plots", "tenant_id", userId)).toBe(1);
    assert.equal(await count("seeds", "tenant_id", userId), 0);
    pass("topic: needs its exact name typed; erased with its thought (2 topics -> 1)");
    // Garden: typed name, export offered first; the other garden is untouched.
    await page.goto(pagesUrl(ids));
    await fromMore("Settings & export");
    await page.getByRole("button", { name: "Delete garden…", exact: true }).click();
    const gardenDialog = page.getByRole("dialog", { name: "Delete “Test Garden” permanently?" });
    await expect(gardenDialog.getByRole("link", { name: "Export first · Markdown" })).toBeVisible();
    const copy = await download(() =>
      gardenDialog.getByRole("link", { name: "Export first · JSON" }).click(),
    );
    assert.equal(JSON.parse(copy.text).source.gardens.length, 1);
    await gardenDialog.getByRole("textbox").fill("Test Garden");
    await gardenDialog
      .getByRole("button", { name: "Delete garden permanently", exact: true })
      .click();
    await expect.poll(() => count("gardens", "tenant_id", userId)).toBe(1);
    assert.equal(await count("plots", "tenant_id", userId), 0);
    await expect(page).toHaveURL(/\/garden/);
    await expect(page.locator(".thinking-garden")).toBeVisible();
    await expect(page.locator(".thinking-garden")).not.toContainText("Test Garden");
    pass("garden: export offered first, typed name, erased (2 gardens -> 1); the other garden opens");
    // Account: typed email; needs a sign-in from the last ten minutes.
    await page.goto(`${base}/garden?garden=${ids.other}&view=list`);
    await fromMore("Settings & export");
    await page.getByRole("button", { name: "Delete account…", exact: true }).click();
    const accountDialog = page.getByRole("dialog", { name: "Delete your account permanently?" });
    const eraseAccount = accountDialog.getByRole("button", {
      name: "Delete account permanently",
      exact: true,
    });
    await expect(eraseAccount).toBeDisabled();
    await expect(accountDialog).toContainText("Your account and sign-in, on every device");
    await page.keyboard.press("Escape");
    await expect(accountDialog).toHaveCount(0);
    assert.equal(await count("gardens", "tenant_id", userId), 1);
    pass("account: Escape cancels; nothing erased");
    const aged = ageSessions(userId);
    await page.getByRole("button", { name: "Delete account…", exact: true }).click();
    await accountDialog.getByRole("textbox").first().fill(email);
    await eraseAccount.click();
    if (aged) {
      await expect(accountDialog).toContainText("Please sign in again first.");
      assert.equal(await count("gardens", "tenant_id", userId), 1);
      await spaceCodes(email);
      await accountDialog.getByRole("button", { name: "Email me a sign-in code" }).click();
      const codeField = accountDialog.getByLabel(/Six-digit code sent to/);
      await expect(codeField).toBeVisible();
      await codeField.fill(await mailedCode(email));
      await accountDialog.getByRole("button", { name: "Confirm code", exact: true }).click();
      await expect(accountDialog).toContainText("You are signed in again.");
      await eraseAccount.click();
      pass("account: an older sign-in is refused, nothing erased; the code sent inside the dialog signs in again");
    }
    await expect(page).toHaveURL(/\/account\/deleted/);
    assert.equal(await count("gardens", "tenant_id", userId), 0);
    assert.equal(await count("accounts", "id", userId), 0);
    const gone = await admin.auth.admin.getUserById(userId);
    assert.ok(gone.error || !gone.data?.user, "the sign-in identity is gone");
    created.delete(userId);
    assert.equal(await heldSessionEntries(), 0, "no session is left in this browser");
    await signedOutAt("/garden");
    pass(
      `account: erased${aged ? " after re-sign-in" : " (session not aged: GARDEN_TEST_DB_CONTAINER unset, re-sign-in step not exercised)"}; 0 gardens, no account row, no identity, no cookie`,
    );
  },
  { when: deletionOn },
);

// Two states whose wording has to read as one true thing: Returns for an
// account that was tended once and is not tended now, and an address whose
// topic and thought no longer exist. Screenshots go to the artifacts directory.
journey(
  "copy-states",
  async () => {
    const { email, ids, userId } = await fixtureAccount("copy", {
      entries: ["Synthetic entry."],
    });
    const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
    // A finished pass that returned nothing, written straight into the local
    // database with triggers skipped (the runtime is off locally).
    assert.ok(
      localSql(
        `set local session_replication_role = replica;
         insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,status,finished_at)
           values(${lit(crypto.randomUUID())},${lit(userId)},${lit(ids.garden)},array[${lit(ids.topic)}]::uuid[],'complete',now());`,
      ),
      "a finished pass was written",
    );
    await signIn(email);
    await page.goto(`${base}/garden?garden=${ids.garden}&view=returns`);
    const returns = page.locator(".level-returns");
    await expect(returns).toContainText("Last tended");
    await expect(returns).toContainText(
      "Tending is not active now. What was returned before stays here to read, and nothing new will arrive until tending is active.",
    );
    await expect(returns).toContainText(
      "No bloom is showing. Earlier tending passes are in the full record below.",
    );
    await expect(returns).not.toContainText("no AI has read your writing");
    await expect(returns).not.toContainText("not active for this account yet");
    await noSidewaysScroll("returns, tended before");
    // The loading screen must be gone, not merely underneath or on top.
    await expect(page.getByText("Gathering what you left here…")).toHaveCount(0);
    await page.screenshot({ path: path.join(artifacts, `copy-returns-${storeMode}-${deviceName}.png`) });
    await page.getByRole("button", { name: "Open the full record", exact: true }).click();
    await expect(returns).toContainText(
      "Tending is not active now, so nothing new will arrive until it is. Your tending choices are saved, and past returns stay here to read.",
    );
    await expect(returns).not.toContainText("not active for this account yet");
    await expect(page.getByRole("button", { name: "Invite a reflection" })).toHaveCount(0);
    await expect(returns.getByRole("status").filter({ hasText: "Opening Returns" })).toHaveCount(0);
    await page.screenshot({ path: path.join(artifacts, `copy-returns-record-${storeMode}-${deviceName}.png`), fullPage: true });
    if (process.env.GARDEN_TEST_DEBUG) console.log((await returns.innerText()).replace(/\n+/g, " | "));
    pass("Returns, tended before and inactive now: last tended, not active now, no bloom showing; never 'no AI has read your writing'; the full record says the same");
    for (const view of ["list", ""]) {
      await page.evaluate((v) => localStorage.setItem("slow-garden:garden-view", v || "garden"), view);
      await page.goto(`${base}/garden?garden=${ids.garden}&topic=${crypto.randomUUID()}&thought=${crypto.randomUUID()}`);
      const notice = page.getByText("That location is no longer available. Showing its nearest available parent.");
      await expect(notice).toBeVisible();
      await page.waitForTimeout(1500);
      await expect(notice).toBeVisible();
      await expect(notice).toHaveCount(1);
      await noSidewaysScroll("stale location");
      const box = await notice.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= viewportHeight, "the notice is on the first screen");
      await page.screenshot({ path: path.join(artifacts, `copy-stale-${view || "meadow"}-${storeMode}-${deviceName}.png`) });
    }
    pass("a stale address says so once, on the first screen, in Pages and in the Meadow, and keeps saying it");
  },
  { when: !!process.env.GARDEN_TEST_DB_CONTAINER },
);

// Two accounts: B must not read or write anything of A's, through the pages or
// by calling the data API directly with B's own session and A's ids, and one
// tab that changes account must never show the other account's writing.
journey("two-accounts", async () => {
  const MARK = "Alder"; // appears only in account A's names and writing
  const A = await fixtureAccount("a", {
    entries: [`${MARK} synthetic private entry of account A.`],
  });
  const B = await fixtureAccount("b", {
    entries: ["Synthetic private entry of account B."],
  });
  for (const [table, id, column, value] of [
    ["gardens", A.ids.garden, "name", `${MARK} Garden`],
    ["plots", A.ids.topic, "name", `${MARK} topic`],
    ["seeds", A.ids.thought, "title", `${MARK} thought`],
  ])
    assert.equal(
      (await A.client.from(table).update({ [column]: value }).eq("id", id)).error,
      null,
    );
  const { data: aRevisions } = await admin
    .from("seed_revisions")
    .select("id,body")
    .eq("tenant_id", A.userId);
  // A finished tending pass with one bloom and one mark for A, written straight
  // into the local database (the runtime is off locally and the API roles may
  // not write these tables), so Returns has something to guard.
  const passId = crypto.randomUUID();
  const evidence = [{ revision_id: aRevisions[0].id, excerpt: `${MARK} synthetic` }];
  const lit = (v) => `'${String(v).replaceAll("'", "''")}'`;
  // Triggers are skipped for this one transaction: a pass is otherwise only
  // ever prepared by its owner's request and finished by the worker.
  const returnsSeeded = localSql(
    `set local session_replication_role = replica;
     insert into public.garden_passes(id,tenant_id,garden_id,plot_ids,status,finished_at)
       values(${lit(passId)},${lit(A.userId)},${lit(A.ids.garden)},array[${lit(A.ids.topic)}]::uuid[],'complete',now());
     insert into public.blooms(pass_id,tenant_id,garden_id,ordinal,kind,interpretation,evidence)
       values(${lit(passId)},${lit(A.userId)},${lit(A.ids.garden)},0,'question',${lit(`${MARK} synthetic bloom of account A.`)},${lit(JSON.stringify(evidence))}::jsonb);
     insert into public.tending_marks(pass_id,tenant_id,garden_id,seed_id,kind,label,evidence)
       values(${lit(passId)},${lit(A.userId)},${lit(A.ids.garden)},${lit(A.ids.thought)},'theme',${lit(`${MARK} mark`)},${lit(JSON.stringify(evidence))}::jsonb);`,
  );

  if (!returnsSeeded)
    console.log(
      "  note A's synthetic pass, bloom and mark were not written (GARDEN_TEST_DB_CONTAINER unset or the insert was refused); Returns isolation is then checked on empty tables",
    );
  const { data: aBloom } = await admin.from("blooms").select("id").eq("tenant_id", A.userId).maybeSingle();
  const { data: aMark } = await admin.from("tending_marks").select("id").eq("tenant_id", A.userId).maybeSingle();
  const snapshot = async () => {
    const out = {};
    for (const table of ["gardens", "plots", "seeds", "entries", "seed_revisions", "garden_passes", "blooms", "bloom_responses", "tending_marks", "tending_mark_responses"]) {
      const { data, error } = await admin.from(table).select("*").eq("tenant_id", A.userId).order("id");
      assert.equal(error, null);
      out[table] = data;
    }
    return JSON.stringify(out);
  };
  const before = await snapshot();
  const aCounts = Object.fromEntries(
    Object.entries(JSON.parse(before)).map(([k, v]) => [k, v.length]),
  );

  // ---- direct data API with B's session ----
  const b = B.client;
  let reads = 0;
  for (const table of ["gardens", "plots", "seeds", "entries", "seed_revisions", "current_entries", "garden_passes", "blooms", "bloom_responses", "tending_marks", "tending_mark_responses"]) {
    const { data, error } = await b.from(table).select("*");
    assert.equal(error, null, `B may read its own ${table}`);
    assert.ok(data.every((row) => row.tenant_id === B.userId), `${table}: only B's rows`);
    assert.ok(!JSON.stringify(data).includes(MARK), `${table}: none of A's words`);
    reads++;
  }
  const { data: accounts } = await b.from("accounts").select("*");
  assert.ok(accounts.every((row) => row.id === B.userId), "accounts: only B's row");
  for (const [table, id] of [
    ["gardens", A.ids.garden],
    ["plots", A.ids.topic],
    ["seeds", A.ids.thought],
    ["entries", A.ids.entries[0]],
    ["seed_revisions", aRevisions[0].id],
    ["garden_passes", passId],
    ["blooms", aBloom?.id],
    ["tending_marks", aMark?.id],
  ]) {
    if (!id) continue;
    const { data } = await b.from(table).select("*").eq("id", id);
    assert.equal((data ?? []).length, 0, `${table}: A's row by id is not readable`);
    reads++;
  }
  const byParent = await b.from("seed_revisions").select("id,body").eq("entry_id", A.ids.entries[0]);
  assert.equal((byParent.data ?? []).length, 0, "A's revisions by entry id");
  const exported = await b.rpc("export_garden_sources");
  assert.equal(exported.error, null);
  assert.ok(!JSON.stringify(exported.data).includes(MARK), "B's export holds none of A's words");
  assert.ok(exported.data.gardens.every((g) => g.tenant_id === B.userId));
  pass(`direct API as B: ${reads} reads return only B's rows; A's rows by id return nothing; B's export is B's only`);

  const refused = [];
  const mustFail = async (label, promise) => {
    const { data, error } = await promise;
    // The deletion functions answer {deleted:false} for a row that is not the caller's.
    const rows = Array.isArray(data) ? data.length : data && data.deleted !== false ? 1 : 0;
    assert.ok(error || rows === 0, `${label} must be refused or change nothing`);
    refused.push(`${label}: ${error ? (error.code ?? "error") : "0 rows"}`);
  };
  const uuid = () => crypto.randomUUID();
  await mustFail("insert topic into A's garden (as B)", b.from("plots").insert({ id: uuid(), garden_id: A.ids.garden, name: "x" }).select());
  await mustFail("insert topic into A's garden (claiming A)", b.from("plots").insert({ id: uuid(), tenant_id: A.userId, garden_id: A.ids.garden, name: "x" }).select());
  await mustFail("insert thought into A's topic", b.from("seeds").insert({ id: uuid(), garden_id: A.ids.garden, plot_id: A.ids.topic, title: "x" }).select());
  await mustFail("insert garden for A", b.from("gardens").insert({ id: uuid(), tenant_id: A.userId, name: "x" }).select());
  await mustFail("rename A's garden", b.from("gardens").update({ name: "x" }).eq("id", A.ids.garden).select());
  await mustFail("rename A's topic", b.from("plots").update({ name: "x" }).eq("id", A.ids.topic).select());
  await mustFail("retitle A's thought", b.from("seeds").update({ title: "x" }).eq("id", A.ids.thought).select());
  await mustFail("archive A's entry", b.from("entries").update({ archived_at: new Date().toISOString() }).eq("id", A.ids.entries[0]).select());
  await mustFail("delete A's garden row", b.from("gardens").delete().eq("id", A.ids.garden).select());
  await mustFail("delete A's revision row", b.from("seed_revisions").delete().eq("id", aRevisions[0].id).select());
  await mustFail("save an entry into A's thought", b.rpc("save_entry", { p_seed_id: A.ids.thought, p_entry_id: uuid(), p_revision_id: uuid(), p_body: "x" }));
  await mustFail("revise A's entry", b.rpc("save_entry", { p_seed_id: A.ids.thought, p_entry_id: A.ids.entries[0], p_revision_id: uuid(), p_body: "x" }));
  await mustFail("revise A's entry through B's thought", b.rpc("save_entry", { p_seed_id: B.ids.thought, p_entry_id: A.ids.entries[0], p_revision_id: uuid(), p_body: "x" }));
  await mustFail("import into A's topic", b.rpc("import_thought", { p_plot_id: A.ids.topic, p_seed_id: uuid(), p_title: "x", p_entries: [{ body: "x", created_at: "2024-01-01T00:00:00Z" }] }));
  await mustFail("request a pass on A's garden", b.from("garden_passes").insert({ id: uuid(), garden_id: A.ids.garden, plot_ids: [A.ids.topic] }).select());
  await mustFail("request a pass claiming A", b.from("garden_passes").insert({ id: uuid(), tenant_id: A.userId, garden_id: A.ids.garden, plot_ids: [A.ids.topic] }).select());
  await mustFail("cancel A's pass", b.from("garden_passes").update({ status: "cancelled" }).eq("id", passId).select());
  if (aBloom) await mustFail("respond to A's bloom", b.from("bloom_responses").insert({ id: uuid(), bloom_id: aBloom.id, response: "prune" }).select());
  if (aMark) await mustFail("respond to A's mark", b.from("tending_mark_responses").insert({ id: uuid(), mark_id: aMark.id, response: "prune" }).select());
  for (const [kind, id] of [["entry", A.ids.entries[0]], ["seed", A.ids.thought], ["plot", A.ids.topic], ["garden", A.ids.garden]]) {
    const preview = await b.rpc("deletion_preview", { p_kind: kind, p_id: id });
    assert.ok(
      preview.error || !JSON.stringify(preview.data).match(/"(entries|versions|thoughts|topics)":\s*[1-9]/),
      `deletion preview of A's ${kind} reveals no counts`,
    );
    refused.push(`preview A's ${kind}: ${preview.error ? (preview.error.code ?? "error") : "zero counts"}`);
  }
  await mustFail("delete A's entry", b.rpc("delete_entry", { p_entry_id: A.ids.entries[0] }));
  await mustFail("delete A's thought", b.rpc("delete_seed", { p_seed_id: A.ids.thought }));
  await mustFail("delete A's topic", b.rpc("delete_plot", { p_plot_id: A.ids.topic, p_confirm_name: `${MARK} topic` }));
  await mustFail("delete A's garden", b.rpc("delete_garden", { p_garden_id: A.ids.garden, p_confirm_name: `${MARK} Garden` }));
  await mustFail("delete A's account by its email", b.rpc("delete_account", { p_confirm: A.email }));
  assert.equal(await snapshot(), before, "every row of A is byte-for-byte unchanged");
  assert.equal(await count("gardens", "tenant_id", B.userId), 2, "B's own account is intact");
  const anonymous = createClient(config.API_URL, config.PUBLISHABLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  for (const table of ["gardens", "seed_revisions", "blooms"]) {
    const { data } = await anonymous.from(table).select("*");
    assert.equal((data ?? []).length, 0, `no session: ${table} is not readable`);
  }
  pass(`direct API as B: ${refused.length} writes and deletions against A's ids refused or without effect; A's ${Object.values(aCounts).reduce((a, n) => a + n, 0)} rows unchanged; no-session reads return nothing`);
  if (process.env.GARDEN_TEST_DEBUG) for (const line of refused) console.log(`       ${line}`);

  // ---- through the browser: B's session, A's addresses ----
  const leaks = [];
  const guard = (ctx, label) =>
    ctx.on("response", async (response) => {
      const type = response.headers()["content-type"] ?? "";
      if (!/json|text|html|x-component/.test(type)) return;
      try {
        if ((await response.text()).includes(MARK))
          leaks.push(`${label}: ${response.request().method()} ${new URL(response.url()).pathname}`);
      } catch {}
    });
  await signIn(B.email);
  guard(context, "B's session");
  const visible = async () => (await page.locator("body").innerText()).includes(MARK);
  const g = A.ids.garden;
  const addresses = [
    `/garden?garden=${g}&view=list`,
    `/garden?garden=${g}`,
    `/garden?garden=${g}&topic=${A.ids.topic}&view=list`,
    `/garden?garden=${g}&topic=${A.ids.topic}&thought=${A.ids.thought}&view=list`,
    `/garden?garden=${B.ids.garden}&topic=${A.ids.topic}&thought=${A.ids.thought}&view=list`,
    `/garden?garden=${g}&view=timeline`,
    `/garden?garden=${g}&view=returns`,
    `/garden?garden=${g}&view=archive`,
    `/garden?garden=${g}&view=gardens`,
    `/garden/import?garden=${g}`,
  ];
  for (const address of addresses) {
    await page.goto(base + address);
    await expect(page.locator(".thinking-garden, main h1").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    assert.equal(await visible(), false, "B never sees A's words at A's address");
  }
  await page.goto(pagesUrl(B.ids));
  await page.getByRole("searchbox").fill(MARK);
  await expect(
    page.getByRole("region", { name: "Search results" }).getByRole("status"),
  ).toContainText("Nothing matches");
  pass(`as B in the browser: ${addresses.length} of A's addresses and a search for A's word show nothing of A`);
  if (storeMode === "server") {
    const foreign = await page.request.get(`${base}/garden/export?garden=${g}`);
    assert.equal(foreign.status(), 404);
    const history = await page.request.get(`${base}/garden/history?entry=${A.ids.entries[0]}`);
    assert.equal(history.status(), 200);
    assert.deepEqual(await history.json(), []);
    const own = await page.request.get(`${base}/garden/export`);
    assert.ok(!(await own.text()).includes(MARK));
    pass("server routes as B: export of A's garden 404, history of A's entry empty, B's export has none of A's words");
  } else {
    await page.goto(pagesUrl(B.ids));
    await fromMore("Settings & export");
    const file = await download(() =>
      page.locator(".garden-settings").getByRole("link", { name: "Export all sources · JSON", exact: true }).click(),
    );
    assert.ok(!file.text.includes(MARK));
    assert.equal(JSON.parse(file.text).source.gardens.length, 2);
    pass("browser store as B: the export built in the page has none of A's words");
  }
  // In the page, with B's own session and client: the same reads by A's ids.
  if (storeMode === "browser") {
    const token = (await heldSession())?.access_token;
    assert.ok(token);
    const rows = await page.evaluate(
      async ({ api, key, token, ids }) => {
        const out = [];
        for (const [table, id] of ids) {
          const r = await fetch(`${api}/rest/v1/${table}?id=eq.${id}&select=*`, {
            headers: { apikey: key, authorization: `Bearer ${token}` },
          });
          out.push([table, r.status, (await r.json()).length ?? -1]);
        }
        return out;
      },
      {
        api: config.API_URL,
        key: config.PUBLISHABLE_KEY,
        token,
        ids: [["gardens", g], ["plots", A.ids.topic], ["seeds", A.ids.thought], ["entries", A.ids.entries[0]], ["seed_revisions", aRevisions[0].id], ["garden_passes", passId]],
      },
    );
    for (const [table, status, n] of rows)
      assert.ok(status === 200 && n === 0, `${table} from the page: 200 with no rows`);
    pass("from B's page (same origin, CSP allowed): A's ids answer 200 with 0 rows");
  }
  assert.deepEqual(leaks, [], "no response in B's session carried A's words");
  pass("no response received in B's session contained A's word");

  // ---- one tab, two accounts ----
  await freshContext();
  await signIn(A.email);
  await page.goto(`${base}/garden?garden=${g}&topic=${A.ids.topic}&thought=${A.ids.thought}&view=list`);
  await expect(heading(`${MARK} thought`)).toBeVisible();
  await expect(newEntry()).toBeEnabled();
  await newEntry().fill(`${MARK} unsaved draft of account A`);
  await page.waitForTimeout(1200);
  await page.goto(`${base}/garden?garden=${g}&view=returns`);
  if (returnsSeeded)
    await expect(page.locator(".level-returns")).toContainText(`${MARK} synthetic bloom`);
  await page.goto(`${base}/garden?garden=${g}&view=list`);
  await expect(heading(`${MARK} Garden`)).toBeVisible();
  await fromMore("Sign out");
  await expect(page).toHaveURL(/\/login/);
  await completeSignIn(B.email);
  await expect(page).toHaveURL(/\/garden/);
  guard(context, "same tab as B");
  await expect(page.locator(".thinking-garden")).toBeVisible();
  await page.waitForLoadState("networkidle");
  assert.equal(await visible(), false, "after switching to B the tab shows none of A");
  for (const address of [
    `/garden?garden=${g}&view=list`,
    `/garden?garden=${g}&topic=${A.ids.topic}&thought=${A.ids.thought}&view=list`,
    `/garden?garden=${g}&view=returns`,
    `/garden?garden=${B.ids.garden}&topic=${B.ids.topic}&thought=${B.ids.thought}&view=list`,
  ]) {
    await page.goto(base + address);
    await expect(page.locator(".thinking-garden")).toBeVisible();
    await page.waitForLoadState("networkidle");
    assert.equal(await visible(), false, "B in A's former tab sees none of A");
  }
  await expect(newEntry()).toHaveValue("");
  // Back through the tab's history, past the sign-in, to pages A had open.
  for (let i = 0; i < 8; i++) {
    await page.goBack().catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(300);
    assert.equal(await visible(), false, `Back x${i + 1} shows none of A`);
  }
  assert.deepEqual(leaks, [], "no response after the switch carried A's words");
  pass("one tab, A then B: B sees none of A's gardens, thought, bloom or unsaved draft, also by A's addresses and by Back");
  await page.goto(pagesUrl(B.ids));
  await fromMore("Sign out");
  await expect(page).toHaveURL(/\/login/);
  await completeSignIn(A.email);
  await expect(page).toHaveURL(/\/garden/);
  await page.goto(`${base}/garden?garden=${g}&topic=${A.ids.topic}&thought=${A.ids.thought}&view=list`);
  await expect(heading(`${MARK} thought`)).toBeVisible();
  assert.ok(!(await page.locator("body").innerText()).includes("entry of account B"));
  // Sign-out says it clears this browser's unsaved drafts, and it does.
  await expect(newEntry()).toBeEnabled();
  await expect(newEntry()).toHaveValue("");
  pass("back as A in the same tab: A's garden, none of B's; the draft A left was cleared at sign-out, as the confirmation says");
  assert.equal(await snapshot(), before, "A's rows are unchanged at the end");
});


// ---- run -------------------------------------------------------------------
console.log(
  `# web journeys · store=${storeMode} · device=${deviceName} (${contextOptions.viewport.width}x${viewportHeight}) · session=${sessionIn} · deletion=${deletionOn ? "on" : "off"} · ${base}`,
);
browser = await chromium.launch(launchOptions);
console.log(`# chromium ${browser.version()} · node ${process.version}`);
let failed = 0;
try {
  for (const { name, fn, when } of journeys) {
    if (only.length && !only.includes(name)) continue;
    if (!when) {
      console.log(`SKIP ${name} (not applicable to this configuration)`);
      results.push({ name, status: "skip" });
      continue;
    }
    await freshContext();
    consoleErrors.length = 0;
    try {
      await fn();
      console.log(`PASS ${name}`);
      results.push({ name, status: "pass" });
    } catch (error) {
      failed++;
      results.push({ name, status: "fail" });
      console.log(`FAIL ${name}: ${String(error?.message ?? error).split("\n").slice(0, 6).join("\n     ")}`);
      try {
        await page.screenshot({
          path: path.join(artifacts, `failure-${storeMode}-${deviceName}-${name}.png`),
        });
        if (process.env.GARDEN_TEST_DEBUG)
          console.log(
            (await page.locator("body").ariaSnapshot()).slice(0, 6000),
          );
      } catch {}
    }
    if (consoleErrors.length)
      console.log(`     console errors: ${consoleErrors.length} (${[...new Set(consoleErrors)].slice(0, 4).join(" | ")})`);
  }
} finally {
  if (context) await context.close().catch(() => {});
  await browser.close();
  // Remove only this run's synthetic identities; their rows cascade.
  for (const id of created) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && error.status !== 404)
      console.log(`cleanup: could not delete a synthetic identity (${error.status})`);
  }
}
console.log(
  `\n${failed ? `FAIL (${failed})` : "PASS"}: ${results.filter((r) => r.status === "pass").length} passed, ${failed} failed, ${results.filter((r) => r.status === "skip").length} skipped · store=${storeMode} device=${deviceName} deletion=${deletionOn ? "on" : "off"}`,
);
process.exit(failed ? 1 : 0);
