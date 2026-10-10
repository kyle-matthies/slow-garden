// Performance receipt harness for the living garden (ADR-007 budget).
// Serves the production build (`npm run build` first) with GARDEN_AXE_FIXTURES=1,
// then on a synthetic tended garden measures, while dragging the meadow round
// for 10 s:
//   - main-thread frame cost from a trace (budget: p95 <= 20 ms at 1280,
//     <= 33 ms at 390 under 4x CPU throttle). Canvas rasterisation is reported
//     separately and excluded from the budget: without a GPU, headless
//     Chromium rasterises 2D canvas on the main thread (SwiftShader), work a
//     GPU does off the main thread on real devices;
//   - requestAnimationFrame intervals, recorded as environment-bound context;
//   - image bytes transferred for the garden route on a phone (budget <= 350 KB);
//   - main-thread busy time while the scene sits still, with and without
//     reduced motion, as a check that the atmosphere idles.
// Synthetic fixtures only; no Supabase, provider or journal content.
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const receipts = process.env.PERF_RECEIPTS
  ? path.resolve(process.env.PERF_RECEIPTS)
  : path.resolve(here, "../../../documents/initiatives/receipts/living-garden");
const PORT = 3212;
const BASE = `http://localhost:${PORT}`;
const ROTATE_MS = 10_000;
const IDLE_MS = 5_000;
const IMAGE_BUDGET = 350 * 1024;

const ROUTES = [
  { name: "garden-100", url: "/dev/axe-fixtures?state=scale&thoughts=100" },
  { name: "garden-1000", url: "/dev/axe-fixtures?state=scale&thoughts=1000" },
];
const DEVICES = [
  {
    name: "1280",
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    isMobile: false,
    throttle: 1,
    p95Budget: 20,
  },
  {
    name: "390",
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    throttle: 4,
    p95Budget: 33,
  },
];

function cleanEnv() {
  const env = { ...process.env, GARDEN_AXE_FIXTURES: "1" };
  for (const key of Object.keys(env))
    if (/SUPABASE|GARDEN_AI/i.test(key)) delete env[key];
  return env;
}

const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  cwd: webDir,
  env: cleanEnv(),
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
server.stderr.on("data", (d) => process.stderr.write(`[next] ${d}`));

