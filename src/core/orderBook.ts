import { FootprintModel } from "./footprint";
import { createPriceScale, formatPrice, priceToUnits, unitsToPrice } from "./math";
import type { ClusterCell, LadderRow, LadderSnapshot, LadderViewOptions, LastTrade, SymbolMeta, TradeSide } from "./types";

export interface DepthSnapshotInput {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface DepthUpdateInput {
  U: number;
  u: number;
  pu: number;
  b: [string, string][];
  a: [string, string][];
}

export interface AggTradeInput {
  id?: string | number;
  p: string;
  q: string;
  T: number;
  m: boolean;
}

export class OrderBookModel {
  readonly meta: SymbolMeta;

  private readonly priceScale;
  private readonly bids = new Map<number, number>();
  private readonly asks = new Map<number, number>();
  private readonly footprint = new FootprintModel();
  private lastTrade: LastTrade | null = null;
  private recentPrints: LastTrade[] = [];

  constructor(meta: SymbolMeta) {
    this.meta = meta;
    this.priceScale = createPriceScale(meta);
  }

  replaceSnapshot(snapshot: DepthSnapshotInput): void {
    this.bids.clear();
    this.asks.clear();
    this.footprint.reset();
    this.lastTrade = null;
    this.recentPrints = [];
    this.applySide(this.bids, snapshot.bids);
    this.applySide(this.asks, snapshot.asks);
  }

  replaceDepthSnapshot(snapshot: DepthSnapshotInput): void {
    this.bids.clear();
    this.asks.clear();
    this.applySide(this.bids, snapshot.bids);
    this.applySide(this.asks, snapshot.asks);
  }

  applyDepthUpdate(update: DepthUpdateInput): void {
    this.applySide(this.bids, update.b);
    this.applySide(this.asks, update.a);
  }

  applyAggTrade(trade: AggTradeInput): void {
    const priceUnits = priceToUnits(trade.p, this.priceScale);
    const quantity = Number(trade.q);
    const side: TradeSide = trade.m ? "sell" : "buy";

    this.footprint.applyTrade(priceUnits, quantity, side, trade.T);
    const print: LastTrade = {
      id: String(trade.id ?? `${trade.T}-${priceUnits}-${quantity}-${side}`),
      price: Number(trade.p),
      priceUnits,
      side,
      quantity,
      timestamp: trade.T
    };
    this.lastTrade = print;
    this.recentPrints = [print, ...this.recentPrints].slice(0, 240);
  }

  buildSnapshot(connection: LadderSnapshot["connection"], connectionDetails: string, viewOptions: LadderViewOptions): LadderSnapshot {
    const compression = Math.max(1, Math.floor(viewOptions.compression));
    const bestBidUnits = this.getBestBidUnits();
    const bestAskUnits = this.getBestAskUnits();
    const midUnits = this.getMidUnits(bestBidUnits, bestAskUnits);
    const centerUnits = viewOptions.centerPriceUnits ?? midUnits ?? this.lastTrade?.priceUnits ?? null;
    const clusterMinuteStarts = this.footprint.getMinuteStarts();
    const rows = centerUnits === null ? [] : this.buildRows(centerUnits, viewOptions.visibleLevels, compression, clusterMinuteStarts);

    return {
      symbol: this.meta.symbol,
      connection,
      connectionDetails,
      updatedAt: Date.now(),
      meta: this.meta,
      bestBid: bestBidUnits === null ? null : unitsToPrice(bestBidUnits, this.priceScale),
      bestAsk: bestAskUnits === null ? null : unitsToPrice(bestAskUnits, this.priceScale),
      bestBidUnits,
      bestAskUnits,
      midPrice: midUnits === null ? null : unitsToPrice(midUnits, this.priceScale),
      spread:
        bestBidUnits === null || bestAskUnits === null
          ? null
          : unitsToPrice(bestAskUnits - bestBidUnits, this.priceScale),
      lastTrade: this.lastTrade,
      recentPrints: this.recentPrints,
      clusterMinuteStarts,
      visibleLevels: viewOptions.visibleLevels,
      compression,
      rows
    };
  }

