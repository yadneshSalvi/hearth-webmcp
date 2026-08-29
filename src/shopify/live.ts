"use client";

import type {
  CartAddLine,
  CatalogProduct,
  Result,
  ShopifyCart,
  ShopifyClient,
  ShopifyError,
} from "./types";

const CART_STORAGE_KEY = "hearth.cartId";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorFromStatus(status: number): ShopifyError {
  if (status === 404) return "not_found";
  if (status === 400) return "invalid";
  return "unavailable";
}

function storage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readCartId(): string | undefined {
  return storage()?.getItem(CART_STORAGE_KEY) ?? undefined;
}

function saveCartId(id: string | undefined): void {
  const local = storage();
  if (!local) return;
  if (id) local.setItem(CART_STORAGE_KEY, id);
  else local.removeItem(CART_STORAGE_KEY);
}

/** Browser Storefront adapter. It never reads Shopify configuration or secrets. */
export function createLiveShopify(): ShopifyClient {
  let offline = false;

  async function api(path: string, init?: RequestInit): Promise<Result<Record<string, unknown>>> {
    let response: Response;
    try {
      response = await fetch(path, init);
    } catch {
      offline = true;
      return { ok: false, error: "unavailable", detail: "Shopify is offline — retry" };
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      offline = true;
      return { ok: false, error: "unavailable", detail: "Shopify returned an invalid response" };
    }
    if (!response.ok) {
      const error = errorFromStatus(response.status);
      offline = error === "unavailable";
      return {
        ok: false,
        error,
        detail: isRecord(payload) && typeof payload.detail === "string" ? payload.detail : `Shopify request failed (${response.status})`,
      };
    }
    if (!isRecord(payload)) {
      offline = true;
      return { ok: false, error: "unavailable", detail: "Shopify returned an invalid response" };
    }
    offline = false;
    return { ok: true, value: payload };
  }

  function cartFrom(result: Result<Record<string, unknown>>): Result<ShopifyCart> {
    if (!result.ok) return result;
    if (!isRecord(result.value.cart) || typeof result.value.cart.id !== "string") {
      offline = true;
      return { ok: false, error: "unavailable", detail: "Shopify returned an invalid cart" };
    }
    const cart = result.value.cart as unknown as ShopifyCart;
    saveCartId(cart.id);
    return { ok: true, value: cart };
  }

  async function createCart(): Promise<Result<ShopifyCart>> {
    const result = cartFrom(await api("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "create", lines: [] }),
    }));
    if (!result.ok) saveCartId(undefined);
    return result;
  }

  async function ensureCart(): Promise<Result<ShopifyCart>> {
    const id = readCartId();
    if (!id) return createCart();
    const result = cartFrom(await api(`/api/cart?id=${encodeURIComponent(id)}`));
    if (!result.ok && result.error === "not_found") {
      saveCartId(undefined);
      return createCart();
    }
    return result;
  }

  async function mutateCart(body: Record<string, unknown>, expiredResult: "retry" | "new-cart"): Promise<Result<ShopifyCart>> {
    const current = await ensureCart();
    if (!current.ok) return current;
    const submit = async (cartId: string): Promise<Result<ShopifyCart>> => cartFrom(await api("/api/cart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, cartId }),
    }));
    const result = await submit(current.value.id);
    if (result.ok || result.error !== "not_found") return result;
    saveCartId(undefined);
    const replacement = await createCart();
    if (!replacement.ok || expiredResult === "new-cart") return replacement;
    return submit(replacement.value.id);
  }

  return {
    get unavailable() {
      return offline;
    },
    async search(q) {
      const result = await api(`/api/shop/search?q=${encodeURIComponent(q)}`);
      if (!result.ok) return result;
      return Array.isArray(result.value.products)
        ? { ok: true, value: result.value.products as CatalogProduct[] }
        : { ok: false, error: "unavailable", detail: "Shopify returned invalid search results" };
    },
    async product(handle) {
      const result = await api(`/api/shop/product?handle=${encodeURIComponent(handle)}`);
      if (!result.ok) return result;
      return isRecord(result.value.product)
        ? { ok: true, value: result.value.product as unknown as CatalogProduct }
        : { ok: false, error: "unavailable", detail: "Shopify returned an invalid product" };
    },
    cartGet: ensureCart,
    async cartAdd(lines: CartAddLine[]) {
      return mutateCart({ op: "add", lines }, "retry");
    },
    async cartRemove(lineIds: string[]) {
      return mutateCart({ op: "remove", lineIds }, "new-cart");
    },
    async cartSetQuantity(lineId: string, qty: number) {
      return mutateCart({ op: "set", lines: [{ id: lineId, quantity: qty }] }, "new-cart");
    },
    async cartUpdateLine(lineId: string, variantId: string, quantity: number) {
      return mutateCart({ op: "set", lines: [{ id: lineId, merchandiseId: variantId, quantity }] }, "new-cart");
    },
    async checkoutLink() {
      let current = await ensureCart();
      if (!current.ok) return current;
      let result = await api(`/api/checkout?cartId=${encodeURIComponent(current.value.id)}`);
      if (!result.ok && result.error === "not_found") {
        saveCartId(undefined);
        current = await createCart();
        if (!current.ok) return current;
        result = await api(`/api/checkout?cartId=${encodeURIComponent(current.value.id)}`);
      }
      if (!result.ok) return result;
      return typeof result.value.checkoutUrl === "string" && typeof result.value.storePassword === "string"
        ? { ok: true, value: { checkoutUrl: result.value.checkoutUrl, storePassword: result.value.storePassword } }
        : { ok: false, error: "unavailable", detail: "Shopify returned an invalid checkout link" };
    },
  };
}
