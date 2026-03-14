# Stakan Spec

## Purpose

This widget is a compact embeddable `DOM / ladder / stakan` for web integration.
The host should only pass a symbol. The widget self-subscribes to Binance USD-M Futures public market data and renders a dense operator-facing interface.

Reference test contract:
- symbol: `SIRENUSDT`
- venue: `Binance USD-M Futures`

Additional verified venue:
- symbol input: `M`
- resolved symbol: `MUSDT`
- venue: `ApeX Omni`

## Visual Layout

The body is rendered as:

`clusters | prints | ladder`

Zones:
- `clusters`: executed volume by price, split into rolling 1-minute columns
- `prints`: recent market-trade bursts
- `ladder`: resting limit liquidity and price ladder

The whole body is canvas-rendered for density and speed.

## Ladder Semantics

The ladder is a vertical price scale.

Rules:
- prices are the ladder steps
- `asks` are above the spread
- `bids` are below the spread
- the spread is the gap between `best ask` and `best bid`
- the viewport is mostly sticky, so the inside market moves across the ladder instead of snapping back to the center on every tick

The ladder is visually compact and right-aligned so multiple DOM widgets can fit in the same screen layout.

### Ladder Columns

The ladder is treated as one tight unit made of two adjacent columns:
- size
- price

Both columns share side tinting:
- ask rows have a red-tinted background wash
- bid rows have a green-tinted background wash

This tint spans both `size + price` columns to make the ladder read as one narrow block rather than two disconnected tables.

### Depth Bars

Resting liquidity comes from the synchronized local order book.

Rendering rules:
- ask depth bars are red
- bid depth bars are green
- bar scale is fixed
- `10k = full width`

This is intentionally not auto-normalized. Relative size should stay visually stable from frame to frame.

### Inside Market Highlight

`best ask` and `best bid` are highlighted as row bands across the full ladder width, including both size and price columns.

Rules:
- `best ask`: red translucent band
- `best bid`: green translucent band
- if compression causes both inside prices to land in the same visible row, the row is split into two halves:
  - upper half red
  - lower half green

This is row-based on purpose. It avoids thin-line artifacts and stays readable under compression.

## Compression

Compression means grouping several raw price ticks into one visible row.

Rules:
- `x1`: one raw tick per row
- `x10`: ten raw ticks per visible row
- default: `x10`

Effects:
- more price range fits into the same vertical space
- asks and bids can collapse into the same visible row near the spread
- exact raw microstructure requires lower compression

Compression changes the visible price step. It is not just a zoom effect.

## Clusters

Clusters represent executed volume by price, not resting limit orders.

Source:
- Binance `aggTrade`

Behavior:
- clusters are stored in rolling 1-minute buckets
- the newest minute is on the right
- older minutes shift left
- each minute column shows its own numbers

Cell fill rules:
- fill direction: left to right
- scale is fixed
- `40k = full cell`

Color logic:
- greenish cell when buy-side delta dominates
- reddish cell when sell-side delta dominates

## Prints

Prints are visualized recent market-trade bursts between clusters and ladder.

Current aggregation:
- grouped by `side + 200ms window`
- each batch tracks:
  - total quantity
  - latest price
  - minimum visible price in the batch
  - maximum visible price in the batch

Rendering rules:
- `< 1k`: tiny colored dot
- `>= 1k` and one price only: circular bubble
- `>= 1k` and several prices in one batch: stretched vertical capsule

The capsule represents one short time burst that walked price within the same `200ms` window.
This is intentionally a visual approximation, not a raw tape replay.

## Feed Model

The widget currently supports two built-in public venues.

### Binance USD-M

The widget uses two Binance public data paths:

- REST snapshot for initial depth
- websocket:
  - `depth@100ms`
  - `aggTrade`

Book synchronization:
- depth deltas are buffered
- snapshot and websocket are stitched via `U / u / pu`
- if the chain breaks, the widget resyncs from a fresh depth snapshot
- trade history and visual prints do not require a full feed restart on depth resync

This avoids the failure mode where prints continue but resting book liquidity freezes.

### ApeX Omni

The widget uses:

- REST metadata:
  - `GET /api/v3/symbols`
- REST depth snapshot:
  - `GET /api/v3/depth?symbol=<crossSymbolName>&limit=200`
- public websocket:
  - `wss://quote.omni.apex.exchange/realtime_public?v=2&timestamp=<ms>`

Subscribed topics:
- `orderBook200.H.<symbol>`
- `recentlyTrade.H.<symbol>`
- `instrumentInfo.H.<symbol>`

Important ApeX-specific behavior:
- symbol input may be a base token like `M`; the adapter resolves it to the market symbol `MUSDT`
- depth frames use `snapshot/delta` with a monotonic `u`
- recent trades are delivered as overlapping snapshots and must be deduplicated by timestamp and trade id before they enter clusters/prints

## Rendering Defaults

Current defaults:
- symbol: `SIRENUSDT`
- compression: `x10`
- ladder depth fill: `10k = full`
- cluster fill: `40k = full`
- print batch window: `200ms`

## Current Limits

Known limits:
- public market data only
- no order entry
- no own-order overlays yet
- no dedicated raw tape view
- no WebGL renderer yet
- no automated tests yet

## Intended Next Steps

Most relevant next work:
- hover and click hit-testing on ladder rows
- manual recenter and scroll control
- animations and decay for prints
- imbalance and delta highlight modes
- own orders / position markers
