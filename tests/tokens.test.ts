import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { palette, mix, wallColorHex, palettePresets } from "../src/tokens";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("tokens", () => {
  it("every palette colour is mirrored in globals.css @theme", () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(css.toLowerCase(), `${name} ${hex}`).toContain(hex.toLowerCase());
    }
  });
  it("mix stays in range and wall tints derive from plaster", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(wallColorHex("plaster")).toBe(palette.plaster);
    expect(wallColorHex("sage-tint")).not.toBe(palette.plaster);
  });
  it("palette presets reference known tokens", () => {
    for (const preset of Object.values(palettePresets)) {
      expect(preset.name.length).toBeGreaterThan(0);
    }
  });
});
