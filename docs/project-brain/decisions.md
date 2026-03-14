# Decisions

## D-001: Build as Embeddable Library First

Decision:
- build a reusable widget, not a standalone terminal app

Why:
- host project only needs to pass a ticker
- reuse is easier if feed, core model, and renderer are separate

Trade-off:
- slightly more upfront structure than a quick one-off page
- lower integration friction later

## D-002: TypeScript + React + Vite

Decision:
- use TypeScript for the library and demo host
- use React for the first renderer layer
- use Vite for fast development and library bundling

Why:
- quickest path to a shippable embeddable widget
- enough flexibility to add a canvas renderer later

Why not pure Python:
- Python is suitable for adapters/backends, not the browser UI layer

Trade-off:
- React renderer is not the final high-frequency rendering target
- we accept this for the scaffold phase

## D-003: Export Both React Component and Custom Element

Decision:
- ship `DomLadderWidget`
- ship `defineStakanDomElement()`

Why:
- React host projects can import directly
- non-React hosts can mount a web component

Trade-off:
- two integration surfaces to maintain
- but a shared core model keeps maintenance bounded

## D-004: Use Binance Snapshot + Diff Depth

Decision:
- build the book from REST snapshot plus websocket deltas
- use `aggTrade` for cluster accumulation

Why:
- partial-depth streams are too shallow for a real ladder
- snapshot + diff path is the correct foundation for later DOM behavior

Trade-off:
- more synchronization logic up front
- much better correctness than partial depth only

## D-004b: Add ApeX Omni As Second Built-In Public Feed

Decision:
- add a dedicated `ApeX Omni` feed adapter alongside Binance
- expose built-in exchange selection via `exchange="binance-usdm" | "apex-omni"`
- resolve ApeX symbols by either full market symbol (`MUSDT`) or base token (`M`)

Why:
- ApeX Omni provides public depth snapshot, public depth websocket, and public recent trades
- this maps well onto the existing `OrderBookModel` without changing the renderer contract
- the user needs the `M` market on ApeX Omni specifically

Trade-off:
- host integration now has an exchange dimension when multiple venues are supported
- ApeX trade feed needs snapshot overlap deduplication, which is more custom than Binance `aggTrade`

## D-005: React Shell + Canvas Ladder Body

Decision:
- keep React for shell and integration
- render ladder rows inside a single canvas
- lay out the body as `clusters | prints | ladder`

Why:
- one canvas is a much better fit for dense, high-frequency ladder updates
- React still keeps embedding and host integration simple
- the target UI is not a side-by-side bid/ask table; it needs separate footprint and prints lanes

Trade-off:
- text measurement and drawing logic become manual
- a future webgl renderer may still be useful for even denser modes

## D-006: Compression Means Grouped Price Steps

Decision:
- implement compression as aggregation of `N` raw ticks into one visible row

Why:
- this matches how traders expect a compressed ladder to behave
- the user can see more price range without changing widget height

Trade-off:
- near the spread, compressed buckets can contain both bid and ask liquidity
- exact uncompressed microstructure requires `compression=1`

## D-007: Prints Are Visual Batches, Not Raw Tape

Decision:
- batch visible prints by side and `200ms` time window
- track the visible min/max price reached inside that window
- render a circle when the batch stays on one visible price, and a stretched capsule when the batch spans multiple visible prices

Why:
- raw aggTrade bursts create unreadable print spam
- the goal of the prints lane is visual signal, not a verbatim tape dump
- a time batch that walks price should read as one moving burst, not several unrelated dots

Trade-off:
- the prints lane is intentionally lossy
- exact raw tape should later live in a separate dedicated view if needed
- one visual capsule can cover intermediate prices that had little or no executed volume inside the same `200ms` bucket

## D-008: Sticky Ladder Viewport Instead of Per-Tick Recentering

Decision:
- keep the ladder viewport fixed most of the time
- recenter only when the inside market approaches the top or bottom edge of the visible window

Why:
- a DOM ladder needs price to act as a stable reference
- the spread and resting liquidity should visibly travel across the ladder instead of snapping back to mid every update

Trade-off:
- the market can drift within the window before any recenter happens
- this matches trader expectations better than always pinning the inside market to the middle

## D-009: Sequence-Aware Depth Sync With Snapshot Resync

Decision:
- keep websocket depth events buffered until they can be stitched to snapshot update ID
- validate chain continuity with `U/u/pu`
- when the chain breaks, fetch a fresh depth snapshot and continue without full socket restart

Why:
- avoids frozen order book states where trades continue but resting liquidity does not move
- reduces reconnect churn compared to restarting the whole feed on each mismatch

Trade-off:
- synchronization logic is more complex than naive per-message apply
- snapshot resync is still lossy for transient micro-events between snapshot and stitched stream

## D-010: Minute-Based Cluster Columns + Fixed Ladder Scale

Decision:
- store footprint in rolling 1-minute buckets and render clusters as a column strip (new minute on the right, old minutes shift left)
- render ladder depth bars with fixed normalization `10k = 100% width`
- default compression is `x10`

Why:
- the target visual is time-sliced clusters, not one cumulative blob
- fixed liquidity scale gives consistent perception of size spikes
- `x10` default matches the desired dense trading view

Trade-off:
- minute rollover means historical cluster context is intentionally bounded
- fixed `10k` scale can saturate on high-liquidity moments, which is expected by design

## D-011: Tint Whole Ladder Rows By Side And Highlight Inside Market Per Row

Decision:
- tint ask rows with a red background wash and bid rows with a green background wash
- apply that tint across both ladder columns (`size + price`)
- highlight `best ask` and `best bid` as full-row bands instead of thin micro-lines
- when compression collapses both inside prices into one visible row, split that row into red/green halves

Why:
- the target visual is a compact DOM where side context is readable at a glance
- full-row inside highlights stay stable under compression and avoid collapsing into thin artifacts
- tinting both columns makes the price ladder read as one tight unit instead of two unrelated columns

Trade-off:
- the renderer is more stylized than a neutral book table
- exact raw inside-line placement is sacrificed in favor of stable operator-readable bands
