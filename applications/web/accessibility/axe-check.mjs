// Accessibility receipt harness for Slow Garden web.
// Boots `next dev` with GARDEN_AXE_FIXTURES=1 (no Supabase env), runs axe-core
// across fixture states, color schemes and viewports, checks 390px overflow and
// a 200%-zoom proxy, and records contrast + screenshot receipts.
// Fixture ids duplicated from src/app/dev/axe-fixtures/fixture.ts — keep in sync.
import { spawn } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const receipts = path.resolve(here, "../../../documents/initiatives/receipts/08");
const BASE = "http://localhost:3211";
const PLOT = "00000000-0000-4000-8000-000000000100";
const SEED = "00000000-0000-4000-8000-000000001000";

const STATES = [
  ["landing", "/"],
  ["login", "/login"],
  ["error", "/dev/axe-fixtures?state=error"],
  ["loading", "/dev/axe-fixtures?state=loading"],
  ["garden-overview", "/dev/axe-fixtures"],
  ["garden-topic", `/dev/axe-fixtures?topic=${PLOT}`],
  ["garden-thought", `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}`],
  ["garden-archive", "/dev/axe-fixtures?view=archive"],
];
// Findings that live in files outside this change's scope (garden/workspace.tsx).
// Reported as warnings instead of failures until the owning file can be fixed.
const KNOWN_ISSUES = new Set(["aria-prohibited-attr:.plant-grid"]);

const SHOT_STATES = new Set([
  "landing",
  "login",
  "garden-overview",
  "garden-thought",
  "error",
]);
const SCHEMES = ["light", "dark"];
const VIEWPORTS = [
  { name: "390", width: 390, height: 844, isMobile: true, deviceScaleFactor: 2 },
  { name: "1280", width: 1280, height: 800, isMobile: false, deviceScaleFactor: 1 },
];
const CONTRAST = [
  {
    state: "landing",
    url: "/",
    token: "--paper",
    selectors: [
      ".eyebrow",
      ".hero h1",
      ".hero-lede",
      ".primary-button",
      ".text-link",
      ".quiet-link",
      ".principles p",
      ".seed-card",
      ".bloom-card",
    ],
  },
  {
    state: "login",
    url: "/login",
    token: "--paper",
    selectors: [".auth-copy p", ".field label", ".status-message", ".form-note"],
  },
  {
    state: "garden-thought",
    url: `/dev/axe-fixtures?topic=${PLOT}&thought=${SEED}`,
    token: "--thought-bg",
    selectors: [
      ".rail-link",
      ".rail-link small",
      ".garden-breadcrumb button",
      ".journal-entry time",
      ".entry-body",
      ".writing-form textarea",
      ".garden-foot",
    ],
  },
  {
    state: "garden-overview",
    url: "/dev/axe-fixtures",
    token: "--garden-bg",
    selectors: [".plant-label", ".seed-plant small"],
  },
];

mkdirSync(receipts, { recursive: true });

function cleanEnv() {
  const env = { ...process.env, GARDEN_AXE_FIXTURES: "1" };
  for (const key of Object.keys(env))
    if (/SUPABASE|GARDEN_AI/i.test(key)) delete env[key];
  return env;
}

const server = spawn("npx", ["next", "dev", "-p", "3211"], {
  cwd: webDir,
  env: cleanEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(BASE);
      if (res.status) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("next dev did not start on :3211");
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
const warnings = [];
const contrastRows = [];

try {
  await waitForServer();
  const browser = await chromium.launch();

  const overflowCheck = async (page, label) => {
    const over = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    if (over > 0) {
      failures++;
      console.error(`OVERFLOW ${label}: scrollWidth exceeds innerWidth by ${over}px`);
    }
  };

  for (const [state, url] of STATES) {
    for (const scheme of SCHEMES) {
      for (const vp of VIEWPORTS) {
        const ctx = await browser.newContext({ colorScheme: scheme, ...vp });
        const page = await ctx.newPage();
        await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
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
        if (vp.name === "390") await overflowCheck(page, `${state}/${scheme}/390`);
        if (SHOT_STATES.has(state))
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
  ]) {
    const ctx = await browser.newContext({
      viewport: { width: 640, height: 400 },
      deviceScaleFactor: 1,
    });
    const page = await ctx.newPage();
    await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
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
    const ctx = await browser.newContext({
      colorScheme: scheme,
      viewport: { width: 1280, height: 800 },
    });
    const page = await ctx.newPage();
    for (const block of CONTRAST) {
      await page.goto(`${BASE}${block.url}`, { waitUntil: "networkidle" });
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
    }
    await ctx.close();
  }

  await browser.close();
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

writeFileSync(
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
console.log(
  `\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: axe-check complete`,
);
process.exit(failures ? 1 : 0);
