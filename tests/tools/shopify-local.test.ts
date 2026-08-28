import { describe, expect, it } from "vitest";
import { catalogSource } from "../fixtures/catalog";
import { createLocalShopify } from "../../src/shopify/local";

describe("local Shopify client", () => {
  it("searches and resolves catalog products deterministically", async () => {
    const client = createLocalShopify(catalogSource);
    const search = await client.search("Endre sage");
    expect(search.ok).toBe(true);
    if (!search.ok) return;
    expect(search.value[0]?.handle).toBe("sofa-endre");
    expect(search.value[0]?.variants.some(({ id }) => id.includes("sofa-endre-sage"))).toBe(true);
    const product = await client.product("Endre");
    expect(product.ok).toBe(true);
    if (product.ok) expect(product.value.name).toBe("Endre Sofa");
    expect((await client.product("missing-product"))).toMatchObject({ ok: false, error: "not_found" });
  });

  it("adds, updates and removes local cart lines", async () => {
    const client = createLocalShopify(catalogSource);
    const product = await client.product("sofa-endre");
    if (!product.ok) throw new Error(product.detail);
    const variant = product.value.variants[0];
    if (!variant) throw new Error("Product has no variants");
    const added = await client.cartAdd([{ variantId: variant.id, quantity: 2, itemId: "sofa-1" }]);
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.value.count).toBe(2);
    expect(added.value.subtotalUsd).toBe(variant.price * 2);
    expect(added.value.lines[0]?.itemId).toBe("sofa-1");
    const lineId = added.value.lines[0]?.id;
    if (!lineId) throw new Error("Cart line is missing");
    const updated = await client.cartSetQuantity(lineId, 3);
    expect(updated).toMatchObject({ ok: true, value: { count: 3 } });
    const removed = await client.cartRemove([lineId]);
    expect(removed).toMatchObject({ ok: true, value: { count: 0, subtotalUsd: 0, lines: [] } });
  });

  it("returns the deterministic offline checkout link", async () => {
    const client = createLocalShopify(catalogSource);
    expect(client.unavailable).toBe(false);
    expect(await client.checkoutLink()).toEqual({
      ok: true,
      value: { checkoutUrl: "https://hearth-studio.myshopify.com/cart", storePassword: "" },
    });
  });
});
