import { createRoot, type Root } from "react-dom/client";
import widgetCssText from "../styles/widget.css?inline";
import { DomLadderWidget } from "../react/DomLadderWidget";

class StakanDomLadderElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ["symbol", "exchange", "title", "visible-levels", "compression"];
  }

  private root: Root | null = null;
  private mountNode: HTMLDivElement | null = null;

  connectedCallback(): void {
    if (!this.shadowRoot) {
      const shadowRoot = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = widgetCssText;
      shadowRoot.append(style);

      this.mountNode = document.createElement("div");
      shadowRoot.append(this.mountNode);
      this.root = createRoot(this.mountNode);
    }

    this.renderWidget();
  }

  disconnectedCallback(): void {
    this.root?.unmount();
    this.root = null;
    this.mountNode = null;
  }

  attributeChangedCallback(): void {
    this.renderWidget();
  }

  private renderWidget(): void {
    if (!this.root) {
      return;
    }

    const visibleLevelsValue = Number(this.getAttribute("visible-levels") ?? "48");

    this.root.render(
      <DomLadderWidget
        symbol={this.getAttribute("symbol") ?? "SIRENUSDT"}
        exchange={(this.getAttribute("exchange") as "binance-usdm" | "apex-omni" | null) ?? "binance-usdm"}
        title={this.getAttribute("title") ?? undefined}
        visibleLevels={Number.isFinite(visibleLevelsValue) ? visibleLevelsValue : 48}
        compression={Math.max(1, Number(this.getAttribute("compression") ?? "10") || 10)}
      />
    );
  }
}

export function defineStakanDomElement(tagName = "stakan-dom-ladder"): void {
  if (!customElements.get(tagName)) {
    customElements.define(tagName, StakanDomLadderElement);
  }
}
