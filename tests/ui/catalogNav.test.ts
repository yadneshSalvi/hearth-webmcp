import { describe, expect, it } from "vitest";
import { edgeFades, emptySuggestion, nextCardIndex } from "../../src/ui/catalogNav";

describe("nextCardIndex", () => {
  it("enters the list from either end when nothing is focused", () => {
    expect(nextCardIndex(5, -1, 1)).toBe(0);
    expect(nextCardIndex(5, -1, -1)).toBe(4);
  });

  it("steps one card at a time and stops at both ends", () => {
    expect(nextCardIndex(5, 2, 1)).toBe(3);
    expect(nextCardIndex(5, 2, -1)).toBe(1);
    expect(nextCardIndex(5, 4, 1)).toBe(4);
    expect(nextCardIndex(5, 0, -1)).toBe(0);
  });

  it("has nowhere to go in an empty list", () => {
    expect(nextCardIndex(0, -1, 1)).toBe(-1);
  });
});

describe("emptySuggestion", () => {
  it("relaxes the price cap first", () => {
    const suggestion = emptySuggestion({ query: "oak desk", category: "desk", style: "japandi", price: "500" });
    expect(suggestion.label).toBe("Try any price");
    expect(suggestion.patch).toEqual({ price: "any" });
  });

  it("then the style, then the category, then the search text", () => {
    expect(emptySuggestion({ query: "", style: "japandi", price: "any" }).label).toBe("Drop the japandi filter");
    expect(emptySuggestion({ query: "", category: "sofa", price: "any" }).label).toBe("Search every category");
    expect(emptySuggestion({ query: " velvet ", price: "any" }).label).toBe("Clear “velvet”");
  });

  it("offers the whole catalog when no filter is set at all", () => {
    const suggestion = emptySuggestion({ query: "", price: "any" });
    expect(suggestion.label).toBe("Show the whole catalog");
    expect(suggestion.patch.price).toBe("any");
  });
});

describe("edgeFades", () => {
  it("shows nothing when the row fits", () => {
    expect(edgeFades(0, 320, 320)).toEqual({ start: false, end: false });
  });

  it("fades the end at the start of an overflowing row, and the start at its end", () => {
    expect(edgeFades(0, 320, 600)).toEqual({ start: false, end: true });
    expect(edgeFades(280, 320, 600)).toEqual({ start: true, end: false });
    expect(edgeFades(140, 320, 600)).toEqual({ start: true, end: true });
  });
});
