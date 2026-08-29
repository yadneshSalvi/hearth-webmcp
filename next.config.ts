import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  // The floating dev badge sits over the canvas and lands in every studio screenshot; errors are
  // still reported through the console and the error overlay.
  devIndicators: false,
};

export default nextConfig;
