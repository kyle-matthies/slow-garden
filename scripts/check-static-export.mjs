// Signed-out shell check of the static export (ADR-009 stage 3).
//
// Build:  cd applications/web && GARDEN_STATIC_EXPORT=1 NEXT_PUBLIC_SUPABASE_URL=…
//         NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=… npx next build      (writes out/)
// Serve:  python3 -m http.server 3171 --bind 127.0.0.1 -d applications/web/out
// Check:  STATIC_BASE=http://127.0.0.1:3171 node scripts/check-static-export.mjs
//
// No backend is needed and none is contacted: nobody signs in. It checks that
// the landing page, sign-in and the garden shell load from plain files, that
// moving between them does not load a new document, that the server-only
// routes are absent, and that the document's own content policy is enforced.
// Signed-in journeys against the export are scripts/test-web-journeys.mjs with
// GARDEN_TEST_STORE=browser GARDEN_TEST_SESSION=storage.
//
//   STATIC_BASE       the static file server (loopback only; default :3171)
//   STATIC_ARTIFACTS  directory for screenshots (default: none taken)
//   AXE_CHROMIUM      a preinstalled Chromium when Playwright's own is absent
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

function loadPlaywright() {
  for (const from of [
    new URL("../applications/web/accessibility/package.json", import.meta.url),
    import.meta.url,
  ]) {
    const require = createRequire(from);
    for (const name of ["@playwright/test", "playwright"])
      try {
        return require(name);
      } catch {}
  }
  throw new Error("Playwright is not installed.");
}
const { chromium } = loadPlaywright();

const base = process.env.STATIC_BASE ?? "http://127.0.0.1:3171";
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):\d+$/, "loopback only");
const artifacts = process.env.STATIC_ARTIFACTS ? path.resolve(process.env.STATIC_ARTIFACTS) : null;
if (artifacts) await mkdir(artifacts, { recursive: true });
const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "desktop", width: 1440, height: 900 },
];

const browser = await chromium.launch(
  process.env.AXE_CHROMIUM ? { executablePath: process.env.AXE_CHROMIUM } : {},
);
console.log(`# static export · ${base} · chromium ${browser.version()} · node ${process.version}`);
let failed = 0;

