# Stakan DOM Widget

Embeddable web widget for a ladder-style DOM with a cluster panel and prints lane.

Current version:
- `0.4.0`

Current scope:
- public market data only
- Binance USD-M Futures adapter
- ApeX Omni adapter
- host project passes only a ticker, widget subscribes by itself
- adjustable compression by grouped price steps
- default compression: `x10`
- compact `clusters | prints | ladder` canvas layout aligned to the right edge
- minute-based cluster columns
- fixed fill scales: ladder `10k = full`, clusters `40k = full`
- ladder rows tinted by side across both size and price columns
- inside market highlighted as full-row ask/bid bands across both columns
- prints batched by `200ms` window can render as circles or stretched capsules across multiple prices
- test symbols:
  - Binance: `SIRENUSDT`
  - ApeX Omni: `M` -> resolves to `MUSDT`

## Docs

- project memory: `docs/project-brain/`
- detailed DOM behavior: `docs/project-brain/stakan-spec.md`
- current architecture snapshot: `docs/project-brain/README.md`
- key decisions: `docs/project-brain/decisions.md`
- next steps: `docs/project-brain/backlog.md`

## Quick Start

```bash
npm install
npm run dev
```

## Library Build

```bash
npm run build
```

Build output is produced in `dist/`.

## Embedding

React:

```tsx
import { DomLadderWidget } from "stakan-dom-widget";

export function Screen() {
  return <DomLadderWidget exchange="apex-omni" symbol="M" compression={10} />;
}
```

Custom element:

```ts
import { defineStakanDomElement } from "stakan-dom-widget";

defineStakanDomElement();
```

```html
<stakan-dom-ladder exchange="apex-omni" symbol="M" compression="10"></stakan-dom-ladder>
```

## Current Limitations

- ladder layout is `clusters | prints | ladder`, not yet webgl
- prints are a lossy visual aggregation, not a raw tick-for-tick tape replay
- only Binance USD-M and ApeX Omni public data are implemented

See `docs/project-brain/` for the architecture and backlog.
