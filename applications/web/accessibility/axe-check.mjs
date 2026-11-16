// Accessibility receipt harness for Slow Garden web.
// Boots `next dev` with GARDEN_AXE_FIXTURES=1 (no Supabase env), runs axe-core
// across fixture states, color schemes and viewports, checks overflow and 44px
// touch targets on the touch viewports, a 200%-zoom proxy, and records contrast
// + screenshot receipts.
// Fixture ids duplicated from src/app/dev/axe-fixtures/fixture.ts — keep in sync.
import { spawn } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
// AXE_RECEIPTS writes a new receipt set elsewhere instead of replacing 08's.
const receipts = process.env.AXE_RECEIPTS
  ? path.resolve(process.env.AXE_RECEIPTS)
  : path.resolve(here, "../../../documents/initiatives/receipts/08");
// AXE_BASE checks a fixture server that is already running (GARDEN_AXE_FIXTURES=1)
// instead of booting one on :3211, e.g. AXE_BASE=http://localhost:3147.
const EXTERNAL = process.env.AXE_BASE?.replace(/\/$/, "");
const BASE = EXTERNAL || "http://localhost:3211";
const PLOT = "00000000-0000-4000-8000-000000000100";
const SEED = "00000000-0000-4000-8000-000000001000";
// A synthetic tended garden: 100 thoughts, unseen blooms, marks.
const TENDED = "/dev/axe-fixtures?state=scale&thoughts=100";

// The morning reveal covers part of the page until it is dismissed.
async function dismissReveal(page) {
  await page.getByRole("button", { name: "Dismiss and mark as seen" }).click();
  await page.locator(".morning-return").waitFor({ state: "detached" });
}

// Phones fold secondary tools behind "More"; open it first when it is showing.
async function openSettings(page) {
  const more = page.getByRole("button", { name: "More" });
  if (await more.isVisible()) await more.click();
  await page.getByRole("button", { name: "Settings & export" }).click();
}

// Entrance animations fade content in; measure colours once they have landed.
// Looping animations never finish, so the wait is capped.
async function settle(page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.allSettled(
        document
          .getAnimations()
          .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
          .map((a) => a.finished),
      ),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]),
  );
}