async function waitForServer(timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/dev/axe-fixtures`);
      if (res.status === 200) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`next start did not serve fixtures on :${PORT}; run npm run build first`);
}

const quantile = (sorted, q) =>
  sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0;
const round = (n) => Math.round(n * 10) / 10;

async function open(browser, device, url, reducedMotion = "no-preference") {
  const ctx = await browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.deviceScaleFactor,
    isMobile: device.isMobile,
    hasTouch: device.hasTouch ?? false,
    reducedMotion,
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: device.throttle });
  await cdp.send("Performance.enable");
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForSelector(".garden-scene");
  // Let hydration finish (slow under CPU throttling) before sampling anything.
  await page.waitForTimeout(3000);
  return { ctx, page, cdp };
}

async function transferred(page) {
  return page.evaluate(() => {
    const entries = performance.getEntriesByType("resource");
    const nav = performance.getEntriesByType("navigation")[0];
    const sum = (list) => list.reduce((n, e) => n + (e.transferSize || e.encodedBodySize || 0), 0);
    const images = entries.filter((e) =>
      /\.(webp|avif|png|jpe?g|gif|svg)(\?|$)/i.test(e.name) || e.initiatorType === "img",
    );
    const scripts = entries.filter((e) => e.initiatorType === "script" || /\.js(\?|$)/.test(e.name));
    const styles = entries.filter((e) => /\.css(\?|$)/.test(e.name));
    return {
      image_bytes: sum(images),
      image_files: images.map((e) => e.name.replace(location.origin, "")),
      script_bytes: sum(scripts),
      style_bytes: sum(styles),
      document_bytes: nav ? nav.transferSize || nav.encodedBodySize : 0,
    };
  });
}

/** Drag the meadow back and forth for ROTATE_MS while recording rAF intervals. */
async function rotate(browser, page, touch) {
  await page.evaluate(() => {
    const w = window;
    w.__frames = [];
    w.__stop = false;
    let last = performance.now();
    const tick = (t) => {
      w.__frames.push(t - last);
      last = t;
      if (!w.__stop) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.__long = [];
    try {
      new PerformanceObserver((list) => {
        for (const e of list.getEntries()) w.__long.push(e.duration);
      }).observe({ type: "longtask", buffered: false });
    } catch {}
  });
  await browser.startTracing(page, {
    categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "cc", "blink"],
  });
  const box = await page.locator(".garden-scene").boundingBox();
  const y = box.y + box.height * 0.45;
  // Phones drag by touch (no hover, no per-move hit testing); desktops by mouse.
  const cdp = touch ? await page.context().newCDPSession(page) : null;
  const point = (x) => [{ x, y, id: 1 }];
  const pointer = touch
    ? {
        down: (x) => cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: point(x) }),
        move: (x) => cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: point(x) }),
        up: () => cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] }),
      }
    : {
        down: async (x) => {
          await page.mouse.move(x, y);
          await page.mouse.down();
        },
        move: (x) => page.mouse.move(x, y),
        up: () => page.mouse.up(),
      };
  const start = Date.now();
  let direction = -1;
  while (Date.now() - start < ROTATE_MS) {
    const x0 = box.x + box.width * (direction < 0 ? 0.75 : 0.25);
    await pointer.down(x0);
    for (let i = 1; i <= 24; i++) {
      await pointer.move(x0 + direction * i * (box.width / 48));
      await page.waitForTimeout(16);
    }
    await pointer.up();
    // Let the release spring settle on a bed before the next drag.
    await page.waitForTimeout(700);
    direction = -direction;
  }
  const sampled = await page.evaluate(() => {
    window.__stop = true;
    return { frames: window.__frames.slice(1), long: window.__long };
  });
  const trace = JSON.parse((await browser.stopTracing()).toString());
  return { ...sampled, ...frameCosts(trace.traceEvents) };
}

const CANVAS_RASTER = new Set([
  "CanvasResourceProviderSharedImage::ProduceCanvasResource",
  "Canvas2DLayerBridge::PrepareTransferableResource",
]);

/** Per-frame main-thread cost (BeginMainFrame tasks), with canvas raster split out. */
function frameCosts(events) {
  // Several renderers can appear in one trace; use the one drawing the most frames.
  const counts = new Map();
  for (const e of events)
    if (e.name === "ProxyMain::BeginMainFrame") {
      const key = `${e.pid}:${e.tid}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  const [busiest] = [...counts].sort((a, b) => b[1] - a[1])[0] ?? [""];
  const main = events
    .filter((e) => e.ph === "X" && e.dur && `${e.pid}:${e.tid}` === busiest)
    .sort((a, b) => a.ts - b.ts);
  const tasks = [];
  for (const e of main) {
    if (e.name !== "RunTask" && e.name !== "ThreadControllerImpl::RunTask") continue;
    const last = tasks[tasks.length - 1];
    if (last && e.ts < last.ts + last.dur) continue; // nested
    tasks.push({ ts: e.ts, dur: e.dur, raster: 0, frame: false });
  }
  const enclosing = (ts) => {
    let lo = 0;
    let hi = tasks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (tasks[mid].ts <= ts) lo = mid + 1;
      else hi = mid - 1;
    }
    const t = tasks[hi];
    return t && ts < t.ts + t.dur ? t : null;
  };
  for (const e of main) {
    const task = enclosing(e.ts);
    if (!task) continue;
    if (e.name === "ProxyMain::BeginMainFrame") task.frame = true;
    if (CANVAS_RASTER.has(e.name)) task.raster += e.dur;
  }
  const frames = tasks.filter((t) => t.frame);
  const ms = (list) => list.map((v) => v / 1000).sort((a, b) => a - b);
  const withRaster = ms(frames.map((t) => t.dur));
  const withoutRaster = ms(frames.map((t) => t.dur - t.raster));
  const longest = ms(tasks.map((t) => t.dur - t.raster));
  return {
    traced_frames: frames.length,
    frame_cost_ms: {
      p50: round(quantile(withoutRaster, 0.5)),
      p95: round(quantile(withoutRaster, 0.95)),
      max: round(withoutRaster[withoutRaster.length - 1] ?? 0),
    },
    frame_cost_with_canvas_raster_ms: {
      p50: round(quantile(withRaster, 0.5)),
      p95: round(quantile(withRaster, 0.95)),
    },
    canvas_raster_share_pct: round(
      (frames.reduce((n, t) => n + t.raster, 0) / Math.max(1, frames.reduce((n, t) => n + t.dur, 0))) * 100,
    ),
    longest_task_excluding_canvas_raster_ms: round(longest[longest.length - 1] ?? 0),
  };
}

