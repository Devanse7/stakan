import { useEffect, useRef, useState } from "react";
import { clampRatio, formatCompactNumber } from "../core/math";
import type { LadderRow, LastTrade } from "../core/types";

const CLUSTER_ZONE_TARGET_WIDTH = 156;
const PRINTS_ZONE_TARGET_WIDTH = 112;
const LADDER_ZONE_TARGET_WIDTH = 156;

export const STAKAN_ZONE_TEMPLATE = `${CLUSTER_ZONE_TARGET_WIDTH}px ${PRINTS_ZONE_TARGET_WIDTH}px ${LADDER_ZONE_TARGET_WIDTH}px`;
const DESKTOP_ROW_HEIGHT = 24;
const MOBILE_ROW_HEIGHT = 22;
const FONT_STACK = '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';
const BOOK_FULL_SIZE = 10_000;
const CLUSTER_FULL_SIZE = 40_000;
const CLUSTER_MINUTE_COLUMNS = 8;
const PRINT_SMALL_THRESHOLD = 1_000;

interface LadderCanvasBodyProps {
  rows: LadderRow[];
  lastTrade: LastTrade | null;
  recentPrints: LastTrade[];
  compression: number;
  bestBidUnits: number | null;
  bestAskUnits: number | null;
  clusterMinuteStarts: number[];
}

interface ZoneMetric {
  x: number;
  width: number;
}

interface LadderMetric {
  x: number;
  width: number;
  sizeX: number;
  sizeWidth: number;
  priceX: number;
  priceWidth: number;
}

interface PrintBatch {
  id: string;
  side: LastTrade["side"];
  quantity: number;
  timestamp: number;
  minPriceUnits: number;
  maxPriceUnits: number;
  latestPriceUnits: number;
}

const THEME = {
  bodyBackground: "rgba(255, 255, 255, 0.015)",
  grid: "rgba(128, 153, 161, 0.09)",
  text: "#dce8e9",
  muted: "#8ba0a7",
  ask: "#de6c7c",
  bid: "#56b87a",
  buyCluster: "rgba(130, 220, 166, 0.68)",
  sellCluster: "rgba(255, 154, 165, 0.68)",
  askBook: "rgba(222, 108, 124, 0.78)",
  bidBook: "rgba(86, 184, 122, 0.78)",
  askLaneFill: "rgba(222, 108, 124, 0.08)",
  bidLaneFill: "rgba(86, 184, 122, 0.08)",
  insideAskFill: "rgba(222, 108, 124, 0.30)",
  insideBidFill: "rgba(86, 184, 122, 0.30)",
  spreadFill: "rgba(255, 255, 255, 0.04)",
  printBuy: "rgba(130, 220, 166, 0.92)",
  printSell: "rgba(255, 154, 165, 0.92)",
  priceText: "#f0f5f5"
} as const;

const PRINT_BATCH_MS = 200;

function getRowHeight(width: number): number {
  return width <= 720 ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT;
}

function measureZones(width: number): ZoneMetric[] {
  const targets = [CLUSTER_ZONE_TARGET_WIDTH, PRINTS_ZONE_TARGET_WIDTH, LADDER_ZONE_TARGET_WIDTH] as const;
  const totalTargetWidth = targets.reduce((sum, target) => sum + target, 0);
  const scale = width < totalTargetWidth ? width / totalTargetWidth : 1;
  const scaledWidths = targets.map((target) => target * scale);
  const usedWidth = scaledWidths.reduce((sum, scaledWidth) => sum + scaledWidth, 0);
  const zones: ZoneMetric[] = [];
  let cursor = Math.max(0, width - usedWidth);

  scaledWidths.forEach((scaledWidth, index) => {
    const nextWidth = index === scaledWidths.length - 1 ? width - cursor : scaledWidth;
    zones.push({
      x: cursor,
      width: nextWidth
    });
    cursor += nextWidth;
  });

  return zones;
}

function measureLadder(zone: ZoneMetric): LadderMetric {
  const sizeWidth = Math.max(44, Math.floor(zone.width / 2));
  const priceWidth = Math.max(44, zone.width - sizeWidth);

  return {
    x: zone.x,
    width: zone.width,
    sizeX: zone.x,
    sizeWidth,
    priceX: zone.x + sizeWidth,
    priceWidth
  };
}

