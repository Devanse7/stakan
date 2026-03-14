import { normalizeSymbol } from "../core/math";
import { OrderBookModel, type AggTradeInput, type DepthSnapshotInput, type DepthUpdateInput } from "../core/orderBook";
import { createEmptyLadderSnapshot } from "../core/snapshot";
import type { LadderFeed, LadderSnapshot, LadderViewOptions, SnapshotListener, SymbolMeta } from "../core/types";

const APEX_REST = "https://omni.apex.exchange";
const APEX_WS = "wss://quote.omni.apex.exchange/realtime_public";
const APEX_PING_MS = 15_000;
const DEPTH_BUFFER_LIMIT = 2_000;
const TRADE_ID_BUFFER_LIMIT = 64;
const TRADE_FRAME_BUFFER_LIMIT = 64;

interface ApexPerpetualSymbol {
  crossSymbolName: string;
  symbolDisplayName: string;
  symbol: string;
  baseTokenId: string;
  tokenName: string;
  tickSize: string;
  stepSize: string;
  indexPriceDecimals: number;
  enableTrade: boolean;
  enableDisplay: boolean;
}

interface ApexSymbolsResponse {
  data?: {
    contractConfig?: {
      perpetualContract?: ApexPerpetualSymbol[];
    };
  };
}

interface ApexDepthResponse {
  data?: {
    s: string;
    b: [string, string][];
    a: [string, string][];
    u: number;
  };
}

interface ApexOrderBookMessage {
  topic: string;
  type: "snapshot" | "delta";
  data: {
    s: string;
    b: [string, string][];
    a: [string, string][];
    u: number;
  };
  cs?: number;
  ts?: number;
}

interface ApexTradeItem {
  T: number;
  s: string;
  S: "Buy" | "Sell";
  v: string;
  p: string;
  i?: string;
}

interface ApexTradeMessage {
  topic: string;
  type: "snapshot" | "delta";
  data: ApexTradeItem[];
  cs?: number;
  ts?: number;
}

interface ApexInstrumentInfoMessage {
  topic: string;
  type: "snapshot" | "delta";
  data: Record<string, unknown>;
  cs?: number;
  ts?: number;
}

interface ApexSubscribeAck {
  success?: boolean;
  request?: {
    op?: string;
    args?: string[];
  };
}

interface ApexPingMessage {
  op?: string;
  args?: string[];
}

type ApexMessage = ApexOrderBookMessage | ApexTradeMessage | ApexInstrumentInfoMessage | ApexSubscribeAck | ApexPingMessage;

export function createApexOmniFeed(listener: SnapshotListener, viewOptions: LadderViewOptions): LadderFeed {
  return new ApexOmniFeed(listener, viewOptions);
}

function countDecimals(value: string): number {
  const trimmed = String(value).replace(/0+$/, "");
  const fraction = trimmed.includes(".") ? trimmed.split(".")[1] : "";
  return fraction.length;
}

function normalizeApexLookup(input: string): string {
  return normalizeSymbol(input);
}

function normalizeWsUrl(): string {
  return `${APEX_WS}?v=2&timestamp=${Date.now()}`;
}

function normalizeDepthSnapshot(message: ApexDepthResponse["data"]): DepthSnapshotInput {
  return {
    lastUpdateId: Number(message?.u ?? 0),
    bids: message?.b ?? [],
    asks: message?.a ?? []
  };
}

function normalizeDepthDelta(message: ApexOrderBookMessage["data"]): DepthUpdateInput {
  const updateId = Number(message.u);

  return {
    U: updateId,
    u: updateId,
    pu: updateId - 1,
    b: message.b ?? [],
    a: message.a ?? []
  };
}

function isOrderBookMessage(message: ApexMessage): message is ApexOrderBookMessage {
  return typeof (message as ApexOrderBookMessage)?.topic === "string" && (message as ApexOrderBookMessage).topic.startsWith("orderBook200.");
}

function isTradeMessage(message: ApexMessage): message is ApexTradeMessage {
  return typeof (message as ApexTradeMessage)?.topic === "string" && (message as ApexTradeMessage).topic.startsWith("recentlyTrade.");
}

