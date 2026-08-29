import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import {
  deltaMove, describePlacement, resolveAnchor, rotateBy,
} from "../../src/engine/anchors";
import { createCatalog } from "../../src/engine/catalog";
import { footprint, itemToWallDistance, polyInside, resolveWall, rotateDims, rotationForWall } from "../../src/engine/geometry";
import { createTemplate } from "../../src/engine/templates";
import type { CatalogItem, Furniture, Opening, Room, Rotation, Scene, Vec2 } from "../../src/engine/types";

const catalog = createCatalog(catalogSource);

function room(width = 600, depth = 500): Room {
  return { id: "room", name: "Test Room", type: "living", poly: [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }], origin: { x: 0, y: 0 }, floor: "oak" };
}

function scene(opts: { furniture?: Furniture[]; openings?: Opening[]; room?: Room } = {}): Scene {
  const target = opts.room ?? room();
  return {
    rooms: [target], openings: opts.openings ?? [], furniture: opts.furniture ?? [], variants: [],
    meta: { mode: "design", view: "plan", yaw: "sw", timeOfDay: "noon", paletteId: "warm-clay", accessibilityMode: false, activeRoomId: target.id, selection: {} },
  };
}

function item(id: string, catalogId: string, pos: Vec2, rotation: Rotation = 0): Furniture {
  return { id, catalogId, roomId: "room", pos, rotation, colorway: "oak", status: "placed" };
}

function ok(result: ReturnType<typeof resolveAnchor>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.detail);
  return result;
}

function alongFor(side: "north" | "east" | "south" | "west", pos: Vec2): number {
  if (side === "north") return pos.x;
  if (side === "east") return pos.y;
  if (side === "south") return 600 - pos.x;
  return 500 - pos.y;
}

describe("wall anchors", () => {
  it("places start, center, end and numeric anchors on every wall", () => {
    const target = room();
    const sofa = catalog.byId("sofa-endre") as CatalogItem;
    const rotations = { north: 0, east: 90, south: 180, west: 270 } as const;
    for (const side of ["north", "east", "south", "west"] as const) {
      const wall = resolveWall(target, side)!;
      for (const [value, expected] of [["start", 110], ["center", wall.length / 2], ["end", wall.length - 110], [30, 110]] as const) {
        const result = ok(resolveAnchor(scene({ room: target }), target.id, sofa, { anchor: { wall: side, along: value } }, catalog));
        const placed = item("sofa-new", sofa.id, result.pos, result.rotation);
        expect(result.rotation).toBe(rotations[side]);
        expect(alongFor(side, result.pos)).toBeCloseTo(expected, 6);
        expect(itemToWallDistance(placed, sofa, wall)).toBeCloseTo(0, 6);
        expect(polyInside(target.poly, footprint(placed, sofa))).toBe(true);
        expect(result.nudgedCm).toBe(0);
        expect(result.note.length).toBeLessThanOrEqual(80);
      }
    }
  });

  it("uses an exact wall id for the second north edge of an L-room", () => {
    const loft = createTemplate("loft");
    const target = loft.rooms.find((entry) => entry.id === "loft")!;
    const plant = catalog.byId("plant-pilea")!;
    const result = ok(resolveAnchor(loft, target.id, plant, { anchor: { wall: "w2", along: "center" } }, catalog));
    expect(result.rotation).toBe(0);
    expect(result.pos.x).toBe(650);
    expect(result.pos.y).toBe(280);
    expect(result.note).toContain("north wall");
  });

  it("lets facing override the derived wall rotation while retaining wall contact", () => {
    const sofa = catalog.byId("sofa-liva")!;
    const result = ok(resolveAnchor(scene(), "room", sofa, { anchor: { wall: "north", along: 150, facing: "wall:west" } }, catalog));
    expect(result.rotation).toBe(90);
    expect(result.pos.x).toBe(150);
    expect(result.pos.y).toBe(90);
    expect(result.note).toContain("facing west");
  });

  it("keeps a same-wall window behind wall-backed furniture in empty and furnished living rooms", () => {
    const sofa = catalog.byId("sofa-liva")!;
    const empty = createTemplate("2br");
    const furnished = createTemplate("2br", { furnished: true });
    const blocked = resolveAnchor(furnished, "living", sofa, {
      anchor: { wall: "north", along: "center", facing: "window:window-living-north" },
    }, catalog);
    expect(blocked).toMatchObject({
      ok: false,
      freeSpans: [{ side: "north", spans: [{ fits: false }, { fits: false }] }],
      suggestion: expect.stringContaining("try a narrower item"),
    });
    furnished.furniture = furnished.furniture.filter((entry) => entry.id !== "sofa-1");
    for (const current of [empty, furnished]) {
      const result = ok(resolveAnchor(current, "living", sofa, {
        anchor: { wall: "north", along: "center", facing: "window:window-living-north" },
      }, catalog));
      const north = resolveWall(current.rooms.find((entry) => entry.id === "living")!, "north")!;
      const placed = { id: "sofa-new", catalogId: sofa.id, roomId: "living", pos: result.pos, rotation: result.rotation, colorway: "sage", status: "placed" } as const;
      expect(result.rotation).toBe(rotationForWall(north.side));
      expect(itemToWallDistance(placed, sofa, north)).toBeCloseTo(0, 6);
      expect(result.note).toContain("facing the room (window is behind it)");
    }
  });
});

