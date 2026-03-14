import type { SymbolMeta } from "./types";

export interface PriceScale {
  scale: number;
  tickSizeUnits: number;
  priceDecimals: number;
}

function countDecimals(value: string): number {
  const trimmed = value.replace(/0+$/, "");
  const fraction = trimmed.includes(".") ? trimmed.split(".")[1] : "";
  return fraction.length;
}

export function normalizeSymbol(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function createPriceScale(meta: SymbolMeta): PriceScale {
  const tickDecimals = countDecimals(meta.tickSizeText);
  const priceDecimals = Math.max(meta.pricePrecision, tickDecimals);
  const scale = 10 ** priceDecimals;
  const tickSizeUnits = Math.max(1, Math.round(Number(meta.tickSizeText) * scale));

  return {
    scale,
    tickSizeUnits,
    priceDecimals
  };
}

export function priceToUnits(price: number | string, scale: PriceScale): number {
  return Math.round(Number(price) * scale.scale);
}

export function unitsToPrice(priceUnits: number, scale: PriceScale): number {
  return priceUnits / scale.scale;
}

export function formatPrice(priceUnits: number, scale: PriceScale): string {
  return unitsToPrice(priceUnits, scale).toFixed(scale.priceDecimals);
}

export function formatCompactNumber(value: number, fractionDigits = 1): string {
  const absolute = Math.abs(value);

  if (absolute >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(fractionDigits)}M`;
  }

  if (absolute >= 1_000) {
    return `${(value / 1_000).toFixed(fractionDigits)}K`;
  }

  if (absolute >= 100) {
    return value.toFixed(0);
  }

  if (absolute >= 10) {
    return value.toFixed(1);
  }

  if (absolute >= 1) {
    return value.toFixed(2);
  }

  return value.toFixed(3);
}

export function clampRatio(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

