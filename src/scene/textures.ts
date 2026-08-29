"use client";
/**
 * Procedural floor textures drawn on a canvas at load time: 13 cm oak planks with ±3 % luminance
 * jitter, faintly noised stone and speckled terrazzo. Deterministic (seeded) and palette-only.
 */
import { useMemo } from "react";
import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from "three";
import type { Floor } from "../tokens";
import { floorHex, mix, palette } from "../tokens";

/** Metres covered by one texture tile, per floor kind. */
const TILE_M: Record<Floor, number> = { oak: 2.08, "pale-oak": 2.08, stone: 1.6, terrazzo: 1.28 };
const SIZE = 1024;

/** Deterministic 32-bit hash PRNG so every render of a scene draws the identical floor. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

/** Shifts a palette hex by a small luminance delta without leaving the palette. */
function shade(hex: string, delta: number): string {
  return delta >= 0 ? mix(hex, palette.plaster, delta) : mix(hex, palette.charcoal, -delta);
}

function drawPlanks(context: CanvasRenderingContext2D, base: string): void {
  const random = rng(0x9e37);
  const rows = 16;
  const rowHeight = SIZE / rows;
  // Seams are drawn ~4 px wide (≈0.8 cm) so they survive mip-mapping at studio distance.
  for (let row = 0; row < rows; row += 1) {
    const top = row * rowHeight;
    context.fillStyle = shade(base, (random() - 0.5) * 0.13);
    context.fillRect(0, top, SIZE, rowHeight);
    for (let grain = 0; grain < 6; grain += 1) {
      context.fillStyle = shade(base, (random() - 0.5) * 0.06);
      context.fillRect(0, top + 4 + random() * (rowHeight - 8), SIZE, 1 + random() * 2);
    }
    const ends = [random(), 0.5 + random() * 0.4];
    context.fillStyle = "rgba(62,58,54,0.16)";
    for (const end of ends) context.fillRect(Math.floor(end * SIZE), top, 4, rowHeight);
    context.fillStyle = "rgba(62,58,54,0.15)";
    context.fillRect(0, top, SIZE, 3.5);
    context.fillStyle = "rgba(244,239,230,0.16)";
    context.fillRect(0, top + 3.5, SIZE, 2);
  }
}

function drawStone(context: CanvasRenderingContext2D, base: string): void {
  const random = rng(0x51ed);
  for (let i = 0; i < 9000; i += 1) {
    const light = random() > 0.5;
    context.fillStyle = light ? "rgba(244,239,230,0.14)" : "rgba(62,58,54,0.07)";
    context.fillRect(random() * SIZE, random() * SIZE, 2, 2);
  }
  context.fillStyle = shade(base, -0.02);
  for (let i = 0; i < 60; i += 1) {
    const x = random() * SIZE;
    const y = random() * SIZE;
    context.globalAlpha = 0.18;
    context.beginPath();
    context.ellipse(x, y, 40 + random() * 90, 30 + random() * 70, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 1;
  }
}

function drawTerrazzo(context: CanvasRenderingContext2D): void {
  const random = rng(0x2c1a);
  const chips = [palette.sage, palette.terracotta, palette.dustyBlue, palette.charcoal, palette.ochre];
  for (let i = 0; i < 620; i += 1) {
    const chip = chips[Math.floor(random() * chips.length)] as string;
    context.fillStyle = chip;
    context.globalAlpha = 0.16 + random() * 0.16;
    context.beginPath();
    context.ellipse(random() * SIZE, random() * SIZE, 3 + random() * 9, 3 + random() * 7, random() * Math.PI, 0, Math.PI * 2);
    context.fill();
  }
  context.globalAlpha = 1;
}

const cache = new Map<Floor, CanvasTexture>();

/** Builds (and caches) the tiling colour map for a floor kind; returns null on the server. */
export function floorTexture(floor: Floor): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  const cached = cache.get(floor);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const base = floorHex(floor);
  context.fillStyle = base;
  context.fillRect(0, 0, SIZE, SIZE);
  if (floor === "oak" || floor === "pale-oak") drawPlanks(context, base);
  else if (floor === "stone") drawStone(context, base);
  else drawTerrazzo(context);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  const repeat = 1 / TILE_M[floor];
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  cache.set(floor, texture);
  return texture;
}

let ringCache: CanvasTexture | null = null;

/**
 * A soft annulus with a feathered edge, used for the selection halo and the placement dust ring —
 * no hard outlines anywhere in the studio (STYLE.md §2).
 */
export function softRingTexture(): CanvasTexture | null {
  if (typeof document === "undefined") return null;
  if (ringCache) return ringCache;
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (!context) return null;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0)");
  gradient.addColorStop(0.52, "rgba(255,255,255,0.05)");
  gradient.addColorStop(0.78, "rgba(255,255,255,0.92)");
  gradient.addColorStop(0.93, "rgba(255,255,255,0.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.needsUpdate = true;
  ringCache = texture;
  return texture;
}

/** Memoised soft ring sprite. */
export function useSoftRing(): CanvasTexture | null {
  return useMemo(() => softRingTexture(), []);
}

/** Memoised floor colour map for a room. */
export function useFloorTexture(floor: Floor): CanvasTexture | null {
  return useMemo(() => floorTexture(floor), [floor]);
}
