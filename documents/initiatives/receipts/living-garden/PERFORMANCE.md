# Living garden performance receipt (A6)

Harness: `applications/web/accessibility/perf-check.mjs` (`npm run perf` in that folder
after `npm run build`). Each run writes its own `performance-<run>.json` with the commit,
Node and Chromium versions, and every harness setting. Synthetic fixtures only.

## Method

- Production build (`next start`) with synthetic fixtures at `/dev/axe-fixtures`:
  - a tended garden of 6 topics with 100 thoughts, and with 1,000 thoughts;
  - the garden ring with 24 gardens (`gardens=24&view=gardens`).
- Headless Chromium 141.0.7390.37, Node v22.22.0, a 4-vCPU container **without a GPU**.
  1280×800 unthrottled with mouse drags; 390×844 at DPR 2 with **4× CPU throttling and
  touch drags**.
- 10 s of dragging back and forth while tracing. **Frame cost** is the duration of each
  main-thread task that produces a frame, with 2D canvas rasterisation split out:
  without a GPU, Chromium rasterises canvas on the main thread (SwiftShader), work a
  GPU does elsewhere on real devices. Both figures are recorded.
- Budgets (ADR-007, unchanged): p95 ≤ 20 ms at 1280, p95 ≤ 33 ms at 390 with 4× CPU,
  garden-route images ≤ 350 KB on phone.

## Results: commit 4d84d8b, three consecutive runs, all pass

| Route | Viewport | Run 1 p95 | Run 2 p95 | Run 3 p95 | Budget |
|---|---|---|---|---|---|
| 100 thoughts | 1280 | 7.1 ms | 8.2 ms | 7.4 ms | 20 ✅ |
| 1,000 thoughts | 1280 | 12.3 ms | 9.9 ms | 11.0 ms | 20 ✅ |
| 24-garden ring | 1280 | 4.6 ms | 4.8 ms | 5.2 ms | 20 ✅ |
| 100 thoughts | 390, 4× CPU | 26.2 ms | 29.4 ms | 27.5 ms | 33 ✅ |
| 1,000 thoughts | 390, 4× CPU | 26.9 ms | 29.3 ms | 31.1 ms | 33 ✅ |
| 24-garden ring | 390, 4× CPU | 18.8 ms | 21.0 ms | 22.3 ms | 33 ✅ |

Raw files: `performance-4d84d8b-run1.json`, `-run2.json`, `-run3.json`.

- Image weight on the garden route: 0 KB (the meadow is canvas and SVG; the pressed
  cosmos photograph loads only in the Cabinet). Script transferred: about 223 KB.
- Reduced motion: the scene goes idle once hydrated. With 1,000 thoughts at 4× CPU,
  hydration is still finishing during the idle sample (12–19% busy).
- The worst phone run (31.1 ms) leaves little margin, and this container varies from run
  to run, so a real-device check remains worthwhile, but the stated acceptance is met.

## Restack confirmation (2026-10-13): this environment is slower today

After #24 merged, #25 and #26 were restacked (merge commits; no A6 code changed). The
confirmation runs on the restacked head and a same-day control on the previously passing
code both miss the phone budget, so the shortfall is the container, not the restack:

| Run (2026-10-13) | Code | 1280 garden-100 / 1000 / ring | 390 garden-100 / 1000 / ring |
|---|---|---|---|
| `performance-5eb4d36-confirm.json` | restacked head | 18.2 / 15.8 / 8.4 ms | 39.7 / 43.7 / 27.7 ms |
| `performance-5eb4d36-confirm2.json` | restacked head | 14.3 / 19.6 / 9.6 ms | 43.5 / 56.5 / 35.6 ms |
| `performance-control-e651786.json` | A6 code that passed 3/3 on 10-11 | 14.6 / 18.8 / 7.9 ms | 50.3 / 54.9 / 33.7 ms |

Identical code ran about 1.6–2× slower than on 2026-10-11 (for example the 1280 ring,
which has no canvas: 4.6 ms then, 7.9 ms now). The three-run acceptance above stands
for commit 4d84d8b; the phone budget cannot be re-confirmed in today's container, which
leaves the real-device check as the deciding measurement.

## What changed, and what it bought

Release verification, 2026-10-17: passing builds and synthetic interaction checks
are separate from the phone frame-pacing acceptance. The October 13 confirmation
failures above remain open evidence; the mid-range physical-phone owner check in
ADR-007 has not been completed. Merging the hardening improvements does not mark
the phone performance budget met. The cap now retains a focused thought without
exceeding 14 visible plants, and cancelling a camera spring restores the settled
state. The budget is unchanged.

Measured on the same method; only changes with a reliable gain were kept.

| Change | Effect |
|---|---|
| Plant wind as a compositor-only travelling gust (was per-frame JS style writes) | Style recalculation per 3 s at 1280: 1,761 → 146 ms |
| Beds re-render only when one enters or leaves view; stable handlers | Long tasks during rotation at 1280: 62 → 0 |
| Hills and meadow strips on their own canvas, redrawn only when the camera turns | Main thread busy while still at 1280: about 90% → 20–50% |
| Canvas quality adapts to frame pacing within a 1 s window | Slow devices thin the grass within seconds |
| **Plants hold their sway while the camera turns** | Phone p50 about 22 → 13 ms; p95 45–64 → 27–42 ms |
| **Phones render up to 14 plants per bed** (owner-approved), with "+N more in List" | Phone p95 at 1,000 thoughts about 42 → 27–31 ms |

Tried and reverted (no reliable gain): front-row-only sway (worse: static plants lose
their own layers and repaint as beds move), thinner grass while turning, and writing
band transforms directly instead of through motion values.

The harness also exposed, and A6 fixed, a swipe that began on a plant or bed sign not
turning the garden.
