"use client";
/**
 * Human cart actions. They go through the same `ShopifyClient` the `update_cart` tool uses and
 * mirror the result into the store, so the agent's `get_cart` and the panel can never disagree
 * (SHOPIFY.md §7).
 */
import type { StoreApi } from "zustand";
import type { CatalogItem } from "../engine/types";
import type { Result, ShopifyCart, ShopifyClient } from "../shopify/types";
import type { HearthStore } from "../state/types";
import { colorwayLabel, usd } from "./format";
import { pushToast } from "./toast-bus";

export interface CartOps {
  add(input: { product: CatalogItem; colorway: string; itemId?: string }): Promise<boolean>;
  setQuantity(lineId: string, quantity: number): Promise<void>;
  remove(lineId: string): Promise<void>;
  refresh(): Promise<void>;
  checkout(): Promise<{ checkoutUrl: string; storePassword: string } | undefined>;
}

function variantIdFor(product: CatalogItem, colorway: string): string {
  return product.shopify?.variantIds[colorway] ?? `gid://shopify/ProductVariant/local-${product.id}-${colorway}`;
}

/** Creates the human-side cart operations bound to one client and one store. */
export function createCartOps(shopify: ShopifyClient, store: StoreApi<HearthStore>): CartOps {
  let sequence = 0;

  const receipt = (summary: string, itemIds: string[] = []): void => {
    sequence += 1;
    store.getState().pushActivity({
      id: `cart-${Date.now()}-${sequence}`,
      t: Date.now(),
      source: "human",
      title: "Update cart",
      summary,
      itemIds,
    });
  };

  const sync = (cart: ShopifyCart): void => {
    store.getState().setCart({
      id: cart.id,
      subtotalUsd: cart.subtotalUsd,
      status: "idle",
      lines: cart.lines.map((line) => ({ ...line })),
    });
  };

  const guard = <T,>(result: Result<T>, what: string): T | undefined => {
    if (result.ok) return result.value;
    store.getState().setCartStatus("offline");
    pushToast({ title: `${what} failed`, detail: result.detail, tone: "warn" });
    return undefined;
  };

  return {
    async add({ product, colorway, itemId }) {
      const result = await shopify.cartAdd([{
        variantId: variantIdFor(product, colorway),
        quantity: 1,
        ...(itemId ? { itemId } : {}),
      }]);
      const cart = guard(result, "Add to cart");
      if (!cart) return false;
      sync(cart);
      receipt(
        `You added ${product.name} (${colorwayLabel(colorway).toLowerCase()}) to the cart · ${usd(cart.subtotalUsd)}`,
        itemId ? [itemId] : [],
      );
      return true;
    },

    async setQuantity(lineId, quantity) {
      const line = store.getState().cart.lines.find((candidate) => candidate.id === lineId);
      const result = await shopify.cartSetQuantity(lineId, quantity);
      const cart = guard(result, "Update quantity");
      if (!cart) return;
      sync(cart);
      if (!line) return;
      receipt(quantity === 0
        ? `You removed ${line.title} from the cart · ${usd(cart.subtotalUsd)}`
        : `You set ${line.title} to ${quantity} · ${usd(cart.subtotalUsd)}`);
    },

    async remove(lineId) {
      const line = store.getState().cart.lines.find((candidate) => candidate.id === lineId);
      const result = await shopify.cartRemove([lineId]);
      const cart = guard(result, "Remove line");
      if (!cart) return;
      sync(cart);
      receipt(`You removed ${line?.title ?? "a product"} from the cart · ${usd(cart.subtotalUsd)}`);
    },

    async refresh() {
      const result = await shopify.cartGet();
      if (!result.ok) {
        store.getState().setCartStatus("offline");
        return;
      }
      sync(result.value);
    },

    async checkout() {
      const result = await shopify.checkoutLink();
      return guard(result, "Checkout");
    },
  };
}
