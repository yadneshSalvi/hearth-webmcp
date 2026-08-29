/**
 * Thumbnail art direction: the backdrop the product shot stands on and which colourway it wears.
 *
 * Both exist because of one failure the reviewers found twice: a *flat* item in a pale colourway
 * disappears. A sofa is a volume — plaster upholstery reads through its own shading and its contact
 * shadow — but a 3 cm rug is a rectangle of albedo, and `softenField` lifts a rug's colour toward
 * plaster on purpose (STYLE.md: a full-strength accent over six square metres shouts). Rendered on a
 * plaster backdrop, `rug-ull` in oak came out as a white sheet visible only by its edge.
 *
 * So: the stage is `canvas.bottom` rather than `plaster` — the warm end of the studio's own gradient,
 * a whisper darker, which gives every pale item a floor to sit on — and a flat item is shot in the
 * first of its colourways that actually separates from that stage. Pure, so both decisions are unit
 * tested (`tests/scene/thumbnail.test.ts`) instead of eyeballed one product at a time.
 */
import type { Category } from "../engine/types";
import { palette } from "../tokens";
import { softenField } from "./retint";

/** The surface every product shot is composed on; `src/ui/CatalogThumb.tsx` matches it. */
export const THUMB_BACKDROP = palette.canvasBottom;

/** Height in cm at or below which an item has no shading to be read by. */
export const FLAT_MAX_H_CM = 6;

/**
 * Contrast a flat item's field must have against the backdrop. 1.25 is empirical: `rug-ull` in oak
 * measures 1.13 and vanishes, in ochre 1.36 and reads; `decor-tray` in oak measures 1.32 and reads.
 */
export const MIN_FLAT_CONTRAST = 1.25;

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance of an `#RRGGBB` colour. */
export function luminance(hex: string): number {
  const value = parseInt(hex.replace("#", ""), 16);
  return (
    0.2126 * toLinear(((value >> 16) & 255) / 255)
    + 0.7152 * toLinear(((value >> 8) & 255) / 255)
    + 0.0722 * toLinear((value & 255) / 255)
  );
}

/** WCAG contrast ratio between two `#RRGGBB` colours; 1 means identical. */
export function contrastRatio(a: string, b: string): number {
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

/** The albedo the item's largest surface actually ends up with, after the re-tint's rug softening. */
export function fieldHex(category: Category, colorwayHex: string): string {
  return category === "rug" ? softenField(colorwayHex) : colorwayHex;
}

export interface ThumbnailSubject {
  category: Category;
  dims: { h: number };
  colorways: readonly { id: string; hex: string }[];
}

/**
 * Which colourway to shoot a product in. The first one — the colourway it is placed in by default —
 * unless the item is flat and that colourway would vanish into the backdrop, in which case the first
 * colourway that separates from it, or failing that the darkest one it has.
 */
export function thumbnailColorway(product: ThumbnailSubject, backdrop: string = THUMB_BACKDROP): string {
  const first = product.colorways[0];
  if (!first) return "oak";
  if (product.dims.h > FLAT_MAX_H_CM) return first.id;
  const separates = product.colorways.find(
    (colorway) => contrastRatio(fieldHex(product.category, colorway.hex), backdrop) >= MIN_FLAT_CONTRAST,
  );
  if (separates) return separates.id;
  return [...product.colorways].sort((a, b) => luminance(a.hex) - luminance(b.hex))[0]?.id ?? first.id;
}
