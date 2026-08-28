import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import type { ColorwayId } from "../../src/tokens";
import type { Furniture, Variant } from "../../src/engine/types";
import { diffVariants, variantSummary } from "../../src/engine/variants";

const catalog = createCatalog(catalogSource);

function item(
  id: string,
  catalogId = "armchair-nook",
  x = 100,
  y = 100,
  colorway: ColorwayId = "sage",
): Furniture {
  return { id, catalogId, roomId: "living", pos: { x, y }, rotation: 0, colorway, status: "placed" };
}

function variant(name: string, furniture: Furniture[]): Variant {
  return { name, roomId: "living", furniture, savedAt: name === "Left" ? 1 : 2 };
}

describe("variant differences", () => {
  it("returns empty lists for identical variants", () => {
    const left = variant("Left", [item("armchair-1"), item("sofa-1", "sofa-endre", 250, 60)]);
    const right = structuredClone(left);
    right.name = "Right";
    const diff = diffVariants(left, right, catalog);
    expect(diff).toEqual({ only_left: [], only_right: [], moved: [], changed_colorway: [] });
    expect(diff.only_left).toHaveLength(0);
    expect(diff.only_right).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
    expect(diff.changed_colorway).toHaveLength(0);
    expect(diff.more).toBeUndefined();
  });

  it("reports added and removed products by catalog display name", () => {
    const left = variant("Left", [item("armchair-1"), item("sofa-1", "sofa-endre")]);
    const right = variant("Right", [item("armchair-1"), item("shelf-1", "shelf-kant")]);
    const diff = diffVariants(left, right, catalog);
    expect(diff.only_left).toEqual(["Endre Sofa"]);
    expect(diff.only_right).toEqual(["Kant Shelf"]);
    expect(diff.moved).toEqual([]);
    expect(diff.changed_colorway).toEqual([]);
    expect(diff.more).toBeUndefined();
  });

  it("reports position and rotation changes as movement", () => {
    const left = variant("Left", [item("armchair-1"), item("sofa-1", "sofa-endre")]);
    const moved = { ...item("armchair-1"), pos: { x: 160, y: 120 } };
    const rotated = { ...item("sofa-1", "sofa-endre"), rotation: 90 as const };
    const diff = diffVariants(left, variant("Right", [moved, rotated]), catalog);
    expect(diff.moved).toEqual(["Endre Sofa", "Nook Armchair"]);
    expect(diff.only_left).toEqual([]);
    expect(diff.only_right).toEqual([]);
    expect(diff.changed_colorway).toEqual([]);
  });

  it("reports colorway changes independently of movement", () => {
    const left = variant("Left", [item("armchair-1", "armchair-nook", 100, 100, "sage")]);
    const right = variant("Right", [item("armchair-1", "armchair-nook", 160, 100, "terracotta")]);
    const diff = diffVariants(left, right, catalog);
    expect(diff.moved).toEqual(["Nook Armchair"]);
    expect(diff.changed_colorway).toEqual(["Nook Armchair"]);
    expect(diff.only_left).toEqual([]);
    expect(diff.only_right).toEqual([]);
  });

  it("counts duplicate additions and removals", () => {
    const left = variant("Left", [item("armchair-1"), item("armchair-2"), item("armchair-3")]);
    const right = variant("Right", [item("armchair-1")]);
    const removed = diffVariants(left, right, catalog);
    const added = diffVariants(right, left, catalog);
    expect(removed.only_left).toEqual(["Nook Armchair ×2"]);
    expect(removed.only_right).toEqual([]);
    expect(added.only_left).toEqual([]);
    expect(added.only_right).toEqual(["Nook Armchair ×2"]);
    expect(removed.moved).toEqual([]);
    expect(added.moved).toEqual([]);
  });

  it("counts duplicate moved and recolored instances", () => {
    const left = variant("Left", [item("armchair-1"), item("armchair-2", "armchair-nook", 200, 100)]);
    const right = variant("Right", [
      item("armchair-1", "armchair-nook", 120, 100, "terracotta"),
      item("armchair-2", "armchair-nook", 220, 100, "terracotta"),
    ]);
    const diff = diffVariants(left, right, catalog);
    expect(diff.moved).toEqual(["Nook Armchair ×2"]);
    expect(diff.changed_colorway).toEqual(["Nook Armchair ×2"]);
    expect(diff.only_left).toEqual([]);
    expect(diff.only_right).toEqual([]);
  });

  it("matches equivalent duplicate state when ids differ", () => {
    const left = variant("Left", [item("armchair-1"), item("armchair-2", "armchair-nook", 200, 100)]);
    const right = variant("Right", [item("chair-a", "armchair-nook", 200, 100), item("chair-b")]);
    const diff = diffVariants(left, right, catalog);
    expect(diff.moved).toEqual([]);
    expect(diff.changed_colorway).toEqual([]);
    expect(diff.only_left).toEqual([]);
    expect(diff.only_right).toEqual([]);
  });

  it("uses a stable catalog-id fallback when a product is unknown", () => {
    const diff = diffVariants(
      variant("Left", [item("mystery-1", "unknown-product")]),
      variant("Right", []),
      catalog,
    );
    expect(diff.only_left).toEqual(["unknown-product"]);
    expect(diff.only_right).toEqual([]);
    expect(diff.moved).toEqual([]);
    expect(diff.changed_colorway).toEqual([]);
  });

  it("caps every list at eight and reports total overflow", () => {
    const productIds = [
      "sofa-endre", "sofa-fjord", "sofa-liva", "armchair-nook", "armchair-elsa",
      "bed-birk", "wardrobe-hald", "table-rove", "desk-aalto", "shelf-kant",
    ];
    const right = variant("Right", productIds.map((catalogId, index) => item(`item-${index}`, catalogId, index * 10, 100)));
    const diff = diffVariants(variant("Left", []), right, catalog);
    expect(diff.only_right).toHaveLength(8);
    expect(diff.more).toBe(2);
    expect(diff.only_left).toHaveLength(0);
    expect(diff.moved).toHaveLength(0);
    expect(diff.changed_colorway).toHaveLength(0);
    expect(diff.only_right).toEqual([...diff.only_right].sort((a, b) => a.localeCompare(b)));
    for (const list of [diff.only_left, diff.only_right, diff.moved, diff.changed_colorway]) {
      expect(list.length).toBeLessThanOrEqual(8);
    }
  });

  it("caps overflow accumulated across different change lists", () => {
    const products = catalogSource.slice(0, 10);
    const leftItems = products.map((product, index) => item(`item-${index}`, product.id, index * 10, 100, "sage"));
    const rightItems = products.map((product, index) => item(`item-${index}`, product.id, index * 10 + 5, 100, "terracotta"));
    const diff = diffVariants(variant("Left", leftItems), variant("Right", rightItems), catalog);
    expect(diff.moved).toHaveLength(8);
    expect(diff.changed_colorway).toHaveLength(8);
    expect(diff.more).toBe(4);
    expect(diff.only_left).toEqual([]);
    expect(diff.only_right).toEqual([]);
  });

  it("summarizes variants for save_variant", () => {
    const value = variant("Cosy", [item("armchair-1"), item("sofa-1", "sofa-endre")]);
    expect(variantSummary(value)).toEqual({ name: "Cosy", items: 2 });
    expect(variantSummary(variant("Empty", []))).toEqual({ name: "Empty", items: 0 });
  });

  it("is deterministic and does not mutate either variant", () => {
    const left = variant("Left", [item("armchair-1"), item("sofa-1", "sofa-endre")]);
    const right = variant("Right", [item("armchair-1", "armchair-nook", 120), item("shelf-1", "shelf-kant")]);
    const beforeLeft = structuredClone(left);
    const beforeRight = structuredClone(right);
    const first = diffVariants(left, right, catalog);
    const second = diffVariants(left, right, catalog);
    expect(second).toEqual(first);
    expect(left).toEqual(beforeLeft);
    expect(right).toEqual(beforeRight);
    expect(first.only_left).toEqual(["Endre Sofa"]);
    expect(first.only_right).toEqual(["Kant Shelf"]);
    expect(first.moved).toEqual(["Nook Armchair"]);
  });
});
