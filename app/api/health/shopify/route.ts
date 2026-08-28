import type { NextRequest } from "next/server";
import { storefrontFetch } from "@/src/shopify/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<Response> {
  const startedAt = performance.now();
  const result = await storefrontFetch<{ shop: { name: string } }, Record<string, never>>(
    "query ShopifyHealth { shop { name } }",
    {},
    request,
  );
  const latencyMs = Math.max(0, Math.round(performance.now() - startedAt));
  return Response.json({ ok: result.ok, storefront: result.ok, latencyMs });
}