function drawText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  height: number,
  align: CanvasTextAlign,
  fill: string
): void {
  if (!text) {
    return;
  }

  const padding = 6;
  ctx.fillStyle = fill;
  ctx.textAlign = align;
  const textX = align === "left" ? x + padding : align === "right" ? x + width - padding : x + width / 2;
  ctx.fillText(text, textX, y + height / 2);
}

function drawHorizontalFill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  fillRatio: number,
  fill: string,
  align: "left" | "right"
): void {
  if (fillRatio <= 0 || width <= 4 || height <= 4) {
    return;
  }

  const insetX = 2;
  const insetY = 2;
  const innerWidth = Math.max(0, width - insetX * 2);
  const innerHeight = Math.max(0, height - insetY * 2);
  const barWidth = Math.max(2, innerWidth * fillRatio);
  const startX = align === "left" ? x + insetX : x + width - insetX - barWidth;

  ctx.fillStyle = fill;
  ctx.fillRect(startX, y + insetY, barWidth, innerHeight);
}

function drawCluster(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  rowHeight: number,
  row: LadderRow,
  clusterMinuteCount: number
): void {
  if (clusterMinuteCount <= 0 || width <= 0) {
    return;
  }

  const minuteColumnWidth = width / clusterMinuteCount;
  const startSlotIndex = Math.max(0, clusterMinuteCount - row.clusterCells.length);

  for (let minuteSlotIndex = 0; minuteSlotIndex < clusterMinuteCount; minuteSlotIndex += 1) {
    const clusterCellIndex = minuteSlotIndex - startSlotIndex;
    const clusterCell = clusterCellIndex >= 0 ? row.clusterCells[clusterCellIndex] : undefined;

    if (!clusterCell || clusterCell.totalVolume <= 0) {
      continue;
    }

    const fillRatio = clampRatio(clusterCell.totalVolume / CLUSTER_FULL_SIZE);
    const fill = clusterCell.delta >= 0 ? THEME.buyCluster : THEME.sellCluster;
    const cellX = x + minuteSlotIndex * minuteColumnWidth;

    drawHorizontalFill(ctx, cellX, y, minuteColumnWidth, rowHeight, fillRatio, fill, "left");

    if (minuteColumnWidth >= 12) {
      const clusterText = formatCompactNumber(clusterCell.totalVolume, 0);
      const previousFont = ctx.font;
      const fontSize = minuteColumnWidth < 18 ? 9 : 10;
      ctx.font = `${fontSize}px ${FONT_STACK}`;
      drawText(ctx, clusterText, cellX, y, minuteColumnWidth, rowHeight, "center", THEME.text);
      ctx.font = previousFont;
    }
  }
}

