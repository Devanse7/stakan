import { startTransition, useEffect, useState } from "react";
import { normalizeSymbol } from "../core/math";
import { createEmptyLadderSnapshot } from "../core/snapshot";
import type { FeedFactory, LadderFeed, LadderSnapshot, LadderViewOptions } from "../core/types";
import { createBinanceUsdMFeed } from "../feeds/binanceUsdMFeed";

const EDGE_BUFFER_RATIO = 0.18;

function getReferencePriceUnits(snapshot: LadderSnapshot): number | null {
  if (snapshot.bestBidUnits !== null && snapshot.bestAskUnits !== null) {
    return Math.round((snapshot.bestBidUnits + snapshot.bestAskUnits) / 2);
  }

  return snapshot.bestBidUnits ?? snapshot.bestAskUnits ?? snapshot.lastTrade?.priceUnits ?? null;
}

function shouldRecenter(snapshot: LadderSnapshot): boolean {
  if (snapshot.rows.length < 2) {
    return false;
  }

  const referencePriceUnits = getReferencePriceUnits(snapshot);

  if (referencePriceUnits === null) {
    return false;
  }

  const rowStepUnits = Math.abs(snapshot.rows[0].priceUnits - snapshot.rows[1].priceUnits) || 1;
  const topVisibleUnits = snapshot.rows[0].priceUnits + rowStepUnits;
  const rowIndex = Math.floor((topVisibleUnits - referencePriceUnits) / rowStepUnits);
  const edgeBufferRows = Math.min(
    Math.max(4, Math.floor(snapshot.rows.length * EDGE_BUFFER_RATIO)),
    Math.max(1, Math.floor(snapshot.rows.length / 2) - 1)
  );

  return rowIndex < edgeBufferRows || rowIndex > snapshot.rows.length - 1 - edgeBufferRows;
}

export function useLadderFeed(symbol: string, visibleLevels: number, compression: number, feedFactory?: FeedFactory): LadderSnapshot {
  const normalizedSymbol = normalizeSymbol(symbol) || "SIRENUSDT";
  const [feed, setFeed] = useState<LadderFeed | null>(null);
  const [centerPriceUnits, setCenterPriceUnits] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<LadderSnapshot>(() =>
    createEmptyLadderSnapshot(normalizedSymbol, visibleLevels, compression, "connecting", `Preparing ${normalizedSymbol}`)
  );

  const viewOptions: LadderViewOptions = {
    visibleLevels,
    compression,
    centerPriceUnits
  };

  useEffect(() => {
    setCenterPriceUnits(null);
  }, [normalizedSymbol]);

  useEffect(() => {
    const factory = feedFactory ?? createBinanceUsdMFeed;
    const feed = factory((nextSnapshot) => {
      const referencePriceUnits = getReferencePriceUnits(nextSnapshot);

      if (referencePriceUnits !== null) {
        setCenterPriceUnits((currentCenterPriceUnits) => {
          if (currentCenterPriceUnits === null) {
            return referencePriceUnits;
          }

          return shouldRecenter(nextSnapshot) ? referencePriceUnits : currentCenterPriceUnits;
        });
      }

      startTransition(() => {
        setSnapshot(nextSnapshot);
      });
    }, viewOptions);

    setFeed(feed);

    void feed.start(normalizedSymbol);

    return () => {
      setFeed(null);
      feed.stop();
    };
  }, [feedFactory, normalizedSymbol]);

  useEffect(() => {
    if (!feed) {
      return;
    }

    feed.setViewOptions(viewOptions);
  }, [centerPriceUnits, compression, feed, visibleLevels]);

  return snapshot;
}
