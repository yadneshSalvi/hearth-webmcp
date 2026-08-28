import type { NextRequest } from "next/server";
import { mapStorefrontProduct } from "@/src/shopify/mapping";
import type { StorefrontProductNode } from "@/src/shopify/mapping";
import { PRODUCT_BY_HANDLE_QUERY } from "@/src/shopify/queries";
import { storefrontFetch } from "@/src/shopify/server";
import { snapshotByHandle } from "@/src/shopify/snapshot";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const handle = request.nextUrl.searchParams.get("handle")?.trim().toLowerCase();
  if (!handle) return Response.json({ error: "invalid", detail: "handle is required" }, { status: 400 });
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(handle)) {
    return Response.json({ error: "invalid", detail: "handle is invalid" }, { status: 400 });
  }
  const result = await storefrontFetch<{ product: StorefrontProductNode | null }, { handle: string }>(
    PRODUCT_BY_HANDLE_QUERY,
    { handle },
    request,
  );
  if (result.ok && result.data.product) {
    try {
      return Response.json({ product: mapStorefrontProduct(result.data.product) });
    } catch {
      // The snapshot is the safe fallback for malformed live metadata.
    }
  }
  const product = snapshotByHandle(handle);
  return product
    ? Response.json({ product, source: "snapshot" })
    : Response.json({ error: "not_found", detail: `Product ${handle} was not found` }, { status: 404 });
}