const STATES = [
  ["landing", "/"],
  ["login", "/login"],
  ["error", "/dev/axe-fixtures?state=error"],
  ["loading", "/dev/axe-fixtures?state=loading"],
  ["garden-first-run", "/dev/axe-fixtures?state=first-run"],
  // First run with a seed pack opened: its topics and questions are showing.
  [
    "garden-first-run-pack",
    "/dev/axe-fixtures?state=first-run",
    async (page) => {
      await page.locator(".seed-packet").first().click();
      await page.locator(".seed-beds").first().waitFor();
    },
  ],
  ["garden-import", "/dev/axe-fixtures?state=import"],
  // The living garden scene (D-022) is the default overview.
  ["garden-overview", "/dev/axe-fixtures"],
  ["garden-resume", "/dev/axe-fixtures", async (page) => {
    await page.locator(".recent-writing > summary").click();
  }],
  ["garden-topic", `/dev/axe-fixtures?topic=${PLOT}`],
  ["garden-focus", `/dev/axe-fixtures?focus=${SEED}`],
  // Pages: the same garden on paper, one layout per level.
  ["garden-list", "/dev/axe-fixtures?view=list"],
  ["garden-topic-list", `/dev/axe-fixtures?topic=${PLOT}&view=list`],
  ["garden-thought-list", `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}&view=list`],
  // The thought page over the Meadow backdrop.
  ["garden-thought", `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}`],
  // Returns: the latest blooms, then the full record opened in place.
  ["garden-returns", `${TENDED}&view=returns`],
  ["garden-returns-empty", "/dev/axe-fixtures?view=returns"],
  [
    "garden-returns-record",
    `${TENDED}&view=returns`,
    async (page) => {
      await page.getByRole("button", { name: "Open the full record" }).click();
      await page.locator(".cabinet-header").waitFor();
    },
  ],
  // The morning reveal: unseen blooms announced once, over Meadow and in Pages.
  ["morning-reveal", TENDED],
  ["morning-reveal-list", `${TENDED}&view=list`],
  ["garden-archive", "/dev/axe-fixtures?view=archive"],
  ["garden-ring", "/dev/axe-fixtures?view=gardens"],
  // Many gardens: a ring of 24 (the owner's 20+ requirement).
  ["garden-ring-24", "/dev/axe-fixtures?state=scale&thoughts=100&gardens=24&view=gardens"],
  // Phone cap: beds over 14 plants show "+N more in Pages". The reveal is
  // dismissed first so the whole scene is checked, as before it existed.
  ["garden-scale", TENDED, dismissReveal],
  ["garden-scale-list", `${TENDED}&view=list`, dismissReveal],
  ["cabinet", "/garden/returns-preview?scene=three-blooms"],
  // The writing page with the caret in it (on a phone the tab bar steps aside).
  [
    "garden-write",
    `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}&view=list`,
    async (page) => {
      await page.getByRole("textbox", { name: "New entry", exact: true }).focus();
    },
  ],
  // Deletion (fixture flag only): the dialog open for one entry, and for the
  // account from Settings. The fixture has no backend, so the dialog shows its
  // "could not count" message; nothing can be erased.
  [
    "garden-delete-entry",
    `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}&view=list`,
    async (page) => {
      await page.getByRole("button", { name: "Delete entry…" }).first().click();
      await page.locator("dialog.delete-dialog[open]").waitFor();
    },
  ],
  [
    "garden-delete-account",
    "/dev/axe-fixtures?view=list",
    async (page) => {
      await openSettings(page);
      await page.getByRole("button", { name: "Delete account…" }).click();
      await page.locator("dialog.delete-dialog[open]").waitFor();
    },
  ],
  // The "More" menu, open over the scene: a dropdown on wide screens, a sheet
  // above the tab bar on a phone, beside the rail in short landscape.
  [
    "garden-menu",
    "/dev/axe-fixtures",
    async (page) => {
      const more = page.getByRole("button", { name: "More" });
      if (await more.isVisible()) await more.click();
    },
  ],
  // Settings, including the overnight tending preference (ADR-008), open in place.
  [
    "garden-settings",
    "/dev/axe-fixtures?view=list",
    openSettings,
  ],
  // Topic settings: the three-state tending control, opened.
  [
    "garden-topic-settings",
    `/dev/axe-fixtures?topic=${PLOT}&view=list`,
    async (page) => {
      await page.locator(".plot-permissions > summary").click();
    },
  ],
];
// AXE_STATES=garden-ring,morning-reveal reruns only those states while fixing
// them. A partial run never replaces the contrast receipt.
const ONLY = process.env.AXE_STATES?.split(",").map((s) => s.trim()).filter(Boolean);
// States whose route exists only in development (it answers the not-found page
// in a production build). Against a production build they are skipped, and
// said to be, instead of checking the not-found page under their name.
const DEV_ONLY = new Map([["cabinet", "/garden/returns-preview?scene=three-blooms"]]);
const skipped = new Set();
const wanted = (state) => (!ONLY || ONLY.includes(state)) && !skipped.has(state);
// Findings reported as warnings instead of failures. Keep empty unless a finding is
// tracked in an initiative record with an owner.
const KNOWN_ISSUES = new Set();

