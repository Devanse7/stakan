import type { CSSProperties } from "react";
import type { DomWidgetOptions } from "../core/types";
import { createApexOmniFeed } from "../feeds/apexOmniFeed";
import { createBinanceUsdMFeed } from "../feeds/binanceUsdMFeed";
import { LadderCanvasBody, STAKAN_ZONE_TEMPLATE } from "./LadderCanvasBody";
import { useLadderFeed } from "./useLadderFeed";

export interface DomLadderWidgetProps extends DomWidgetOptions {}

export function DomLadderWidget({
  symbol,
  exchange = "binance-usdm",
  visibleLevels = 48,
  compression = 10,
  title,
  feedFactory
}: DomLadderWidgetProps) {
  const resolvedTitle = title ?? (exchange === "apex-omni" ? "ApeX Omni DOM" : "Binance USDT-M DOM");
  const resolvedFeedFactory = feedFactory ?? (exchange === "apex-omni" ? createApexOmniFeed : createBinanceUsdMFeed);
  const snapshot = useLadderFeed(symbol, visibleLevels, compression, resolvedFeedFactory);
  const zoneStyle = {
    gridTemplateColumns: STAKAN_ZONE_TEMPLATE,
    justifyContent: "end"
  } as CSSProperties;

  return (
    <section className="stakan-widget">
      <header className="stakan-header">
        <div className="stakan-title-block">
          <span className="stakan-kicker">Stakan</span>
          <strong className="stakan-title">{resolvedTitle}</strong>
        </div>
        <div className="stakan-meta">
          <span className={`stakan-status stakan-status--${snapshot.connection}`}>{snapshot.connection}</span>
          <span className="stakan-symbol">{snapshot.symbol}</span>
          <span className="stakan-spread">
            spread {snapshot.spread === null ? "--" : snapshot.spread.toFixed(snapshot.meta?.pricePrecision ?? 5)}
          </span>
        </div>
      </header>

      <div className="stakan-strip">
        <span>best bid {snapshot.bestBid === null ? "--" : snapshot.bestBid.toFixed(snapshot.meta?.pricePrecision ?? 5)}</span>
        <span>best ask {snapshot.bestAsk === null ? "--" : snapshot.bestAsk.toFixed(snapshot.meta?.pricePrecision ?? 5)}</span>
        <span>step x{snapshot.compression}</span>
        <span>
          last {snapshot.lastTrade === null ? "--" : snapshot.lastTrade.price.toFixed(snapshot.meta?.pricePrecision ?? 5)}{" "}
          {snapshot.lastTrade?.side ?? ""}
        </span>
      </div>

      <div className="stakan-grid stakan-grid--header" style={zoneStyle}>
        <div className="stakan-cell stakan-cell--label">clusters</div>
        <div className="stakan-cell stakan-cell--label">prints</div>
        <div className="stakan-cell stakan-cell--label">ladder</div>
      </div>

      <LadderCanvasBody
        rows={snapshot.rows}
        lastTrade={snapshot.lastTrade}
        recentPrints={snapshot.recentPrints}
        compression={snapshot.compression}
        bestBidUnits={snapshot.bestBidUnits}
        bestAskUnits={snapshot.bestAskUnits}
        clusterMinuteStarts={snapshot.clusterMinuteStarts}
      />

      <footer className="stakan-footer">{snapshot.connectionDetails}</footer>
    </section>
  );
}
