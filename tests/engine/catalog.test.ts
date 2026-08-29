import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { colorways } from "../../src/tokens";
import { CATEGORIES } from "../../src/engine/types";
import { createCatalog, nextItemId, resolveColorway } from "../../src/engine/catalog";

const catalog = createCatalog(catalogSource);
const styleTags = new Set(["scandinavian", "japandi", "mid-century", "rustic", "modern", "coastal"]);

describe("built-in catalog", () => {
  it("covers every category with enough realistic products", () => {
    expect(catalogSource.length).toBeGreaterThanOrEqual(64);
    expect(catalogSource.length).toBeLessThanOrEqual(80);
    for (const category of CATEGORIES) {
      const items = catalog.byCategory(category);
      expect(items.length).toBeGreaterThanOrEqual(category === "rug" || category.includes("lamp") || category === "plant" || category === "decor" ? 4 : 3);
      expect(items.every((item) => item.category === category)).toBe(true);
    }
  });

  it("keeps every record sane, unique, token-backed and asset-addressable", () => {
    const ids = new Set<string>();
    for (const item of catalogSource) {
      expect(item.id).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)+$/);
      expect(ids.has(item.id)).toBe(false);
      ids.add(item.id);
      expect(item.name.length).toBeGreaterThan(3);
      expect(item.dims.w).toBeGreaterThan(0);
      expect(item.dims.d).toBeGreaterThan(0);
      expect(item.dims.h).toBeGreaterThan(0);
      expect(Number.isInteger(item.dims.w) && Number.isInteger(item.dims.d) && Number.isInteger(item.dims.h), item.id).toBe(true);
      expect(item.price).toBeGreaterThan(0);
      expect(item.glb).toBe(`/assets/glb/${item.id}.glb`);
      expect(item.description?.length).toBeGreaterThan(20);
      expect(item.description?.length).toBeLessThanOrEqual(200);
      expect(item.colorways.length).toBeGreaterThanOrEqual(2);
      expect(item.colorways.length).toBeLessThanOrEqual(4);
      expect(new Set(item.colorways.map((entry) => entry.id)).size).toBe(item.colorways.length);
      for (const entry of item.colorways) {
        expect(entry.id in colorways).toBe(true);
        expect(entry.name).toBe(colorways[entry.id].name);
        expect(entry.hex).toBe(colorways[entry.id].hex);
      }
      expect(item.styleTags.length).toBeGreaterThan(0);
      expect(item.styleTags.every((tag) => styleTags.has(tag))).toBe(true);
    }
    expect(ids.size).toBe(catalogSource.length);
  });

  it("contains all tool-contract products with exact anchor data", () => {
    const required = ["sofa-endre", "armchair-nook", "rug-loop", "desk-aalto", "bed-birk", "lamp-glow", "tv-unit-linje", "wardrobe-hald"];
    for (const id of required) expect(catalog.byId(id)?.id).toBe(id);
    const endre = catalog.byId("sofa-endre")!;
    expect(endre.name).toBe("Endre Sofa");
    expect(endre.dims).toEqual({ w: 220, d: 95, h: 85 });
    expect(endre.price).toBe(790);
    expect(endre.seatCount).toBe(3);
    expect(endre.colorways.map((entry) => entry.id)).toEqual(["oak", "sage", "terracotta"]);
    expect(catalog.byId("rug-loop")?.dims).toEqual({ w: 200, d: 300, h: 2 });
    expect(catalog.byId("bed-birk")?.dims.w).toBe(160);
    expect(catalog.byId("bed-birk")?.dims.d).toBe(200);
    expect(catalog.byId("lamp-glow")?.category).toBe("floor-lamp");
  });

  it("enforces category dimensions, prices, clearances and wall preferences", () => {
    for (const item of catalogSource) {
      if (item.category === "sofa") {
        expect(item.dims.w).toBeGreaterThanOrEqual(160);
        expect(item.dims.w).toBeLessThanOrEqual(260);
        expect(item.price).toBeGreaterThanOrEqual(590);
        expect(item.price).toBeLessThanOrEqual(1490);
        expect(item.clearanceFront).toBe(75);
        expect(item.againstWall).toBe(true);
      }
      if (item.category === "bed") {
        expect([140, 160, 180]).toContain(item.dims.w);
        expect(item.dims.d).toBe(200);
        expect(item.price).toBeGreaterThanOrEqual(690);
        expect(item.price).toBeLessThanOrEqual(1590);
        expect(item.clearanceFront).toBe(60);
      }
      if (item.category === "chair") {
        expect(item.price).toBeGreaterThanOrEqual(90);
        expect(item.price).toBeLessThanOrEqual(240);
        expect(item.seatCount).toBe(1);
      }
      if (item.category === "rug") {
        expect(item.price).toBeGreaterThanOrEqual(190);
        expect(item.price).toBeLessThanOrEqual(590);
        expect(item.clearanceFront).toBe(0);
      }
      if (item.category === "plant" || item.category === "decor") expect(item.clearanceFront).toBe(0);
      if (["bed", "wardrobe", "desk", "shelf", "tv-unit"].includes(item.category)) expect(item.againstWall).toBe(true);
    }
  });
});

