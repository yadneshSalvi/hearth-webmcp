import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Production gate for the two development harnesses (Next 16 Proxy — see
 * `node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md`).
 *
 * `/parade` walks every GLB through the real pipeline and `/render` shoots one product for the
 * thumbnail script; neither should exist on the public origin. Both pages already call `notFound()`,
 * but `notFound()` renders the not-found *page* — this build serves it with a 200, and `/parade`
 * prerenders as static so the gate never even runs per request. A proxy is the only place that can
 * answer with the status code, so it does: a real 404 in production, untouched in development.
 */
const DEV_ROUTES = ["/parade", "/render"] as const;

export function proxy(request: NextRequest): NextResponse {
  if (process.env.NODE_ENV !== "production") return NextResponse.next();
  const { pathname } = request.nextUrl;
  const gated = DEV_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
  if (!gated) return NextResponse.next();
  return new NextResponse("404 Not Found\n", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", "x-robots-tag": "noindex" },
  });
}

export const config = {
  matcher: ["/parade", "/parade/:path*", "/render", "/render/:path*"],
};
