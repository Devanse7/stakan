import { normalizeSymbol } from "../core/math";
import { OrderBookModel, type AggTradeInput, type DepthSnapshotInput, type DepthUpdateInput } from "../core/orderBook";
import { createEmptyLadderSnapshot } from "../core/snapshot";
import type { LadderFeed, LadderSnapshot, LadderViewOptions, SnapshotListener, SymbolMeta } from "../core/types";

const BINANCE_FAPI_REST = "https://fapi.binance.com";
const BINANCE_FAPI_WS = "wss://fstream.binance.com/stream";
const DEPTH_BUFFER_LIMIT = 6000;

interface BinanceDepthMessage extends DepthUpdateInput {
  e: "depthUpdate";
  E: number;
  T: number;
  s: string;
}

interface BinanceAggTradeMessage extends AggTradeInput {
  e: "aggTrade";
  E: number;
  s: string;
  a: number;
  f: number;
  l: number;
  nq: string;
}

interface BinanceCombinedMessage {
  stream?: string;
  data?: BinanceDepthMessage | BinanceAggTradeMessage;
}

interface BinanceExchangeInfoResponse {
  symbols: Array<{
    symbol: string;
    status: string;
    pricePrecision: number;
    quantityPrecision: number;
    filters: Array<{
      filterType: string;
      tickSize?: string;
      stepSize?: string;
    }>;
  }>;
}

export function createBinanceUsdMFeed(listener: SnapshotListener, viewOptions: LadderViewOptions): LadderFeed {
  return new BinanceUsdMFeed(listener, viewOptions);
}

function isCombinedMessage(payload: unknown): payload is BinanceCombinedMessage {
  return typeof payload === "object" && payload !== null && "data" in payload;
}

class BinanceUsdMFeed implements LadderFeed {
  private symbol = "";
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private disposed = false;
  private book: OrderBookModel | null = null;
  private lastUpdateId: number | null = null;
  private synchronized = false;
  private connection: LadderSnapshot["connection"] = "idle";
  private connectionDetails = "Idle";
  private bufferedDepth: BinanceDepthMessage[] = [];
  private bufferedTrades: BinanceAggTradeMessage[] = [];
  private snapshotResyncInFlight = false;
  private viewOptions: LadderViewOptions;

  constructor(
    private readonly listener: SnapshotListener,
    initialViewOptions: LadderViewOptions
  ) {
    this.viewOptions = this.normalizeViewOptions(initialViewOptions);
  }

  async start(symbol: string): Promise<void> {
    this.stop();

    this.disposed = false;
    this.symbol = normalizeSymbol(symbol) || "SIRENUSDT";
    this.book = null;
    this.lastUpdateId = null;
    this.synchronized = false;
    this.bufferedDepth = [];
    this.bufferedTrades = [];
    this.snapshotResyncInFlight = false;
    this.setStatus("connecting", `Connecting to ${this.symbol}`);

    this.openSocket();

    try {
      const [meta, snapshot] = await Promise.all([this.fetchSymbolMeta(this.symbol), this.fetchDepthSnapshot(this.symbol)]);

      if (this.disposed) {
        return;
      }

      this.book = new OrderBookModel(meta);
      this.book.replaceSnapshot(snapshot);
      this.lastUpdateId = snapshot.lastUpdateId;
      this.setStatus("snapshot", `Snapshot loaded #${snapshot.lastUpdateId}`);
      this.flushBufferedTrades();
      this.trySynchronizeBufferedDepth();

      if (!this.synchronized) {
        this.emit();
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error.message : String(error));
    }
  }

  stop(): void {
    this.disposed = true;
    this.clearReconnectTimer();

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }

  setViewOptions(options: LadderViewOptions): void {
    this.viewOptions = this.normalizeViewOptions(options);
    this.emit();
  }

