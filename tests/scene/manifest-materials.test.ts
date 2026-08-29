import { describe, expect, it } from "vitest";
import manifest from "@/data/assets.manifest.json";
import { catalogSource } from "@/data/catalog.source";
import { hexToOklab, materialRole, nearestPaletteFamily, retintPlan, SHADE_HEX, POT_HEX } from "@/src/scene/retint";
import type { MaterialRole } from "@/src/scene/retint";
import type { CatalogItem } from "@/src/engine/types";
import { colorways, palette } from "@/src/tokens";

interface ManifestRow {
  id: string;
  materials: string[];
  bbox_cm: { w: number; d: number; h: number };
  rotationY: number;
}

const rows = manifest as ManifestRow[];
const byId = new Map<string, CatalogItem>(catalogSource.map((item) => [item.id, item]));
const uniqueNames = [...new Set(rows.flatMap((row) => row.materials))].sort();

const PALETTE_LAB = Object.values(palette).map(hexToOklab);

/**
 * Distance in the Oklab chroma plane from a colour to the nearest palette token, ignoring lightness.
 * Every re-tinted colour must sit on a palette hue: lightness is free (that is how a variant is
 * made), hue and chroma are not, so a foreign albedo leaking through is caught here.
 */
function paletteChromaDistance(hex: string): number {
  const lab = hexToOklab(hex);
  let best = Infinity;
  for (const family of PALETTE_LAB) best = Math.min(best, Math.hypot(lab.a - family.a, lab.b - family.b));
  return best;
}

/** Widest gap measured across all 71 shipped assets is 0.042; palette families sit 0.05+ apart. */
const MAX_CHROMA_DRIFT = 0.05;

describe("manifest coverage", () => {
  it("has one row per catalog product", () => {
    expect(rows).toHaveLength(catalogSource.length);
    for (const row of rows) expect(byId.get(row.id), row.id).toBeDefined();
  });

  it("bakes every model to its catalog width so normalisation is a no-op", () => {
    for (const row of rows) {
      const product = byId.get(row.id) as CatalogItem;
      expect(row.bbox_cm.w, row.id).toBeCloseTo(product.dims.w, 2);
    }
  });
});

describe("manifest material names map to palette families", () => {
  it("classifies every shipped material name", () => {
    const unresolved = uniqueNames.filter((name) => {
      const role = materialRole(name);
      // A name with no role still resolves: the albedo falls back to a palette family.
      return role === "unknown" && !/material|texture|treats|grey|white|red|orange/i.test(name);
    });
    expect(unresolved).toEqual([]);
  });

  it("puts the shipped wood, metal, textile, foliage, book and lamp names in the right role", () => {
    const expected: Record<string, MaterialRole> = {
      Wood: "timber", Wood1: "timber", Wood2: "timber", Wood_Dark: "timber", Wood_Light: "timber",
      DarkWood: "timber", wood: "timber", Brown: "timber", Legs: "timber",
      Metal: "metal", metal: "metal", metalDark: "metal", metalMedium: "metal", LightMetal: "metal", Black: "metal",
      Sofa: "textile", Couch_Blue: "textile", Couch_Mustard: "textile", Comforter: "textile",
      ComforterLight: "textile", Mattress: "textile", PillowCover: "textile",
      carpet: "textile", carpetDarker: "textile", carpetWhite: "textile",
      Plant_Green: "leaf",
      Cover1: "book", Cover2: "book", Cover3: "book", Cover4: "book", Cover5: "book", Cover6: "book",
      Pages: "paper",
      lamp: "shade", Light: "shade",
    };
    for (const [name, role] of Object.entries(expected)) {
      expect(materialRole(name), name).toBe(role);
      expect(uniqueNames, `${name} is no longer shipped`).toContain(name);
    }
  });

  it("never lands a hueless source colour on a saturated family", () => {
    for (const hex of ["#7D7C7B", "#686868", "#A09F9D", "#E6E6E6", "#323232", "#FFFFFF"]) {
      expect(["plaster", "oak", "charcoal"], hex).toContain(nearestPaletteFamily(hex));
    }
  });

  it("resolves every material of every shipped asset to a palette-derived colour", () => {
    for (const row of rows) {
      const product = byId.get(row.id) as CatalogItem;
      const colorway = product.colorways[0];
      expect(colorway, row.id).toBeDefined();
      const plan = retintPlan(
        row.materials.map((name, index) => ({ name, hex: "#FFFFFF", area: row.materials.length - index })),
        (colorway as { hex: string }).hex,
        product.category,
      );
      expect(plan, row.id).toHaveLength(row.materials.length);
      for (const entry of plan) {
        expect(entry.metalness, `${row.id}/${entry.name}`).toBe(0);
        expect(entry.roughness, `${row.id}/${entry.name}`).toBeGreaterThanOrEqual(0.55);
        expect(entry.roughness, `${row.id}/${entry.name}`).toBeLessThanOrEqual(0.95);
        expect(entry.hex, `${row.id}/${entry.name}`).toMatch(/^#[0-9A-F]{6}$/);
        expect(paletteChromaDistance(entry.hex), `${row.id}/${entry.name} → ${entry.hex}`).toBeLessThan(MAX_CHROMA_DRIFT);
      }
    }
  });

  it("carries the item colorway family on every asset that is not all foliage or all shade", () => {
    for (const row of rows) {
      const product = byId.get(row.id) as CatalogItem;
      const hex = (product.colorways[0] as { hex: string }).hex.toUpperCase();
      const plan = retintPlan(
        row.materials.map((name, index) => ({ name, hex: "#FFFFFF", area: row.materials.length - index })),
        hex,
        product.category,
      );
      const roles = new Set(plan.map((entry) => entry.role));
      const allDecorative = [...roles].every((role) => role === "leaf" || role === "shade");
      if (product.category === "plant" || allDecorative) continue;
      const dominant = plan.find((entry) => entry.dominant);
      expect(dominant, row.id).toBeDefined();
      // Rugs lift their field toward plaster, so match the family rather than the exact hex.
      expect(nearestPaletteFamily((dominant as { hex: string }).hex), row.id).toBe(nearestPaletteFamily(hex));
    }
  });

  it("keeps foliage sage, pots clay and lamp shades warm across the whole catalog", () => {
    const plants = rows.filter((row) => byId.get(row.id)?.category === "plant");
    expect(plants.length).toBeGreaterThan(0);
    for (const row of plants) {
      const plan = retintPlan(
        row.materials.map((name, index) => ({ name, hex: "#FFFFFF", area: row.materials.length - index })),
        colorways.sage.hex,
        "plant",
      );
      for (const entry of plan) {
        const allowed = [palette.sage.toUpperCase(), POT_HEX.toUpperCase()];
        expect(allowed, `${row.id}/${entry.name}`).toContain(entry.hex.toUpperCase());
      }
    }
    const lamps = rows.filter((row) => {
      const category = byId.get(row.id)?.category;
      return category === "floor-lamp" || category === "table-lamp";
    });
    expect(lamps.length).toBe(10);
    for (const row of lamps) {
      const product = byId.get(row.id) as CatalogItem;
      const plan = retintPlan(
        row.materials.map((name, index) => ({ name, hex: "#FFFFFF", area: row.materials.length - index })),
        (product.colorways[0] as { hex: string }).hex,
        product.category,
      );
      expect(plan.some((entry) => entry.emissive !== undefined), row.id).toBe(true);
      const shade = plan.find((entry) => entry.role === "shade");
      if (shade) expect(shade.hex.toUpperCase(), row.id).toBe(SHADE_HEX.toUpperCase());
    }
  });
});
