import { stat } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import manifestJson from "../../data/assets.manifest.json";
import { assetMappings, sourceIdentity } from "../../scripts/assets/mapping";
import type { AssetManifestRow } from "../../scripts/assets/types";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const manifest = manifestJson as AssetManifestRow[];
const allowedDuplicateGroups = [
  ["sofa-endre", "sofa-svale"],
  ["armchair-elsa", "armchair-nook", "armchair-ro"],
  ["bed-birk", "bed-viggo"],
  ["desk-aalto", "desk-linn", "desk-varde"],
  ["desk-kari", "desk-soren"],
  ["wardrobe-hald", "wardrobe-nord", "wardrobe-tor"],
  ["wardrobe-eira", "shelf-kant", "shelf-lund", "shelf-rune", "shelf-saga", "shelf-vik"],
  ["tv-unit-sund", "tv-unit-ved"],
  ["rug-mark", "rug-siv", "rug-ull"],
  ["floor-lamp-lyst", "floor-lamp-sol", "lamp-glow"],
  ["table-lamp-alva", "table-lamp-natt"],
].map((ids) => [...ids].sort().join("|"));

describe("built furniture assets", () => {
  it("covers every catalog item with one manifest row and GLB", async () => {
    const catalogIds = catalogSource.map((item) => item.id).sort();
    expect(manifest.map((row) => row.id).sort()).toEqual(catalogIds);
    await Promise.all(catalogIds.map((id) => stat(path.join(repoRoot, `public/assets/glb/${id}.glb`))));
  });

  it("stays within per-file and total byte budgets", async () => {
    const sizes = await Promise.all(manifest.map((row) => stat(path.join(repoRoot, `public/assets/glb/${row.id}.glb`))));
    for (const size of sizes) expect(size.size).toBeLessThan(400 * 1024);
    expect(sizes.reduce((sum, size) => sum + size.size, 0)).toBeLessThan(25 * 1024 * 1024);
    for (let index = 0; index < sizes.length; index += 1) expect(manifest[index].bytes).toBe(sizes[index].size);
  });

  it("keeps baked bounds within 15 percent of catalog dimensions", () => {
    const byId = new Map(manifest.map((row) => [row.id, row]));
    for (const item of catalogSource) {
      const row = byId.get(item.id);
      expect(row, item.id).toBeDefined();
      if (!row) continue;
      for (const axis of ["w", "d", "h"] as const) {
        const error = Math.abs(row.bbox_cm[axis] - item.dims[axis]) / item.dims[axis];
        expect(error, `${item.id} ${axis}`).toBeLessThanOrEqual(0.1501);
      }
    }
  });

  it("ships only verified CC0 assets", () => {
    expect(new Set(manifest.map((row) => row.license))).toEqual(new Set(["CC0"]));
  });

  it("limits source-model reuse to dimensionally distinct catalog variants", () => {
    const groups = new Map<string, string[]>();
    for (const mapping of assetMappings) {
      const identity = sourceIdentity(mapping);
      groups.set(identity, [...(groups.get(identity) ?? []), mapping.id]);
    }
    const duplicates = [...groups.values()].filter((ids) => ids.length > 1).map((ids) => [...ids].sort().join("|"));
    expect(duplicates.sort()).toEqual([...allowedDuplicateGroups].sort());
    for (const ids of [...groups.values()].filter((group) => group.length > 1)) {
      const variants = ids.map((id) => {
        const item = catalogSource.find((candidate) => candidate.id === id);
        if (!item) throw new Error(`Missing catalog item ${id}`);
        return `${item.dims.w}×${item.dims.d}×${item.dims.h}:${item.colorways.map((color) => color.id).join(",")}`;
      });
      expect(new Set(variants).size).toBe(variants.length);
    }
  });
});
