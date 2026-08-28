import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import { fitNote, fitsInRoom, fitsOnWall, searchCatalog, wallFits } from "../../src/engine/fit";
import { resolveWall } from "../../src/engine/geometry";
import type { Furniture, Opening, Room, Scene } from "../../src/engine/types";

const catalog = createCatalog(catalogSource);

function room(width = 400, depth = 300): Room {
  return { id: "room", name: "Fit Room", type: "living", poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin: { x: 0, y: 0 }, floor: "oak" };
}

function scene(openings: Opening[] = [], furniture: Furniture[] = [], target = room()): Scene {
  return {
    rooms: [target], openings, furniture, variants: [],
    meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: target.id, selection: {} },
  };
}

function northWindow(offset: number, width: number): Opening {
  return { id: "window-1", roomId: "room", wallId: "w0", offset, width, kind: "window", sillHeight: 90 };
}

describe("wall fitting", () => {
  it("selects the tightest fitting free span and reports spare cm", () => {
    const target = room();
    const current = scene([northWindow(232, 168)], [], target);
    const wall = resolveWall(target, "north")!;
    const sofa = catalog.byId("sofa-endre")!;
    const fit = fitsOnWall(current, target, wall, sofa, catalog);
    expect(fit.fits).toBe(true);
    expect(fit.spareCm).toBe(12);
    expect(fit.span).toEqual({ start: 0, end: 232 });
    expect(fitNote(current, target, wall, sofa, catalog)).toBe("fits north wall · 12 cm spare");
  });

  it("distinguishes a too-short span from no free span", () => {
    const target = room();
    const wall = resolveWall(target, "north")!;
    const sofa = catalog.byId("sofa-endre")!;
    const tooShort = scene([northWindow(190, 210)], [], target);
    const absent = scene([northWindow(0, 400)], [], target);
    expect(fitsOnWall(tooShort, target, wall, sofa, catalog)).toMatchObject({ fits: false, spareCm: -30, span: { start: 0, end: 190 } });
    expect(fitNote(tooShort, target, wall, sofa, catalog)).toBe("too wide for north wall by 30 cm");
    expect(fitsOnWall(absent, target, wall, sofa, catalog)).toEqual({ fits: false, spareCm: -220 });
    expect(fitNote(absent, target, wall, sofa, catalog)).toBe("no free span on north wall");
  });

  it("accounts for wall-hugging furniture and ignore ids", () => {
    const target = room();
    const blocker: Furniture = { id: "sofa-1", catalogId: "sofa-liva", roomId: "room", pos: { x: 100, y: 44 }, rotation: 0, colorway: "sage", status: "placed" };
    const current = scene([], [blocker], target);
    const wall = resolveWall(target, "north")!;
    const sofa = catalog.byId("sofa-endre")!;
    const blocked = fitsOnWall(current, target, wall, sofa, catalog);
    const ignored = fitsOnWall(current, target, wall, sofa, catalog, { ignoreItemIds: ["sofa-1"] });
    expect(blocked.fits).toBe(false);
    expect(blocked.spareCm).toBe(-10);
    expect(blocked.span).toEqual({ start: 190, end: 400 });
    expect(ignored.fits).toBe(true);
    expect(ignored.spareCm).toBe(180);
    expect(ignored.span).toEqual({ start: 0, end: 400 });
  });

  it("summarises every wall by stable wall id and side", () => {
    const target = room();
    const result = wallFits(scene([], [], target), target, catalog.byId("sofa-endre")!, catalog);
    expect(result).toHaveLength(4);
    expect(result.map((entry) => entry.wall)).toEqual(["w0", "w1", "w2", "w3"]);
    expect(result.map((entry) => entry.side)).toEqual(["north", "east", "south", "west"]);
    expect(result.map((entry) => entry.fits)).toEqual([true, true, true, true]);
    expect(result.map((entry) => entry.spareCm)).toEqual([180, 80, 180, 80]);
  });
});

