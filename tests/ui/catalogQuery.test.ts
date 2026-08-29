import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { CATEGORIES } from "../../src/engine/types";
import { catalogGroups, catalogResults, categoryLabel, styleTags } from "../../src/ui/catalogQuery";

describe("catalog panel query", () => {
  it("returns the whole catalog when nothing is filtered", () => {
    const results = catalogResults(catalogSource, { query: "" });
    expect(results).toHaveLength(catalogSource.length);
    expect(new Set(results.map((item) => item.id)).size).toBe(catalogSource.length);
  });

  it("pages past the engine's six-row tool limit", () => {
    expect(catalogSource.length).toBeGreaterThan(6);
    expect(catalogResults(catalogSource, { query: "" }).length).toBeGreaterThan(6);
  });

  it("filters by category, style and price cap", () => {
    const sofas = catalogResults(catalogSource, { query: "", category: "sofa" });
    expect(sofas.length).toBeGreaterThan(0);
    expect(sofas.every((item) => item.category === "sofa")).toBe(true);

    const cheap = catalogResults(catalogSource, { query: "", maxPriceUsd: 500 });
    expect(cheap.every((item) => (item.price ?? 0) <= 500)).toBe(true);

    const japandi = catalogResults(catalogSource, { query: "", style: "japandi" });
    expect(japandi.length).toBeGreaterThan(0);
    expect(japandi.every((item) => item.styleTags.includes("japandi"))).toBe(true);
  });

  it("matches free text on name and colourway", () => {
    const byName = catalogResults(catalogSource, { query: "endre" });
    expect(byName.map((item) => item.id)).toContain("sofa-endre");
    expect(catalogResults(catalogSource, { query: "zzzz" })).toEqual([]);
  });

  it("groups results in catalog category order", () => {
    const groups = catalogGroups(catalogResults(catalogSource, { query: "" }));
    const order = groups.map((group) => group.category);
    expect(order).toEqual(CATEGORIES.filter((category) => order.includes(category)));
    expect(groups.reduce((total, group) => total + group.items.length, 0)).toBe(catalogSource.length);
  });

  it("labels every category and lists style tags alphabetically", () => {
    for (const category of CATEGORIES) expect(categoryLabel(category).length).toBeGreaterThan(2);
    const tags = styleTags(catalogSource);
    expect(tags).toEqual([...tags].sort((a, b) => a.localeCompare(b)));
    expect(tags).toContain("scandinavian");
  });
});
