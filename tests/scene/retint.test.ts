import { describe, expect, it } from "vitest";
import { familyHex, hexToOklab, lampEmissiveIntensity, nearestPaletteFamily, oklabDistance, retintPlan } from "@/src/scene/retint";
import type { SourceMaterial } from "@/src/scene/retint";
import { colorways, palette } from "@/src/tokens";

describe("nearest palette family", () => {
  it("maps every palette family onto itself", () => {
    for (const [id, entry] of Object.entries(colorways)) {
      expect(nearestPaletteFamily(entry.hex)).toBe(id);
    }
  });

  it("maps arbitrary albedos to a plausible family", () => {
    expect(nearestPaletteFamily("#C97A55")).toBe("terracotta");
    expect(nearestPaletteFamily("#7B8F6E")).toBe("sage");
    expect(nearestPaletteFamily("#6E86A0")).toBe("dusty-blue");
    expect(nearestPaletteFamily("#FFFFFF")).toBe("plaster");
    expect(nearestPaletteFamily("#000000")).toBe("charcoal");
    expect(nearestPaletteFamily("#DBC6A6")).toBe("oak");
  });

  it("weights lightness so a near-neutral dark reads charcoal, not an accent", () => {
    expect(nearestPaletteFamily("#4A423A")).toBe("charcoal");
    expect(nearestPaletteFamily("#3B3833")).toBe("charcoal");
  });

  it("keeps a mid brown in the timber family instead of drifting to plum", () => {
    expect(nearestPaletteFamily("#8A7355")).toBe("oak");
    // A very dark brown carries almost no hue, so it lands on the dark neutral family.
    expect(nearestPaletteFamily("#5C4433")).toBe("charcoal");
  });

  it("is a metric: identical colours have zero distance", () => {
    const lab = hexToOklab(palette.sage);
    expect(oklabDistance(lab, lab)).toBeCloseTo(0, 9);
    expect(oklabDistance(lab, hexToOklab(palette.terracotta))).toBeGreaterThan(0.1);
  });

  it("exposes the family hex", () => {
    expect(familyHex("ochre")).toBe(palette.ochre);
  });
});

describe("retint plan", () => {
  const materials: SourceMaterial[] = [
    { name: "Frame", hex: "#8A7355", area: 2 },
    { name: "Upholstery", hex: "#B9BFAE", area: 40 },
    { name: "Feet", hex: "#3B3833", area: 0.4 },
  ];

  it("gives the item colorway to the largest surface group", () => {
    const plan = retintPlan(materials, palette.terracotta, "sofa");
    expect(plan[1]?.dominant).toBe(true);
    expect(plan[1]?.hex).toBe(palette.terracotta.toUpperCase());
    expect(plan[0]?.dominant).toBe(false);
    expect(plan[2]?.dominant).toBe(false);
  });

  it("snaps every other group to its nearest palette family", () => {
    const plan = retintPlan(materials, palette.terracotta, "sofa");
    expect(plan[0]?.family).toBe("oak");
    expect(plan[0]?.hex).toBe(familyHex("oak"));
    expect(plan[2]?.family).toBe("charcoal");
    expect(plan[2]?.hex).toBe(familyHex("charcoal"));
  });

  it("stays matte clay: metalness 0 and roughness in 0.85–0.95", () => {
    for (const entry of retintPlan(materials, palette.sage, "sofa")) {
      expect(entry.metalness).toBe(0);
      expect(entry.roughness).toBeGreaterThanOrEqual(0.85);
      expect(entry.roughness).toBeLessThanOrEqual(0.95);
    }
  });

  it("keeps an ochre emissive on lamp shades only", () => {
    const lamp: SourceMaterial[] = [
      { name: "Stem", hex: "#3B3833", area: 3 },
      { name: "Shade", hex: "#EFE7DB", area: 9 },
    ];
    const plan = retintPlan(lamp, palette.ochre, "floor-lamp");
    expect(plan[1]?.emissive).toBe(palette.ochre);
    expect(plan[0]?.emissive).toBeUndefined();
    const sofa = retintPlan(lamp, palette.ochre, "sofa");
    expect(sofa.every((entry) => entry.emissive === undefined)).toBe(true);
  });

  it("falls back to the dominant group when a lamp has no named shade", () => {
    const lamp: SourceMaterial[] = [
      { name: "base", hex: "#3B3833", area: 3 },
      { name: "body", hex: "#EFE7DB", area: 9 },
    ];
    const plan = retintPlan(lamp, palette.ochre, "table-lamp");
    expect(plan[1]?.emissive).toBe(palette.ochre);
  });

  it("turns lamps on at dusk only, above the bloom threshold", () => {
    expect(lampEmissiveIntensity("morning")).toBe(0);
    expect(lampEmissiveIntensity("noon")).toBe(0);
    expect(lampEmissiveIntensity("golden")).toBeGreaterThan(0);
    expect(lampEmissiveIntensity("evening")).toBeGreaterThan(lampEmissiveIntensity("golden") * 4);
  });
});
