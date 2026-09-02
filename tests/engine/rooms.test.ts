import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import { polyBBox, resolveWall } from "../../src/engine/geometry";
import { resizeRoom } from "../../src/engine/rooms";
import type { Opening, Room, Scene } from "../../src/engine/types";
import { furnished2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

function world(room: Room): { minX: number; minY: number; maxX: number; maxY: number } {
  const box = polyBBox(room.poly);
  return { minX: room.origin.x + box.minX, minY: room.origin.y + box.minY, maxX: room.origin.x + box.maxX, maxY: room.origin.y + box.maxY };
}

function worldSpan(scene: Scene, opening: Opening): { x0: number; y0: number; x1: number; y1: number } {
  const room = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
  const wall = resolveWall(room, opening.wallId)!;
  const dir = { x: (wall.b.x - wall.a.x) / wall.length, y: (wall.b.y - wall.a.y) / wall.length };
  const start = { x: room.origin.x + wall.a.x + dir.x * opening.offset, y: room.origin.y + wall.a.y + dir.y * opening.offset };
  const end = { x: start.x + dir.x * opening.width, y: start.y + dir.y * opening.width };
  return { x0: Math.min(start.x, end.x), y0: Math.min(start.y, end.y), x1: Math.max(start.x, end.x), y1: Math.max(start.y, end.y) };
}

function room(scene: Scene, id: string): Room {
  return scene.rooms.find((candidate) => candidate.id === id)!;
}

describe("resizeRoom", () => {
  it("grows east from the north-west corner and pushes the rooms beyond the east wall", () => {
    const scene = furnished2br();
    const before = world(room(scene, "kitchen"));
    const result = resizeRoom(scene, "living", { width: 560 }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next: Scene = { ...scene, rooms: result.rooms, openings: result.openings, furniture: result.furniture };
    expect(world(room(next, "living"))).toMatchObject({ minX: 0, maxX: 560 });
    expect(result.shifted).toContain("kitchen");
    expect(world(room(next, "kitchen")).minX).toBe(before.minX + 40);
    expect(world(room(next, "kitchen")).maxX - world(room(next, "kitchen")).minX).toBe(before.maxX - before.minX);
    expect(result.outside).toEqual([]);
    expect(result.size).toEqual({ w: 560, d: 440 });
  });

  it("keeps openings at their world position on every wall", () => {
    const scene = furnished2br();
    const before = new Map(scene.openings.filter((opening) => opening.roomId === "living").map((opening) => [opening.id, worldSpan(scene, opening)]));
    const result = resizeRoom(scene, "living", { width: 600, depth: 480 }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next: Scene = { ...scene, rooms: result.rooms, openings: result.openings, furniture: result.furniture };
    for (const opening of next.openings.filter((entry) => entry.roomId === "living")) {
      const wall = resolveWall(room(next, "living"), opening.wallId)!;
      expect(opening.offset + opening.width, opening.id).toBeLessThanOrEqual(wall.length);
      // Openings on a wall that moved outward follow it perpendicular to the wall only.
      const was = before.get(opening.id)!;
      const now = worldSpan(next, opening);
      if (wall.side === "north" || wall.side === "south") expect([now.x0, now.x1], opening.id).toEqual([was.x0, was.x1]);
      else expect([now.y0, now.y1], opening.id).toEqual([was.y0, was.y1]);
    }
  });

  it("anchors on the south-east corner so the west and north walls move and furniture stays put in the world", () => {
    const scene = furnished2br();
    const living = room(scene, "living");
    const sofa = scene.furniture.find((item) => item.id === "sofa-1")!;
    const sofaWorld = { x: living.origin.x + sofa.pos.x, y: living.origin.y + sofa.pos.y };
    const result = resizeRoom(scene, "living", { width: 580, depth: 500, anchorCorner: "se" }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next: Scene = { ...scene, rooms: result.rooms, openings: result.openings, furniture: result.furniture };
    const resized = room(next, "living");
    expect(world(resized)).toEqual({ minX: -60, minY: -60, maxX: 520, maxY: 440 });
    const movedSofa = next.furniture.find((item) => item.id === "sofa-1")!;
    expect({ x: resized.origin.x + movedSofa.pos.x, y: resized.origin.y + movedSofa.pos.y }).toEqual(sofaWorld);
    // Nothing lies west or north of the living room in this plan, so nothing is pushed that way.
    expect(result.shifted).toEqual([]);
  });

  it("leaves neighbours alone when pushing is off, and reports items that fall outside", () => {
    const scene = furnished2br();
    const shelf = scene.furniture.find((item) => item.id === "shelf-1");
    const result = resizeRoom(scene, "living", { width: 400, pushNeighbors: false }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.shifted).toEqual([]);
    if (shelf) expect(result.outside).toContain("shelf-1");
    expect(world(room({ ...scene, rooms: result.rooms }, "kitchen"))).toEqual(world(room(scene, "kitchen")));
  });

  it("refuses a wall shorter than one of its openings, naming it", () => {
    const scene = furnished2br();
    const result = resizeRoom(scene, "living", { width: 150 }, catalog);
    expect(result).toMatchObject({ ok: false, detail: expect.stringMatching(/window-living-north .*no longer fits the 150 cm north wall/) });
  });

  it("slides an opening back inside when a shrink leaves it past the wall's end", () => {
    const scene = furnished2br();
    const result = resizeRoom(scene, "living", { width: 400 }, catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const next: Scene = { ...scene, rooms: result.rooms, openings: result.openings };
    const window = next.openings.find((opening) => opening.id === "window-living-north")!;
    expect(window.offset + window.width).toBeLessThanOrEqual(400);
  });

  it("rejects unknown rooms and non-positive sizes", () => {
    const scene = furnished2br();
    expect(resizeRoom(scene, "nope", { width: 300 }, catalog)).toMatchObject({ ok: false });
    expect(resizeRoom(scene, "living", { width: 0 }, catalog)).toMatchObject({ ok: false });
  });
});