describe("room fitting", () => {
  it("accepts either quarter-turn orientation", () => {
    const narrow = room(180, 250);
    expect(fitsInRoom(catalog.byId("sofa-endre")!, narrow)).toBe(true);
    expect(fitsInRoom(catalog.byId("bed-birk")!, narrow)).toBe(true);
    expect(fitsInRoom(catalog.byId("rug-mark")!, narrow)).toBe(false);
  });

  it("uses contained rectangles for an L-room instead of its bounding box", () => {
    const lRoom: Room = {
      ...room(500, 400),
      poly: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 150 }, { x: 500, y: 150 }, { x: 500, y: 400 }, { x: 0, y: 400 }],
    };
    expect(fitsInRoom(catalog.byId("sofa-endre")!, lRoom)).toBe(true);
    expect(fitsInRoom(catalog.byId("rug-mark")!, lRoom)).toBe(true);
    expect(fitsInRoom({ ...catalog.byId("rug-mark")!, dims: { w: 480, d: 380, h: 2 } }, lRoom)).toBe(false);
  });
});

describe("catalog search", () => {
  it("matches every query token against text-field word prefixes", () => {
    const result = searchCatalog(catalogSource, { query: "End sca sage" });
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("sofa-endre");
    expect(searchCatalog(catalogSource, { query: "television cabinet mid" }).map((entry) => entry.category)).toEqual(["tv-unit"]);
    expect(searchCatalog(catalogSource, { query: "definitely absent" })).toEqual([]);
  });

  it("applies category, price, dimensions, style and colorway together", () => {
    const result = searchCatalog(catalogSource, {
      category: "sofa", maxPriceUsd: 800, maxWidthCm: 200, maxDepthCm: 90, style: "mod", colorway: "sa",
    });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "sofa-liva", category: "sofa", price: 690, dims: { w: 180, d: 88 } });
    expect(result[0]?.styleTags).toContain("modern");
    expect(result[0]?.colorways.map((entry) => entry.id)).toContain("sage");
  });

  it("ranks live fits by spare cm before price and name", () => {
    const target = room();
    const current = scene([northWindow(210, 190)], [], target);
    const result = searchCatalog(catalogSource, { category: "sofa" }, { scene: current, roomId: "room", fitsWall: "north" });
    expect(result.map((entry) => entry.id)).toEqual(["sofa-svale", "sofa-liva"]);
    expect(result[0]?.price).toBeGreaterThan(result[1]?.price ?? 0);
    expect(result.every((entry) => entry.dims.w <= 210)).toBe(true);
  });

  it("uses price then name without fit context", () => {
    const chairs = searchCatalog(catalogSource, { category: "chair" });
    expect(chairs.map((entry) => entry.id)).toEqual(["chair-mysa", "chair-ida", "chair-finn", "chair-olve", "chair-lars"]);
    expect(chairs.map((entry) => entry.price)).toEqual([110, 120, 140, 160, 190]);
  });

  it("clamps result limits to one through six", () => {
    expect(searchCatalog(catalogSource, { limit: 0 })).toHaveLength(1);
    expect(searchCatalog(catalogSource, { limit: 1 })).toHaveLength(1);
    expect(searchCatalog(catalogSource, { limit: 4 })).toHaveLength(4);
    expect(searchCatalog(catalogSource, { limit: 99 })).toHaveLength(6);
  });

  it("returns no products for an unresolved fit room or wall", () => {
    const current = scene();
    expect(searchCatalog(catalogSource, {}, { scene: current, roomId: "missing", fitsWall: "north" })).toEqual([]);
    expect(searchCatalog(catalogSource, {}, { scene: current, roomId: "room", fitsWall: "diagonal" })).toEqual([]);
  });

  it("does not mutate the source array while sorting", () => {
    const copy = [...catalogSource];
    const firstBefore = copy[0];
    searchCatalog(copy, { category: "sofa" });
    expect(copy[0]).toBe(firstBefore);
    expect(copy.map((entry) => entry.id)).toEqual(catalogSource.map((entry) => entry.id));
  });
});
