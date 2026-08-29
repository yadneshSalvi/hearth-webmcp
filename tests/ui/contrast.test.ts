import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { glass, ink, palette } from "../../src/tokens";

const css = readFileSync(new URL("../../app/globals.css", import.meta.url), "utf8");
const style = readFileSync(new URL("../../STYLE.md", import.meta.url), "utf8");

type Rgb = [number, number, number];

function hexRgb(hex: string): Rgb {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Parses `rgba(62, 58, 54, 0.72)` into its channels and alpha. */
function rgba(value: string): { rgb: Rgb; alpha: number } {
  const parts = value.replace(/^rgba?\(|\)$/g, "").split(",").map((part) => Number(part.trim()));
  const [r = 0, g = 0, b = 0, alpha = 1] = parts;
  return { rgb: [r, g, b], alpha };
}

function over(front: { rgb: Rgb; alpha: number }, back: Rgb): Rgb {
  return [0, 1, 2].map((index) => {
    const top = front.rgb[index] ?? 0;
    const bottom = back[index] ?? 0;
    return top * front.alpha + bottom * (1 - front.alpha);
  }) as Rgb;
}

/** WCAG 2.1 relative luminance. */
function luminance(rgb: Rgb): number {
  const channel = (value: number): number => {
    const srgb = value / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
}

/** WCAG 2.1 contrast ratio between two opaque colours. */
function contrast(a: Rgb, b: Rgb): number {
  const light = Math.max(luminance(a), luminance(b));
  const dark = Math.min(luminance(a), luminance(b));
  return (light + 0.05) / (dark + 0.05);
}

const plaster = hexRgb(palette.plaster);
/** A floating panel is plaster at 88 % over the canvas gradient; its darkest end is the bottom stop. */
const panel = over({ rgb: plaster, alpha: rgba(glass.background).alpha }, hexRgb(palette.canvasBottom));

function ratioOnPlaster(token: string): number {
  return contrast(over(rgba(token), plaster), plaster);
}

describe("text contrast", () => {
  it("ink.muted carries label-caps at 11 px: at least 4.5:1 on plaster", () => {
    expect(rgba(ink.muted).alpha).toBe(0.72);
    expect(ratioOnPlaster(ink.muted)).toBeGreaterThanOrEqual(4.5);
  });

  it("ink.muted still reads on a glass panel over the canvas gradient", () => {
    // The panel is a touch darker than bare plaster, so the same token lands just under 4.5 there;
    // 4.4 is the floor that keeps the panel honest if the glass recipe is ever changed.
    expect(contrast(over(rgba(ink.muted), panel), panel)).toBeGreaterThanOrEqual(4.4);
  });

  it("ink.text clears AAA body text on plaster", () => {
    expect(contrast(hexRgb(ink.text), plaster)).toBeGreaterThanOrEqual(7);
  });

  it("ink.faint is tertiary, not body text, but is no longer a whisper", () => {
    expect(rgba(ink.faint).alpha).toBe(0.52);
    const faint = ratioOnPlaster(ink.faint);
    expect(faint).toBeGreaterThanOrEqual(2.5);
    expect(faint).toBeLessThan(ratioOnPlaster(ink.muted));
    // Darker than the 40 % it replaced.
    expect(faint).toBeGreaterThan(contrast(over({ rgb: hexRgb(palette.charcoal), alpha: 0.4 }, plaster), plaster));
  });

  it("hairlines stay hairlines: 14 % is a rule, never text", () => {
    expect(rgba(ink.hairline).alpha).toBe(0.14);
    expect(ratioOnPlaster(ink.hairline)).toBeLessThan(1.5);
  });
});

describe("token mirrors", () => {
  it("globals.css @theme carries the same alphas as src/tokens.ts", () => {
    for (const [name, token] of [["ink-muted", ink.muted], ["ink-faint", ink.faint], ["hairline", ink.hairline]] as const) {
      const declared = new RegExp(`--color-${name}:\\s*rgb\\(62 58 54 / ([0-9.]+)\\)`).exec(css);
      expect(declared, `--color-${name} must exist in app/globals.css`).not.toBeNull();
      expect(Number(declared?.[1])).toBeCloseTo(rgba(token).alpha, 5);
    }
  });

  it("STYLE.md's token table states the same percentages", () => {
    expect(style).toContain("`ink.muted` | `charcoal @ 72%`");
    expect(style).toContain("`ink.faint` | `charcoal @ 52%`");
  });
});
