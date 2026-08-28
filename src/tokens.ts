/**
 * Hearth design tokens — the single source of colour, type, radius, shadow and motion for UI and 3D.
 * STYLE.md is the law; this file is its executable form. Tailwind reads the same values via @theme in
 * app/globals.css (keep the two in sync — tests/tokens.test.ts asserts it).
 */

export const palette = {
  canvasTop: "#F7F3EC",
  canvasBottom: "#EFE7DB",
  plaster: "#F4EFE6",
  oak: "#D9C4A3",
  paleOak: "#E6D8BF",
  stone: "#D8D3CA",
  terracotta: "#C46A4A",
  sage: "#8A9B7C",
  ochre: "#C9A44C",
  dustyBlue: "#7E93A8",
  plum: "#8A6A7D",
  charcoal: "#3E3A36",
  amber: "#D9973B",
  rose: "#C25E5E",
} as const;

export type PaletteName = keyof typeof palette;

/** Colorway ids used by the catalog, cart variants and the GLB re-tint step (maps to palette families). */
export const colorways = {
  oak: { name: "Oak", hex: palette.oak },
  plaster: { name: "Plaster", hex: palette.plaster },
  charcoal: { name: "Charcoal", hex: palette.charcoal },
  terracotta: { name: "Terracotta", hex: palette.terracotta },
  sage: { name: "Sage", hex: palette.sage },
  ochre: { name: "Ochre", hex: palette.ochre },
  "dusty-blue": { name: "Dusty blue", hex: palette.dustyBlue },
  plum: { name: "Plum", hex: palette.plum },
} as const;

export type ColorwayId = keyof typeof colorways;

/** Wall colour tokens: plaster or a 14 % tint of an accent over plaster (computed, never new hex). */
export const wallColors = ["plaster", "sage-tint", "plum-tint", "ochre-tint", "blue-tint", "terracotta-tint"] as const;
export type WallColor = (typeof wallColors)[number];

export const floors = ["oak", "pale-oak", "stone", "terrazzo"] as const;
export type Floor = (typeof floors)[number];

export const ink = {
  text: palette.charcoal,
  muted: "rgba(62, 58, 54, 0.62)",
  faint: "rgba(62, 58, 54, 0.40)",
  hairline: "rgba(62, 58, 54, 0.14)",
} as const;

export const radius = { panel: 16, chip: 10, pill: 999 } as const;

export const shadow = {
  panel: "0 18px 48px -18px rgba(62,58,54,.28), 0 2px 6px rgba(62,58,54,.06)",
  chip: "0 6px 18px -10px rgba(62,58,54,.30), 0 1px 2px rgba(62,58,54,.05)",
} as const;

export const glass = {
  background: "rgba(244, 239, 230, 0.88)",
  blur: "14px",
} as const;

export const motion = {
  /** 2D chrome */
  fast: 180,
  base: 240,
  slow: 320,
  easeOut: "cubic-bezier(0.22, 1, 0.36, 1)",
  /** 3D springs (react-spring config) */
  spring: { tension: 210, friction: 22 },
  springSoft: { tension: 120, friction: 18 },
  arrangeStaggerMs: 60,
  cameraTweenMs: 600,
  timeOfDayMs: 2000,
  orbFlightMs: 500,
} as const;

/** Mix a hex colour toward another (0..1). Used for wall tints and hover states; keeps everything in-palette. */
export function mix(hexA: string, hexB: string, t: number): string {
  const a = parseInt(hexA.slice(1), 16);
  const b = parseInt(hexB.slice(1), 16);
  const ch = (shift: number) => {
    const va = (a >> shift) & 255;
    const vb = (b >> shift) & 255;
    return Math.round(va + (vb - va) * t);
  };
  const toHex = (v: number) => v.toString(16).padStart(2, "0");
  return `#${toHex(ch(16))}${toHex(ch(8))}${toHex(ch(0))}`.toUpperCase();
}

export function wallColorHex(color: WallColor): string {
  switch (color) {
    case "plaster":
      return palette.plaster;
    case "sage-tint":
      return mix(palette.plaster, palette.sage, 0.14);
    case "plum-tint":
      return mix(palette.plaster, palette.plum, 0.14);
    case "ochre-tint":
      return mix(palette.plaster, palette.ochre, 0.14);
    case "blue-tint":
      return mix(palette.plaster, palette.dustyBlue, 0.14);
    case "terracotta-tint":
      return mix(palette.plaster, palette.terracotta, 0.14);
  }
}

export function floorHex(floor: Floor): string {
  switch (floor) {
    case "oak":
      return palette.oak;
    case "pale-oak":
      return palette.paleOak;
    case "stone":
      return palette.stone;
    case "terrazzo":
      return mix(palette.stone, palette.plaster, 0.5);
  }
}

/** Palette presets for apply_palette (TOOLS.md §16). */
export const palettePresets = {
  "warm-clay": { name: "Warm clay", walls: "plaster", floor: "oak", textiles: "terracotta" },
  "sage-linen": { name: "Sage linen", walls: "plaster", floor: "pale-oak", textiles: "sage" },
  dusk: { name: "Dusk", walls: "plum-tint", floor: "stone", textiles: "dusty-blue" },
  nordic: { name: "Nordic", walls: "plaster", floor: "pale-oak", textiles: "dusty-blue" },
  terrazzo: { name: "Terrazzo", walls: "plaster", floor: "terrazzo", textiles: "ochre" },
  "ochre-sun": { name: "Ochre sun", walls: "ochre-tint", floor: "oak", textiles: "ochre" },
} as const satisfies Record<string, { name: string; walls: WallColor; floor: Floor; textiles: ColorwayId }>;

export type PaletteId = keyof typeof palettePresets;
