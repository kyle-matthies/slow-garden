# November 4 growth validation

All browser input and screenshots are fictional. No hosted source or credentials
were used. Product strategy and five lane records are linked from the
[delivery plan](../../../operations/GROWTH_DELIVERY_2026-11-04.md).

- Node 22.23.4: 99 Vitest, 75 Node and 31 worker tests passed; lint and production
  build passed. CI additionally runs database lint, pgTAP and generated type checks.
- `journeys.json`: production-build Playwright journeys, 390/1280, light/dark.
  Covers keyboard/exact-entry resume, tending history, import preview without a
  write, failed import retry, setup reload and partially completed setup recovery.
- `contrast.json`: complete axe harness contrast receipt. All serious/critical,
  overflow, 200% zoom proxy and contrast gates passed. Expanded recent writing and
  initial onboarding have no axe findings. Existing Cabinet preview moderate
  findings: `landmark-unique` and `page-has-heading-one`, in all four profiles.
- Synthetic screenshots remain at `/tmp/slow-garden-growth-20261104` and
  `/tmp/slow-garden-growth-final-axe-20261104`. Physical-phone acceptance and
  commercial conversion/retention impact were not established by this run.

Reproduce using `npm run growth` and `npm run axe` under
`applications/web/accessibility`; its README describes the fixture isolation and
receipt options. Release checks and exact serving commit are recorded on
[PR #29](https://github.com/kyle-matthies/slow-garden/pull/29) and
[PR #30](https://github.com/kyle-matthies/slow-garden/pull/30).
