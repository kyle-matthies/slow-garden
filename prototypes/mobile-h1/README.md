# Slow Garden H1 mobile prototype

This disposable browser prototype tests the selected native-iOS-first Meadow and Cabinet interaction. It is not the production SwiftUI client.

## Run locally

```sh
npm ci --prefer-offline --no-audit --no-fund
npm run dev -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/` and use the iPhone preview.

## Core flow

1. Plant a seed in Meadow.
2. Open Review clipping or switch to Cabinet.
3. Inspect the same bloom beside its three exact source clippings.
4. Keep, Correct, or Prune the bloom.
5. Return to Meadow.

## Verification

```sh
npm run check:runtime
npm run build
npm run test:sites
```

The final browser comparison and QA receipt are in [design-qa.md](design-qa.md).
