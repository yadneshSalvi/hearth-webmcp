// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveShopify } from "../../src/shopify/live";

const emptyCart = { id: "gid://shopify/Cart/new", lines: [], subtotalUsd: 0, count: 0 };

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("live Shopify browser client", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("persists a newly created cart id", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ cart: emptyCart }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createLiveShopify();
    const result = await client.cartGet();
    expect(result).toEqual({ ok: true, value: emptyCart });
    expect(window.localStorage.getItem("hearth.cartId")).toBe(emptyCart.id);
    expect(fetchMock).toHaveBeenCalledWith("/api/cart", expect.objectContaining({ method: "POST" }));
  });

  it("uses the persisted cart on later reads", async () => {
    window.localStorage.setItem("hearth.cartId", "gid://shopify/Cart/existing");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ cart: { ...emptyCart, id: "gid://shopify/Cart/existing" } }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createLiveShopify().cartGet();
    expect(result.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/cart?id=gid%3A%2F%2Fshopify%2FCart%2Fexisting", undefined);
  });

  it("creates and stores a replacement when Shopify returns a 404", async () => {
    window.localStorage.setItem("hearth.cartId", "expired");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: "not_found", detail: "expired" }, 404))
      .mockResolvedValueOnce(jsonResponse({ cart: emptyCart }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await createLiveShopify().cartGet();
    expect(result).toEqual({ ok: true, value: emptyCart });
    expect(window.localStorage.getItem("hearth.cartId")).toBe(emptyCart.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns unavailable and marks the client offline on network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    const client = createLiveShopify();
    const result = await client.search("sofa");
    expect(result).toEqual({ ok: false, error: "unavailable", detail: "Shopify is offline — retry" });
    expect(client.unavailable).toBe(true);
  });

  it("clears the offline flag on the next successful request", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(jsonResponse({ products: [] })));
    const client = createLiveShopify();
    expect(await client.search("sofa")).toMatchObject({ ok: false, error: "unavailable" });
    expect(client.unavailable).toBe(true);
    expect(await client.search("sofa")).toEqual({ ok: true, value: [] });
    expect(client.unavailable).toBe(false);
  });

  it("sends merchandiseId when updating a cart line variant", async () => {
    window.localStorage.setItem("hearth.cartId", emptyCart.id);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ cart: emptyCart }))
      .mockResolvedValueOnce(jsonResponse({ cart: emptyCart }));
    vi.stubGlobal("fetch", fetchMock);
    await createLiveShopify().cartUpdateLine("line-1", "gid://shopify/ProductVariant/2", 2);
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toEqual({
      op: "set",
      cartId: emptyCart.id,
      lines: [{ id: "line-1", merchandiseId: "gid://shopify/ProductVariant/2", quantity: 2 }],
    });
  });
});