describe("catalog resolution", () => {
  it("resolves exact ids, exact names, unique prefixes and substrings", () => {
    expect(catalog.resolveProduct("sofa-endre")?.id).toBe("sofa-endre");
    expect(catalog.resolveProduct("Endre Sofa")?.id).toBe("sofa-endre");
    expect(catalog.resolveProduct(" SOFA-ENDRE ")?.id).toBe("sofa-endre");
    expect(catalog.resolveProduct("endre s")?.id).toBe("sofa-endre");
    expect(catalog.resolveProduct("Endre")?.id).toBe("sofa-endre");
    expect(catalog.resolveProduct("AAALTO")).toBeUndefined();
  });

  it("does not guess when a prefix or substring is ambiguous", () => {
    expect(catalog.resolveProduct("sofa")).toBeUndefined();
    expect(catalog.resolveProduct("chair")).toBeUndefined();
    expect(catalog.resolveProduct("Table Lamp")).toBeUndefined();
    expect(catalog.resolveProduct("")).toBeUndefined();
  });

  it("suggests close ids deterministically", () => {
    expect(catalog.suggestProducts("sofa ender", 3)).toHaveLength(3);
    expect(catalog.suggestProducts("sofa ender", 3)[0]).toBe("sofa-endre");
    expect(catalog.suggestProducts("aalto", 1)).toEqual(["desk-aalto"]);
    expect(catalog.suggestProducts("x", 0)).toEqual([]);
  });

  it("resolves available colorways without ambiguity", () => {
    const endre = catalog.byId("sofa-endre")!;
    expect(resolveColorway(endre, "sage")?.id).toBe("sage");
    expect(resolveColorway(endre, "Sage")?.name).toBe("Sage");
    expect(resolveColorway(endre, "terr")?.id).toBe("terracotta");
    expect(resolveColorway(endre, "plaster")).toBeUndefined();
    expect(catalog.resolveColorway(endre, "oak")?.id).toBe("oak");
  });

  it("allocates the first unused readable scene item id", () => {
    expect(nextItemId("sofa", [])).toBe("sofa-1");
    expect(nextItemId("sofa", ["sofa-1", "sofa-3"])).toBe("sofa-2");
    expect(nextItemId("tv-unit", ["tv-unit-1", "tv-unit-2"])).toBe("tv-unit-3");
    expect(catalog.nextItemId("plant", new Set(["plant-1"]))).toBe("plant-2");
  });

  it("returns copies from all and byCategory", () => {
    const all = catalog.all();
    expect(all).toHaveLength(catalogSource.length);
    all.pop();
    expect(catalog.all()).toHaveLength(catalogSource.length);
    const sofas = catalog.byCategory("sofa");
    expect(sofas).toHaveLength(5);
    expect(sofas.every((item) => item.category === "sofa")).toBe(true);
  });
});