const SHOT_STATES = new Set([
  "landing",
  "login",
  "garden-overview",
  "garden-resume",
  "garden-focus",
  "garden-list",
  "garden-topic-list",
  "garden-thought",
  "garden-thought-list",
  "garden-returns",
  "garden-returns-record",
  "morning-reveal",
  "morning-reveal-list",
  "garden-first-run",
  "garden-first-run-pack",
  "garden-delete-entry",
  "garden-delete-account",
  "garden-ring",
  "garden-ring-24",
  "garden-scale",
  "cabinet",
  "garden-settings",
  "garden-menu",
  "error",
]);
const SCHEMES = ["light", "dark"];
// Touch viewports get the overflow and 44px target checks as well as axe.
const VIEWPORTS = [
  { name: "360", width: 360, height: 740, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "390", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "844x390", width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "1280", width: 1280, height: 800, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
];
// Receipt screenshots stay at the two sizes they have always had.
const SHOT_VIEWPORTS = new Set(["390", "1280"]);
// AXE_VIEWPORTS=360,844x390 reruns only those viewports.
const ONLY_VIEWPORTS = process.env.AXE_VIEWPORTS?.split(",").map((s) => s.trim()).filter(Boolean);

// Touch targets (WCAG 2.5.5 at the product's 44px bar, AGENTS/TEAM rules).
// Returns "selector WxH" for every visible control smaller than 44x44 CSS px.
// Not counted, as in the mobile-first audit of 2026-11-16:
//  - links inside a sentence (WCAG's inline exception) and screen-reader-only
//    or skip links;
//  - a radio or checkbox inside a label: the label is the target;
//  - Meadow plants, whose target is a centred 44px ::after, not the drawing;
//  - controls on a ring card that is not the selected one (audit item 30):
//    they are the 3D-scaled copy of a 44px control on a card waiting to one
//    side; the selected card and the dock are full size.
const TARGET_EXCEPTION = ".ring-card:not(.is-selected) *";
// AXE_TARGET_MIN=60 proves the check bites; the bar is 44.
const TARGET_MIN = Number(process.env.AXE_TARGET_MIN) || 44;
const smallTargets = (page) =>
  page.evaluate(({ exception, min }) => {
    const seen = (el) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return (
        r.width > 0 && r.height > 0 &&
        s.visibility !== "hidden" && s.display !== "none" && +s.opacity > 0.05 &&
        r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth
      );
    };
    const name = (el) =>
      `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 28)}"`;
    const small = [];
    const modal = document.querySelector("dialog[open]");
    for (const el of document.querySelectorAll(
      "button, a[href], summary, input:not([type=hidden]), select, textarea, [role=button]",
    )) {
      if (!seen(el) || el.disabled) continue;
      // A modal dialog makes the page behind it inert.
      if (modal && !modal.contains(el)) continue;
      if (el.closest(".sr-only, .skip-link") || el.matches(exception)) continue;
      let r = el.getBoundingClientRect();
      if ((el.type === "radio" || el.type === "checkbox") && el.closest("label"))
        r = el.closest("label").getBoundingClientRect();
      const inline =
        el.tagName === "A" &&
        getComputedStyle(el).display === "inline" &&
        el.parentElement &&
        el.parentElement.textContent.trim().length > el.textContent.trim().length + 12;
      if (inline) continue;
      let { width, height } = r;
      if (el.matches("button.scene-plant") && getComputedStyle(el, "::after").content !== "none") {
        width = Math.max(width, 44);
        height = Math.max(height, 44);
      }
      if (width < min - 0.5 || height < min - 0.5)
        small.push(`${name(el)} ${Math.round(width)}x${Math.round(height)}`);
    }
    return small;
  }, { exception: TARGET_EXCEPTION, min: TARGET_MIN });
