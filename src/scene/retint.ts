"use client";
/**
 * GLB re-tint. Every loaded albedo is mapped into the Hearth palette so 71 CC0 models from six
 * different sources read as one designed set (STYLE.md §2). Material *names* drive the mapping —
 * the shipped assets name their groups (`wood`, `metal`, `carpet`, `Plant_Green`, `Cover3`, `lamp`)
 * far more reliably than their albedos, roughly half of them being white with an atlas texture.
 * Names that carry no role fall back to the nearest palette family of the original albedo.
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
/**
 * A hueless albedo may only become a hueless family. Without this a mid grey lamp base lands on
 * plum purely because their lightnesses match, which is how grey poles turned pink.
 */
const NEUTRAL_FAMILIES = new Set<ColorwayId>(["plaster", "oak", "charcoal"]);

/** Nearest palette family for an arbitrary albedo colour (STYLE.md: albedo → palette family). */
export function nearestPaletteFamily(hex: string): ColorwayId {
  const lab = hexToOklab(hex);
  const neutral = Math.hypot(lab.a, lab.b) < NEUTRAL_CHROMA;
  const candidates = neutral ? FAMILY_LAB.filter((family) => NEUTRAL_FAMILIES.has(family.id)) : FAMILY_LAB;
  let best = candidates[0] as (typeof FAMILY_LAB)[number];
  let bestDistance = Infinity;
  for (const family of candidates) {
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

/** What a GLB material group represents, decided from its name and then its category. */
export type MaterialRole = "shade" | "leaf" | "timber" | "metal" | "textile" | "paper" | "book" | "unknown";

/** Categories whose lightest non-metal group glows so evening lamps bloom (STYLE.md §2). */
const LAMP_CATEGORIES = new Set<Category>(["floor-lamp", "table-lamp"]);
/** Every group of a rug is textile, whatever the source called it. */
const TEXTILE_CATEGORIES = new Set<Category>(["rug"]);

const METAL_PATTERN = /metal|chrome|steel|iron|^black$/i;
const SHADE_PATTERN = /^light$|^lamp$|shade|diffus|globe|bulb|emissive/i;
const LEAF_PATTERN = /leaf|leaves|plant|foliage|green/i;
const TIMBER_PATTERN = /wood|timber|oak|birch|pine|^legs?$|^brown$/i;
const BOOK_PATTERN = /^cover\s*\d+$/i;
const PAPER_PATTERN = /page|paper/i;
const TEXTILE_PATTERN = /sofa|couch|cushion|fabric|linen|cover|comforter|duvet|quilt|mattress|pillow|carpet|rug|upholst|seat|cloth/i;

/**
 * Classifies one GLB material group from its name. Metal is tested first so `LightMetal` never
 * reads as a lamp shade, and book covers before textiles so `Cover3` is a book, not upholstery.
 */
export function materialRole(name: string): MaterialRole {
  const value = name.trim();
  if (!value) return "unknown";
  if (METAL_PATTERN.test(value)) return "metal";
  if (SHADE_PATTERN.test(value)) return "shade";
  if (LEAF_PATTERN.test(value)) return "leaf";
  if (TIMBER_PATTERN.test(value)) return "timber";
  if (BOOK_PATTERN.test(value)) return "book";
  if (PAPER_PATTERN.test(value)) return "paper";
  if (TEXTILE_PATTERN.test(value)) return "textile";
  return "unknown";
}

/** Book spines cycle a fixed accent order so every shelf in the home reads as the same library. */
const BOOK_ACCENTS: ColorwayId[] = ["terracotta", "dusty-blue", "ochre", "sage", "plum", "charcoal"];

function bookHex(name: string): string {
  const digits = name.match(/(\d+)/);
  const index = digits ? (Number(digits[1]) - 1 + BOOK_ACCENTS.length) % BOOK_ACCENTS.length : 0;
  const family = BOOK_ACCENTS[index] ?? "terracotta";
  // Heavily muted toward timber: six full-strength accents on one shelf read as a toy rainbow.
  return mix(mix(familyHex(family), palette.oak, 0.46), palette.charcoal, 0.08);
}

/** Timber is always a shade deeper than raw oak so an oak-colorway item still reads as frame + face. */
const TIMBER_BASE = mix(palette.oak, palette.charcoal, 0.16);

function timberHex(name: string): string {
  if (/light/i.test(name)) return mix(palette.oak, palette.plaster, 0.14);
  if (/dark/i.test(name)) return mix(palette.oak, palette.charcoal, 0.32);
  if (/2$/.test(name)) return mix(palette.oak, palette.charcoal, 0.24);
  return TIMBER_BASE;
}

function metalHex(name: string): string {
  if (/light/i.test(name)) return mix(palette.charcoal, palette.plaster, 0.34);
  if (/dark/i.test(name)) return palette.charcoal;
  return mix(palette.charcoal, palette.plaster, 0.16);
}

/**
 * Secondary textile groups are variants of the *field* colour, not of the raw colorway, so a rug
 * whose field has been lifted toward plaster keeps a border in proportion instead of a hard ring.
 * The spread is wide enough that a bed's frame, mattress, duvet and pillows read as four layers.
 */
function textileHex(name: string, fieldHex: string): string {
  // Kept moderate on purpose: these steps compound with the non-focus recede in Furniture.tsx, and
  // a wider spread turned every bed outside the framed room into a sheet of plaster.
  if (/mattress/i.test(name)) return mix(fieldHex, palette.plaster, 0.5);
  if (/light|white|pillow/i.test(name)) return mix(fieldHex, palette.plaster, 0.38);
  if (/dark/i.test(name)) return mix(fieldHex, palette.charcoal, 0.14);
  return mix(fieldHex, palette.plaster, 0.24);
}

/** The warm diffuser colour every lamp shade shares. */
export const SHADE_HEX = mix(palette.plaster, palette.ochre, 0.3);
/** Plant pots are always the same warm clay, so foliage stays the only green in the room. */
export const POT_HEX = mix(palette.terracotta, palette.plaster, 0.3);

/**
 * A rug's field is the largest single textile in a room, and a full-strength accent over six square
 * metres shouts. The field is lifted toward plaster by the largest step that still resolves to the
 * item's own palette family, so `set_colorway charcoal` never quietly becomes an oak rug.
 */
export function softenField(colorwayHex: string): string {
  const family = nearestPaletteFamily(colorwayHex);
  for (const amount of [0.42, 0.26, 0.12]) {
    const candidate = mix(colorwayHex, palette.plaster, amount);
    if (nearestPaletteFamily(candidate) === family) return candidate;
  }
  return colorwayHex;
}

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
  /** Final albedo hex after role mapping and the colorway override. */
  hex: string;
  /** Matched palette family of the original albedo, before any override. */
  family: ColorwayId;
  /** The role the name resolved to, after category defaults. */
  role: MaterialRole;
  /** True for the group that carries the item's colorway. */
  dominant: boolean;
  /** Emissive hex, or undefined when the material does not glow. */
  emissive?: string;
  roughness: number;
  metalness: 0;
}

function largestIndex(materials: SourceMaterial[], allow: (index: number) => boolean): number {
  let best = -1;
  let bestArea = -Infinity;
  materials.forEach((material, index) => {
    if (!allow(index)) return;
    if (material.area > bestArea) {
      bestArea = material.area;
      best = index;
    }
  });
  return best;
}

/**
 * Builds the deterministic re-tint plan for one GLB: a palette colour per material group from its
 * role, the item's colorway on the largest group that is neither a lamp shade nor foliage, and an
 * ochre emissive kept on shades. Pure and stable — the same inputs always give the same plan.
 */
export function retintPlan(materials: SourceMaterial[], colorwayHex: string, category: Category): RetintedMaterial[] {
  const isLamp = LAMP_CATEGORIES.has(category);
  const isPlant = category === "plant";
  const roles = materials.map((material) => {
    const named = materialRole(material.name);
    // Only a lamp actually diffuses light; a sofa panel called "Shade" is upholstery.
    if (named === "shade" && !isLamp) return TEXTILE_CATEGORIES.has(category) ? "textile" : "unknown";
    if (named !== "unknown") return named;
    if (TEXTILE_CATEGORIES.has(category)) return "textile";
    // A plant whose whole model is one atlas material is foliage first; the pot is a detail.
    if (isPlant) return "leaf";
    return "unknown";
  });

  // A lamp with no group actually called "shade"/"light" still needs one: the lightest non-metal
  // group diffuses. A single-material lamp keeps its colorway and glows as a whole instead.
  let soloGlow = false;
  if (isLamp && !roles.includes("shade")) {
    if (materials.length === 1) soloGlow = true;
    else {
      const shade = materials
        .map((material, index) => ({ index, lightness: hexToOklab(material.hex).L }))
        .filter((entry) => roles[entry.index] !== "metal")
        .sort((a, b) => b.lightness - a.lightness)[0];
      if (shade) roles[shade.index] = "shade";
    }
  }

  // Plants are the one category the colorway does not drive: STYLE.md fixes foliage at sage, and a
  // pot tinted to a sage colorway would vanish into its own leaves.
  const dominant = isPlant ? -1 : largestIndex(materials, (index) => roles[index] !== "shade" && roles[index] !== "leaf");
  const dominantHex = TEXTILE_CATEGORIES.has(category) ? softenField(colorwayHex) : colorwayHex;

  return materials.map((material, index) => {
    const role = roles[index] ?? "unknown";
    const family = nearestPaletteFamily(material.hex);
    const isDominant = index === dominant;
    const glows = role === "shade" || (soloGlow && isDominant);
    const hex = role === "shade"
      ? SHADE_HEX
      : role === "leaf"
        ? palette.sage
        : isPlant
        ? POT_HEX
        : isDominant
          ? dominantHex.toUpperCase()
          : role === "timber"
            ? timberHex(material.name)
            : role === "metal"
              ? metalHex(material.name)
              : role === "book"
                ? bookHex(material.name)
                : role === "paper"
                  ? mix(palette.plaster, palette.oak, 0.25)
                  : role === "textile"
                    ? textileHex(material.name, dominantHex)
                    : familyHex(family);
    return {
      name: material.name,
      hex: hex.toUpperCase(),
      family,
      role,
      dominant: isDominant,
      ...(glows ? { emissive: palette.ochre } : {}),
      roughness: glows ? 0.55 : 0.85 + ((index * 37) % 11) / 100,
      metalness: 0 as const,
    };
  });
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