function isInstrumentInfoMessage(message: ApexMessage): message is ApexInstrumentInfoMessage {
  return typeof (message as ApexInstrumentInfoMessage)?.topic === "string" && (message as ApexInstrumentInfoMessage).topic.startsWith("instrumentInfo.");
}

class ApexOmniFeed implements LadderFeed {
  private symbol = "";
  private ws: WebSocket | null = null;
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private disposed = false;
  private book: OrderBookModel | null = null;
  private lastUpdateId: number | null = null;
  private synchronized = false;
  private connection: LadderSnapshot["connection"] = "idle";
  private connectionDetails = "Idle";
  private bufferedDepth: ApexOrderBookMessage[] = [];
  private bufferedTrades: ApexTradeMessage[] = [];
  private snapshotResyncInFlight = false;
  private tradeBaselineReady = false;
  private tradeLastTimestampMs = 0;
  private tradeLastIds: string[] = [];
  private lastInstrumentMarkPrice: string | null = null;
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
    this.symbol = normalizeApexLookup(symbol) || "MUSDT";
    this.book = null;
    this.lastUpdateId = null;
    this.synchronized = false;
    this.bufferedDepth = [];
    this.bufferedTrades = [];
    this.snapshotResyncInFlight = false;
    this.tradeBaselineReady = false;
    this.tradeLastTimestampMs = 0;
    this.tradeLastIds = [];
    this.lastInstrumentMarkPrice = null;
    this.setStatus("connecting", `Resolving ApeX Omni ${this.symbol}`);

    try {
      const meta = await this.fetchSymbolMeta(this.symbol);

      if (this.disposed) {
        return;
      }

      this.symbol = meta.symbol;
      this.book = new OrderBookModel(meta);
      this.openSocket();

      const snapshot = await this.fetchDepthSnapshot(meta.symbol);

      if (this.disposed || !this.book) {
        return;
      }

      if (this.lastUpdateId === null || snapshot.lastUpdateId >= this.lastUpdateId) {
        this.book.replaceSnapshot(snapshot);
        this.lastUpdateId = snapshot.lastUpdateId;
        this.setStatus("snapshot", `ApeX snapshot loaded #${snapshot.lastUpdateId}`);
      }

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
    this.clearPingTimer();

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
    this.ws = new WebSocket(normalizeWsUrl());

    this.ws.onopen = () => {
      this.send({
        op: "subscribe",
        args: [
          `orderBook200.H.${this.symbol}`,
          `recentlyTrade.H.${this.symbol}`,
          `instrumentInfo.H.${this.symbol}`
        ]
      });
      this.startPingLoop();
      this.setStatus("connecting", `ApeX socket open for ${this.symbol}`);
    };

    this.ws.onmessage = (event) => {
      const parsed = JSON.parse(String(event.data)) as ApexMessage;

      if ("op" in parsed && String(parsed.op ?? "").toLowerCase() === "ping") {
        const args = Array.isArray(parsed.args) && parsed.args.length > 0 ? parsed.args : [String(Date.now())];
        this.send({ op: "pong", args });
        return;
      }

      if (isOrderBookMessage(parsed)) {
        this.handleDepthMessage(parsed);
        return;
      }

      if (isTradeMessage(parsed)) {
        this.handleTradeMessage(parsed);
        return;
      }

      if (isInstrumentInfoMessage(parsed)) {
        this.handleInstrumentInfoMessage(parsed);
      }
    };

    this.ws.onerror = () => {
      this.scheduleReconnect(`ApeX socket error for ${this.symbol}`);
    };

    this.ws.onclose = () => {
      if (!this.disposed) {
        this.scheduleReconnect(`ApeX socket closed for ${this.symbol}`);
      }
    };
  }

  private send(payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    this.ws.send(JSON.stringify(payload));
  }

  private startPingLoop(): void {
    this.clearPingTimer();
    this.pingTimer = window.setInterval(() => {
      this.send({
        op: "ping",
        args: [String(Date.now())]
      });
    }, APEX_PING_MS);
  }

