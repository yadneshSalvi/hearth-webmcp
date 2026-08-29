import { describe, expect, it } from "vitest";
import {
  NO_INSETS, clampInsets, foldInset, insetCentreOffsetPx, insetHalfScale, visibleAspect,
} from "@/src/scene/insets";

/** The 1440 × 900 sign-off viewport with the studio's own panel geometry. */
const VIEWPORT = { width: 1440, height: 900 };
const CATALOG = { left: 20, right: 348, top: 92, bottom: 812 };
const INSPECTOR = { left: 1076, right: 1420, top: 92, bottom: 812 };
const TOP_BAR = { left: 20, right: 1420, top: 20, bottom: 76 };
const PROMPT_BAR = { left: 20, right: 1250, top: 826, bottom: 880 };

function studioInsets() {
  return clampInsets(
    [CATALOG, INSPECTOR, TOP_BAR, PROMPT_BAR].reduce((insets, rect) => foldInset(insets, rect, VIEWPORT), NO_INSETS),
    VIEWPORT,
  );
}

describe("canvas insets", () => {
  it("reads a tall narrow panel as the side it hugs", () => {
    expect(foldInset(NO_INSETS, CATALOG, VIEWPORT).left).toBe(348);
    expect(foldInset(NO_INSETS, INSPECTOR, VIEWPORT).right).toBe(1440 - 1076);
  });

  it("reads a wide short bar as the edge it sits against", () => {
    expect(foldInset(NO_INSETS, TOP_BAR, VIEWPORT).top).toBe(76);
    expect(foldInset(NO_INSETS, PROMPT_BAR, VIEWPORT).bottom).toBe(900 - 826);
  });

  it("measures the studio's own 1440 × 900 chrome", () => {
    // Each side panel is 348/364 px wide, and 24 % of 1440 is 346: the wider one gives a little back
    // rather than squeezing the room into a 728 px slot.
    expect(studioInsets()).toEqual({ left: 346, right: 346, top: 76, bottom: 74 });
  });

  it("ignores chrome too thin to reframe for, and never lets one edge crowd out the room", () => {
    const chip = { left: 1300, right: 1420, top: 826, bottom: 862 };
    expect(clampInsets(foldInset(NO_INSETS, chip, VIEWPORT), VIEWPORT).bottom).toBe(0);
    expect(clampInsets({ ...NO_INSETS, left: 900 }, VIEWPORT).left).toBe(Math.round(1440 * 0.24));
  });

  it("frames to the visible rect, not the window", () => {
    const insets = studioInsets();
    // 1440 × 900 minus the panels is 748 × 750 — square, where the window is 1.6 : 1.
    expect(visibleAspect(VIEWPORT, insets)).toBeCloseTo(748 / 750, 4);
    expect(visibleAspect(VIEWPORT, NO_INSETS)).toBeCloseTo(1.6, 4);
    // …so the frustum has to be 1.2× taller than the fit for the visible rect alone.
    expect(insetHalfScale(VIEWPORT, insets)).toBeCloseTo(900 / 750, 4);
    expect(insetHalfScale(VIEWPORT, NO_INSETS)).toBe(1);
  });

  it("stops the panels shrinking the hero room past a point", () => {
    // A tall pair of panels on a short window would otherwise scale the room away entirely.
    const narrow = { width: 1280, height: 620 };
    expect(insetHalfScale(narrow, { left: 0, right: 0, top: 120, bottom: 120 })).toBeCloseTo(1.2, 4);
    expect(visibleAspect(narrow, clampInsets({ left: 600, right: 600, top: 0, bottom: 0 }, narrow)))
      .toBeCloseTo((1280 - 2 * Math.round(1280 * 0.24)) / 620, 4);
  });

  it("offsets the frame toward the free space", () => {
    // The studio's own panels are near enough symmetric that the frame barely moves; a collapsed
    // one is what actually shifts it.
    expect(insetCentreOffsetPx(studioInsets())).toEqual({ x: 0, y: 1 });
    expect(insetCentreOffsetPx({ ...NO_INSETS, left: 300 })).toEqual({ x: 150, y: 0 });
    expect(insetCentreOffsetPx(NO_INSETS)).toEqual({ x: 0, y: 0 });
  });
});
