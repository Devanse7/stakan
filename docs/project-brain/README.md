# Project Brain

Current version:
- `0.4.0`

## Doc Index

- `README.md`: current architecture and verified state
- `commands.md`: install/run/build commands
- `decisions.md`: architectural and renderer decisions
- `backlog.md`: next implementation steps
- `stakan-spec.md`: detailed behavior of the DOM, clusters, prints, compression, and feed model

## Goal

Build an embeddable web widget that recreates a trading ladder (`DOM / stakan`) with a cluster panel.

Host integration target:
- host passes only a ticker
- widget connects to Binance USD-M Futures public feeds by itself
- widget can later be embedded either as a React component or as a custom element

## Chosen Architecture

Layers:
- `core/`: price math, order book model, footprint accumulation, snapshot shaping
- `feeds/`: exchange connectivity and local-book synchronization
- `react/`: UI widget and hooks
- `web-component/`: wrapper for framework-agnostic embedding
- `demo/`: standalone host for development and smoke checks

## Data Flow

1. Host provides `symbol`
2. Feed adapter loads Binance symbol metadata and initial depth snapshot
3. Feed adapter opens a combined public websocket:
   - `symbol@depth@100ms`
   - `symbol@aggTrade`
4. Feed synchronizes buffered depth events to snapshot sequence (`U/u/pu`) and resyncs from fresh snapshot on detected chain gaps
5. Order book model applies synchronized deltas
6. Footprint model accumulates executed volume by price
7. React widget renders `clusters | prints | ladder`
8. Compression groups `N` raw ticks into one visible ladder row
9. Viewport keeps a sticky center and recenters only near the edges, so the spread moves across the ladder instead of snapping back to the middle on every tick

## Current MVP Status

Implemented:
- embeddable project skeleton
- Binance USD-M public adapter
- ApeX Omni public adapter
- live subscription smoke path for `SIRENUSDT`
- live subscription smoke path for `M` on ApeX Omni (`MUSDT`)
- sequence-aware depth synchronization with snapshot resync on chain breaks
- canvas renderer with `clusters | prints | ladder`
- compact right-aligned terminal geometry for dense multi-widget layouts
- 1-minute rolling cluster columns (new minute on the right, oldest shifts left)
- adjustable compression that changes visible price step
- ladder liquidity scale normalized to `10k = full bar`
- cluster fill normalized to `40k = full cell`
- prints batched into minimum `200ms` windows for display
- prints can render either as circular bubbles or stretched vertical capsules when one visual batch spans multiple price levels
- sticky ladder viewport with edge-triggered recentering
- ask/bid ladder lane tint across both size and price columns
- row-based inside market highlight across both ladder columns
- built-in exchange switch for `binance-usdm` and `apex-omni`
- React component and custom element export

Not implemented yet:
- webgl renderer
- order entry controls
- iceberg/spoofing diagnostics
- session windows for cluster reset modes
- automated tests

## Verified Binance Test Contract

Verified on `2026-03-13`:
- symbol: `SIRENUSDT`
- market: `Binance USD-M Futures`
- contract type: `PERPETUAL`
- status: `TRADING`
- tick size: `0.0000100`
- step size: `1`