  private clearPingTimer(): void {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  private handleDepthMessage(message: ApexOrderBookMessage): void {
    if (!this.book || this.lastUpdateId === null) {
      this.bufferDepthMessage(message);
      return;
    }

    if (message.type === "snapshot") {
      const snapshot = normalizeDepthSnapshot(message.data);

      if (snapshot.lastUpdateId >= this.lastUpdateId) {
        this.book.replaceDepthSnapshot(snapshot);
        this.lastUpdateId = snapshot.lastUpdateId;
        this.synchronized = true;
        this.bufferedDepth = this.bufferedDepth.filter((event) => Number(event.data.u) > this.lastUpdateId!);
        this.setStatus("live", `ApeX live ${this.symbol}`);
        this.emit();
      }

      return;
    }

    if (!this.synchronized) {
      this.bufferDepthMessage(message);
      this.trySynchronizeBufferedDepth();
      return;
    }

    const updateId = Number(message.data.u);

    if (updateId <= this.lastUpdateId) {
      return;
    }

    if (updateId !== this.lastUpdateId + 1) {
      void this.resyncDepthSnapshot(`ApeX depth gap ${updateId} != ${this.lastUpdateId + 1}`);
      return;
    }

    this.book.applyDepthUpdate(normalizeDepthDelta(message.data));
    this.lastUpdateId = updateId;
    this.emit();
  }

  private handleTradeMessage(message: ApexTradeMessage): void {
    if (!this.book || this.lastUpdateId === null) {
      this.bufferTradeMessage(message);
      return;
    }

    this.processTradeMessage(message);
    this.emit();
  }

  private handleInstrumentInfoMessage(message: ApexInstrumentInfoMessage): void {
    const markPrice = typeof message.data.markPrice === "string" ? message.data.markPrice : null;

    if (markPrice) {
      this.lastInstrumentMarkPrice = markPrice;
    }
  }

  private bufferDepthMessage(message: ApexOrderBookMessage): void {
    this.bufferedDepth.push(message);

    if (this.bufferedDepth.length > DEPTH_BUFFER_LIMIT) {
      this.bufferedDepth.splice(0, this.bufferedDepth.length - DEPTH_BUFFER_LIMIT);
    }
  }

  private bufferTradeMessage(message: ApexTradeMessage): void {
    this.bufferedTrades.push(message);

    if (this.bufferedTrades.length > TRADE_FRAME_BUFFER_LIMIT) {
      this.bufferedTrades.splice(0, this.bufferedTrades.length - TRADE_FRAME_BUFFER_LIMIT);
    }
  }

  private flushBufferedTrades(): void {
    if (!this.book) {
      return;
    }

    for (const tradeMessage of this.bufferedTrades) {
      this.processTradeMessage(tradeMessage);
    }

    this.bufferedTrades = [];
  }

  private processTradeMessage(message: ApexTradeMessage): void {
    if (!this.book || !Array.isArray(message.data)) {
      return;
    }

    const parsedTrades = message.data
      .map((trade) => ({
        timestamp: Number(trade.T),
        id: String(trade.i ?? ""),
        payload: trade
      }))
      .filter((trade) => Number.isFinite(trade.timestamp) && trade.timestamp > 0)
      .sort((left, right) => (left.timestamp === right.timestamp ? left.id.localeCompare(right.id) : left.timestamp - right.timestamp));

    if (parsedTrades.length === 0) {
      return;
    }

    if (!this.tradeBaselineReady) {
      const lastTimestamp = parsedTrades[parsedTrades.length - 1].timestamp;
      this.tradeLastTimestampMs = lastTimestamp;
      this.tradeLastIds = parsedTrades
        .filter((trade) => trade.timestamp === lastTimestamp && trade.id)
        .slice(-TRADE_ID_BUFFER_LIMIT)
        .map((trade) => trade.id);
      this.tradeBaselineReady = true;
      return;
    }

    for (const trade of parsedTrades) {
      if (trade.timestamp < this.tradeLastTimestampMs) {
        continue;
      }

      if (trade.timestamp === this.tradeLastTimestampMs && trade.id && this.tradeLastIds.includes(trade.id)) {
        continue;
      }

      const normalizedTrade: AggTradeInput = {
        id: trade.payload.i,
        p: trade.payload.p,
        q: trade.payload.v,
        T: trade.timestamp,
        m: String(trade.payload.S).toLowerCase() === "sell"
      };

      this.book.applyAggTrade(normalizedTrade);

      if (trade.timestamp > this.tradeLastTimestampMs) {
        this.tradeLastTimestampMs = trade.timestamp;
        this.tradeLastIds = [];
      }

      if (trade.id) {
        this.tradeLastIds.push(trade.id);

        if (this.tradeLastIds.length > TRADE_ID_BUFFER_LIMIT) {
          this.tradeLastIds.splice(0, this.tradeLastIds.length - TRADE_ID_BUFFER_LIMIT);
        }
      }
    }
  }

  private trySynchronizeBufferedDepth(): void {
    if (!this.book || this.lastUpdateId === null || this.bufferedDepth.length === 0) {
      return;
    }

    const pending = [...this.bufferedDepth].sort((left, right) => Number(left.data.u) - Number(right.data.u));
    this.bufferedDepth = [];

    for (const message of pending) {
      if (message.type === "snapshot") {
        const snapshot = normalizeDepthSnapshot(message.data);

        if (snapshot.lastUpdateId >= this.lastUpdateId) {
          this.book.replaceDepthSnapshot(snapshot);
          this.lastUpdateId = snapshot.lastUpdateId;
        }

        continue;
      }

      const updateId = Number(message.data.u);

      if (updateId <= this.lastUpdateId) {
        continue;
      }

      if (updateId !== this.lastUpdateId + 1) {
        void this.resyncDepthSnapshot(`ApeX buffered depth gap ${updateId} != ${this.lastUpdateId + 1}`);
        return;
      }

      this.book.applyDepthUpdate(normalizeDepthDelta(message.data));
      this.lastUpdateId = updateId;
    }

    this.synchronized = true;
    this.setStatus("live", `ApeX live ${this.symbol}`);
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

  private async fetchSymbolMeta(symbolInput: string): Promise<SymbolMeta> {
    const response = await fetch(`${APEX_REST}/api/v3/symbols`);

    if (!response.ok) {
      throw new Error(`ApeX symbols failed: ${response.status}`);
    }

    const payload = (await response.json()) as ApexSymbolsResponse;
    const listings = payload.data?.contractConfig?.perpetualContract ?? [];
    const lookup = normalizeApexLookup(symbolInput);
    const target =
      listings.find((entry) => entry.crossSymbolName === lookup) ??
      listings.find((entry) => entry.symbolDisplayName === lookup) ??
      listings.find((entry) => normalizeSymbol(entry.symbol) === lookup) ??
      listings.find((entry) => entry.baseTokenId === lookup);

    if (!target) {
      throw new Error(`ApeX symbol ${symbolInput} not found`);
    }

    if (!target.enableTrade) {
      throw new Error(`ApeX symbol ${target.crossSymbolName} is not tradable`);
    }

    const tickDecimals = countDecimals(target.tickSize);
    const stepDecimals = countDecimals(target.stepSize);

    return {
      symbol: target.crossSymbolName,
      tickSizeText: target.tickSize,
      stepSizeText: target.stepSize,
      pricePrecision: Math.max(target.indexPriceDecimals ?? 0, tickDecimals),
      quantityPrecision: stepDecimals
    };
  }

  private async fetchDepthSnapshot(symbol: string): Promise<DepthSnapshotInput> {
    const response = await fetch(`${APEX_REST}/api/v3/depth?symbol=${encodeURIComponent(symbol)}&limit=200`);

    if (!response.ok) {
      throw new Error(`ApeX depth snapshot failed: ${response.status}`);
    }

    const payload = (await response.json()) as ApexDepthResponse;

    if (!payload.data) {
      throw new Error(`ApeX depth snapshot missing data for ${symbol}`);
    }

    return normalizeDepthSnapshot(payload.data);
  }

  private scheduleReconnect(reason: string): void {
    if (this.disposed || this.reconnectTimer !== null) {
      return;
    }

    this.clearPingTimer();
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
          this.symbol || "MUSDT",
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
