"use client";
/**
 * Which Shopify the studio is actually talking to. The registry and the cart panel must share one
 * client (SHOPIFY.md §7: the agent's `update_cart` and the human's cart can never disagree), and
 * that client is chosen at startup by probing `/api/health/shopify` — the only honest test of
 * whether the Storefront API is configured on this deployment.
 *
 * Until the probe answers, every call waits on it. That is a few hundred milliseconds once per page
 * load, and it buys the guarantee that no cart line is ever created against the wrong backend.
 */
import { createLiveShopify } from "./live";
import type { ShopifyClient } from "./types";

export type ShopifyMode = "checking" | "live" | "local";

export interface SelectableShopify extends ShopifyClient {
  /** Which backend is in use; "checking" until the health probe answers. */
  readonly mode: ShopifyMode;
  /** Resolves with the chosen mode, for callers that want to wait (the cart panel does not). */
  ready(): Promise<ShopifyMode>;
  subscribe(listener: () => void): () => void;
}

export interface SelectOptions {
  /** The offline client, used when the Storefront API is not configured. */
  local: ShopifyClient;
  /** Built only if the probe reports a live Storefront, so no cart is created needlessly. */
  live?: () => ShopifyClient;
  /** True when the Storefront API answered. Defaults to `/api/health/shopify`. */
  probe?: () => Promise<boolean>;
}

async function probeHealth(): Promise<boolean> {
  try {
    const response = await fetch("/api/health/shopify");
    if (!response.ok) return false;
    const body = await response.json() as { storefront?: boolean };
    return body.storefront === true;
  } catch {
    return false;
  }
}

/** Creates the one client the whole studio shares, live when the store is reachable. */
export function createSelectedShopify(options: SelectOptions): SelectableShopify {
  const buildLive = options.live ?? createLiveShopify;
  const probe = options.probe ?? probeHealth;
  const listeners = new Set<() => void>();
  let mode: ShopifyMode = "checking";
  let chosen: ShopifyClient = options.local;

  // A probe that throws is the same answer as a probe that says no: tool handlers must never see an
  // exception (TOOLS.md §0), and every method below waits on this promise.
  const settled = probe().catch(() => false).then((live) => {
    mode = live ? "live" : "local";
    chosen = live ? buildLive() : options.local;
    for (const listener of listeners) listener();
    return mode;
  });

  const client = async (): Promise<ShopifyClient> => {
    await settled;
    return chosen;
  };

  return {
    get mode() {
      return mode;
    },
    get unavailable() {
      return chosen.unavailable;
    },
    ready: () => settled,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async search(q) {
      return (await client()).search(q);
    },
    async product(handle) {
      return (await client()).product(handle);
    },
    async cartGet() {
      return (await client()).cartGet();
    },
    async cartAdd(lines) {
      return (await client()).cartAdd(lines);
    },
    async cartRemove(lineIds) {
      return (await client()).cartRemove(lineIds);
    },
    async cartSetQuantity(lineId, qty) {
      return (await client()).cartSetQuantity(lineId, qty);
    },
    async cartUpdateLine(lineId, variantId, quantity) {
      return (await client()).cartUpdateLine(lineId, variantId, quantity);
    },
    async checkoutLink() {
      return (await client()).checkoutLink();
    },
  };
}
