import { useState, type FormEvent } from "react";
import { normalizeSymbol } from "../core/math";
import type { ExchangeId } from "../core/types";
import { DomLadderWidget } from "../react/DomLadderWidget";

const EXCHANGE_PRESETS: Record<ExchangeId, { symbol: string; title: string; copy: string }> = {
  "binance-usdm": {
    symbol: "SIRENUSDT",
    title: "Binance USDT-M DOM",
    copy: "This scaffold self-subscribes to Binance USD-M Futures and renders a live ladder with book depth and footprint buckets."
  },
  "apex-omni": {
    symbol: "M",
    title: "ApeX Omni DOM",
    copy: "This scaffold self-subscribes to ApeX Omni public market data and renders a live DOM with order-book depth, prints, and clusters."
  }
};

export function App() {
  const [exchange, setExchange] = useState<ExchangeId>("apex-omni");
  const [draftSymbol, setDraftSymbol] = useState(EXCHANGE_PRESETS["apex-omni"].symbol);
  const [activeSymbol, setActiveSymbol] = useState(EXCHANGE_PRESETS["apex-omni"].symbol);
  const [compression, setCompression] = useState(10);

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setActiveSymbol(normalizeSymbol(draftSymbol) || EXCHANGE_PRESETS[exchange].symbol);
  }

  function handleExchangeChange(nextExchange: ExchangeId): void {
    setExchange(nextExchange);
    setDraftSymbol(EXCHANGE_PRESETS[nextExchange].symbol);
    setActiveSymbol(EXCHANGE_PRESETS[nextExchange].symbol);
  }

  return (
    <main className="demo-shell">
      <section className="demo-copy">
        <p className="demo-eyebrow">Embeddable Ladder Widget</p>
        <h1>DOM + clusters for web integration</h1>
        <p className="demo-body">
          The host project only passes a symbol. {EXCHANGE_PRESETS[exchange].copy}
        </p>

        <form className="demo-form" onSubmit={handleSubmit}>
          <label className="demo-label" htmlFor="exchange">
            Exchange
          </label>
          <select
            id="exchange"
            className="demo-input demo-select"
            value={exchange}
            onChange={(event) => handleExchangeChange(event.target.value as ExchangeId)}
          >
            <option value="apex-omni">ApeX Omni</option>
            <option value="binance-usdm">Binance USDT-M</option>
          </select>
          <label className="demo-label" htmlFor="symbol">
            Test symbol
          </label>
          <input
            id="symbol"
            className="demo-input"
            value={draftSymbol}
            onChange={(event) => setDraftSymbol(event.target.value)}
            placeholder={EXCHANGE_PRESETS[exchange].symbol}
          />
          <label className="demo-label" htmlFor="compression">
            Compression
          </label>
          <select
            id="compression"
            className="demo-input demo-select"
            value={compression}
            onChange={(event) => setCompression(Number(event.target.value))}
          >
            {[1, 2, 5, 10, 20, 50].map((value) => (
              <option key={value} value={value}>
                x{value}
              </option>
            ))}
          </select>
          <button className="demo-button" type="submit">
            Apply
          </button>
        </form>

        <pre className="demo-snippet">{`<stakan-dom-ladder exchange="${exchange}" symbol="${activeSymbol}" compression="${compression}"></stakan-dom-ladder>`}</pre>
      </section>

      <section className="demo-widget">
        <DomLadderWidget exchange={exchange} symbol={activeSymbol} compression={compression} title={EXCHANGE_PRESETS[exchange].title} />
      </section>
    </main>
  );
}
