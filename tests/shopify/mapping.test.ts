import { describe, expect, it } from "vitest";
import { mapStorefrontCart, mapStorefrontProduct } from "../../src/shopify/mapping";
import type { StorefrontCartNode, StorefrontProductNode } from "../../src/shopify/mapping";

const productFixture: StorefrontProductNode = {
  id: "gid://shopify/Product/1",
  handle: "sofa-endre",
  title: "Endre Sofa",
  productType: "sofa",
  tags: ["hearth", "scandinavian"],
  vendor: "Hearth Studio",
  description: "A Storefront description.",
  priceRange: { minVariantPrice: { amount: "790.00", currencyCode: "USD" } },
  featuredImage: { url: "https://cdn.shopify.com/endre.png", altText: "Endre Sofa" },
  variants: {
    nodes: [{
      id: "gid://shopify/ProductVariant/1",
      title: "Oak",
      availableForSale: true,
      price: { amount: "790.00", currencyCode: "USD" },
      selectedOptions: [{ name: "Colorway", value: "Oak" }],
    }],
  },
  dims: { value: '{"w":221,"d":96,"h":86}' },
  colorways: { value: '[{"id":"oak","name":"Oak","hex":"#D9C4A3"}]' },
  clearance: { value: "75" },
  seats: { value: "3" },
  glb: { value: "https://hearth.yadneshsalvi.com/assets/glb/sofa-endre.glb" },
  againstWall: { value: "true" },
};

describe("Storefront mapping", () => {
  it("maps product nodes into CatalogProduct", () => {
    const product = mapStorefrontProduct(productFixture);
    expect(product).toMatchObject({
      id: "sofa-endre",
      handle: "sofa-endre",
      category: "sofa",
      dims: { w: 221, d: 96, h: 86 },
      clearanceFront: 75,
      seatCount: 3,
      againstWall: true,
      price: 790,
      imageUrl: "https://cdn.shopify.com/endre.png",
    });
    expect(product.variants[0]).toEqual({
      id: "gid://shopify/ProductVariant/1",
      colorway: "oak",
      price: 790,
      available: true,
    });
  });

  it("falls back to snapshot fit metadata when live JSON is invalid", () => {
    const product = mapStorefrontProduct({ ...productFixture, dims: { value: "not-json" }, colorways: null });
    expect(product.dims).toEqual({ w: 220, d: 95, h: 85 });
    expect(product.colorways.map(({ id }) => id)).toEqual(["oak", "sage", "terracotta"]);
  });

  it("maps cart totals, variants, colorways, and item links", () => {
    const cartFixture: StorefrontCartNode = {
      id: "gid://shopify/Cart/1",
      checkoutUrl: "https://hearth-studio.myshopify.com/checkouts/cn/1",
      totalQuantity: 2,
      cost: { subtotalAmount: { amount: "1580.00", currencyCode: "USD" } },
      lines: {
        nodes: [{
          id: "gid://shopify/CartLine/1",
          quantity: 2,
          attributes: [{ key: "_hearth_item_id", value: "sofa-1" }],
          cost: { totalAmount: { amount: "1580.00", currencyCode: "USD" } },
          merchandise: {
            id: "gid://shopify/ProductVariant/1",
            title: "Oak",
            price: { amount: "790.00", currencyCode: "USD" },
            selectedOptions: [{ name: "Colorway", value: "Oak" }],
            product: { handle: "sofa-endre", title: "Endre Sofa" },
          },
        }],
      },
    };
    expect(mapStorefrontCart(cartFixture)).toEqual({
      id: "gid://shopify/Cart/1",
      checkoutUrl: "https://hearth-studio.myshopify.com/checkouts/cn/1",
      lines: [{
        id: "gid://shopify/CartLine/1",
        variantId: "gid://shopify/ProductVariant/1",
        handle: "sofa-endre",
        title: "Endre Sofa",
        colorway: "oak",
        quantity: 2,
        unitUsd: 790,
        lineUsd: 1580,
        itemId: "sofa-1",
      }],
      subtotalUsd: 1580,
      count: 2,
    });
  });
});
