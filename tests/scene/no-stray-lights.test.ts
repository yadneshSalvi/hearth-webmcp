import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SCENE_DIR = path.resolve(import.meta.dirname, "../../src/scene");
const LIGHT_TAGS = /<(pointLight|spotLight|directionalLight|ambientLight|hemisphereLight)\b/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

describe("no stray lights", () => {
  it("keeps every light inside LightingRig.tsx (STYLE.md §5)", () => {
    const offenders: string[] = [];
    for (const file of walk(SCENE_DIR)) {
      if (path.basename(file) === "LightingRig.tsx") continue;
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, index) => {
        if (LIGHT_TAGS.test(line)) offenders.push(`${path.relative(SCENE_DIR, file)}:${index + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  it("actually finds the rig's own lights, so the check cannot silently pass", () => {
    const rig = readFileSync(path.join(SCENE_DIR, "LightingRig.tsx"), "utf8");
    expect(LIGHT_TAGS.test(rig)).toBe(true);
  });
});
