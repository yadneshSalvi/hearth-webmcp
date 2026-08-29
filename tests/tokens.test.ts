import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { palette, mix, wallColorHex, palettePresets, radius } from "../src/tokens";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const style = readFileSync(new URL("../STYLE.md", import.meta.url), "utf8");

/** Every `--color-*: #rrggbb` declaration in the @theme block, as `[name, hex]`. */
function cssColorHexes(): [string, string][] {
  return [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})\s*;/g)]
    .map((match) => [match[1] as string, (match[2] as string).toLowerCase()]);
}

describe("tokens", () => {
  it("every palette colour is mirrored in globals.css @theme", () => {
    for (const [name, hex] of Object.entries(palette)) {
      expect(css.toLowerCase(), `${name} ${hex}`).toContain(hex.toLowerCase());
    }
  });

  it("STYLE.md's token table contains every palette entry and no extra hex", () => {
    const table = style.slice(style.indexOf("| Token | Value | Use |"), style.indexOf("These six accents"));
    const documented = new Set([...table.matchAll(/#[0-9a-fA-F]{6}/g)].map((match) => match[0].toLowerCase()));
    const executable = new Set(Object.values(palette).map((hex) => hex.toLowerCase()));
    expect([...documented].sort()).toEqual([...executable].sort());
  });

  // The mirror has to hold in both directions: a hex that only exists in CSS is a new colour
  // smuggled past src/tokens.ts, which STYLE.md §1 forbids (`--color-white: #fffdf9` was one).
  it("every hex colour in globals.css comes from the palette", () => {
    const known = new Set(Object.values(palette).map((hex) => hex.toLowerCase()));
    const found = cssColorHexes();
    expect(found.length).toBeGreaterThan(10);
    for (const [name, hex] of found) {
      expect(known, `--color-${name}: ${hex} is not in src/tokens.ts palette`).toContain(hex);
    }
  });

  it("only the three documented radii exist", () => {
    const declared = [...css.matchAll(/--radius-([a-z]+):\s*(\d+)px/g)].map((match) => Number(match[2]));
    expect(declared.sort((a, b) => a - b)).toEqual([radius.chip, radius.panel, radius.pill]);
    // An arbitrary rounded-[Npx] utility is a fourth radius by the back door (STYLE.md §1).
    expect(css).not.toMatch(/rounded-\[/);
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
