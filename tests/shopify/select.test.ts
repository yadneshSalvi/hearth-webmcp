// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { createLocalShopify } from "@/src/shopify/local";
import { createSelectedShopify } from "@/src/shopify/select";
import { snapshotProducts } from "@/src/shopify/snapshot";
import type { CatalogProduct, Result, ShopifyCart, ShopifyClient } from "@/src/shopify/types";

function stubClient(tag: string): ShopifyClient {
  const cart: ShopifyCart = { id: `${tag}-cart`, lines: [], subtotalUsd: 0, count: 0 };
  const ok = <T,>(value: T): Promise<Result<T>> => Promise.resolve({ ok: true, value });
  return {
    unavailable: false,
    search: () => ok([] as CatalogProduct[]),
    product: () => Promise.resolve({ ok: false, error: "not_found", detail: tag } as Result<CatalogProduct>),
    cartGet: () => ok(cart),
    cartAdd: () => ok(cart),
    cartRemove: () => ok(cart),
    cartSetQuantity: () => ok(cart),
    cartUpdateLine: () => ok(cart),
    checkoutLink: () => ok({ checkoutUrl: `https://${tag}/checkouts/cn/1`, storePassword: tag }),
  };
}

const local = () => createLocalShopify(snapshotProducts());

describe("startup Shopify selection", () => {
  it("uses the live client when the health route reports a Storefront", async () => {
    const live = stubClient("live");
    const client = createSelectedShopify({ local: local(), live: () => live, probe: async () => true });
    expect(client.mode).toBe("checking");
    // Calls made before the probe answers still reach the right backend — that is the point of
    // choosing at startup rather than letting the panel and the registry each guess.
    const cart = await client.cartGet();
    expect(cart.ok && cart.value.id).toBe("live-cart");
    expect(client.mode).toBe("live");
  });

  it("falls back to the local catalog when the Storefront is not configured", async () => {
    const client = createSelectedShopify({ local: local(), live: () => stubClient("live"), probe: async () => false });
    await client.ready();
    expect(client.mode).toBe("local");
    const cart = await client.cartGet();
    expect(cart.ok && cart.value.id).toBe("local-cart");
  });

  it("never builds the live client when the probe says no", async () => {
    const build = vi.fn(() => stubClient("live"));
    const client = createSelectedShopify({ local: local(), live: build, probe: async () => false });
    await client.ready();
    expect(build).not.toHaveBeenCalled();
  });

  it("tells subscribers once the mode is known, so the cart dot can stop guessing", async () => {
    const seen: string[] = [];
    const client = createSelectedShopify({ local: local(), live: () => stubClient("live"), probe: async () => true });
    client.subscribe(() => seen.push(client.mode));
    await client.ready();
    expect(seen).toEqual(["live"]);
  });

  it("treats a failed probe as local rather than throwing", async () => {
    const client = createSelectedShopify({
      local: local(),
      live: () => stubClient("live"),
      probe: async () => {
        throw new Error("offline");
      },
    });
    // Tool handlers never throw (TOOLS.md §0), and every call goes through this promise.
    await expect(client.ready()).resolves.toBe("local");
    const cart = await client.cartGet();
    expect(cart.ok && cart.value.id).toBe("local-cart");
  });
});
