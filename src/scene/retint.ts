/**
 * GLB re-tint: every loaded albedo is mapped to its nearest Hearth palette family and the item's
 * largest material group takes the colorway hex, so 70 assets read as one designed set (STYLE.md §2).
 */
import type { Category } from "../engine/types";
import { colorways, mix, palette } from "../tokens";
import type { ColorwayId } from "../tokens";

export type Oklab = { L: number; a: number; b: number };

/** Parses `#RRGGBB` into 0..1 sRGB components. */
export function parseHex(hex: string): [number, number, number] {
  const value = parseInt(hex.replace("#", ""), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** Converts an sRGB hex to Oklab, the perceptual space used for palette matching. */
export function hexToOklab(hex: string): Oklab {
  const [sr, sg, sb] = parseHex(hex);
  const r = toLinear(sr);
  const g = toLinear(sg);
  const b = toLinear(sb);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/** Below this Oklab chroma a colour has no usable hue, so it is matched on lightness instead. */
const NEUTRAL_CHROMA = 0.025;

/**
 * Luminance-weighted Oklab distance. Chromatic albedos are matched mostly on hue and chroma —
 * the family hex supplies the lightness anyway, so a mid brown must land on oak, not on plum —
 * while near-neutral albedos weight lightness heavily so white reads plaster and black charcoal.
 */
export function oklabDistance(a: Oklab, b: Oklab): number {
  const weight = Math.hypot(a.a, a.b) < NEUTRAL_CHROMA ? 3 : 0.15;
  const dL = (a.L - b.L) * weight;
  const da = a.a - b.a;
  const db = a.b - b.b;
  return Math.sqrt(dL * dL + da * da + db * db);
}

const FAMILY_IDS = Object.keys(colorways) as ColorwayId[];
const FAMILY_LAB = FAMILY_IDS.map((id) => ({ id, lab: hexToOklab(colorways[id].hex) }));

/** Nearest palette family for an arbitrary albedo colour (STYLE.md: albedo → palette family). */
export function nearestPaletteFamily(hex: string): ColorwayId {
  const lab = hexToOklab(hex);
  let best = FAMILY_LAB[0] as (typeof FAMILY_LAB)[number];
  let bestDistance = Infinity;
  for (const family of FAMILY_LAB) {
    const distance = oklabDistance(lab, family.lab);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = family;
    }
  }
  return best.id;
}

/** Hex for a palette family id. */
export function familyHex(id: ColorwayId): string {
  return colorways[id].hex;
}

/** Categories whose shade material keeps a warm emissive so evening lamps bloom. */
const LAMP_CATEGORIES = new Set<Category>(["floor-lamp", "table-lamp"]);

/** Material names that read as a lamp shade / diffuser in a GLB. */
const SHADE_PATTERN = /shade|diffus|globe|bulb|light|lamp/i;

export interface SourceMaterial {
  /** Material name from the GLB (may be empty). */
  name: string;
  /** Original albedo as `#RRGGBB`. */
  hex: string;
  /** Summed triangle area of the faces using this material, in any consistent unit. */
  area: number;
}

export interface RetintedMaterial {
  name: string;
  /** Final albedo hex after palette mapping and colorway override. */
  hex: string;
  /** Matched palette family before the colorway override. */
  family: ColorwayId;
  /** True for the largest-surface group, which takes the item's colorway. */
  dominant: boolean;
  /** Emissive hex, or undefined when the material does not glow. */
  emissive?: string;
  roughness: number;
  metalness: 0;
}

/**
 * Builds the deterministic re-tint plan for one GLB: nearest palette family per material, the
 * item's colorway on the largest surface, and an ochre emissive kept for lamp shades.
 */
export function retintPlan(materials: SourceMaterial[], colorwayHex: string, category: Category): RetintedMaterial[] {
  const lamp = LAMP_CATEGORIES.has(category);
  const shadeIndexes = materials
    .map((material, index) => ({ index, shade: SHADE_PATTERN.test(material.name) }))
    .filter((entry) => entry.shade)
    .map((entry) => entry.index);
  const lampShades = new Set(lamp ? (shadeIndexes.length > 0 ? shadeIndexes : [dominantIndex(materials)]) : []);
  const dominant = dominantIndex(materials);
  return materials.map((material, index) => {
    const family = nearestPaletteFamily(material.hex);
    const isDominant = index === dominant;
    const isShade = lampShades.has(index);
    return {
      name: material.name,
      hex: isDominant ? colorwayHex.toUpperCase() : isShade ? mix(palette.plaster, palette.ochre, 0.35) : familyHex(family),
      family,
      dominant: isDominant,
      ...(isShade ? { emissive: palette.ochre } : {}),
      roughness: isShade ? 0.55 : 0.85 + ((index * 37) % 11) / 100,
      metalness: 0 as const,
    };
  });
}

function dominantIndex(materials: SourceMaterial[]): number {
  let best = 0;
  let bestArea = -Infinity;
  materials.forEach((material, index) => {
    if (material.area > bestArea) {
      bestArea = material.area;
      best = index;
    }
  });
  return best;
}

/**
 * Emissive intensity for lamp shades: dark by day, glowing at dusk (STYLE.md §2). The evening value
 * is chosen so an ochre shade clears the bloom threshold, which nothing lit by the sun does.
 */
export function lampEmissiveIntensity(timeOfDay: string): number {
  if (timeOfDay === "evening") return 3.2;
  if (timeOfDay === "golden") return 0.5;
  return 0;
}
