import { describe, expect, it } from "vitest";
import { DOLLHOUSE_PITCH, furnitureOpacity } from "@/src/scene/math";
import { templateLabel } from "@/src/engine";
import { humanizeConfirmMessage, templateConfirmMessage } from "@/src/ui/templates";

const DEG = Math.PI / 180;
/** The framed room's centre, in world centimetres. */
const CENTRE = { x: 260, y: 220 };
/** Half-extents of a wardrobe's footprint, in metres. */
const WARDROBE = { x: 0.8, z: 0.25 };

/**
 * The furniture cut-away (src/scene/math.ts). The wall in front of the framed room is cut away, so
 * the neighbour's wardrobe standing behind it has to go with it — measured on the same edges.
 */
describe("furnitureOpacity", () => {
  it("keeps a piece behind the framed centre fully opaque", () => {
    // The camera is at the south-west corner, so "behind" is north-east of the centre.
    const azimuth = -45 * DEG;
    expect(furnitureOpacity({ x: 460, y: 40 }, WARDROBE, CENTRE, azimuth, DOLLHOUSE_PITCH)).toBe(1);
  });

  it("cuts a piece standing well in front of the framed centre", () => {
    const azimuth = -45 * DEG;
    // 3 m south-west of the centre: between the camera and the room.
    expect(furnitureOpacity({ x: 50, y: 430 }, WARDROBE, CENTRE, azimuth, DOLLHOUSE_PITCH)).toBe(0);
  });

  it("fades across the same band the walls use, rather than switching off", () => {
    const azimuth = -45 * DEG;
    const near = furnitureOpacity({ x: 250, y: 230 }, WARDROBE, CENTRE, azimuth, DOLLHOUSE_PITCH);
    const far = furnitureOpacity({ x: 230, y: 250 }, WARDROBE, CENTRE, azimuth, DOLLHOUSE_PITCH);
    expect(near).toBeGreaterThan(0);
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
  });

  it("cuts nothing from almost directly above, exactly as the walls do", () => {
    expect(furnitureOpacity({ x: 50, y: 430 }, WARDROBE, CENTRE, -45 * DEG, 85 * DEG)).toBe(1);
  });

  it("cuts nothing while the whole home is framed", () => {
    expect(furnitureOpacity({ x: 50, y: 430 }, WARDROBE, CENTRE, -45 * DEG, DOLLHOUSE_PITCH, { cutInFront: false })).toBe(1);
  });

  it("follows the camera round: the same piece is in front from one corner and behind from another", () => {
    const piece = { x: 50, y: 430 };
    expect(furnitureOpacity(piece, WARDROBE, CENTRE, -45 * DEG, DOLLHOUSE_PITCH)).toBe(0);
    expect(furnitureOpacity(piece, WARDROBE, CENTRE, 135 * DEG, DOLLHOUSE_PITCH)).toBe(1);
  });
});

/** The confirmation copy (src/ui/templates.ts): a human is never told the agent asked, or shown `1br`. */
describe("template confirmation copy", () => {
  it("names the layout the way the chooser names it", () => {
    expect(templateConfirmMessage("1br")).toBe("Replace this home with the 1 bedroom layout?");
    expect(templateConfirmMessage("5br")).toBe("Replace this home with the 5 bedrooms layout?");
    expect(templateConfirmMessage("loft")).toBe(`Replace this home with the ${templateLabel("loft")} layout?`);
  });

  it("rewrites the tool's own question into the same sentence", () => {
    // The shape apply_template asks in today. The string the *live* tool produces is fed through
    // this same function by tests/tools/handlers.test.ts, so the regex cannot go stale again.
    expect(humanizeConfirmMessage("Replace this home and its 24 placed items with the 5 bedrooms layout?"))
      .toBe("Replace this home with the 5 bedrooms layout?");
    expect(humanizeConfirmMessage("Replace this home and its 1 placed items with the Studio layout?"))
      .toBe("Replace this home with the Studio layout?");
  });

  it("still rewrites the shape the tool asked in before engine-owned labels", () => {
    expect(humanizeConfirmMessage("Replace this home and its 24 placed items with the 5br template?"))
      .toBe("Replace this home with the 5 bedrooms layout?");
    expect(humanizeConfirmMessage("Replace this home and its 1 placed items with the studio template?"))
      .toBe("Replace this home with the Studio layout?");
  });

  it("passes any other question through untouched", () => {
    const other = "Clear Living Room and remove its 7 placed items?";
    expect(humanizeConfirmMessage(other)).toBe(other);
  });
});
