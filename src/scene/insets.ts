"use client";
/**
 * How much of the canvas the floating chrome covers. The canvas is full-bleed and the panels float
 * over it (STYLE.md §4), so framing a room to the *window* hides its west third under the catalog
 * and its east third under the inspector. The camera rig frames to the visible rect instead.
 *
 * The rect is measured from the DOM rather than duplicating the shell's blueprint: anything marked
 * `data-studio-inset` reports its own box, so collapsing a panel, a narrower tier or a future panel
 * all move the framing without this module knowing the layout.
 */
import { useEffect, useState } from "react";
import { useHearthStore } from "../state/store";

export interface CanvasInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const NO_INSETS: CanvasInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/** Chrome thinner than this is a chip or a rail badge, not something worth reframing for. */
const MIN_INSET_PX = 24;

/**
 * Most a single edge may claim. Two 350 px panels over a 1280 px window would otherwise leave the
 * hero room a 570 px square to live in, and a room drawn that small is its own composition problem
 * (STYLE.md §4) — past this point the panels are allowed to overlap the room's outer edge again.
 */
const MAX_INSET_FRACTION = 0.24;

/** Ceiling on how much the panels may shrink the framed room, for the same reason. */
const MAX_HALF_SCALE = 1.2;

/** A side panel covers at least this fraction of the viewport height; anything less is a bar. */
const SIDE_PANEL_HEIGHT_FRACTION = 0.3;

/** A bar spans at least this fraction of the viewport width; a small floating chip does not. */
const BAR_WIDTH_FRACTION = 0.25;

export interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

/**
 * Folds one piece of chrome into the insets. A tall narrow box is a side panel (the side it hugs
 * decides which inset grows); a wide short one is the top or the prompt bar; anything smaller is
 * left alone.
 */
export function foldInset(insets: CanvasInsets, rect: Rect, viewport: Viewport): CanvasInsets {
  const width = rect.right - rect.left;
  const height = rect.bottom - rect.top;
  if (width <= 0 || height <= 0) return insets;
  if (height >= viewport.height * SIDE_PANEL_HEIGHT_FRACTION && width < viewport.width / 2) {
    return rect.left + width / 2 < viewport.width / 2
      ? { ...insets, left: Math.max(insets.left, rect.right) }
      : { ...insets, right: Math.max(insets.right, viewport.width - rect.left) };
  }
  // Neither tall enough to be a panel nor wide enough to be a bar: a chip, and the room can sit
  // behind it without anyone minding.
  if (width < viewport.width * BAR_WIDTH_FRACTION) return insets;
  return rect.top + height / 2 < viewport.height / 2
    ? { ...insets, top: Math.max(insets.top, rect.bottom) }
    : { ...insets, bottom: Math.max(insets.bottom, viewport.height - rect.top) };
}

/** Drops insets too small to matter and trims any that would crowd the room out of its own frame. */
export function clampInsets(insets: CanvasInsets, viewport: Viewport): CanvasInsets {
  const keep = (value: number, extent: number) =>
    (value < MIN_INSET_PX ? 0 : Math.round(Math.min(value, extent * MAX_INSET_FRACTION)));
  return {
    left: keep(insets.left, viewport.width),
    right: keep(insets.right, viewport.width),
    top: keep(insets.top, viewport.height),
    bottom: keep(insets.bottom, viewport.height),
  };
}

/** The visible rect's aspect ratio, which is what a framed room has to fit inside. */
export function visibleAspect(viewport: Viewport, insets: CanvasInsets): number {
  const width = Math.max(1, viewport.width - insets.left - insets.right);
  const height = Math.max(1, viewport.height - insets.top - insets.bottom);
  return width / height;
}

/**
 * How much taller the full-canvas frustum has to be than the visible one, so a room that fits the
 * visible rect keeps fitting once the panels are counted back in.
 */
export function insetHalfScale(viewport: Viewport, insets: CanvasInsets): number {
  const visible = Math.max(1, viewport.height - insets.top - insets.bottom);
  return Math.min(MAX_HALF_SCALE, viewport.height / visible);
}

/**
 * Where the visible rect's centre sits relative to the canvas centre, in CSS pixels: `x` positive
 * means the free space is to the right of centre, `y` positive means below it.
 */
export function insetCentreOffsetPx(insets: CanvasInsets): { x: number; y: number } {
  return { x: (insets.left - insets.right) / 2, y: (insets.top - insets.bottom) / 2 };
}

function measure(): CanvasInsets {
  if (typeof document === "undefined") return NO_INSETS;
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  let insets = NO_INSETS;
  for (const node of document.querySelectorAll<HTMLElement>("[data-studio-inset]")) {
    if (node.offsetParent === null) continue;
    insets = foldInset(insets, node.getBoundingClientRect(), viewport);
  }
  return clampInsets(insets, viewport);
}

function same(a: CanvasInsets, b: CanvasInsets): boolean {
  return a.left === b.left && a.right === b.right && a.top === b.top && a.bottom === b.bottom;
}

/**
 * The chrome's insets, re-measured after paint whenever something could have moved a panel: the
 * window resizing (which also mounts and unmounts panels as the tier changes) and the store flags
 * that collapse them. Deliberately *not* a MutationObserver over the document: the canvas draws its
 * dimension labels through `drei/Html`, so the body mutates on every frame of a drag, and
 * re-measuring there would force a layout per frame in the middle of the one interaction that can
 * least afford it.
 */
export function useCanvasInsets(): CanvasInsets {
  const [insets, setInsets] = useState<CanvasInsets>(NO_INSETS);
  const panelKey = useHearthStore(
    (state) => `${state.ui.catalogCollapsed ?? ""}|${state.ui.inspectorCollapsed ?? ""}|${state.ui.cartOpen ?? ""}|${state.ui.boardOpen}`,
  );

  useEffect(() => {
    let frame = 0;
    const remeasure = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setInsets((current) => {
          const next = measure();
          return same(current, next) ? current : next;
        });
      });
    };
    remeasure();

    // Panels animate in (`rise-in`), so their first measured box is not their settled one.
    const settle = setTimeout(remeasure, 400);
    const observer = new ResizeObserver(remeasure);
    for (const node of document.querySelectorAll("[data-studio-inset]")) observer.observe(node);
    window.addEventListener("resize", remeasure, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener("resize", remeasure);
    };
  }, [panelKey]);

  return insets;
}