async function busyWhileStill(cdp, page) {
  const metric = async () =>
    Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const before = await metric();
  await page.waitForTimeout(IDLE_MS);
  const after = await metric();
  const busy = after.TaskDuration - before.TaskDuration;
  return round((busy / (IDLE_MS / 1000)) * 100);
}

let failures = 0;
const results = [];
try {
  await waitForServer();
  const browser = await chromium.launch(
    process.env.AXE_CHROMIUM ? { executablePath: process.env.AXE_CHROMIUM } : {},
  );
  for (const route of ROUTES) {
    for (const device of DEVICES) {
      const { ctx, page, cdp } = await open(browser, device, route.url);
      const weight = await transferred(page);
      const plants = await page.locator("[data-plant]").count();
      const stillBusy = await busyWhileStill(cdp, page);
      const { frames, long, ...cost } = await rotate(browser, page, device.hasTouch ?? false);
      await ctx.close();
      const reduced = await open(browser, device, route.url, "reduce");
      const reducedBusy = await busyWhileStill(reduced.cdp, reduced.page);
      await reduced.ctx.close();

      const sorted = [...frames].sort((a, b) => a - b);
      const p95 = cost.frame_cost_ms.p95;
      const row = {
        route: route.name,
        device: device.name,
        cpu_throttle: device.throttle,
        interactive_plants_rendered: plants,
        ...cost,
        p95_budget_ms: device.p95Budget,
        raf_frames: frames.length,
        raf_interval_ms: {
          p50: round(quantile(sorted, 0.5)),
          p95: round(quantile(sorted, 0.95)),
          p99: round(quantile(sorted, 0.99)),
          max: round(sorted[sorted.length - 1] ?? 0),
        },
        long_tasks: long.length,
        main_thread_busy_still_pct: stillBusy,
        main_thread_busy_still_reduced_motion_pct: reducedBusy,
        ...weight,
        p95_ok: p95 <= device.p95Budget,
        image_ok: device.isMobile ? weight.image_bytes <= IMAGE_BUDGET : true,
      };
      if (!row.traced_frames) {
        row.p95_ok = false;
        console.error(`${route.name} @ ${device.name}: no frames found in the trace`);
      }
      if (!row.p95_ok || !row.image_ok) failures++;
      results.push(row);
      console.log(
        `${route.name} @ ${device.name} (${device.throttle}x CPU): frame cost p95 ${p95} ms / ${device.p95Budget} ` +
          `(with canvas raster ${row.frame_cost_with_canvas_raster_ms.p95}; raster ${row.canvas_raster_share_pct}%) · ` +
          `rAF p50/p95 ${row.raf_interval_ms.p50}/${row.raf_interval_ms.p95} · long tasks ${row.long_tasks} · images ${Math.round(weight.image_bytes / 1024)} KB · ` +
          `JS ${Math.round(weight.script_bytes / 1024)} KB · still busy ${stillBusy}% (reduced ${reducedBusy}%)` +
          `${row.p95_ok && row.image_ok ? "" : "  <-- OVER BUDGET"}`,
      );
    }
  }
  await browser.close();
} catch (error) {
  failures++;
  console.error(error);
} finally {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

mkdirSync(receipts, { recursive: true });
writeFileSync(
  path.join(receipts, "performance.json"),
  JSON.stringify(
    {
      content_free_note: "Synthetic fixtures only; no journal content.",
      method:
        "Production build (next start), headless Chromium in a 4-vCPU container without a GPU. While dragging the meadow for 10 s: frame cost is the duration of each main-thread task containing BeginMainFrame from a devtools.timeline trace, with 2D canvas rasterisation (done on the main thread here, by a GPU on real devices) split out and excluded from the budget; rAF intervals are recorded as environment-bound context. CPU throttling via CDP Emulation.setCPUThrottlingRate. Image bytes are resource transferSize after network idle. Real-device frame pacing remains an owner check.",
      budgets: { p95_ms_1280: 20, p95_ms_390_4x: 33, phone_image_kb: 350 },
      results,
      ok: failures === 0,
    },
    null,
    2,
  ) + "\n",
);
console.log(`\n${failures === 0 ? "PASS" : `FAIL (${failures})`}: perf-check complete`);
process.exit(failures ? 1 : 0);
