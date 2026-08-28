import type { NextRequest } from "next/server";
import { mapStorefrontCart } from "@/src/shopify/mapping";
import type { StorefrontCartNode } from "@/src/shopify/mapping";
import {
  CART_ADD_MUTATION,
  CART_CREATE_MUTATION,
  CART_QUERY,
  CART_REMOVE_MUTATION,
  CART_UPDATE_MUTATION,
} from "@/src/shopify/queries";
import { storefrontFetch } from "@/src/shopify/server";
import { snapshotProducts } from "@/src/shopify/snapshot";

export const dynamic = "force-dynamic";

interface UserError {
  field?: string[] | null;
  message: string;
}

interface CartMutationPayload {
  cart: StorefrontCartNode | null;
  userErrors: UserError[];
}

interface AddLine {
  variantId: string;
  quantity: number;
  itemId?: string;
}

interface UpdateLine {
  id: string;
  quantity: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 300;
}

function parseAddLines(value: unknown): AddLine[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const lines: AddLine[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !validId(entry.variantId) || !Number.isInteger(entry.quantity) || (entry.quantity as number) < 1) return undefined;
    if (entry.itemId !== undefined && !validId(entry.itemId)) return undefined;
    lines.push({ variantId: entry.variantId, quantity: entry.quantity as number, ...(entry.itemId ? { itemId: entry.itemId as string } : {}) });
  }
  return lines;
}

function parseUpdateLines(value: unknown): UpdateLine[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const lines: UpdateLine[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const id = entry.id ?? entry.lineId;
    if (!validId(id) || !Number.isInteger(entry.quantity) || (entry.quantity as number) < 0) return undefined;
    lines.push({ id, quantity: entry.quantity as number });
  }
  return lines;
}

function cartResponse(payload: CartMutationPayload): Response {
  if (payload.userErrors.length > 0) {
    return Response.json({
      error: "invalid",
      detail: payload.userErrors.map(({ message }) => message).join("; "),
    }, { status: 400 });
  }
  if (!payload.cart) return Response.json({ error: "not_found", detail: "Cart was not found or has expired" }, { status: 404 });
  try {
    return Response.json({ cart: mapStorefrontCart(payload.cart) });
  } catch {
    return Response.json({ error: "unavailable", detail: "Shopify returned an invalid cart" }, { status: 503 });
  }
}

function unavailable(detail: string): Response {
  return Response.json({ error: "unavailable", detail }, { status: 503 });
}

export async function GET(request: NextRequest): Promise<Response> {
  const id = request.nextUrl.searchParams.get("id")?.trim();
  if (!id) return Response.json({ error: "invalid", detail: "id is required" }, { status: 400 });
  const result = await storefrontFetch<{ cart: StorefrontCartNode | null }, { id: string }>(CART_QUERY, { id }, request);
  if (!result.ok) return unavailable(result.detail);
  if (!result.data.cart) return Response.json({ error: "not_found", detail: "Cart was not found or has expired" }, { status: 404 });
  return Response.json({ cart: mapStorefrontCart(result.data.cart) });
}

export async function POST(request: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid", detail: "Request body must be JSON" }, { status: 400 });
  }
  if (!isRecord(body) || typeof body.op !== "string") {
    return Response.json({ error: "invalid", detail: "op is required" }, { status: 400 });
  }
  const variantIds = new Set(snapshotProducts().flatMap((product) => product.variants.map(({ id }) => id)));

  if (body.op === "create" || body.op === "add") {
    const lines = parseAddLines(body.lines ?? []);
    if (!lines || (body.op === "add" && lines.length === 0)) {
      return Response.json({ error: "invalid", detail: "lines must contain positive quantities" }, { status: 400 });
    }
    const invalidVariant = lines.find(({ variantId }) => !variantIds.has(variantId));
    if (invalidVariant) {
      return Response.json({ error: "invalid", detail: `Variant ${invalidVariant.variantId} is not in the Hearth snapshot` }, { status: 400 });
    }
    const storefrontLines = lines.map(({ variantId, quantity, itemId }) => ({
      merchandiseId: variantId,
      quantity,
      ...(itemId ? { attributes: [{ key: "_hearth_item_id", value: itemId }] } : {}),
    }));
    if (body.op === "create") {
      const result = await storefrontFetch<{
        cartCreate: CartMutationPayload;
      }, { lines: typeof storefrontLines }>(CART_CREATE_MUTATION, { lines: storefrontLines }, request);
      return result.ok ? cartResponse(result.data.cartCreate) : unavailable(result.detail);
    }
    if (!validId(body.cartId)) return Response.json({ error: "invalid", detail: "cartId is required" }, { status: 400 });
    const result = await storefrontFetch<{
      cartLinesAdd: CartMutationPayload;
    }, { cartId: string; lines: typeof storefrontLines }>(CART_ADD_MUTATION, { cartId: body.cartId, lines: storefrontLines }, request);
    return result.ok ? cartResponse(result.data.cartLinesAdd) : unavailable(result.detail);
  }

  if (body.op === "remove") {
    if (!validId(body.cartId) || !Array.isArray(body.lineIds) || body.lineIds.length === 0 || !body.lineIds.every(validId)) {
      return Response.json({ error: "invalid", detail: "cartId and lineIds are required" }, { status: 400 });
    }
    const lineIds = body.lineIds as string[];
    const result = await storefrontFetch<{
      cartLinesRemove: CartMutationPayload;
    }, { cartId: string; lineIds: string[] }>(CART_REMOVE_MUTATION, { cartId: body.cartId, lineIds }, request);
    return result.ok ? cartResponse(result.data.cartLinesRemove) : unavailable(result.detail);
  }

  if (body.op === "set") {
    if (!validId(body.cartId)) return Response.json({ error: "invalid", detail: "cartId is required" }, { status: 400 });
    const lines = parseUpdateLines(body.lines);
    if (!lines) return Response.json({ error: "invalid", detail: "lines must contain line ids and non-negative quantities" }, { status: 400 });
    const result = await storefrontFetch<{
      cartLinesUpdate: CartMutationPayload;
    }, { cartId: string; lines: UpdateLine[] }>(CART_UPDATE_MUTATION, { cartId: body.cartId, lines }, request);
    return result.ok ? cartResponse(result.data.cartLinesUpdate) : unavailable(result.detail);
  }

  return Response.json({ error: "invalid", detail: `Unsupported cart op ${body.op}` }, { status: 400 });
}
