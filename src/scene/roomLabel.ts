/**
 * Fitting a plan-view room label to the room it names.
 *
 * The label is drawn horizontally in the middle of the room, so a narrow room gives it very little
 * width: "BEDROOM HALL" over a 1.2 m hall used to break wherever it liked, and the area under it
 * came apart into "10.6" and "m²". Instead the name shrinks — never below `MIN_PX`, which is the
 * smallest size STYLE.md's small-caps stays legible at — and only a name that still will not fit at
 * that size is allowed to wrap, at a word boundary. The area line never wraps at all.
 *
 * Pure: no DOM measurement, so it is unit-tested without a browser. The advance below is Inter's
 * uppercase average at 0.12em tracking, measured against the shipped labels; it only has to be
 * accurate enough to decide when to shrink, and it errs on the wide side so a label shrinks a step
 * early rather than a step late.
 */

/** Width of one uppercase glyph at 1 px, including the small-caps letter-spacing. */
const CAPS_ADVANCE = 0.66;

/** STYLE.md §1: small-caps labels are Inter 11–12 px. 11 is the plan label's resting size. */
export const LABEL_PX = 11;
/** Below this the label stops being a label and becomes a smudge. */
export const MIN_PX = 9;

export interface FittedLabel {
  /** Font size in px, between `MIN_PX` and `LABEL_PX`. */
  fontPx: number;
  /** Width the label may occupy, in px; a name that needs more wraps at a word boundary. */
  maxWidthPx: number;
  /** True when even `MIN_PX` will not fit the name on one line. */
  wraps: boolean;
}

/** Rendered width of `text` in px at `fontPx`. */
export function labelWidthPx(text: string, fontPx: number): number {
  return text.length * fontPx * CAPS_ADVANCE;
}

/**
 * The size a room's label should be drawn at, given how many pixels of room it has to sit in.
 * `availablePx` is the room's *shorter* side on screen: the label is horizontal, but a long thin
 * room read the other way round is exactly where a full-size label spills over its neighbour.
 */
export function fitRoomLabel(name: string, availablePx: number, basePx = LABEL_PX): FittedLabel {
  const usable = Math.max(0, availablePx);
  if (!(usable > 0)) return { fontPx: basePx, maxWidthPx: Number.POSITIVE_INFINITY, wraps: false };
  if (labelWidthPx(name, basePx) <= usable) return { fontPx: basePx, maxWidthPx: usable, wraps: false };
  const wanted = usable / (name.length * CAPS_ADVANCE);
  if (wanted >= MIN_PX) {
    // Tenths, so the size is stable frame to frame instead of jittering with the camera.
    return { fontPx: Math.round(wanted * 10) / 10, maxWidthPx: usable, wraps: false };
  }
  return { fontPx: MIN_PX, maxWidthPx: usable, wraps: true };
}
