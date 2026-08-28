import { catalogSource } from "../../data/catalog.source";
import { describe, expect, it } from "vitest";
import { snapshotByHandle, snapshotMetadata, snapshotProducts } from "../../src/shopify/snapshot";

describe("catalog snapshot", () => {
  it("loads the seeded 2026-07 catalog in deterministic handle order", () => {
    const products = snapshotProducts();
    expect(snapshotMetadata()).toMatchObject({
      storeDomain: "hearth-studio.myshopify.com",
      apiVersion: "2026-07",
    });
    expect(products).toHaveLength(catalogSource.length);
    expect(products.map(({ handle }) => handle)).toEqual([...products.map(({ handle }) => handle)].sort());
    expect(products.every((product) => product.variants.every(({ id, available }) => id.startsWith("gid://shopify/ProductVariant/") && available))).toBe(true);
  });

  it("looks up by handle and returns defensive copies", () => {
    const first = snapshotByHandle("sofa-endre");
    const second = snapshotByHandle("sofa-endre");
    expect(first?.name).toBe("Endre Sofa");
    expect(first).not.toBe(second);
    expect(snapshotByHandle("missing-product")).toBeUndefined();
  });
});
