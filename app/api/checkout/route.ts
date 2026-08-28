import type { NextRequest } from "next/server";
import type { StorefrontCartNode } from "@/src/shopify/mapping";
import { CART_QUERY } from "@/src/shopify/queries";
import { storefrontFetch } from "@/src/shopify/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const cartId = request.nextUrl.searchParams.get("cartId")?.trim();
  if (!cartId) return Response.json({ error: "invalid", detail: "cartId is required" }, { status: 400 });
  const result = await storefrontFetch<{ cart: StorefrontCartNode | null }, { id: string }>(CART_QUERY, { id: cartId }, request);
  if (!result.ok) return Response.json({ error: "unavailable", detail: result.detail }, { status: 503 });
  if (!result.data.cart) {
    return Response.json({ error: "not_found", detail: "Cart was not found or has expired" }, { status: 404 });
  }
  const storePassword = process.env.SHOPIFY_STOREFRONT_PASSWORD;
  if (!storePassword) {
    return Response.json({ error: "unavailable", detail: "Store password is not configured" }, { status: 503 });
  }
  return Response.json({ checkoutUrl: result.data.cart.checkoutUrl, storePassword });
}
