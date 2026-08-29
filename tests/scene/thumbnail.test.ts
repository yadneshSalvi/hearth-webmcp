import { describe, expect, it } from "vitest";
import { catalogSource } from "@/data/catalog.source";
import { palette } from "@/src/tokens";
import {
  FLAT_MAX_H_CM, MIN_FLAT_CONTRAST, THUMB_BACKDROP, contrastRatio, fieldHex, thumbnailColorway,
} from "@/src/scene/thumbnail";

describe("thumbnail backdrop", () => {
  it("is canvas.bottom — a token, and darker than the plaster it replaced", () => {
    expect(THUMB_BACKDROP).toBe(palette.canvasBottom);
    expect(contrastRatio(THUMB_BACKDROP, palette.plaster)).toBeGreaterThan(1);
    expect(contrastRatio(palette.plaster, palette.plaster)).toBe(1);
  });
});

describe("thumbnailColorway", () => {
  it("keeps the default colourway for anything with volume to shade", () => {
    for (const product of catalogSource.filter((entry) => entry.dims.h > FLAT_MAX_H_CM)) {
      expect(thumbnailColorway(product), product.id).toBe(product.colorways[0]?.id);
    }
  });

  it("moves a flat item off a colourway that vanishes into the backdrop", () => {
    // The two the reviewers could only see by their edge, and what they become.
    expect(thumbnailColorway(catalogSource.find((entry) => entry.id === "rug-ull")!)).toBe("ochre");
    expect(thumbnailColorway(catalogSource.find((entry) => entry.id === "rug-flette")!)).toBe("dusty-blue");
  });

  it("changes nothing else in the catalog", () => {
    const moved = catalogSource
      .filter((product) => thumbnailColorway(product) !== product.colorways[0]?.id)
      .map((product) => product.id);
    expect(moved).toEqual(["rug-flette", "rug-ull"]);
  });

  it("guarantees every flat item's field separates from the backdrop", () => {
    for (const product of catalogSource.filter((entry) => entry.dims.h <= FLAT_MAX_H_CM)) {
      const picked = product.colorways.find((entry) => entry.id === thumbnailColorway(product));
      expect(picked, product.id).toBeDefined();
      const ratio = contrastRatio(fieldHex(product.category, picked?.hex ?? "#000000"), THUMB_BACKDROP);
      expect(ratio, `${product.id} ${picked?.id}`).toBeGreaterThanOrEqual(MIN_FLAT_CONTRAST);
    }
  });

  it("accounts for the rug field being lifted toward plaster by the re-tint", () => {
    const oak = palette.oak;
    expect(contrastRatio(fieldHex("rug", oak), THUMB_BACKDROP)).toBeLessThan(MIN_FLAT_CONTRAST);
    // The same colour on a non-rug is not softened, and does separate.
    expect(contrastRatio(fieldHex("decor", oak), THUMB_BACKDROP)).toBeGreaterThanOrEqual(MIN_FLAT_CONTRAST);
  });

  it("falls back to the darkest colourway when none of them separate", () => {
    const stubborn = {
      category: "rug" as const,
      dims: { h: 2 },
      colorways: [
        { id: "plaster", hex: palette.plaster },
        { id: "pale", hex: palette.canvasTop },
      ],
    };
    expect(thumbnailColorway(stubborn)).toBe("plaster");
  });

  it("survives a product with no colourways at all", () => {
    expect(thumbnailColorway({ category: "decor", dims: { h: 1 }, colorways: [] })).toBe("oak");
  });
});
