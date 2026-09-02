# Applications

- `ios/`: primary native SwiftUI client, local domain package, Xcode project, and UI journey tests.
- `web/`: Next.js App Router companion deployed on Vercel.

Both clients consume the same Supabase tenant boundary and versioned domain contracts. They do not share UI code or ship privileged service credentials. The iOS local vertical slice is implemented; simulator, SwiftData macro, protected-file, accessibility, and UI-test receipts remain gated on full-Xcode validation.
