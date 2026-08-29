import { describe, expect, it } from "vitest";
import { createCatalog } from "../../src/engine/catalog";
import type { Furniture } from "../../src/engine/types";
import {
  BOARD_HEIGHT, BOARD_WIDTH, MAX_LIST_ROWS, boardLayout, boardModel, boardRows, boardSwatches,
  cropFraction, fitContain, fitCover, fitImage, listRowHeight, truncateToWidth,
} from "../../src/ui/boardCompose";
import { catalogSource } from "../fixtures/catalog";
import { furnished2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);
const byId = (id: string) => catalog.byId(id);
const scene = furnished2br();
const room = scene.rooms.find((candidate) => candidate.id === "living");
if (!room) throw new Error("The 2BR fixture must have a living room");
const livingItems = scene.furniture.filter((item) => item.roomId === "living" && item.status === "placed");

function fill(count: number, catalogId: string, colorway: string): Furniture[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${catalogId}-${index}`,
    catalogId,
    roomId: "living",
    pos: { x: index * 10, y: 0 },
    rotation: 0 as const,
    colorway: colorway as Furniture["colorway"],
    status: "placed" as const,
  }));
}

describe("board layout", () => {
  const layout = boardLayout();

  it("keeps every block inside the 1600 × 1000 frame with matching gutters", () => {
    for (const box of [layout.dollhouse, layout.plan, layout.palette, layout.list]) {
      expect(box.x).toBeGreaterThanOrEqual(layout.pad);
      expect(box.y).toBeGreaterThanOrEqual(layout.headRuleY);
      expect(box.x + box.w).toBeLessThanOrEqual(BOARD_WIDTH - layout.pad);
      expect(box.y + box.h).toBeLessThanOrEqual(layout.footRuleY);
      expect(box.w).toBeGreaterThan(0);
      expect(box.h).toBeGreaterThan(0);
    }
    expect(layout.footBaseline).toBeLessThanOrEqual(BOARD_HEIGHT);
  });

  it("puts the renders and the list on one row, the plan and the palette on the next", () => {
    expect(layout.dollhouse.y).toBe(layout.list.y);
    expect(layout.dollhouse.h).toBe(layout.list.h);
    expect(layout.plan.y).toBe(layout.palette.y);
    // No overlap between the two columns of either row.
    expect(layout.dollhouse.x + layout.dollhouse.w).toBeLessThan(layout.list.x);
    expect(layout.plan.x + layout.plan.w).toBeLessThan(layout.palette.x);
    expect(layout.dollhouse.y + layout.dollhouse.h).toBeLessThan(layout.plan.y);
  });

  it("sizes the plan tile so a 3:2 studio capture fills it instead of letterboxing", () => {
    expect(cropFraction({ w: 1440, h: 900 }, layout.plan)).toBeLessThan(0.3);
    const fit = fitImage({ w: 1440, h: 900 }, layout.plan);
    expect(fit.dw).toBe(layout.plan.w);
    expect(fit.dh).toBe(layout.plan.h);
  });
});

describe("image fitting", () => {
  const box = { x: 100, y: 50, w: 400, h: 200 };

  it("cover fills the box and crops the source symmetrically", () => {
    const fit = fitCover({ w: 1000, h: 1000 }, box);
    expect(fit.dw).toBe(400);
    expect(fit.dh).toBe(200);
    expect(fit.sw).toBe(1000);
    expect(fit.sh).toBe(500);
    expect(fit.sy).toBe(250);
    expect(fit.sx).toBe(0);
  });

  it("contain keeps the whole source and centres it in the box", () => {
    const fit = fitContain({ w: 1000, h: 1000 }, box);
    expect(fit.dw).toBe(200);
    expect(fit.dh).toBe(200);
    expect(fit.dx).toBe(200);
    expect(fit.dy).toBe(50);
    expect(fit.sw).toBe(1000);
    expect(fit.sh).toBe(1000);
  });

  it("falls back to contain rather than crop away more than 30 % of a wide plan", () => {
    // A square capture in a 2:1 tile would lose half its height.
    expect(cropFraction({ w: 1000, h: 1000 }, box)).toBeCloseTo(0.5, 5);
    const fit = fitImage({ w: 1000, h: 1000 }, box);
    expect(fit.sh).toBe(1000);
    expect(fit.dw).toBe(200);
  });

  it("survives a zero-sized source", () => {
    const fit = fitImage({ w: 0, h: 0 }, box);
    expect(fit.dw).toBe(box.w);
    expect(fit.dh).toBe(box.h);
  });
});

describe("list rows", () => {
  it("groups duplicates, sorts by spend and totals every item", () => {
    const { rows, hidden, totalUsd } = boardRows(livingItems, byId);
    expect(hidden).toBe(0);
    expect(rows.length).toBeLessThanOrEqual(livingItems.length);
    expect(rows[0]?.price).toBe("$790");
    const spends = rows.map((row) => Number(row.price.replace(/[^0-9]/g, "")));
    expect([...spends].sort((a, b) => b - a)).toEqual(spends);
    const expected = livingItems.reduce((sum, item) => sum + (byId(item.catalogId)?.price ?? 0), 0);
    expect(totalUsd).toBe(Math.round(expected));
  });

  it("counts a repeated product once, with a multiplier and the line total", () => {
    const { rows, totalUsd } = boardRows(fill(3, "chair-lars", "oak"), byId);
    const price = byId("chair-lars")?.price ?? 0;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe(`${byId("chair-lars")?.name} ×3`);
    expect(rows[0]?.count).toBe(3);
    expect(rows[0]?.price).toBe(`$${(price * 3).toLocaleString("en-US")}`);
    expect(totalUsd).toBe(price * 3);
  });

  it("truncates to the rows the board has room for and still totals everything", () => {
    const many = [
      ...fill(1, "sofa-endre", "sage"),
      ...fill(1, "sofa-liva", "sage"),
      ...fill(1, "sofa-fjord", "sage"),
      ...fill(1, "armchair-nook", "terracotta"),
      ...fill(1, "armchair-elsa", "terracotta"),
      ...fill(1, "chair-lars", "oak"),
      ...fill(1, "chair-ida", "oak"),
      ...fill(1, "table-lamp-alva", "ochre"),
      ...fill(1, "plant-fern", "sage"),
      ...fill(1, "plant-ivy", "sage"),
    ];
    const { rows, hidden, moreLine, totalUsd } = boardRows(many, byId);
    expect(rows).toHaveLength(MAX_LIST_ROWS - 1);
    expect(hidden).toBe(many.length - rows.length);
    expect(moreLine).toContain(`${hidden} more items`);
    const expected = many.reduce((sum, item) => sum + (byId(item.catalogId)?.price ?? 0), 0);
    expect(totalUsd).toBe(Math.round(expected));
  });

  it("skips items whose product left the catalog", () => {
    const { rows, totalUsd } = boardRows(fill(2, "sofa-gone", "oak"), byId);
    expect(rows).toHaveLength(0);
    expect(totalUsd).toBe(0);
  });

  it("never lets the rows collide with the total pinned at the foot of the column", () => {
    const { list } = boardLayout();
    const height = listRowHeight(MAX_LIST_ROWS - 1, list.h, true);
    expect(height).toBeGreaterThanOrEqual(34);
    expect((MAX_LIST_ROWS - 1) * height + 24).toBeLessThanOrEqual(list.h - 40 - 74);
    // A short list breathes, a long one tightens, and neither exceeds the cap.
    expect(listRowHeight(2, list.h)).toBe(56);
    expect(listRowHeight(7, list.h)).toBeLessThan(56);
    expect(listRowHeight(0, list.h)).toBe(56);
  });
});

describe("board model", () => {
  it("reads the room, its area and its item count, without repeating the title", () => {
    const model = boardModel({
      title: room.name,
      room,
      items: livingItems,
      byId,
      paletteId: "warm-clay",
      timeOfDay: "golden",
    });
    expect(model.caps).toBe(`22.9 M² · ${livingItems.length} ITEMS`);
    expect(model.itemCount).toBe(livingItems.length);
    expect(model.total).toBe(`$${model.totalUsd.toLocaleString("en-US")}`);
    expect(model.footerLeft).toBe("Hearth Studio · hearth.yadneshsalvi.com");
    expect(model.footerRight).toBe("WARM CLAY · GOLDEN LIGHT");
  });

  it("names the room in the caps line when the agent gave the board its own title", () => {
    const model = boardModel({
      title: "Movie night",
      room,
      items: livingItems,
      byId,
      paletteId: "dusk",
      timeOfDay: "evening",
    });
    expect(model.caps.startsWith("LIVING ROOM · 22.9 M²")).toBe(true);
  });

  it("swatches the room's own wall and floor with the palette's textile", () => {
    const swatches = boardSwatches({ ...room, floor: "stone", wallColor: "sage-tint" }, "sage-linen");
    expect(swatches.map((swatch) => swatch.label)).toEqual(["Wall", "Floor", "Textile"]);
    expect(swatches[0]?.name).toBe("Sage tint");
    expect(swatches[1]?.name).toBe("Stone");
    expect(swatches[2]?.name).toBe("Sage");
    for (const swatch of swatches) expect(swatch.hex).toMatch(/^#[0-9A-F]{6}$/i);
  });
});

describe("text truncation", () => {
  // A 10 px-per-character stand-in for canvas text metrics.
  const measure = (value: string) => value.length * 10;

  it("leaves text that fits alone", () => {
    expect(truncateToWidth("Endre Sofa", 200, measure)).toBe("Endre Sofa");
  });

  it("ellipsises to the widest prefix that fits", () => {
    expect(truncateToWidth("Endre Sofa", 50, measure)).toBe("Endr…");
    expect(measure(truncateToWidth("Endre Sofa", 50, measure))).toBeLessThanOrEqual(50);
  });

  it("degrades to an ellipsis rather than overflowing", () => {
    expect(truncateToWidth("Endre Sofa", 10, measure)).toBe("…");
    expect(truncateToWidth("Endre Sofa", 0, measure)).toBe("");
  });

  it("does not leave a space before the ellipsis", () => {
    expect(truncateToWidth("Endre Sofa Two", 70, measure)).toBe("Endre…");
  });
});
