import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog, productFor, withItemDims } from "../../src/engine/catalog";
import { closestProducts, compareDims, resizeDims, sameDims } from "../../src/engine/dims";
import { footprint } from "../../src/engine/geometry";
import type { Furniture } from "../../src/engine/types";

const catalog = createCatalog(catalogSource);
const sofa = catalog.byId("sofa-endre")!;

describe("effective dimensions", () => {
  it("returns the catalog record untouched without an override", () => {
    const item: Furniture = { id: "sofa-1", catalogId: "sofa-endre", roomId: "living", pos: { x: 0, y: 0 }, rotation: 0, colorway: "oak", status: "placed" };
    expect(productFor(item, catalog)).toBe(sofa);
    expect(productFor(item, catalogSource)?.id).toBe("sofa-endre");
    expect(productFor(item, (id) => catalog.byId(id))?.id).toBe("sofa-endre");
    expect(withItemDims({ catalogId: "sofa-endre", dims: { ...sofa.dims } }, sofa)).toBe(sofa);
  });

  it("swaps in the item's own size for footprints", () => {
    const item: Furniture = {
      id: "sofa-1", catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0, colorway: "oak", status: "placed", dims: { w: 260, d: 100, h: 90 },
    };
    const sized = productFor(item, catalog)!;
    expect(sized.dims).toEqual({ w: 260, d: 100, h: 90 });
    expect(sized.name).toBe(sofa.name);
    expect(sized.clearanceFront).toBe(sofa.clearanceFront);
    expect(footprint(item, sized)[0]).toEqual({ x: 70, y: 50 });
    expect(sofa.dims.w).toBe(220);
  });
});

describe("resizeDims", () => {
  it("requires at least one field", () => {
    expect(resizeDims(sofa.dims, sofa.dims, {})).toMatchObject({ ok: false });
  });

  it("changes named sides only and keeps the rest", () => {
    const outcome = resizeDims(sofa.dims, sofa.dims, { width_cm: 240 });
    expect(outcome).toMatchObject({ ok: true, dims: { w: 240, d: 95, h: 85 } });
  });

  it("scales from the catalog size, and 100 % drops the override", () => {
    const doubled = resizeDims(sofa.dims, { w: 240, d: 95, h: 85 }, { scale_percent: 150 });
    expect(doubled).toMatchObject({ ok: true, dims: { w: 330, d: 143, h: 128 }, scalePercent: 150 });
    expect(resizeDims(sofa.dims, { w: 240, d: 95, h: 85 }, { scale_percent: 100 })).toMatchObject({ ok: true, dims: undefined, scalePercent: 100 });
    expect(resizeDims(sofa.dims, { w: 240, d: 95, h: 85 }, { reset: true })).toMatchObject({ ok: true, dims: undefined });
  });

  it("refuses sizes outside 25–400 % or 10–1000 cm", () => {
    expect(resizeDims(sofa.dims, sofa.dims, { width_cm: 5 })).toMatchObject({ ok: false });
    expect(resizeDims(sofa.dims, sofa.dims, { width_cm: 2000 })).toMatchObject({ ok: false });
    expect(resizeDims(sofa.dims, sofa.dims, { scale_percent: 10 })).toMatchObject({ ok: false });
    expect(resizeDims(sofa.dims, sofa.dims, { height_cm: 20 })).toMatchObject({ ok: false, detail: expect.stringContaining("Height") });
    expect(resizeDims(sofa.dims, sofa.dims, { width_cm: -3 })).toMatchObject({ ok: false });
  });

  it("rounds to whole centimetres and treats a 1 cm difference as the catalog size", () => {
    expect(resizeDims(sofa.dims, sofa.dims, { width_cm: 220.4 })).toMatchObject({ ok: true, dims: undefined });
    expect(sameDims({ w: 220, d: 95, h: 85 }, { w: 221, d: 95, h: 85 })).toBe(true);
    expect(sameDims({ w: 220, d: 95, h: 85 }, { w: 223, d: 95, h: 85 })).toBe(false);
  });
});

describe("compareDims and closestProducts", () => {
  it("classifies exact, close and off with a signed delta per side", () => {
    expect(compareDims({ w: 220, d: 95, h: 85 }, { w: 220, d: 95, h: 85 })).toEqual({ match: "exact", distanceCm: 0, delta: "w0 d0 h0" });
    expect(compareDims({ w: 225, d: 92, h: 85 }, { w: 220, d: 95, h: 85 })).toEqual({ match: "close", distanceCm: 8, delta: "w+5 d-3 h0" });
    expect(compareDims({ w: 260, d: 95, h: 85 }, { w: 220, d: 95 })).toEqual({ match: "off", distanceCm: 40, delta: "w+40 d0" });
    expect(compareDims({ w: 235, d: 95, h: 85 }, { w: 220 }, 20).match).toBe("close");
  });

  it("ranks the catalog by size distance within a category", () => {
    const ranked = closestProducts(catalogSource, { w: 240, d: 98, h: 104 }, { category: "sofa" });
    expect(ranked[0]?.product.id).toBe("sofa-maren");
    expect(ranked[0]?.comparison.match).toBe("exact");
    const excluding = closestProducts(catalogSource, { w: 240, d: 98, h: 104 }, { category: "sofa", excludeId: "sofa-maren", limit: 1 });
    expect(excluding[0]?.product.id).not.toBe("sofa-maren");
    expect(excluding[0]?.product.category).toBe("sofa");
  });
});
