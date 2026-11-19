# PR 42 remediation — November 18, 2026

Kyle requested independent review, remediation, testing and merge if unblocked.
Claude's original Returns read-path regression and investigation record are retained.

## Confirmed and fixed

- Scheduling tests mixed fixed enqueue dates with a cycle-less nightly pass stamped
  by the real clock. Set its creation date to November 17 **after** insertion:
  `prepare_pass` overwrites an inserted creation date with `now()`.
- Local full-suite testing exposed the same issue in the bloom-ranking fixture.
  Its creation date now matches its intended November 21 cycle, preventing it from
  consuming the nearby November 20 cycle's exhausted allowance.
- The preference journey expected UTC despite first-use device-zone detection.
  It now explicitly selects UTC and waits for that save before enabling tending.
- A fresh audit passes the existing high/critical gate without a new exception.
  [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
  was withdrawn November 18. Picomatch remains unchanged; no security gate was weakened.
- The production build independently flagged Next 16.4.3. Updated Next and its
  matching ESLint config to 16.4.6, beyond the 16.4.5 fixes for
  [GHSA-mfr8-8qww-v76h](https://github.com/advisories/GHSA-mfr8-8qww-v76h)
  and [GHSA-vc7v-qv4w-wrv8](https://github.com/advisories/GHSA-vc7v-qv4w-wrv8).

## Verification

Local: macOS, Node 22.23.4, Supabase CLI 2.109.1, isolated Docker database,
all 14 committed migrations applied. No hosted Supabase changes or provider calls.

- Reproduced scheduling tests 46–49 failing by placing the cycle-less fixture
  inside the enqueue's night window, independent of today's clock. The corrected
  full SQL suite passes: 16 files, 977 assertions.
- Database lint: no schema errors; generated public types match the checked-in file.
- Web: 53 files, 441 tests; Node: 88 tests; worker: 93 tests. All pass.
- Audit gate, ESLint, TypeScript and production build pass. npm audit still reports
  nine moderate dev-tooling findings; zero high or critical findings.
- Returns regression: reintroducing the passive effect fails the new test; restoring
  the layout effect passes it. The temporary source edit was restored.
- Independent review (Claude Opus 5.5, two rounds): no substantive code findings.
  The readiness requirement is successful CI on the final committed SHA. An unrelated
  extra preference save in the archived-garden test was removed after review.
- Final-head CI results are recorded in the PR's verification
  section. Earlier-head CI cannot establish readiness of the remediated commit.

The static export builds and its signed-out Chromium shell check passes at phone
and desktop sizes (2/2), including document navigation, CSP and no backend requests.
Authenticated hosted browser journeys, Safari and a real phone were not exercised.
The Returns timing regression runs in jsdom; production deployment is verified separately.
