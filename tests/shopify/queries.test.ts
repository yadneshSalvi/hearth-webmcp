import { describe, expect, it } from "vitest";
import { buildStorefrontProductQuery, quoteShopifySearchValue } from "../../src/shopify/queries";

describe("Shopify search query builder", () => {
  it("quotes backslashes, quotes, controls, and search operators", () => {
    expect(quoteShopifySearchValue("oak\\desk\" OR tag:*\n")).toBe('"oak\\\\desk\\\" OR tag:*"');
  });

  it("builds only explicit filter clauses", () => {
    const query = buildStorefrontProductQuery({
      q: "small oak desk",
      category: "desk",
      maxPrice: 800,
      style: "japandi",
      colorway: "dusty-blue",
    });
    expect(query).toBe('"small oak desk" AND product_type:"desk" AND variants.price:<=800 AND tag:"japandi" AND variant_title:"dusty blue"');
  });

  it("omits empty and invalid numeric filters", () => {
    expect(buildStorefrontProductQuery({ q: "  ", maxPrice: Number.NaN })).toBe("");
  });
});