for (const viewport of VIEWPORTS) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
  context.setDefaultTimeout(15000);
  const page = await context.newPage();
  const documents = [];
  const offOrigin = [];
  const notGet = [];
  const errors = [];
  page.on("request", (r) => {
    if (r.resourceType() === "document") documents.push(new URL(r.url()).pathname);
    if (!r.url().startsWith(base) && !/^(data|blob):/.test(r.url())) offOrigin.push(new URL(r.url()).origin);
    // Next's router also sends HEAD to a page's own file before moving to it.
    if (r.url().startsWith(base) && !["GET", "HEAD"].includes(r.method()))
      notGet.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const missing = [];
  page.on("response", (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${new URL(r.url()).pathname}`);
  });
  page.on("console", (m) => m.type() === "error" && errors.push(m.text().slice(0, 200)));
  page.on("pageerror", (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));
  const ok = (text) => console.log(`  ok   ${text}`);
  const shot = async (name) =>
    artifacts && page.screenshot({ path: path.join(artifacts, `static-${viewport.name}-${name}.png`) });
  const fits = async (where) =>
    assert.ok(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${where}: no sideways scroll`,
    );
  const heading = (name, level) => page.getByRole("heading", { name, level });
  const settled = () => page.waitForLoadState("networkidle");

  console.log(`\n## ${viewport.name} ${viewport.width}x${viewport.height}`);
  try {
    // Landing.
    await page.goto(`${base}/`);
    await heading("What the AI will never do.", 2).waitFor();
    await settled();
    await fits("landing");
    await shot("landing");
    const policy = await page.locator('head meta[http-equiv="Content-Security-Policy"]').getAttribute("content");
    assert.match(policy ?? "", /default-src 'self'/);
    assert.match(policy ?? "", /connect-src 'self' \S+/);
    assert.equal(await page.locator('head meta[name="referrer"]').getAttribute("content"), "no-referrer");
    ok("landing loads from a file; the content policy and referrer policy are in the document head");

    // Landing -> sign-in -> landing, without a new document.
    const before = documents.length;
    await page.getByRole("link", { name: "Sign in", exact: true }).click();
    await heading("Sign in to your garden", 2).waitFor();
    assert.equal(new URL(page.url()).pathname, "/login/");
    await page.getByLabel("Email address").waitFor();
    assert.ok(await page.getByRole("button", { name: "Email me a sign-in code" }).isEnabled());
    await fits("sign-in");
    await shot("login");
    // The sign-in screen shares the landing page's headline, so wait on a landing-only one.
    await page.getByRole("link", { name: "Slow Garden" }).first().click();
    await heading("What the AI will never do.", 2).waitFor();
    assert.equal(new URL(page.url()).pathname, "/");
    await page.getByRole("link", { name: "Start your garden" }).first().click();
    await heading("Sign in to your garden", 2).waitFor();
    assert.equal(documents.length, before, "no document was loaded while moving between pages");
    ok("landing -> sign-in -> landing -> sign-in in the browser: 0 new documents; the form is enabled");

    // Sign-in opened directly.
    await page.goto(`${base}/login/`);
    await heading("Sign in to your garden", 2).waitFor();
    ok("sign-in loads directly from its own file");

    // The garden shell, signed out: loading state, then sign-in in place.
    for (const address of ["/garden/", "/garden/?garden=00000000-0000-4000-8000-000000000001&view=list", "/garden/import/"]) {
      await page.goto(base + address);
      await page.getByLabel("Email address").waitFor();
      assert.equal(new URL(page.url()).pathname, address.split("?")[0], "the address asked for is kept");
      assert.equal(await page.locator(".journal-entry, .bed-card, .garden-scene").count(), 0);
      await fits(address);
    }
    await shot("garden-signed-out");
    assert.match(
      await (await page.request.get(`${base}/garden/`)).text(),
      /Gathering what you left here/,
      "the garden file holds only the loading state",
    );
    ok("/garden/, a garden address with a query, and /garden/import/ load the shell and show sign-in in place");

    // A path without the trailing slash (what the app's own links use).
    await page.goto(`${base}/garden?view=list`);
    await page.getByLabel("Email address").waitFor();
    assert.equal(new URL(page.url()).pathname, "/garden/");
    assert.equal(new URL(page.url()).search, "?view=list");
    ok("/garden?view=list is answered by the file server's own directory redirect, query kept");

    // Account-deleted page, and back to the landing page in the browser.
    await page.goto(`${base}/account/deleted/`);
    await heading("Your account is deleted.", 1).waitFor();
    const beforeBack = documents.length;
    await page.getByRole("link", { name: "Back to Slow Garden" }).click();
    await heading("What the AI will never do.", 2).waitFor();
    assert.equal(documents.length, beforeBack);
    ok("/account/deleted/ loads; its way back is a browser navigation");

    // What the hosted app answers from its server is absent here.
    for (const gone of ["/garden/export", "/garden/history?entry=x", "/api/health", "/dev/axe-fixtures", "/garden/meadow-preview"])
      assert.equal((await page.request.get(base + gone, { maxRedirects: 0 })).status(), 404, gone);
    ok("no export, history or health route, and no fixture or preview page, exists in the export");

    assert.deepEqual(notGet, [], "only GET and HEAD requests reach the file server");
    assert.deepEqual(missing, [], "every file the pages asked for exists");
    assert.deepEqual([...new Set(offOrigin)], [], "signed out, nothing is requested from another origin");
    assert.equal((await context.cookies()).length, 0, "no cookie is set");
    assert.deepEqual(errors, [], "no console error");
    ok(`signed out: ${documents.length} documents, 0 requests other than GET or HEAD, 0 missing files, 0 requests to another origin, 0 cookies, 0 console errors`);

    // The policy in the document is enforced, not just present.
    const violation = await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.addEventListener("securitypolicyviolation", (e) => resolve(e.effectiveDirective), { once: true });
          fetch("https://policy-check.invalid/").catch(() => {});
          setTimeout(() => resolve(null), 3000);
        }),
    );
    assert.equal(violation, "connect-src");
    ok("a request to an origin outside connect-src is blocked by the document's policy");
    console.log(`PASS ${viewport.name}`);
  } catch (error) {
    failed++;
    console.log(`FAIL ${viewport.name}: ${String(error?.message ?? error).split("\n").slice(0, 5).join("\n     ")}`);
    if (errors.length) console.log(`     console: ${[...new Set(errors)].slice(0, 4).join(" | ")}`);
    await shot("failure").catch(() => {});
  }
  await context.close();
}
await browser.close();
console.log(`\n${failed ? `FAIL (${failed})` : "PASS"}: static export shell, ${VIEWPORTS.length - failed}/${VIEWPORTS.length} viewports`);
process.exit(failed ? 1 : 0);