describe("semantic targets", () => {
  it("centres in the largest rectangle of an L-room", () => {
    const loft = createTemplate("loft");
    const plant = catalog.byId("plant-pilea")!;
    const result = ok(resolveAnchor(loft, "loft", plant, { anchor: { centered: true } }, catalog));
    expect(result.pos).toEqual({ x: 250, y: 300 });
    expect(result.rotation).toBe(0);
    expect(result.nudgedCm).toBe(0);
    expect(result.note).toContain("centred");
  });

  it("centres under a window and puts the back against its wall", () => {
    const opening: Opening = { id: "window-main", roomId: "room", wallId: "w0", offset: 200, width: 100, kind: "window", sillHeight: 90 };
    const desk = catalog.byId("desk-soren")!;
    const result = ok(resolveAnchor(scene({ openings: [opening] }), "room", desk, { anchor: { under: "window:window-main" } }, catalog));
    expect(result.pos.x).toBe(250);
    expect(result.pos.y).toBe(30);
    expect(result.rotation).toBe(0);
    expect(result.note).toContain("north wall");
  });

  it("snaps facing targets to cardinal rotations", () => {
    const plant = catalog.byId("plant-pilea")!;
    const neighbour = item("plant-focus", "plant-fern", { x: 500, y: 250 });
    const withTargets = scene({
      furniture: [neighbour],
      openings: [{ id: "window-west", roomId: "room", wallId: "w3", offset: 180, width: 100, kind: "window", sillHeight: 90 }],
    });
    const cases = [
      ["plant-focus", { x: 300, y: 250 }, 270],
      ["room_center", { x: 300, y: 100 }, 0],
      ["wall:north", { x: 300, y: 250 }, 180],
      ["wall:east", { x: 300, y: 250 }, 270],
      ["window:window-west", { x: 300, y: 250 }, 90],
    ] as const;
    for (const [facing, pos, rotation] of cases) {
      const result = ok(resolveAnchor(withTargets, "room", plant, { pos, anchor: { facing } }, catalog));
      expect(result.pos).toEqual(pos);
      expect(result.rotation).toBe(rotation);
      expect(result.note).toContain(`facing ${{ 0: "south", 90: "west", 180: "north", 270: "east" }[rotation]}`);
    }
  });

  it("gives raw position and rotation final precedence", () => {
    const plant = catalog.byId("plant-pilea")!;
    const result = ok(resolveAnchor(scene(), "room", plant, {
      anchor: { wall: "north", along: "start", centered: true, facing: "wall:north" },
      pos: { x: 420, y: 330 }, rotation: 270,
    }, catalog));
    expect(result.pos).toEqual({ x: 420, y: 330 });
    expect(result.rotation).toBe(270);
    expect(result.nudgedCm).toBe(0);
  });
});

