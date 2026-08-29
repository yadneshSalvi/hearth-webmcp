import type { NextConfig } from "next";

/**
 * Static asset caching. Everything under `/public/assets` is built by `pnpm assets` and named by
 * catalog id, and `/draco` is a vendored decoder that never changes — so the browser should keep
 * them rather than revalidating 71 GLBs and 71 thumbnails on every visit. Next serves `/public` with
 * `max-age=0` by default, which showed up both in Lighthouse's cache audit and as a conditional
 * request per asset behind the warm-up queue (src/scene/glb.ts).
 */
const ASSET_CACHE = "public, max-age=604800, stale-while-revalidate=86400";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The floating dev badge sits over the canvas and lands in every studio screenshot; errors are
  // still reported through the console and the error overlay.
  devIndicators: false,
  async headers() {
    return [
      { source: "/assets/:path*", headers: [{ key: "cache-control", value: ASSET_CACHE }] },
      { source: "/draco/:path*", headers: [{ key: "cache-control", value: IMMUTABLE_CACHE }] },
    ];
  },
};

export default nextConfig;