const CONTRAST = [
  {
    state: "landing",
    url: "/",
    token: "--paper",
    selectors: [
      ".eyebrow",
      ".landing-hero h1",
      ".landing-lede",
      ".primary-button",
      ".text-link",
      ".quiet-link",
      ".landing-privacy article p",
      ".landing-section-intro p:not(.eyebrow)",
      ".landing-steps li p",
      ".landing-never-list li p",
      ".landing-signin-note",
      ".landing-example-disclosure",
    ],
  },
  {
    state: "login",
    url: "/login",
    token: "--paper",
    selectors: [
      ".calm-copy > p",
      ".calm-steps li",
      ".panel-kicker",
      ".field label",
      ".status-message",
      ".form-note",
    ],
  },
  {
    state: "garden-thought",
    url: `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}`,
    token: "--thought-bg",
    selectors: [
      // The depth trail replaced the topic rail: every ancestor is a button.
      ".garden-breadcrumb button",
      ".level-trail-back",
      ".level-trail-level",
      ".level-trail-here .level-trail-name",
      ".specimen-label .level-eyebrow",
      ".specimen-facts dt",
      ".specimen-facts dd",
      ".entry-page .level-eyebrow",
      ".entry-revision",
      ".journal-entry time",
      ".entry-body",
      ".writing-form textarea",
      ".garden-foot",
    ],
  },
  {
    state: "garden-list",
    url: "/dev/axe-fixtures?view=list",
    token: "--garden-bg",
    selectors: [
      ".garden-banner .level-eyebrow",
      ".garden-banner-meta",
      ".level-section-title",
      ".level-section-title span",
      ".bed-card-level",
      ".bed-card-name",
      ".bed-card .bed-meta",
      ".bed-card .tending-chip",
      ".view-toggle button[aria-pressed='true']",
      ".view-toggle button[aria-pressed='false']",
      ".top-link",
    ],
  },
  {
    // Thought cards moved from the garden overview to the topic page.
    state: "garden-topic-list",
    url: `/dev/axe-fixtures?topic=${PLOT}&view=list`,
    token: "--garden-bg",
    selectors: [
      ".bed-header .level-eyebrow",
      ".bed-header .bed-meta",
      ".bed-header .tending-chip",
      ".plant-label",
      ".seed-plant small",
      ".plot-permissions summary",
    ],
  },
  {
    state: "garden-topic-settings",
    url: `/dev/axe-fixtures?topic=${PLOT}&view=list`,
    open: async (page) => {
      await page.locator(".plot-permissions > summary").click();
    },
    token: "--garden-bg",
    selectors: [
      ".tending-choice legend",
      ".tending-choice strong",
      ".tending-choice small",
      ".plot-permissions > p",
    ],
  },
  {
    state: "garden-returns",
    url: `${TENDED}&view=returns`,
    token: "--garden-bg",
    selectors: [
      ".returns-eyebrow",
      ".returns-header > p:not([class])",
      ".returns-tended",
      ".returns-bloom-kind",
      ".returns-new",
      ".returns-bloom-text",
      ".returns-bloom-sources",
      ".returns-bloom-sources button",
      ".returns-cabinet-host > p",
      ".level-trail-here .level-trail-name",
    ],
  },
  {
    state: "garden-returns-empty",
    url: "/dev/axe-fixtures?view=returns",
    token: "--garden-bg",
    selectors: [".returns-empty"],
  },
  {
    state: "morning-reveal-list",
    url: `${TENDED}&view=list`,
    token: "--garden-bg",
    selectors: [
      ".morning-return-kicker",
      ".morning-return h2",
      ".morning-return-kind",
      ".morning-return-line",
      ".morning-return-touches-label",
      ".morning-return-thought",
      ".morning-return-open",
      ".morning-return-dismiss",
    ],
  },
  {
    state: "garden-overview",
    url: "/dev/axe-fixtures",
    token: "--sheet",
    selectors: [
      ".scene-title h1",
      ".scene-kicker",
      ".bed-sign-name",
      ".bed-sign-count",
      ".dock-chip",
      ".view-toggle button",
    ],
  },
  {
    state: "garden-ring",
    url: "/dev/axe-fixtures?view=gardens",
    token: "--sheet",
    selectors: [".ring-title h1", ".ring-name", ".ring-meta"],
  },
  {
    state: "cabinet",
    url: "/garden/returns-preview?scene=three-blooms",
    token: "--cabinet-bg",
    selectors: [
      ".cabinet-interpretation",
      ".cabinet-clipping-body",
      ".cabinet-clipping-caption",
      ".pressed-specimen figcaption",
    ],
  },
  {
    state: "garden-settings",
    url: "/dev/axe-fixtures?view=list",
    open: openSettings,
    token: "--garden-bg",
    selectors: [".tending-settings h3", ".tending-settings p", ".tending-toggle"],
  },
  {
    state: "garden-focus",
    url: `/dev/axe-fixtures?focus=${SEED}`,
    token: "--sheet",
    selectors: [".focus-body h2", ".focus-meta", ".slip p", ".slip time"],
  },
];

