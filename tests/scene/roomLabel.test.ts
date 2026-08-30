import { describe, expect, it } from "vitest";
import { LABEL_PX, MIN_PX, fitRoomLabel, labelWidthPx } from "@/src/scene/roomLabel";

/**
 * Plan-view room labels size themselves to the room they name (src/scene/roomLabel.ts). The 5BR's
 * "Bedroom Hall" over a 1.2 m hall is the case that used to come apart into one word per line.
 */
describe("fitRoomLabel", () => {
  it("leaves a label that fits at its resting size", () => {
    const fitted = fitRoomLabel("Living Room", 400);
    expect(fitted.fontPx).toBe(LABEL_PX);
    expect(fitted.wraps).toBe(false);
  });

  it("shrinks a name that is a little too wide, and only as far as it has to", () => {
    const name = "Family Bathroom";
    const tight = labelWidthPx(name, LABEL_PX) * 0.9;
    const fitted = fitRoomLabel(name, tight);
    expect(fitted.fontPx).toBeLessThan(LABEL_PX);
    expect(fitted.fontPx).toBeGreaterThanOrEqual(MIN_PX);
    expect(fitted.wraps).toBe(false);
    expect(labelWidthPx(name, fitted.fontPx)).toBeLessThanOrEqual(tight + 0.5);
  });

  it("never goes below the legible floor, and wraps instead", () => {
    const fitted = fitRoomLabel("Bedroom Hall", 40);
    expect(fitted.fontPx).toBe(MIN_PX);
    expect(fitted.wraps).toBe(true);
    expect(fitted.maxWidthPx).toBe(40);
  });

  it("holds its size steady: the same room measured twice gives the same number", () => {
    const first = fitRoomLabel("Kitchen & Dining", 96.4);
    const second = fitRoomLabel("Kitchen & Dining", 96.41);
    expect(second.fontPx).toBe(first.fontPx);
  });

  it("falls back to the resting size when the room has not been measured yet", () => {
    expect(fitRoomLabel("Hall", 0).fontPx).toBe(LABEL_PX);
    expect(fitRoomLabel("Hall", Number.NaN).fontPx).toBe(LABEL_PX);
  });
});