function drawPrints(
  ctx: CanvasRenderingContext2D,
  x: number,
  width: number,
  rowHeight: number,
  rows: LadderRow[],
  recentPrints: LastTrade[]
): void {
  if (recentPrints.length === 0) {
    return;
  }

  const rowStepUnits = rows.length > 1 ? Math.abs(rows[0].priceUnits - rows[1].priceUnits) : 1;
  const visiblePriceUnits = new Set(rows.map((row) => row.priceUnits));
  const batchedPrints = new Map<string, PrintBatch>();

  for (const print of recentPrints) {
    const bucketPriceUnits = Math.floor(print.priceUnits / rowStepUnits) * rowStepUnits;

    if (!visiblePriceUnits.has(bucketPriceUnits)) {
      continue;
    }

    const timeBucket = Math.floor(print.timestamp / PRINT_BATCH_MS);
    const key = `${print.side}:${timeBucket}`;
    const existing = batchedPrints.get(key);

    if (existing) {
      existing.quantity += print.quantity;
      existing.timestamp = Math.max(existing.timestamp, print.timestamp);
      existing.minPriceUnits = Math.min(existing.minPriceUnits, bucketPriceUnits);
      existing.maxPriceUnits = Math.max(existing.maxPriceUnits, bucketPriceUnits);
      if (existing.timestamp === print.timestamp) {
        existing.latestPriceUnits = bucketPriceUnits;
      }
    } else {
      batchedPrints.set(key, {
        id: key,
        side: print.side,
        quantity: print.quantity,
        timestamp: print.timestamp,
        minPriceUnits: bucketPriceUnits,
        maxPriceUnits: bucketPriceUnits,
        latestPriceUnits: bucketPriceUnits
      });
    }
  }

  const visiblePrints = [...batchedPrints.values()]
    .sort((left, right) => right.timestamp - left.timestamp)
    .slice(0, 18);

  if (visiblePrints.length === 0) {
    return;
  }

  const rowYByPrice = new Map<number, number>();
  rows.forEach((row, index) => {
    rowYByPrice.set(row.priceUnits, index * rowHeight + rowHeight / 2);
  });

  const maxLargePrintQuantity = visiblePrints.reduce(
    (max, print) => (print.quantity >= PRINT_SMALL_THRESHOLD ? Math.max(max, print.quantity) : max),
    PRINT_SMALL_THRESHOLD
  );

  visiblePrints.forEach((print, index) => {
    const minY = rowYByPrice.get(print.minPriceUnits);
    const maxY = rowYByPrice.get(print.maxPriceUnits);

    if (minY === undefined || maxY === undefined) {
      return;
    }

    const topY = Math.min(minY, maxY);
    const bottomY = Math.max(minY, maxY);
    const centerY = (topY + bottomY) / 2;
    const latestY = rowYByPrice.get(print.latestPriceUnits) ?? centerY;

    const progress = visiblePrints.length === 1 ? 1 : 1 - index / (visiblePrints.length - 1);
    const cx = x + 12 + progress * Math.max(0, width - 24);
    const isSmallPrint = print.quantity < PRINT_SMALL_THRESHOLD;
    const radius = isSmallPrint
      ? 2
      : 4 + clampRatio((print.quantity - PRINT_SMALL_THRESHOLD) / Math.max(1, maxLargePrintQuantity - PRINT_SMALL_THRESHOLD)) * 8;

    ctx.globalAlpha = 0.35 + progress * 0.65;
    ctx.fillStyle = print.side === "buy" ? THEME.printBuy : THEME.printSell;

    if (isSmallPrint || bottomY - topY < rowHeight * 0.65) {
      ctx.beginPath();
      ctx.arc(cx, latestY, radius, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const capsuleTop = topY - radius;
      const capsuleHeight = Math.max(radius * 2, bottomY - topY + radius * 2);
      const capsuleWidth = radius * 2;

      ctx.beginPath();
      ctx.roundRect(cx - radius, capsuleTop, capsuleWidth, capsuleHeight, radius);
      ctx.fill();
    }

    ctx.globalAlpha = 1;

    if (!isSmallPrint) {
      ctx.font = `${Math.max(8, Math.min(11, radius))}px ${FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.fillStyle = "#08110d";
      ctx.fillText(formatCompactNumber(print.quantity, 0), cx, centerY);
      ctx.font = `12px ${FONT_STACK}`;
      ctx.textAlign = "left";
    }
  });
}

function drawLadderBook(
  ctx: CanvasRenderingContext2D,
  ladder: LadderMetric,
  y: number,
  rowHeight: number,
  row: LadderRow,
  askBandTop: number | null,
  askBandBottom: number | null,
  bidBandTop: number | null,
  bidBandBottom: number | null
): void {
  const askRatio = clampRatio(row.askSize / BOOK_FULL_SIZE);
  const bidRatio = clampRatio(row.bidSize / BOOK_FULL_SIZE);

  if (row.askSize > 0 && askBandTop !== null && askBandBottom !== null && askBandBottom > askBandTop) {
    drawHorizontalFill(ctx, ladder.sizeX, askBandTop, ladder.sizeWidth, askBandBottom - askBandTop, askRatio, THEME.askBook, "right");
    drawText(
      ctx,
      formatCompactNumber(row.askSize),
      ladder.sizeX,
      askBandTop,
      ladder.sizeWidth,
      Math.max(12, askBandBottom - askBandTop),
      "right",
      THEME.text
    );
  }

  if (row.bidSize > 0 && bidBandTop !== null && bidBandBottom !== null && bidBandBottom > bidBandTop) {
    drawHorizontalFill(ctx, ladder.sizeX, bidBandTop, ladder.sizeWidth, bidBandBottom - bidBandTop, bidRatio, THEME.bidBook, "right");
    drawText(
      ctx,
      formatCompactNumber(row.bidSize),
      ladder.sizeX,
      bidBandTop,
      ladder.sizeWidth,
      Math.max(12, bidBandBottom - bidBandTop),
      "right",
      THEME.text
    );
  }
}

function drawInsideRowHighlight(
  ctx: CanvasRenderingContext2D,
  ladder: LadderMetric,
  top: number,
  height: number,
  fill: string
): void {
  const rectTop = top + 1;
  const rectHeight = Math.max(1, height - 2);
  const rectLeft = ladder.x + 1;
  const rectWidth = Math.max(1, ladder.width - 2);

  ctx.fillStyle = fill;
  ctx.fillRect(rectLeft, rectTop, rectWidth, rectHeight);
}

function drawLadderRowBackground(
  ctx: CanvasRenderingContext2D,
  ladder: LadderMetric,
  top: number,
  height: number,
  fill: string
): void {
  const rectLeft = ladder.x + 1;
  const rectTop = top + 1;
  const rectWidth = Math.max(1, ladder.width - 2);
  const rectHeight = Math.max(1, height - 2);

  ctx.fillStyle = fill;
  ctx.fillRect(rectLeft, rectTop, rectWidth, rectHeight);
}

function getPriceYPosition(rows: LadderRow[], rowHeight: number, priceUnits: number | null): number | null {
  if (priceUnits === null || rows.length === 0) {
    return null;
  }

  const rowStepUnits = rows.length > 1 ? Math.abs(rows[0].priceUnits - rows[1].priceUnits) : 1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const rowUpperBound = row.priceUnits + rowStepUnits;

    if (priceUnits >= row.priceUnits && priceUnits < rowUpperBound) {
      const relativeOffset = (rowUpperBound - priceUnits) / rowStepUnits;
      return index * rowHeight + rowHeight * relativeOffset;
    }
  }

  return null;
}

function renderLadder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  rowHeight: number,
  rows: LadderRow[],
  _lastTrade: LastTrade | null,
  recentPrints: LastTrade[],
  compression: number,
  bestBidUnits: number | null,
  bestAskUnits: number | null,
  clusterMinuteStarts: number[]
): void {
  const zones = measureZones(width);
  const ladder = measureLadder(zones[2]);
  const clusterMinuteCount = Math.max(CLUSTER_MINUTE_COLUMNS, clusterMinuteStarts.length, rows[0]?.clusterCells.length ?? 0);
  const rowStepUnits = rows.length > 1 ? Math.abs(rows[0].priceUnits - rows[1].priceUnits) : 1;
  const askLineY = getPriceYPosition(rows, rowHeight, bestAskUnits);
  const bidLineY = getPriceYPosition(rows, rowHeight, bestBidUnits);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = THEME.bodyBackground;
  ctx.fillRect(0, 0, width, height);

  ctx.font = `12px ${FONT_STACK}`;
  ctx.textBaseline = "middle";

  for (let zoneIndex = 1; zoneIndex < zones.length; zoneIndex += 1) {
    const lineX = Math.round(zones[zoneIndex].x) + 0.5;
    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    ctx.moveTo(lineX, 0);
    ctx.lineTo(lineX, height);
    ctx.stroke();
  }

  if (clusterMinuteCount > 1) {
    const clusterZone = zones[0];
    const minuteColumnWidth = clusterZone.width / clusterMinuteCount;

    for (let minuteIndex = 1; minuteIndex < clusterMinuteCount; minuteIndex += 1) {
      const lineX = Math.round(clusterZone.x + minuteIndex * minuteColumnWidth) + 0.5;
      ctx.strokeStyle = "rgba(128, 153, 161, 0.07)";
      ctx.beginPath();
      ctx.moveTo(lineX, 0);
      ctx.lineTo(lineX, height);
      ctx.stroke();
    }
  }

  drawPrints(ctx, zones[1].x, zones[1].width, rowHeight, rows, recentPrints);

  if (askLineY !== null && bidLineY !== null) {
    const spreadTop = Math.min(askLineY, bidLineY);
    const spreadBottom = Math.max(askLineY, bidLineY);

    ctx.fillStyle = THEME.spreadFill;
    ctx.fillRect(ladder.x + 2, spreadTop, Math.max(0, ladder.width - 4), Math.max(1, spreadBottom - spreadTop));
  }

  rows.forEach((row, index) => {
    const y = index * rowHeight;
    const lineY = Math.round(y + rowHeight) + 0.5;
    const rowLowerBound = row.priceUnits;
    const rowUpperBound = row.priceUnits + rowStepUnits;
    const containsBestAsk = bestAskUnits !== null && bestAskUnits >= rowLowerBound && bestAskUnits < rowUpperBound;
    const containsBestBid = bestBidUnits !== null && bestBidUnits >= rowLowerBound && bestBidUnits < rowUpperBound;
    const rowTop = y;

    drawCluster(ctx, zones[0].x, y, zones[0].width, rowHeight, row, clusterMinuteCount);

    if (row.askSize > 0 && row.bidSize > 0) {
      const halfHeight = rowHeight / 2;
      drawLadderRowBackground(ctx, ladder, rowTop, halfHeight, THEME.askLaneFill);
      drawLadderRowBackground(ctx, ladder, rowTop + halfHeight, rowHeight - halfHeight, THEME.bidLaneFill);
    } else if (row.askSize > 0) {
      drawLadderRowBackground(ctx, ladder, rowTop, rowHeight, THEME.askLaneFill);
    } else if (row.bidSize > 0) {
      drawLadderRowBackground(ctx, ladder, rowTop, rowHeight, THEME.bidLaneFill);
    }

    if (containsBestAsk && containsBestBid) {
      const halfHeight = rowHeight / 2;
      drawInsideRowHighlight(ctx, ladder, rowTop, halfHeight, THEME.insideAskFill);
      drawInsideRowHighlight(ctx, ladder, rowTop + halfHeight, rowHeight - halfHeight, THEME.insideBidFill);
    } else if (containsBestAsk) {
      drawInsideRowHighlight(ctx, ladder, rowTop, rowHeight, THEME.insideAskFill);
    } else if (containsBestBid) {
      drawInsideRowHighlight(ctx, ladder, rowTop, rowHeight, THEME.insideBidFill);
    }

    const askBandTop = row.askSize > 0 ? y : null;
    const askBandBottom = row.askSize > 0 ? (containsBestAsk && askLineY !== null ? askLineY : y + rowHeight) : null;
    const bidBandTop = row.bidSize > 0 ? (containsBestBid && bidLineY !== null ? bidLineY : y) : null;
    const bidBandBottom = row.bidSize > 0 ? y + rowHeight : null;

    drawLadderBook(ctx, ladder, y, rowHeight, row, askBandTop, askBandBottom, bidBandTop, bidBandBottom);

    drawText(ctx, row.priceText, ladder.priceX, y, ladder.priceWidth, rowHeight, "right", THEME.priceText);

    ctx.strokeStyle = THEME.grid;
    ctx.beginPath();
    ctx.moveTo(0, lineY);
    ctx.lineTo(width, lineY);
    ctx.stroke();
  });

  ctx.fillStyle = THEME.muted;
  ctx.textAlign = "left";
  ctx.fillText(`x${compression}`, zones[2].x + 6, 12);
}

export function LadderCanvasBody({
  rows,
  lastTrade,
  recentPrints,
  compression,
  bestBidUnits,
  bestAskUnits,
  clusterMinuteStarts
}: LadderCanvasBodyProps) {
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const shell = shellRef.current;

    if (!shell) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const nextWidth = entries[0]?.contentRect.width ?? shell.clientWidth;
      setWidth(Math.floor(nextWidth));
    });

    observer.observe(shell);
    setWidth(Math.floor(shell.clientWidth));

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || width <= 0) {
      return;
    }

    const rowHeight = getRowHeight(width);
    const bodyHeight = Math.max(rowHeight * rows.length, rowHeight * 8);
    const dpr = window.devicePixelRatio || 1;

    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(bodyHeight * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${bodyHeight}px`;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderLadder(
      ctx,
      width,
      bodyHeight,
      rowHeight,
      rows,
      lastTrade,
      recentPrints,
      compression,
      bestBidUnits,
      bestAskUnits,
      clusterMinuteStarts
    );
  }, [bestAskUnits, bestBidUnits, clusterMinuteStarts, compression, lastTrade, recentPrints, rows, width]);

  if (rows.length === 0) {
    return (
      <div className="stakan-body" ref={shellRef}>
        <div className="stakan-empty">Waiting for snapshot and trades</div>
      </div>
    );
  }

  return (
    <div className="stakan-body" ref={shellRef}>
      <canvas className="stakan-canvas" ref={canvasRef} />
    </div>
  );
}