mkdirSync(receipts, { recursive: true });

function cleanEnv() {
  const env = { ...process.env, GARDEN_AXE_FIXTURES: "1" };
  for (const key of Object.keys(env))
    if (/SUPABASE|GARDEN_AI/i.test(key)) delete env[key];
  return env;
}

const server = EXTERNAL
  ? null
  : spawn("npx", ["next", "dev", "-p", "3211"], {
      cwd: webDir,
      env: cleanEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
server?.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE);
      if (res.status) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no fixture server answered at ${BASE}`);
}

async function shot(page, file) {
  const png = path.join(receipts, `${file}.png`);
  await page.screenshot({ path: png, fullPage: true });
  if (statSync(png).size > 400 * 1024) {
    unlinkSync(png);
    await page.screenshot({
      path: path.join(receipts, `${file}.jpg`),
      fullPage: true,
      type: "jpeg",
      quality: 70,
    });
  }
}

let failures = 0;
let targetChecks = 0;
const warnings = [];
const contrastRows = [];

try {
  await waitForServer();
  // AXE_CHROMIUM points at a preinstalled browser when Playwright's own is absent.
  const browser = await chromium.launch(
    process.env.AXE_CHROMIUM ? { executablePath: process.env.AXE_CHROMIUM } : {},
  );

  const overflowCheck = async (page, label) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (over > 0) {
      failures++;
      console.error(`OVERFLOW ${label}: scrollWidth exceeds innerWidth by ${over}px`);
    }
  };

  for (const [state, url] of DEV_ONLY) {
    if (!wanted(state)) continue;
    const res = await fetch(`${BASE}${url}`);
    if (res.status === 404 || !(await res.text()).includes("cabinet")) {
      skipped.add(state);
      console.log(`SKIP ${state}: ${url.split("?")[0]} is development-only and is not served by this build`);
    }
  }
  for (const [state, url, open] of STATES.filter(([state]) => wanted(state))) {
    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        if (ONLY_VIEWPORTS && !ONLY_VIEWPORTS.includes(vp.name)) continue;
        const ctx = await browser.newContext({
          colorScheme: scheme,
          viewport: { width: vp.width, height: vp.height },
          isMobile: vp.isMobile,
          hasTouch: vp.hasTouch,
          deviceScaleFactor: vp.deviceScaleFactor,
        });
        const page = await ctx.newPage();
        await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
        // Hide the Next.js dev-tools badge before anything is opened: in short
        // landscape it sits over the rail's last item, and receipts show only
        // the app.
        await page.addStyleTag({
          content: "nextjs-portal{display:none!important}",
        });
        await open?.(page);
        await settle(page);
        const res = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "best-practice"])
          .analyze();
        const bad = res.violations.filter((v) => {
          if (
            (v.impact !== "serious" && v.impact !== "critical") ||
            [...KNOWN_ISSUES].some((k) => {
              const [id, sel] = k.split(":");
              return (
                v.id === id && v.nodes.every((n) => n.target.join(" ") === sel)
              );
            })
          )
            return false;
          return true;
        });
        const known = res.violations.filter(
          (v) =>
            (v.impact === "serious" || v.impact === "critical") &&
            [...KNOWN_ISSUES].some((k) => {
              const [id, sel] = k.split(":");
              return (
                v.id === id && v.nodes.every((n) => n.target.join(" ") === sel)
              );
            }),
        );
        for (const v of known)
          warnings.push(
            `[${state}/${scheme}/${vp.name}] KNOWN serious ${v.id}: ${v.nodes[0]?.target ?? ""} (fix requires garden/workspace.tsx)`,
          );
        const mild = res.violations.filter(
          (v) => v.impact === "moderate" || v.impact === "minor",
        );
        for (const v of bad) {
          failures++;
          console.error(
            `AXE ${v.impact} [${state}/${scheme}/${vp.name}] ${v.id}: ${v.help} (${v.nodes.length} nodes) ${v.nodes[0]?.target}`,
          );
        }
        for (const v of mild)
          warnings.push(
            `[${state}/${scheme}/${vp.name}] ${v.impact} ${v.id}: ${v.nodes[0]?.target ?? ""}`,
          );
        console.log(
          `${state}/${scheme}/${vp.name}: ${bad.length} serious/critical, ${mild.length} moderate/minor`,
        );
        if (vp.hasTouch) {
          await overflowCheck(page, `${state}/${scheme}/${vp.name}`);
          const small = await smallTargets(page);
          targetChecks++;
          if (small.length) {
            failures++;
            console.error(
              `TARGET [${state}/${scheme}/${vp.name}] ${small.length} under ${TARGET_MIN}px: ${small.slice(0, 6).join("; ")}`,
            );
          }
        }
        if (SHOT_STATES.has(state) && SHOT_VIEWPORTS.has(vp.name))
          await shot(page, `${state}-${scheme}-${vp.name}`);
        await ctx.close();
      }
    }
  }

  // 200% zoom proxy: 640x400 CSS px at desktop scale.
  for (const [state, url] of [
    ["landing", "/"],
    ["login", "/login"],
    ["garden-thought", `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}`],
    ["garden-thought-list", `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}&view=list`],
    ["garden-returns", `${TENDED}&view=returns`],
    ["morning-reveal-list", `${TENDED}&view=list`],
  ].filter(([state]) => wanted(state))) {
    const ctx = await browser.newContext({
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
    await page.addStyleTag({
      content: "nextjs-portal{display:none!important}",
    });
    await overflowCheck(page, `${state}/zoom200`);
    const h1 = page.locator("h1").first();
    const btn = page.locator(".primary-button").first();
    if (!(await h1.isVisible())) {
      failures++;
      console.error(`ZOOM ${state}: h1 not visible at 200% proxy`);
    }
    if ((await btn.count()) && !(await btn.isVisible())) {
      failures++;
      console.error(`ZOOM ${state}: .primary-button not visible at 200% proxy`);
    }
    if (state !== "login") await shot(page, `${state}-zoom200`);
    await ctx.close();
  }

  // Contrast receipts at 1280 in both schemes.
  for (const scheme of SCHEMES) {
    for (const block of CONTRAST.filter((block) => wanted(block.state))) {
      // A fresh browser profile per state: first-view receipts kept in
      // localStorage must not hide the morning reveal from a later state.
      const ctx = await browser.newContext({
        colorScheme: scheme,
        viewport: { width: 1280, height: 800 },
      });
      const page = await ctx.newPage();
      await page.goto(`${BASE}${block.url}`, { waitUntil: "networkidle" });
      await block.open?.(page);
      await settle(page);
      for (const sel of block.selectors) {
        const rows = await page.evaluate(
          ({ sel, token }) => {
            const parse = (c) => {
              const m = c.match(/rgba?\(([^)]+)\)/);
              if (!m) return null;
              const [r, g, b, a = "1"] = m[1].split(",").map((x) => x.trim());
              return { r: +r, g: +g, b: +b, a: +a };
            };
            const lum = ({ r, g, b }) => {
              const f = (v) => {
                v /= 255;
                return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
              };
              return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
            };
            const el = document.querySelector(sel);
            if (!el) return null;
            const cs = getComputedStyle(el);
            const fg = parse(cs.color);
            let node = el;
            let bg = null;
            let note = "";
            while (node) {
              const s = getComputedStyle(node);
              const c = parse(s.backgroundColor);
              if (c && c.a > 0) {
                bg = c;
                break;
              }
              if (s.backgroundImage !== "none") {
                note = "over gradient";
                break;
              }
              node = node.parentElement;
            }
            if (!bg) {
              const v = getComputedStyle(document.documentElement)
                .getPropertyValue(token)
                .trim();
              if (v.startsWith("#")) {
                const n = parseInt(v.slice(1), 16);
                bg = { r: n >> 16, g: (n >> 8) & 255, b: n & 255, a: 1 };
              }
              if (!note) note = "over gradient";
            }
            if (!fg || !bg) return { sel, error: "unresolved color" };
            // Composite translucent bg over page token.
            let eff = bg;
            if (bg.a < 1) {
              const v = getComputedStyle(document.documentElement)
                .getPropertyValue(token)
                .trim();
              const n = parseInt(v.slice(1), 16);
              const base = { r: n >> 16, g: (n >> 8) & 255, b: n & 255 };
              eff = {
                r: bg.a * bg.r + (1 - bg.a) * base.r,
                g: bg.a * bg.g + (1 - bg.a) * base.g,
                b: bg.a * bg.b + (1 - bg.a) * base.b,
              };
            }
            const l1 = lum(fg);
            const l2 = lum(eff);
            const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
            const size = parseFloat(cs.fontSize);
            const large =
              size >= 24 || (size >= 18.66 && parseInt(cs.fontWeight) >= 700);
            return {
              sel,
              fg: cs.color,
              bg: `rgb(${Math.round(eff.r)},${Math.round(eff.g)},${Math.round(eff.b)})`,
              ratio: Math.round(ratio * 100) / 100,
              threshold: large ? 3 : 4.5,
              note,
            };
          },
          { sel, token: block.token },
        );
        const row = rows ?? { sel, error: "element not found" };
        const passes = !row.error && row.ratio >= row.threshold;
        if (row.error || !passes) {
          failures++;
          console.error(
            `CONTRAST FAIL ${block.state}/${scheme} ${sel}: ${row.error ?? `${row.ratio}:1 < ${row.threshold}:1`}`,
          );
        }
        contrastRows.push({
          state: block.state,
          scheme,
          selector: sel,
          fg: row.fg ?? "-",
          bg: row.bg ?? "-",
          ratio: row.ratio ?? 0,
          passesAA: passes,
          note: row.note ?? "",
        });
      }
      await ctx.close();
    }
  }

  await browser.close();
} finally {
  if (server)
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      server.kill("SIGTERM");
    }
}

if (!ONLY && !ONLY_VIEWPORTS && !skipped.size) writeFileSync(
  path.join(receipts, "contrast.json"),
  JSON.stringify(
    contrastRows.map(({ state, scheme, selector, fg, bg, ratio, passesAA }) => ({
      state,
      scheme,
      selector,
      fg,
      bg,
      ratio,
      passesAA,
    })),
    null,
    2,
  ),
);

console.log("\n| state | scheme | selector | fg | bg | ratio | AA |");
console.log("|---|---|---|---|---|---|---|");
for (const r of contrastRows)
  console.log(
    `| ${r.state} | ${r.scheme} | ${r.selector} | ${r.fg} | ${r.bg} | ${r.ratio} | ${r.passesAA ? "pass" : "FAIL"} |`,
  );
if (warnings.length) {
  console.log("\nWarnings (moderate/minor):");
  for (const w of warnings) console.log(`  ${w}`);
}
console.log(`\n44px target check: ${targetChecks} touch-viewport state runs.`);
console.log(
  `\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: axe-check complete`,
);
process.exit(failures ? 1 : 0);
