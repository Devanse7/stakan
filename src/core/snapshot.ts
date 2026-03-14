import type { ConnectionState, LadderSnapshot } from "./types";

export function createEmptyLadderSnapshot(
  symbol: string,
  visibleLevels: number,
  compression = 10,
  connection: ConnectionState = "idle",
  connectionDetails = "Idle"
): LadderSnapshot {
  return {
    symbol,
    connection,
    connectionDetails,
    updatedAt: null,
    meta: null,
    bestBid: null,
    bestAsk: null,
    bestBidUnits: null,
    bestAskUnits: null,
    midPrice: null,
    spread: null,
    lastTrade: null,
    recentPrints: [],
    clusterMinuteStarts: [],
    visibleLevels,
    compression,
    rows: []
  };
}
