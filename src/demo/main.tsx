import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { defineStakanDomElement } from "../web-component/defineDomLadderElement";
import "../styles/demo.css";
import "../styles/widget.css";

defineStakanDomElement();

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root not found");
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);