  private openSocket(): void {
    const lowerSymbol = this.symbol.toLowerCase();
    const streamUrl = `${BINANCE_FAPI_WS}?streams=${lowerSymbol}@depth@100ms/${lowerSymbol}@aggTrade`;
    this.ws = new WebSocket(streamUrl);

    this.ws.onopen = () => {
      this.setStatus("connecting", `Socket open for ${this.symbol}`);
    };

    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(String(event.data)) as BinanceCombinedMessage | BinanceDepthMessage | BinanceAggTradeMessage;
      const data = isCombinedMessage(parsed) ? parsed.data : parsed;

      if (!data) {
        return;
      }

      if (data.e === "depthUpdate") {
        this.handleDepthMessage(data);
      } else if (data.e === "aggTrade") {
        this.handleAggTradeMessage(data);
      }
    };

    this.ws.onerror = () => {
      this.scheduleReconnect(`Socket error for ${this.symbol}`);
    };

    this.ws.onclose = () => {
      if (!this.disposed) {
        this.scheduleReconnect(`Socket closed for ${this.symbol}`);
      }
    };
  }

  private handleDepthMessage(message: BinanceDepthMessage): void {
    if (!this.book || this.lastUpdateId === null) {
      this.bufferDepthMessage(message);
      return;
    }

    if (!this.synchronized) {
      this.bufferDepthMessage(message);
      this.trySynchronizeBufferedDepth();
      return;
    }

    if (message.u <= this.lastUpdateId) {
      return;
    }

    if (message.pu !== this.lastUpdateId) {
      void this.resyncDepthSnapshot(`Depth gap ${message.pu} != ${this.lastUpdateId}`);
      return;
    }

    this.book.applyDepthUpdate(message);
    this.lastUpdateId = message.u;
    this.emit();
  }

  private handleAggTradeMessage(message: BinanceAggTradeMessage): void {
    if (!this.book) {
      this.bufferedTrades.push(message);
      return;
    }

    this.book.applyAggTrade(message);
    this.emit();
  }

  private flushBufferedTrades(): void {
    if (!this.book) {
      return;
    }

    for (const trade of this.bufferedTrades) {
      this.book.applyAggTrade(trade);
    }

    this.bufferedTrades = [];
  }

  private bufferDepthMessage(message: BinanceDepthMessage): void {
    this.bufferedDepth.push(message);

    if (this.bufferedDepth.length > DEPTH_BUFFER_LIMIT) {
      this.bufferedDepth.splice(0, this.bufferedDepth.length - DEPTH_BUFFER_LIMIT);
    }
  }

  private trySynchronizeBufferedDepth(): void {
    if (!this.book || this.lastUpdateId === null || this.synchronized || this.bufferedDepth.length === 0) {
      return;
    }

    const expectedNext = this.lastUpdateId + 1;
    this.bufferedDepth = this.bufferedDepth.filter((event) => event.u >= expectedNext);

    if (this.bufferedDepth.length === 0) {
      return;
    }

    const startIndex = this.bufferedDepth.findIndex((event) => event.U <= expectedNext && event.u >= expectedNext);

    if (startIndex === -1) {
      const firstEvent = this.bufferedDepth[0];

      if (firstEvent.U > expectedNext) {
        void this.resyncDepthSnapshot(`Initial depth gap ${firstEvent.U} > ${expectedNext}`);
      }

      return;
    }

    const pending = this.bufferedDepth.slice(startIndex);
    let cursorUpdateId = this.lastUpdateId;
    let isFirstAppliedUpdate = true;

    for (const update of pending) {
      if (update.u <= cursorUpdateId) {
        continue;
      }

      if (isFirstAppliedUpdate) {
        if (update.U > cursorUpdateId + 1) {
          void this.resyncDepthSnapshot(`Depth start gap ${update.U} > ${cursorUpdateId + 1}`);
          return;
        }
      } else if (update.pu !== cursorUpdateId) {
        void this.resyncDepthSnapshot(`Depth chain broken ${update.pu} != ${cursorUpdateId}`);
        return;
      }

      this.book.applyDepthUpdate(update);
      cursorUpdateId = update.u;
      isFirstAppliedUpdate = false;
    }

    this.lastUpdateId = cursorUpdateId;
    this.synchronized = true;
    this.bufferedDepth = [];
    this.setStatus("live", `Live stream ${this.symbol}`);
    this.emit();
  }

  private async resyncDepthSnapshot(reason: string): Promise<void> {
    if (this.disposed || this.snapshotResyncInFlight || !this.book) {
      return;
    }

    this.snapshotResyncInFlight = true;
    this.synchronized = false;
    this.setStatus("resyncing", reason);

    try {
      const snapshot = await this.fetchDepthSnapshot(this.symbol);

      if (this.disposed || !this.book) {
        return;
      }

      this.book.replaceDepthSnapshot(snapshot);
      this.lastUpdateId = snapshot.lastUpdateId;
      this.trySynchronizeBufferedDepth();

      if (!this.synchronized) {
        this.emit();
      }
    } catch (error) {
      this.handleError(error instanceof Error ? error.message : String(error));
    } finally {
      this.snapshotResyncInFlight = false;
    }
  }

  private normalizeViewOptions(options: LadderViewOptions): LadderViewOptions {
    return {
      visibleLevels: Math.max(8, Math.floor(options.visibleLevels)),
      compression: Math.max(1, Math.floor(options.compression)),
      centerPriceUnits: options.centerPriceUnits ?? null
    };
  }

  private async fetchSymbolMeta(symbol: string): Promise<SymbolMeta> {
    const response = await fetch(`${BINANCE_FAPI_REST}/fapi/v1/exchangeInfo`);

    if (!response.ok) {
      throw new Error(`exchangeInfo failed: ${response.status}`);
    }

    const payload = (await response.json()) as BinanceExchangeInfoResponse;
    const target = payload.symbols.find((entry) => entry.symbol === symbol);

    if (!target) {
      throw new Error(`Symbol ${symbol} not found on Binance USD-M Futures`);
    }

    if (target.status !== "TRADING") {
      throw new Error(`Symbol ${symbol} is not tradable: ${target.status}`);
    }

    const priceFilter = target.filters.find((filter) => filter.filterType === "PRICE_FILTER");
    const lotSizeFilter = target.filters.find((filter) => filter.filterType === "LOT_SIZE");

    if (!priceFilter?.tickSize || !lotSizeFilter?.stepSize) {
      throw new Error(`Symbol ${symbol} has incomplete precision filters`);
    }

    return {
      symbol,
      tickSizeText: priceFilter.tickSize,
      stepSizeText: lotSizeFilter.stepSize,
      pricePrecision: target.pricePrecision,
      quantityPrecision: target.quantityPrecision
    };
  }

  private async fetchDepthSnapshot(symbol: string): Promise<DepthSnapshotInput> {
    const response = await fetch(`${BINANCE_FAPI_REST}/fapi/v1/depth?symbol=${symbol}&limit=1000`);

    if (!response.ok) {
      throw new Error(`depth snapshot failed: ${response.status}`);
    }

    return (await response.json()) as DepthSnapshotInput;
  }

  private scheduleReconnect(reason: string): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    this.setStatus("resyncing", reason);

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      void this.start(this.symbol);
    }, 1_000);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer !== null) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private handleError(message: string): void {
    this.setStatus("error", message);
  }

  private setStatus(connection: LadderSnapshot["connection"], details: string): void {
    this.connection = connection;
    this.connectionDetails = details;
    this.emit();
  }

  private emit(): void {
    if (!this.book) {
      this.listener(
        createEmptyLadderSnapshot(
          this.symbol || "SIRENUSDT",
          this.viewOptions.visibleLevels,
          this.viewOptions.compression,
          this.connection,
          this.connectionDetails
        )
      );
      return;
    }

    this.listener(this.book.buildSnapshot(this.connection, this.connectionDetails, this.viewOptions));
  }
}
