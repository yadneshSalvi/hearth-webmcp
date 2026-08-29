/**
 * Pure helpers for the catalog panel's keyboard navigation and its empty state, so the arrow-key
 * arithmetic and the wording of "nothing matches" are unit-tested rather than eyeballed.
 */
import type { Category } from "../engine/types";

/**
 * Index of the card the arrow keys should land on. Movement stops at both ends rather than
 * wrapping: a list that jumps from the last row back to the first loses the human's place.
 */
export function nextCardIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  const next = current + delta;
  if (next < 0) return 0;
  if (next > count - 1) return count - 1;
  return next;
}

export interface CatalogFilterState {
  query: string;
  category?: Category;
  style?: string;
  /** "any" or the cap in USD as a string, matching the panel's chip. */
  price: string;
}

/** One thing to relax, and the filter patch that relaxes it. */
export interface CatalogSuggestion {
  label: string;
  patch: { query?: string; category?: undefined; style?: undefined; price?: "any" };
}

/**
 * The single most useful filter to drop when nothing matches, loosest-first: the price cap, then
 * the style tag, then the category, then the search text. One chip, one obvious next move.
 */
export function emptySuggestion(state: CatalogFilterState): CatalogSuggestion {
  if (state.price !== "any") return { label: "Try any price", patch: { price: "any" } };
  if (state.style) return { label: `Drop the ${state.style} filter`, patch: { style: undefined } };
  if (state.category) return { label: "Search every category", patch: { category: undefined } };
  if (state.query.trim().length > 0) return { label: `Clear “${state.query.trim()}”`, patch: { query: "" } };
  return { label: "Show the whole catalog", patch: { query: "", category: undefined, style: undefined, price: "any" } };
}

export interface EdgeFades {
  start: boolean;
  end: boolean;
}

/** Which edges of a horizontal scroller still have content past them, for the fade masks. */
export function edgeFades(scrollLeft: number, clientWidth: number, scrollWidth: number): EdgeFades {
  const overflow = scrollWidth - clientWidth;
  if (overflow <= 1) return { start: false, end: false };
  return { start: scrollLeft > 1, end: scrollLeft < overflow - 1 };
}
