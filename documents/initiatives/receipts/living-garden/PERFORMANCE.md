# Living garden performance receipt (A6)

Date: 2026-10-10. Harness: `applications/web/accessibility/perf-check.mjs` (`npm run perf` in
that folder after `npm run build`). Raw numbers: `performance.json`. Synthetic fixtures only.

## Method

- Production build (`next start`) with the synthetic tended garden at
  `/dev/axe-fixtures?state=scale&thoughts=N` (6 topics; 100 and 1,000 thoughts).
- Headless Chromium in a 4-vCPU container **without a GPU**. 1280×800 unthrottled;
  390×844 at DPR 2 with 4× CPU throttling and touch drags.
- 10 s of dragging the meadow back and forth while tracing. **Frame cost** is the duration
  of each main-thread task that produces a frame, with 2D canvas rasterisation split out.
  Without a GPU, Chromium rasterises canvas on the main thread (SwiftShader), work a GPU
  does off the main thread on real devices, so the budget is checked on frame cost
  without it. Both figures are recorded, as are raw `requestAnimationFrame` intervals,
  which are bound by this environment rather than the code.

## Results (receipt run)

| Garden | Viewport | Frame cost p50 | Frame cost p95 | Budget (p95) | With canvas raster p95 |
|---|---|---|---|---|---|
| 100 thoughts | 1280 | 7.5 ms | 13.2 ms | 20 ms ✅ | 19.6 ms |
| 1,000 thoughts | 1280 | 11.1 ms | 19.9 ms | 20 ms ✅ | 25.9 ms |
| 100 thoughts | 390, 4× CPU | 22.0 ms | 49.0 ms | 33 ms ❌ | 83.3 ms |
| 1,000 thoughts | 390, 4× CPU | 24.0 ms | 53.7 ms | 33 ms ❌ | 85.3 ms |

- Image weight on the garden route: **0 KB** (budget 350 KB). The meadow is canvas and SVG;
  the pressed cosmos photograph loads only in the Cabinet.
- Script transferred: about 223 KB.
- Reduced motion: the scene sits idle (main thread about 0.1–0.3% busy once hydrated).
- Run-to-run spread in this container is wide: across today's runs of the final code,
  1280 / 1,000 thoughts measured 13.9–21.2 ms p95, and 390 measured 43.7–56 ms (100) and
  53.7–72.7 ms (1,000).

**Verdict:** desktop meets the budget. On the throttled phone profile the median frame
fits the 33 ms budget but the p95 does not, so the phone budget is **not yet met** in
this environment. The budget is unchanged; real-device measurement is the next check.

## What A6 changed to get here

Measured on the same harness before and after:

| Change | Effect |
|---|---|
| Plant wind moved from per-frame JS style writes to a compositor-only travelling gust | Style recalculation per 3 s at 1280: 1,761 → 146 ms; phone p95 64 → 44 ms |
| Beds re-render only when a bed enters or leaves view; stable handlers keep memoised beds | Long tasks during a 10 s rotation at 1280: 62 → 0 |
| Hills and meadow strips on their own canvas, redrawn only when the camera turns; ground as a CSS gradient | Main thread busy while the scene is still at 1280: about 90% → 25–48% |
| Canvas quality adapts to frame pacing (not only draw cost), within a 1 s window, then lowers resolution | Slow devices thin the grass within seconds instead of tens of seconds |
| Hover glow only on hover-capable devices | No sticky glow after a tap; no hover work during touch drags |

The harness also exposed a real bug, now fixed: a swipe that began on a plant or a
bed sign did not turn the garden, so dense meadows often would not rotate by touch.

## Remaining levers (not done)

- Real-device traces (mid-range Android, iPhone) to confirm whether the phone tail is
  this container's CPU or the scene.
- Per-frame canvas JS on phones (about 6–7 ms at 4×) could drop further with fewer
  live blades on narrow screens.
- Style and layerize work while beds move (about 5–6 ms each at 4×) scales with the
  number of mounted plants; a lower per-bed plant cap on phones would cut it, at a
  design cost.
