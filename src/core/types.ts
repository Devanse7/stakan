export type ConnectionState = "idle" | "connecting" | "snapshot" | "live" | "resyncing" | "error";
export type TradeSide = "buy" | "sell";
export type ExchangeId = "binance-usdm" | "apex-omni";

export interface SymbolMeta {
  symbol: string;
  tickSizeText: string;
  stepSizeText: string;
  pricePrecision: number;
  quantityPrecision: number;
}

export interface LadderRow {
  price: number;
  priceText: string;
  priceUnits: number;
  bidSize: number;
  askSize: number;
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number;
  clusterCells: ClusterCell[];
}

export interface ClusterCell {
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  delta: number;
}

export interface LastTrade {
  id: string;
  price: number;
  priceUnits: number;
  side: TradeSide;
  quantity: number;
  timestamp: number;
}

export interface LadderSnapshot {
  symbol: string;
  connection: ConnectionState;
  connectionDetails: string;
  updatedAt: number | null;
  meta: SymbolMeta | null;
  bestBid: number | null;
  bestAsk: number | null;
  bestBidUnits: number | null;
  bestAskUnits: number | null;
  midPrice: number | null;
  spread: number | null;
  lastTrade: LastTrade | null;
  recentPrints: LastTrade[];
  clusterMinuteStarts: number[];
  visibleLevels: number;
  compression: number;
  rows: LadderRow[];
}

export interface LadderViewOptions {
  visibleLevels: number;
  compression: number;
  centerPriceUnits?: number | null;
}

export interface LadderFeed {
  start(symbol: string): Promise<void>;
  stop(): void;
  setViewOptions(options: LadderViewOptions): void;
}

export type SnapshotListener = (snapshot: LadderSnapshot) => void;
export type FeedFactory = (listener: SnapshotListener, viewOptions: LadderViewOptions) => LadderFeed;

export interface DomWidgetOptions {
  symbol: string;
  exchange?: ExchangeId;
  visibleLevels?: number;
  compression?: number;
  title?: string;
  feedFactory?: FeedFactory;
}
