import type { TradeSide } from "./types";

export interface FootprintBucket {
  buyVolume: number;
  sellVolume: number;
  lastTradeTimestamp: number;
}

export class FootprintModel {
  private readonly minuteBuckets = new Map<number, Map<number, FootprintBucket>>();
  private readonly minuteOrder: number[] = [];

  constructor(private readonly maxMinutes = 8) {}

  reset(): void {
    this.minuteBuckets.clear();
    this.minuteOrder.length = 0;
  }

  applyTrade(priceUnits: number, quantity: number, side: TradeSide, timestamp: number): void {
    const minuteStart = Math.floor(timestamp / 60_000) * 60_000;
    const minuteMap = this.ensureMinute(minuteStart);
    const bucket = minuteMap.get(priceUnits) ?? {
      buyVolume: 0,
      sellVolume: 0,
      lastTradeTimestamp: timestamp
    };

    if (side === "buy") {
      bucket.buyVolume += quantity;
    } else {
      bucket.sellVolume += quantity;
    }

    bucket.lastTradeTimestamp = timestamp;
    minuteMap.set(priceUnits, bucket);
    this.pruneOldMinutes();
  }

  getMinuteStarts(): number[] {
    return [...this.minuteOrder];
  }

  getBucket(priceUnits: number, minuteStart?: number): FootprintBucket | undefined {
    if (minuteStart !== undefined) {
      return this.minuteBuckets.get(minuteStart)?.get(priceUnits);
    }

    let merged: FootprintBucket | undefined;

    for (const currentMinuteStart of this.minuteOrder) {
      const bucket = this.minuteBuckets.get(currentMinuteStart)?.get(priceUnits);

      if (!bucket) {
        continue;
      }

      if (!merged) {
        merged = {
          buyVolume: bucket.buyVolume,
          sellVolume: bucket.sellVolume,
          lastTradeTimestamp: bucket.lastTradeTimestamp
        };
      } else {
        merged.buyVolume += bucket.buyVolume;
        merged.sellVolume += bucket.sellVolume;
        merged.lastTradeTimestamp = Math.max(merged.lastTradeTimestamp, bucket.lastTradeTimestamp);
      }
    }

    return merged;
  }

  private ensureMinute(minuteStart: number): Map<number, FootprintBucket> {
    const existing = this.minuteBuckets.get(minuteStart);

    if (existing) {
      return existing;
    }

    const created = new Map<number, FootprintBucket>();
    this.minuteBuckets.set(minuteStart, created);

    const insertIndex = this.minuteOrder.findIndex((knownMinuteStart) => knownMinuteStart > minuteStart);

    if (insertIndex === -1) {
      this.minuteOrder.push(minuteStart);
    } else {
      this.minuteOrder.splice(insertIndex, 0, minuteStart);
    }

    return created;
  }

  private pruneOldMinutes(): void {
    while (this.minuteOrder.length > this.maxMinutes) {
      const oldestMinuteStart = this.minuteOrder.shift();

      if (oldestMinuteStart !== undefined) {
        this.minuteBuckets.delete(oldestMinuteStart);
      }
    }
  }
}
