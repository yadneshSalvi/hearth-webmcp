"use client";
/**
 * The design-board painter. Draws the composed board onto a 2D canvas at 1600 × 1000 using the same
 * tokens the studio does (STYLE.md §1): plaster cards, hairline rules, Fraunces for the title and
 * every number, Inter for the small-caps labels. No layout decisions live here — they come from
 * `boardCompose.ts`, so the composition is testable and the painting is mechanical.
 */
import { ink, palette, radius } from "../tokens";
import {
  BOARD_HEIGHT, BOARD_WIDTH, boardLayout, fitImage, listRowHeight, truncateToWidth,
} from "./boardCompose";
import type { BoardModel, BoardRect } from "./boardCompose";

export interface BoardImages {
  dollhouse: CanvasImageSource & { width: number; height: number };
  plan: CanvasImageSource & { width: number; height: number };
}

interface Fonts {
  display: string;
  sans: string;
}

const CAPS_TRACKING = "1.3px";

/** The real family names next/font generated, read from the tokens on <html>. */
function readFonts(): Fonts {
  const styles = typeof window === "undefined" ? undefined : getComputedStyle(document.documentElement);
  const read = (name: string): string => styles?.getPropertyValue(name).trim() ?? "";
  return {
    display: read("--font-fraunces") || 'Fraunces, Georgia, serif',
    sans: read("--font-inter") || 'Inter, system-ui, sans-serif',
  };
}

function roundRect(ctx: CanvasRenderingContext2D, box: BoardRect, r: number = radius.panel): void {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(box.x, box.y, box.w, box.h, r);
    return;
  }
  ctx.moveTo(box.x + r, box.y);
  ctx.arcTo(box.x + box.w, box.y, box.x + box.w, box.y + box.h, r);
  ctx.arcTo(box.x + box.w, box.y + box.h, box.x, box.y + box.h, r);
  ctx.arcTo(box.x, box.y + box.h, box.x, box.y, r);
  ctx.arcTo(box.x, box.y, box.x + box.w, box.y, r);
  ctx.closePath();
}

function caps(ctx: CanvasRenderingContext2D, fonts: Fonts, size = 11): void {
  ctx.font = `500 ${size}px ${fonts.sans}`;
  ctx.letterSpacing = CAPS_TRACKING;
}

function clearTracking(ctx: CanvasRenderingContext2D): void {
  ctx.letterSpacing = "0px";
}

function rule(ctx: CanvasRenderingContext2D, x: number, y: number, w: number): void {
  ctx.fillStyle = ink.hairline;
  ctx.fillRect(x, y, w, 1);
}

/** The Hearth mark: a circle half filled in terracotta, the wordmark's only ornament. */
function mark(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  ctx.strokeStyle = palette.terracotta;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = palette.terracotta;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI / 2, (Math.PI * 3) / 2);
  ctx.closePath();
  ctx.fill();
}

function frame(ctx: CanvasRenderingContext2D, box: BoardRect): void {
  ctx.save();
  roundRect(ctx, box);
  ctx.fillStyle = palette.plaster;
  ctx.fill();
  ctx.restore();
}

