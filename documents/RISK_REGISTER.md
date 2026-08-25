# Risk register

| ID | Risk | Early signal | Planned mitigation | Horizon | Status |
|---|---|---|---|---|---|
| K-001 | The concept is a beautiful weekly-summary app rather than a new interaction model. | Blooms paraphrase entries and users prefer a normal report. | Require accumulation-dependent value and compare against explicit baselines. | H0-H1 | Open |
| K-002 | AI interpretation displaces the user’s own meaning. | Users adopt system language, feel judged, or cannot disagree. | Preserve ambiguity, source links, correction, no-output behavior, and user-owned promotion. | All | Open |
| K-003 | Private journal data leaks through logs, analytics, providers, examples, or integrations. | Raw text appears outside the classified source boundary. | Minimize data, threat-model every sink, redact logs, isolate tenants, and test export/deletion. | H2+ | Open |
| K-004 | Spatial interaction becomes cumbersome or inaccessible at scale. | Capture slows, mobile manipulation fails, or screen-reader flow breaks. | Test multiple densities and input modes before selecting the architecture. | H1-H2 | Open |
| K-005 | Flower-inspired motion becomes decorative, distracting, or exclusionary. | Motion hides state, causes discomfort, or lacks a reduced-motion equivalent. | Tie motion to state transitions and require equivalent static communication. | H1+ | Open |
| K-006 | Batch results are stale, duplicated, or based on superseded edits. | A bloom cites old revisions or appears twice after retry. | Snapshot exact revisions, use idempotency keys, mark stale results, and support cancellation. | H2+ | Open |
| K-007 | Processing cost grows with the full journal corpus. | Pass cost or latency rises linearly with retained history. | Use bounded scopes, incremental summaries, budgets, caching, and measured retrieval. | H2+ | Open |
| K-008 | Prompt injection inside notes or imported sources changes agent behavior. | Source text influences tools, permissions, or output schema. | Treat all notes as data, isolate instructions, validate structured output, and run adversarial evals. | H1+ | Open |
| K-009 | The product becomes a general automation dashboard. | Tasks, status, and integrations crowd out the thinking surface. | Keep workbench features in H3 and test them against the quiet-foreground principle. | H3+ | Open |
| K-010 | Existing Personal OS, Agent Ops, and knowledge systems become duplicate authorities. | The same state differs across systems. | Define read-only projections, canonical sources, freshness, and verified receipts before integration. | H0-H3 | Open |
| K-011 | Native iOS work duplicates an unvalidated web concept. | Platform work starts before useful returns repeat. | Hold native work behind the H2 dogfood gate. | H2-H3 | Open |
| K-012 | Mental-health framing creates unsafe expectations. | Users interpret blooms as diagnosis, therapy, or objective truth. | Use non-clinical positioning, uncertainty language, crisis boundaries, and expert review if scope changes. | All | Open |
| K-013 | Over-personalization makes the product impossible to generalize. | Only Kyle understands the garden language or values the returns. | First prove Kyle value, then run explicit transfer studies before productizing broadly. | H3-H4 | Open |
| K-014 | Feature growth overwhelms the return ritual. | More than three outputs or modes become default. | Use horizon gates, feature flags, density tests, and explicit removals. | All | Open |