  private applySide(target: Map<number, number>, updates: [string, string][]): void {
    for (const [priceText, quantityText] of updates) {
      const priceUnits = priceToUnits(priceText, this.priceScale);
      const quantity = Number(quantityText);

      if (quantity === 0) {
        target.delete(priceUnits);
      } else {
        target.set(priceUnits, quantity);
      }
    }
  }

  private getBestBidUnits(): number | null {
    if (this.bids.size === 0) {
      return null;
    }

    let best = Number.NEGATIVE_INFINITY;

    for (const priceUnits of this.bids.keys()) {
      if (priceUnits > best) {
        best = priceUnits;
      }
    }

    return Number.isFinite(best) ? best : null;
  }

  private getBestAskUnits(): number | null {
    if (this.asks.size === 0) {
      return null;
    }

    let best = Number.POSITIVE_INFINITY;

    for (const priceUnits of this.asks.keys()) {
      if (priceUnits < best) {
        best = priceUnits;
      }
    }

    return Number.isFinite(best) ? best : null;
  }

  private getMidUnits(bestBidUnits: number | null, bestAskUnits: number | null): number | null {
    const reference =
      bestBidUnits !== null && bestAskUnits !== null ? Math.round((bestBidUnits + bestAskUnits) / 2) : bestBidUnits ?? bestAskUnits;

    if (reference === null) {
      return null;
    }

    return this.alignToTick(reference);
  }

  private alignToTick(priceUnits: number): number {
    const step = this.priceScale.tickSizeUnits;
    return Math.round(priceUnits / step) * step;
  }

  private buildRows(centerUnits: number, visibleLevels: number, compression: number, clusterMinuteStarts: number[]): LadderRow[] {
    const halfWindow = Math.floor(visibleLevels / 2);
    const tickStep = this.priceScale.tickSizeUnits;
    const compressionStep = tickStep * compression;
    const alignedCenterUnits = this.alignToStep(centerUnits, compressionStep);
    const startUnits = alignedCenterUnits + halfWindow * compressionStep;
    const rows: LadderRow[] = [];

    for (let index = 0; index < visibleLevels; index += 1) {
      const priceUnits = startUnits - index * compressionStep;
      let bidSize = 0;
      let askSize = 0;
      const clusterCells: ClusterCell[] = clusterMinuteStarts.map(() => ({
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
        delta: 0
      }));

      for (let level = 0; level < compression; level += 1) {
        const aggregatedPriceUnits = priceUnits + level * tickStep;
        bidSize += this.bids.get(aggregatedPriceUnits) ?? 0;
        askSize += this.asks.get(aggregatedPriceUnits) ?? 0;

        for (let minuteIndex = 0; minuteIndex < clusterMinuteStarts.length; minuteIndex += 1) {
          const cluster = this.footprint.getBucket(aggregatedPriceUnits, clusterMinuteStarts[minuteIndex]);

          if (!cluster) {
            continue;
          }

          clusterCells[minuteIndex].buyVolume += cluster.buyVolume;
          clusterCells[minuteIndex].sellVolume += cluster.sellVolume;
        }
      }

      let buyVolume = 0;
      let sellVolume = 0;

      for (const clusterCell of clusterCells) {
        clusterCell.totalVolume = clusterCell.buyVolume + clusterCell.sellVolume;
        clusterCell.delta = clusterCell.buyVolume - clusterCell.sellVolume;
        buyVolume += clusterCell.buyVolume;
        sellVolume += clusterCell.sellVolume;
      }

      rows.push({
        price: unitsToPrice(priceUnits, this.priceScale),
        priceText: formatPrice(priceUnits, this.priceScale),
        priceUnits,
        bidSize,
        askSize,
        buyVolume,
        sellVolume,
        totalVolume: buyVolume + sellVolume,
        delta: buyVolume - sellVolume,
        clusterCells
      });
    }

    return rows;
  }

  private alignToStep(priceUnits: number, step: number): number {
    return Math.round(priceUnits / step) * step;
  }
}