function stroke(ctx: CanvasRenderingContext2D, box: BoardRect): void {
  ctx.save();
  roundRect(ctx, box);
  ctx.strokeStyle = ink.hairline;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

function drawImageIn(ctx: CanvasRenderingContext2D, image: BoardImages["dollhouse"], box: BoardRect): void {
  frame(ctx, box);
  const fit = fitImage({ w: image.width, h: image.height }, box);
  ctx.save();
  roundRect(ctx, box);
  ctx.clip();
  ctx.drawImage(image, fit.sx, fit.sy, fit.sw, fit.sh, fit.dx, fit.dy, fit.dw, fit.dh);
  ctx.restore();
  stroke(ctx, box);
}

function drawHead(ctx: CanvasRenderingContext2D, model: BoardModel, fonts: Fonts): void {
  const layout = boardLayout();
  const markX = layout.markRight - 9;

  caps(ctx, fonts);
  ctx.textAlign = "right";
  ctx.fillStyle = ink.muted;
  ctx.fillText("HEARTH STUDIO", markX - 26, layout.titleBaseline - 20);
  clearTracking(ctx);
  ctx.textAlign = "left";
  mark(ctx, markX, layout.titleBaseline - 25, 9);

  const titleWidth = BOARD_WIDTH - layout.pad * 2 - 200;
  ctx.font = `600 54px ${fonts.display}`;
  ctx.fillStyle = ink.text;
  ctx.fillText(
    truncateToWidth(model.title, titleWidth, (value) => ctx.measureText(value).width),
    layout.pad,
    layout.titleBaseline,
  );

  caps(ctx, fonts, 12);
  ctx.fillStyle = ink.muted;
  ctx.fillText(model.caps, layout.pad, layout.capsBaseline);
  clearTracking(ctx);

  rule(ctx, layout.pad, layout.headRuleY, BOARD_WIDTH - layout.pad * 2);
}

function drawPalette(ctx: CanvasRenderingContext2D, model: BoardModel, fonts: Fonts): void {
  const box = boardLayout().palette;
  frame(ctx, box);
  stroke(ctx, box);

  caps(ctx, fonts);
  ctx.fillStyle = ink.muted;
  ctx.fillText("PALETTE", box.x + 24, box.y + 32);
  clearTracking(ctx);

  const columns = Math.max(1, model.swatches.length);
  const columnWidth = (box.w - 48) / columns;
  const size = 64;
  const top = box.y + 34 + Math.max(0, (box.h - 34 - size) / 2);
  model.swatches.forEach((swatch, index) => {
    const x = box.x + 24 + index * columnWidth;
    const chip: BoardRect = { x, y: top, w: size, h: size };
    ctx.save();
    roundRect(ctx, chip, 14);
    ctx.fillStyle = swatch.hex;
    ctx.fill();
    ctx.strokeStyle = ink.hairline;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    caps(ctx, fonts, 10);
    ctx.fillStyle = ink.faint;
    ctx.fillText(swatch.label.toUpperCase(), x + size + 18, top + 26);
    clearTracking(ctx);
    ctx.font = `500 16px ${fonts.sans}`;
    ctx.fillStyle = ink.text;
    ctx.fillText(
      truncateToWidth(swatch.name, columnWidth - size - 34, (value) => ctx.measureText(value).width),
      x + size + 18,
      top + 50,
    );
  });
}

function drawList(ctx: CanvasRenderingContext2D, model: BoardModel, fonts: Fonts): void {
  const box = boardLayout().list;
  const priceX = box.x + box.w;
  const nameWidth = box.w - 96;

  caps(ctx, fonts);
  ctx.fillStyle = ink.muted;
  ctx.fillText("ITEMS", box.x, box.y + 12);
  clearTracking(ctx);

  const rowHeight = listRowHeight(model.rows.length, box.h, model.moreLine !== undefined);
  let y = box.y + 40;
  for (const row of model.rows) {
    ctx.font = `500 14px ${fonts.sans}`;
    ctx.fillStyle = ink.text;
    ctx.textAlign = "left";
    ctx.fillText(truncateToWidth(row.name, nameWidth, (value) => ctx.measureText(value).width), box.x, y + 12);

    ctx.font = `500 14.5px ${fonts.display}`;
    ctx.textAlign = "right";
    ctx.fillText(row.price, priceX, y + 12);

    ctx.font = `400 11.5px ${fonts.sans}`;
    ctx.fillStyle = ink.faint;
    ctx.textAlign = "left";
    ctx.fillText(truncateToWidth(row.meta, nameWidth, (value) => ctx.measureText(value).width), box.x, y + 28);

    rule(ctx, box.x, y + 36, box.w);
    y += rowHeight;
  }

  if (model.moreLine) {
    ctx.font = `italic 400 13px ${fonts.display}`;
    ctx.fillStyle = ink.muted;
    ctx.textAlign = "left";
    ctx.fillText(model.moreLine, box.x, y + 12);
  }

  const totalY = box.y + box.h - 34;
  rule(ctx, box.x, totalY - 26, box.w);
  caps(ctx, fonts, 12);
  ctx.fillStyle = ink.muted;
  ctx.textAlign = "left";
  ctx.fillText("TOTAL", box.x, totalY);
  clearTracking(ctx);
  ctx.font = `600 30px ${fonts.display}`;
  ctx.fillStyle = ink.text;
  ctx.textAlign = "right";
  ctx.fillText(model.total, priceX, totalY + 4);
  ctx.textAlign = "left";
}

function drawFoot(ctx: CanvasRenderingContext2D, model: BoardModel, fonts: Fonts): void {
  const layout = boardLayout();
  rule(ctx, layout.pad, layout.footRuleY, BOARD_WIDTH - layout.pad * 2);
  ctx.font = `400 13px ${fonts.sans}`;
  ctx.fillStyle = ink.muted;
  ctx.textAlign = "left";
  ctx.fillText(model.footerLeft, layout.pad, layout.footBaseline);
  caps(ctx, fonts);
  ctx.fillStyle = ink.faint;
  ctx.textAlign = "right";
  ctx.fillText(model.footerRight, BOARD_WIDTH - layout.pad, layout.footBaseline);
  clearTracking(ctx);
  ctx.textAlign = "left";
}

/** Paints the whole board. Every colour is a token; nothing here is random. */
export function paintBoard(ctx: CanvasRenderingContext2D, model: BoardModel, images: BoardImages): void {
  const layout = boardLayout();
  const gradient = ctx.createLinearGradient(0, 0, 0, BOARD_HEIGHT);
  gradient.addColorStop(0, palette.canvasTop);
  gradient.addColorStop(1, palette.canvasBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, BOARD_WIDTH, BOARD_HEIGHT);

  const fonts = readFonts();
  ctx.textBaseline = "alphabetic";
  drawHead(ctx, model, fonts);
  drawImageIn(ctx, images.dollhouse, layout.dollhouse);
  drawImageIn(ctx, images.plan, layout.plan);
  drawPalette(ctx, model, fonts);
  drawList(ctx, model, fonts);
  drawFoot(ctx, model, fonts);
}

/** Paints the board into a fresh canvas and hands back a PNG blob. */
export async function renderBoard(model: BoardModel, images: BoardImages): Promise<Blob> {
  if (document.fonts?.ready) await document.fonts.ready;
  const canvas = document.createElement("canvas");
  canvas.width = BOARD_WIDTH;
  canvas.height = BOARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("The design board needs a 2D canvas context");
  paintBoard(ctx, model, images);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The design board could not be encoded as a PNG");
  return blob;
}
