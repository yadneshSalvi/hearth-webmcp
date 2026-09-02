import type { CatalogItem, Dims } from "./types";

/** Smallest and largest side a resized item may have, in cm. */
export const MIN_SIDE_CM = 10;
export const MAX_SIDE_CM = 1000;
/** Bounds on scale_percent relative to the catalog size. */
export const MIN_SCALE_PERCENT = 25;
export const MAX_SCALE_PERCENT = 400;
/** Sides within this many cm count as the same size. */
export const EXACT_TOLERANCE_CM = 1;
/** Default per-side tolerance for a "close" size match. */
export const DEFAULT_CLOSE_TOLERANCE_CM = 10;

export interface ResizePatch {
  width_cm?: number;
  depth_cm?: number;
  height_cm?: number;
  scale_percent?: number;
  reset?: boolean;
}

export type ResizeOutcome =
  | { ok: true; dims: Dims | undefined; scalePercent: number }
  | { ok: false; detail: string };

function clampSide(value: number): number {
  return Math.max(MIN_SIDE_CM, Math.min(MAX_SIDE_CM, Math.round(value)));
}

/** True when two sizes agree on every side within the exact tolerance. */
export function sameDims(a: Dims, b: Dims): boolean {
  return Math.abs(a.w - b.w) <= EXACT_TOLERANCE_CM && Math.abs(a.d - b.d) <= EXACT_TOLERANCE_CM && Math.abs(a.h - b.h) <= EXACT_TOLERANCE_CM;
}

/**
 * Applies a resize request to an item. `current` is the item's present size (its override or the
 * catalog size); `catalog` is the product's own size, which `scale_percent` and `reset` refer to.
 * Returns `dims: undefined` when the result is the catalog size again, so the override is dropped.
 */
export function resizeDims(catalog: Dims, current: Dims, patch: ResizePatch): ResizeOutcome {
  const fields = [patch.width_cm, patch.depth_cm, patch.height_cm, patch.scale_percent];
  if (!patch.reset && fields.every((value) => value === undefined)) {
    return { ok: false, detail: "Give width_cm, depth_cm, height_cm, scale_percent or reset." };
  }
  for (const value of fields) {
    if (value !== undefined && (!Number.isFinite(value) || value <= 0)) return { ok: false, detail: "Sizes must be positive numbers in cm." };
  }
  if (patch.scale_percent !== undefined && (patch.scale_percent < MIN_SCALE_PERCENT || patch.scale_percent > MAX_SCALE_PERCENT)) {
    return { ok: false, detail: `scale_percent must be between ${MIN_SCALE_PERCENT} and ${MAX_SCALE_PERCENT}.` };
  }
  let next: Dims = patch.reset ? { ...catalog } : { ...current };
  if (patch.scale_percent !== undefined) {
    const factor = patch.scale_percent / 100;
    next = { w: catalog.w * factor, d: catalog.d * factor, h: catalog.h * factor };
  }
  if (patch.width_cm !== undefined) next.w = patch.width_cm;
  if (patch.depth_cm !== undefined) next.d = patch.depth_cm;
  if (patch.height_cm !== undefined) next.h = patch.height_cm;
  for (const [side, value] of Object.entries(next) as Array<[keyof Dims, number]>) {
    if (value < MIN_SIDE_CM || value > MAX_SIDE_CM) return { ok: false, detail: `${sideName(side)} must be between ${MIN_SIDE_CM} and ${MAX_SIDE_CM} cm.` };
    const percent = (value / catalog[side]) * 100;
    if (percent < MIN_SCALE_PERCENT - 0.5 || percent > MAX_SCALE_PERCENT + 0.5) {
      return { ok: false, detail: `${sideName(side)} ${Math.round(value)} cm is outside ${MIN_SCALE_PERCENT}–${MAX_SCALE_PERCENT}% of the catalog ${catalog[side]} cm.` };
    }
  }
  const rounded: Dims = { w: clampSide(next.w), d: clampSide(next.d), h: clampSide(next.h) };
  const scalePercent = Math.round(((rounded.w / catalog.w + rounded.d / catalog.d + rounded.h / catalog.h) / 3) * 100);
  return { ok: true, dims: sameDims(rounded, catalog) ? undefined : rounded, scalePercent };
}

function sideName(side: keyof Dims): string {
  return side === "w" ? "Width" : side === "d" ? "Depth" : "Height";
}

/** How well a product size fits a target: exact (every side within 1 cm), close (within the tolerance), or off. */
export type DimsMatch = "exact" | "close" | "off";

export interface DimsComparison {
  match: DimsMatch;
  /** Sum of absolute differences over the sides the target names, in cm. */
  distanceCm: number;
  /** "w+5 d-3 h0" — product minus target, per named side. */
  delta: string;
}

/** Compares a product size with a (possibly partial) target size. */
export function compareDims(dims: Dims, target: Partial<Dims>, toleranceCm = DEFAULT_CLOSE_TOLERANCE_CM): DimsComparison {
  const sides = (["w", "d", "h"] as const).filter((side) => target[side] !== undefined && Number.isFinite(target[side]));
  if (sides.length === 0) return { match: "off", distanceCm: 0, delta: "" };
  let distance = 0;
  let worst = 0;
  const parts: string[] = [];
  for (const side of sides) {
    const diff = Math.round(dims[side] - (target[side] as number));
    distance += Math.abs(diff);
    worst = Math.max(worst, Math.abs(diff));
    parts.push(`${side}${diff > 0 ? "+" : ""}${diff}`);
  }
  const match: DimsMatch = worst <= EXACT_TOLERANCE_CM ? "exact" : worst <= toleranceCm ? "close" : "off";
  return { match, distanceCm: distance, delta: parts.join(" ") };
}

export interface ClosestProduct {
  product: CatalogItem;
  comparison: DimsComparison;
}

/**
 * The catalog products nearest a target size, closest first; ties break on price then name. `category`
 * narrows the pool; `excludeId` drops the product an item already is.
 */
export function closestProducts(
  catalog: readonly CatalogItem[],
  target: Partial<Dims>,
  opts: { category?: CatalogItem["category"]; excludeId?: string; toleranceCm?: number; limit?: number } = {},
): ClosestProduct[] {
  return catalog
    .filter((product) => (!opts.category || product.category === opts.category) && product.id !== opts.excludeId)
    .map((product) => ({ product, comparison: compareDims(product.dims, target, opts.toleranceCm) }))
    .sort((a, b) => a.comparison.distanceCm - b.comparison.distanceCm
      || (a.product.price ?? Number.POSITIVE_INFINITY) - (b.product.price ?? Number.POSITIVE_INFINITY)
      || a.product.name.localeCompare(b.product.name))
    .slice(0, Math.max(1, opts.limit ?? 3));
}
