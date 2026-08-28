import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetMapping } from "./types";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const assetCacheRoot = path.join(repoRoot, ".cache/assets");
export const archiveCacheDir = path.join(assetCacheRoot, "archives");
export const polyPizzaCacheDir = path.join(assetCacheRoot, "poly-pizza");
export const outputGlbDir = path.join(repoRoot, "public/assets/glb");
export const outputThumbDir = path.join(repoRoot, "public/assets/thumbs");
export const manifestPath = path.join(repoRoot, "data/assets.manifest.json");
export const creditsPath = path.join(repoRoot, "public/assets/CREDITS.md");

export function sourceInputPath(mapping: AssetMapping): string {
  if (mapping.sourceKey === "kenney-furniture") {
    return path.join(assetCacheRoot, "kenney", mapping.sourceFile);
  }
  if (mapping.sourceKey === "kaykit-furniture") {
    return path.join(assetCacheRoot, "kaykit", mapping.sourceFile);
  }
  return path.join(polyPizzaCacheDir, `${mapping.polyPizzaId}.glb`);
}