describe("next_to anchors", () => {
  it("honours every relative side for every neighbour rotation", () => {
    const moving = catalog.byId("plant-pilea")!;
    const otherCat = catalog.byId("chair-finn")!;
    const vectors = {
      0: { front: { x: 0, y: 1 }, behind: { x: 0, y: -1 }, right: { x: -1, y: 0 }, left: { x: 1, y: 0 } },
      90: { front: { x: -1, y: 0 }, behind: { x: 1, y: 0 }, right: { x: 0, y: -1 }, left: { x: 0, y: 1 } },
      180: { front: { x: 0, y: -1 }, behind: { x: 0, y: 1 }, right: { x: 1, y: 0 }, left: { x: -1, y: 0 } },
      270: { front: { x: 1, y: 0 }, behind: { x: -1, y: 0 }, right: { x: 0, y: 1 }, left: { x: 0, y: -1 } },
    } as const;
    for (const rotation of [0, 90, 180, 270] as const) {
      const neighbour = item("chair-1", otherCat.id, { x: 300, y: 250 }, rotation);
      const ownDims = rotateDims(moving.dims, rotation);
      const otherDims = rotateDims(otherCat.dims, rotation);
      for (const side of ["left", "right", "front", "behind"] as const) {
        const result = ok(resolveAnchor(scene({ furniture: [neighbour] }), "room", moving, { anchor: { next_to: "chair-1", side, gap_cm: 15 } }, catalog));
        const vector = vectors[rotation][side];
        const half = vector.x === 0 ? (ownDims.d + otherDims.d) / 2 : (ownDims.w + otherDims.w) / 2;
        expect(result.pos.x).toBe(300 + vector.x * (half + 15));
        expect(result.pos.y).toBe(250 + vector.y * (half + 15));
        expect(result.rotation).toBe(rotation);
        expect(result.nudgedCm).toBe(0);
      }
    }
  });

  it("defaults to the neighbour's right with a 10 cm gap and permits facing", () => {
    const neighbour = item("chair-1", "chair-finn", { x: 300, y: 250 }, 0);
    const result = ok(resolveAnchor(scene({ furniture: [neighbour] }), "room", catalog.byId("plant-pilea")!, { anchor: { next_to: "chair-1", facing: "chair-1" } }, catalog));
    expect(result.pos).toEqual({ x: 247.5, y: 250 });
    expect(result.rotation).toBe(270);
    expect(result.note).toContain("right of chair-1");
  });
});

describe("validity, nudging and failures", () => {
  it("nudges along a wall to the nearest valid 5 cm position", () => {
    const lamp = catalog.byId("table-lamp-natt")!;
    const blocker = item("lamp-blocker", lamp.id, { x: 300, y: 10 }, 0);
    const result = ok(resolveAnchor(scene({ furniture: [blocker] }), "room", lamp, { anchor: { wall: "north", along: 300 } }, catalog));
    expect(result.pos.x).toBe(280);
    expect(result.pos.y).toBe(10);
    expect(result.nudgedCm).toBe(20);
    expect(result.note).toContain("280 cm");
  });

  it("uses a two-axis spiral for a centred collision", () => {
    const lamp = catalog.byId("table-lamp-natt")!;
    const blocker = item("lamp-blocker", lamp.id, { x: 300, y: 250 });
    const result = ok(resolveAnchor(scene({ furniture: [blocker] }), "room", lamp, { anchor: { centered: true } }, catalog));
    expect(result.pos).toEqual({ x: 320, y: 250 });
    expect(result.nudgedCm).toBe(20);
    expect(result.rotation).toBe(0);
  });

  it("returns blockers, fitting wall spans and an actionable suggestion", () => {
    const sofa = catalog.byId("sofa-liva")!;
    const blocker = item("sofa-blocker", sofa.id, { x: 300, y: 44 }, 0);
    const result = resolveAnchor(scene({ furniture: [blocker] }), "room", sofa, { anchor: { wall: "north", along: 300 } }, catalog);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("blocked");
    expect(result.detail).toContain("sofa-blocker");
    expect(result.freeSpans).toHaveLength(1);
    expect(result.freeSpans?.[0]).toMatchObject({ wall: "w0", side: "north" });
    expect(result.freeSpans?.[0]?.spans.length).toBeGreaterThan(0);
    expect(result.suggestion).toMatch(/north wall .* fits; try along:/);
  });

  it("only marks a span fitting when its suggested wall placement is placeable", () => {
    const sofa = catalog.byId("sofa-liva")!;
    const current = scene({
      furniture: [item("sofa-blocker", sofa.id, { x: 300, y: 44 })],
      openings: [{ id: "window-main", roomId: "room", wallId: "w0", offset: 200, width: 200, kind: "window", sillHeight: 90 }],
    });
    const anchor = { wall: "north", along: 300, facing: "window:window-main" } as const;
    const blocked = resolveAnchor(current, "room", sofa, { anchor }, catalog);
    expect(blocked).toMatchObject({ ok: false, error: "blocked" });
    if (blocked.ok) return;
    const along = Number(/along: ([0-9.]+)/.exec(blocked.suggestion ?? "")?.[1]);
    expect(Number.isFinite(along)).toBe(true);
    const retry = ok(resolveAnchor(current, "room", sofa, { anchor: { ...anchor, along } }, catalog));
    expect(retry.rotation).toBe(rotationForWall("north"));
    expect(retry.note).toContain("window is behind it");
  });

  it("avoids both door swing and opening clear zones", () => {
    const door: Opening = { id: "door-1", roomId: "room", wallId: "w0", offset: 250, width: 90, kind: "door", swing: "in", hinge: "left" };
    const plant = catalog.byId("plant-pilea")!;
    const result = resolveAnchor(scene({ openings: [door] }), "room", plant, { pos: { x: 295, y: 30 } }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("blocked");
      expect(result.detail).toContain("door-1");
      expect(result.freeSpans).toHaveLength(4);
    }
  });

  it("blocks tall furniture across a window but permits a sofa below its sill", () => {
    const opening: Opening = { id: "window-main", roomId: "room", wallId: "w0", offset: 200, width: 200, kind: "window", sillHeight: 90 };
    const current = scene({ openings: [opening] });
    const wardrobe = resolveAnchor(current, "room", catalog.byId("wardrobe-hald")!, { anchor: { wall: "north", along: 300 } }, catalog);
    expect(wardrobe).toMatchObject({ ok: false, error: "blocked", detail: expect.stringContaining("window-main") });
    if (!wardrobe.ok) {
      expect(wardrobe.freeSpans?.[0]?.spans).toEqual([
        { start: 0, end: 200, fits: true },
        { start: 400, end: 600, fits: true },
      ]);
      expect(wardrobe.suggestion).toContain("fits; try along");
    }
    const sofa = ok(resolveAnchor(current, "room", catalog.byId("sofa-endre")!, { anchor: { wall: "north", along: 300 } }, catalog));
    expect(sofa.nudgedCm).toBe(0);
  });

  it("returns unfiltered requested-wall spans with fits flags when none fit", () => {
    const target = room(420, 300);
    const blocker = item("sofa-blocker", "sofa-liva", { x: 210, y: 44 });
    const result = resolveAnchor(scene({ room: target, furniture: [blocker] }), "room", catalog.byId("sofa-endre")!, { anchor: { wall: "north", along: 210 } }, catalog);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.freeSpans?.[0]?.spans).toEqual([
        { start: 0, end: 120, fits: false },
        { start: 300, end: 420, fits: false },
      ]);
      expect(result.suggestion).toContain("try a narrower item");
    }
  });

  it("permits rugs beneath items and small decor on a surface", () => {
    const table = item("table-1", "table-ake", { x: 300, y: 250 });
    const sofa = item("sofa-1", "sofa-liva", { x: 300, y: 100 });
    const base = scene({ furniture: [table, sofa] });
    const lamp = ok(resolveAnchor(base, "room", catalog.byId("table-lamp-alva")!, { pos: { x: 300, y: 250 } }, catalog));
    const rug = ok(resolveAnchor(base, "room", catalog.byId("rug-flette")!, { pos: { x: 300, y: 190 }, rotation: 90 }, catalog));
    expect(lamp.pos).toEqual({ x: 300, y: 250 });
    expect(lamp.nudgedCm).toBe(0);
    expect(rug.pos).toEqual({ x: 300, y: 190 });
    expect(rug.nudgedCm).toBe(0);
  });

  it("reports unknown room, wall, window and item refs with alternatives", () => {
    const plant = catalog.byId("plant-pilea")!;
    const fixtures = scene({
      furniture: [item("plant-1", "plant-fern", { x: 100, y: 100 }), item("chair-1", "chair-finn", { x: 300, y: 100 }), item("lamp-1", "lamp-glow", { x: 500, y: 100 })],
      openings: [
        { id: "window-a", roomId: "room", wallId: "w0", offset: 20, width: 80, kind: "window" },
        { id: "window-b", roomId: "room", wallId: "w1", offset: 20, width: 80, kind: "window" },
        { id: "window-c", roomId: "room", wallId: "w2", offset: 20, width: 80, kind: "window" },
      ],
    });
    const results = [
      resolveAnchor(fixtures, "missing", plant, {}, catalog),
      resolveAnchor(fixtures, "room", plant, { anchor: { wall: "nroth" } }, catalog),
      resolveAnchor(fixtures, "room", plant, { anchor: { under: "window:missing" } }, catalog),
      resolveAnchor(fixtures, "room", plant, { pos: { x: 250, y: 250 }, anchor: { facing: "missing-item" } }, catalog),
    ];
    for (const result of results) {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe("not_found");
        expect(result.detail).toContain("closest:");
        const alternatives = result.detail.split("closest: ")[1]?.split(", ") ?? [];
        expect(alternatives.length).toBeGreaterThanOrEqual(1);
        expect(alternatives.length).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe("receipt and move helpers", () => {
  it("describes wall and free placements with bounded natural language", () => {
    const sofa = item("sofa-1", "sofa-endre", { x: 260, y: 47.5 });
    const wallText = describePlacement(scene({ furniture: [sofa] }), sofa, catalog);
    const free = item("plant-1", "plant-pilea", { x: 200, y: 200 }, 270);
    const freeText = describePlacement(scene({ furniture: [free] }), free, catalog);
    expect(wallText).toBe("on the north wall, 260 cm from the west corner, facing south");
    expect(wallText.length).toBeLessThanOrEqual(80);
    expect(freeText).toContain("at 200, 200 cm in the Test Room");
    expect(freeText).toContain("facing east");
  });

  it("moves by deltas and rotates without mutating the item", () => {
    const original = item("plant-1", "plant-pilea", { x: 100, y: 100 }, 0);
    const moved = ok(deltaMove(scene({ furniture: [original] }), original, { x: 45, y: -20 }, catalog));
    expect(moved.pos).toEqual({ x: 145, y: 80 });
    expect(moved.rotation).toBe(0);
    expect(rotateBy(original, 90)).toBe(90);
    expect(rotateBy({ ...original, rotation: 0 }, -90)).toBe(270);
    expect(rotateBy({ ...original, rotation: 270 }, 180)).toBe(90);
    expect(original).toMatchObject({ pos: { x: 100, y: 100 }, rotation: 0 });
  });
});
