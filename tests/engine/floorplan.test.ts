import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog, productFor } from "../../src/engine/catalog";
import { evaluateHome } from "../../src/engine/conflicts";
import { planToScene, roomDisplayName } from "../../src/engine/floorplan";
import type { ParsedPlan, ParsedRoom } from "../../src/engine/floorplan";
import { footprint, polyBBox, polyInside, polysOverlap, resolveWall } from "../../src/engine/geometry";
import { starterFurniture } from "../../src/engine/starter";
import type { Opening, Room, Scene } from "../../src/engine/types";
import { asParsedPlan } from "../../src/floorplan/schema";

const catalog = createCatalog(catalogSource);
const FIXTURES = ["two-bed-deck", "one-bed-hera", "studio-hera"] as const;

function fixture(name: (typeof FIXTURES)[number]): ParsedPlan {
  const raw: unknown = JSON.parse(readFileSync(resolve(process.cwd(), `tests/fixtures/floorplans/${name}.json`), "utf8"));
  const plan = asParsedPlan(raw);
  if (!plan) throw new Error(`${name} does not match the plan schema`);
  return plan;
}

function worldPoly(room: Room): { x: number; y: number }[] {
  return room.poly.map((point) => ({ x: point.x + room.origin.x, y: point.y + room.origin.y }));
}

function worldSpan(scene: Scene, opening: Opening): string {
  const room = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
  const wall = resolveWall(room, opening.wallId)!;
  const dir = { x: (wall.b.x - wall.a.x) / wall.length, y: (wall.b.y - wall.a.y) / wall.length };
  const start = { x: room.origin.x + wall.a.x + dir.x * opening.offset, y: room.origin.y + wall.a.y + dir.y * opening.offset };
  const end = { x: start.x + dir.x * opening.width, y: start.y + dir.y * opening.width };
  return [Math.min(start.x, end.x), Math.min(start.y, end.y), Math.max(start.x, end.x), Math.max(start.y, end.y)].map((value) => Math.round(value)).join(":");
}

function reachable(scene: Scene, from: string): Set<string> {
  const doors = scene.openings.filter((opening) => opening.kind === "door");
  const bySpan = new Map<string, string[]>();
  for (const door of doors) {
    const key = worldSpan(scene, door);
    bySpan.set(key, [...(bySpan.get(key) ?? []), door.roomId]);
  }
  const adjacency = new Map<string, Set<string>>();
  for (const rooms of bySpan.values()) {
    for (const a of rooms) for (const b of rooms) if (a !== b) {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      adjacency.get(a)?.add(b);
    }
  }
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const next of adjacency.get(current) ?? []) if (!seen.has(next)) { seen.add(next); queue.push(next); }
  }
  return seen;
}

function room(name: string, type: ParsedRoom["type"], box: [number, number, number, number], size: [number, number], doors: string[] = [], windows: ParsedRoom["windows"] = []): ParsedRoom {
  return { name, type, dimension_label: `${size[0]} x ${size[1]}`, width_cm: size[0], depth_cm: size[1], bbox: { x0: box[0], y0: box[1], x1: box[2], y1: box[3] }, doors_to: doors, windows };
}

describe("planToScene on the sample plans", () => {
  it.each(FIXTURES)("%s: rooms abut without overlapping, openings sit inside their walls, every room is reachable", (name) => {
    const { scene, skipped } = planToScene(fixture(name));
    expect(scene.rooms.length).toBeGreaterThanOrEqual(4);
    for (const a of scene.rooms) for (const b of scene.rooms) {
      if (a.id >= b.id) continue;
      expect(polysOverlap(worldPoly(a), worldPoly(b)), `${a.id} vs ${b.id}`).toBe(false);
    }
    for (const opening of scene.openings) {
      const host = scene.rooms.find((candidate) => candidate.id === opening.roomId)!;
      const wall = resolveWall(host, opening.wallId)!;
      expect(opening.offset, opening.id).toBeGreaterThanOrEqual(0);
      expect(opening.offset + opening.width, opening.id).toBeLessThanOrEqual(wall.length + 0.5);
    }
    const entrance = scene.openings.find((opening) => opening.id === "door-entrance")!;
    expect(entrance).toBeDefined();
    const seen = reachable(scene, entrance.roomId);
    expect([...seen].sort()).toEqual(scene.rooms.map(({ id }) => id).sort());
    expect(new Set(scene.rooms.map(({ id }) => id)).size).toBe(scene.rooms.length);
    expect(new Set(scene.openings.map(({ id }) => id)).size).toBe(scene.openings.length);
    if (name === "two-bed-deck") expect(skipped).toEqual(["Deck (outdoor)"]);
    expect(scene.meta.importedPlan?.roomsDetected).toBe(fixture(name).rooms.length);
    expect(scene.meta.template).toBeUndefined();
  });

  it("keeps the printed sizes within half a wall and pairs every shared door", () => {
    const plan = fixture("two-bed-deck");
    const { scene } = planToScene(plan);
    for (const source of plan.rooms.filter((entry) => entry.type !== "outdoor")) {
      const built = scene.rooms.find((candidate) => candidate.name === source.name)!;
      const box = polyBBox(built.poly);
      expect(Math.abs(box.w - source.width_cm), source.name).toBeLessThanOrEqual(20);
      expect(Math.abs(box.d - source.depth_cm), source.name).toBeLessThanOrEqual(20);
    }
    const doors = scene.openings.filter((opening) => opening.kind === "door" && opening.id !== "door-entrance");
    const spans = new Map<string, number>();
    for (const door of doors) spans.set(worldSpan(scene, door), (spans.get(worldSpan(scene, door)) ?? 0) + 1);
    for (const [span, count] of spans) expect(count, span).toBe(2);
    expect(scene.rooms.map(({ id }) => id)).toEqual(["bed-1", "living", "bed-2", "dining", "kitchen", "bath", "bath-2"]);
    expect(scene.rooms.find(({ id }) => id === "bath")?.floor).toBe("terrazzo");
    expect(scene.rooms.find(({ id }) => id === "kitchen")?.floor).toBe("stone");
  });

  it("puts windows on exterior walls only", () => {
    const { scene } = planToScene(fixture("one-bed-hera"));
    for (const window of scene.openings.filter((opening) => opening.kind === "window")) {
      const host = scene.rooms.find((candidate) => candidate.id === window.roomId)!;
      const wall = resolveWall(host, window.wallId)!;
      const dir = { x: (wall.b.x - wall.a.x) / wall.length, y: (wall.b.y - wall.a.y) / wall.length };
      const mid = { x: host.origin.x + wall.a.x + dir.x * (window.offset + window.width / 2), y: host.origin.y + wall.a.y + dir.y * (window.offset + window.width / 2) };
      // Step 5 cm outward from the wall: no other room may be there.
      const outward = { x: mid.x + (wall.side === "east" ? 5 : wall.side === "west" ? -5 : 0), y: mid.y + (wall.side === "south" ? 5 : wall.side === "north" ? -5 : 0) };
      for (const other of scene.rooms) {
        if (other.id === host.id) continue;
        expect(polyInside(worldPoly(other), [outward, outward, outward, outward]), `${window.id} faces ${other.id}`).toBe(false);
      }
    }
  });

  it("sets printed capitals in title case and leaves mixed case alone", () => {
    expect(roomDisplayName("M.BEDROOM TOILET")).toBe("M.Bedroom Toilet");
    expect(roomDisplayName("LIVING ROOM")).toBe("Living Room");
    expect(roomDisplayName("Bed Room 2")).toBe("Bed Room 2");
    expect(roomDisplayName("W/C")).toBe("W/C");
    expect(roomDisplayName("  ")).toBe("");
  });

  it("is deterministic", () => {
    const plan = fixture("studio-hera");
    expect(planToScene(plan)).toEqual(planToScene(plan));
  });
});

describe("planToScene on synthetic plans", () => {
  it("snaps noisy edges into shared walls and resolves overlaps", () => {
    const plan: ParsedPlan = {
      title: "noisy", units: "m", north_up: true, entrance_room: "Living", confidence: 0.7, notes: "",
      rooms: [
        room("Living", "living", [0.02, 0.02, 0.5, 0.5], [500, 400], ["Bedroom", "Hall", "outside"], ["north"]),
        room("Bedroom", "bedroom", [0.515, 0.03, 0.98, 0.49], [460, 400], ["Living"], ["east"]),
        room("Hall", "hall", [0.0, 0.52, 0.49, 0.62], [500, 100], ["Living", "Bath"]),
        room("Bath", "bath", [0.51, 0.53, 0.75, 0.9], [220, 300], ["Hall"]),
      ],
    };
    const { scene, notes } = planToScene(plan);
    expect(scene.rooms).toHaveLength(4);
    const living = scene.rooms.find(({ id }) => id === "living")!;
    const bedroom = scene.rooms.find(({ id }) => id === "bed-1")!;
    expect(living.origin.x + polyBBox(living.poly).maxX).toBe(bedroom.origin.x);
    for (const a of scene.rooms) for (const b of scene.rooms) if (a.id < b.id) expect(polysOverlap(worldPoly(a), worldPoly(b)), `${a.id}/${b.id}`).toBe(false);
    expect(scene.openings.filter((opening) => opening.kind === "door").length).toBeGreaterThanOrEqual(7);
    expect(notes.some((note) => /overlap/.test(note)) || notes.length === 0).toBe(true);
  });

  it("estimates sizes from the drawing when no room is labelled and reports it", () => {
    const plan: ParsedPlan = {
      title: "unlabelled", units: "unknown", north_up: true, entrance_room: "", confidence: 0.4, notes: "",
      rooms: [
        room("A", "living", [0.1, 0.1, 0.5, 0.5], [0, 0], ["B"]),
        room("B", "bedroom", [0.5, 0.1, 0.9, 0.5], [0, 0], ["A"]),
      ],
    };
    const { scene, notes } = planToScene(plan);
    expect(notes[0]).toMatch(/estimated/);
    expect(polyBBox(scene.rooms[0]!.poly).w).toBeGreaterThan(300);
    expect(scene.openings.some((opening) => opening.id === "door-entrance")).toBe(true);
  });

  it("swaps a printed size that contradicts the drawing and adds doors so every room is reachable", () => {
    const plan: ParsedPlan = {
      title: "swapped", units: "ft", north_up: true, entrance_room: "Living", confidence: 0.6, notes: "",
      rooms: [
        room("Living", "living", [0.0, 0.0, 0.6, 0.3], [300, 600], []),
        room("Study", "office", [0.6, 0.0, 1.0, 0.3], [400, 300], []),
        room("Bedroom", "bedroom", [0.0, 0.3, 0.6, 0.6], [600, 300], []),
      ],
    };
    const { scene, notes } = planToScene(plan);
    const living = scene.rooms.find(({ id }) => id === "living")!;
    expect(polyBBox(living.poly).w).toBeGreaterThan(polyBBox(living.poly).d);
    expect(notes.filter((note) => /depth × width/.test(note))).toEqual(["Living: printed size read as depth × width to match the drawing."]);
    expect(notes.filter((note) => /Added a door/.test(note)).length).toBe(2);
    const entrance = scene.openings.find((opening) => opening.id === "door-entrance")!;
    expect([...reachable(scene, entrance.roomId)].sort()).toEqual(["bed-1", "living", "office"]);
  });

  it("accepts a box listed right-to-left", () => {
    const plan: ParsedPlan = {
      title: "flipped", units: "ft", north_up: true, entrance_room: "A", confidence: 0.5, notes: "",
      rooms: [
        room("A", "living", [0.0, 0.0, 0.5, 0.5], [400, 400], ["B"]),
        { ...room("B", "bath", [0.5, 0.0, 0.8, 0.5], [240, 400], ["A"]), bbox: { x0: 0.8, y0: 0.5, x1: 0.5, y1: 0.0 } },
      ],
    };
    const { scene, skipped } = planToScene(plan);
    expect(skipped).toEqual([]);
    expect(scene.rooms.map(({ id }) => id)).toEqual(["living", "bath"]);
    expect(scene.rooms[1]?.origin.x).toBe(400);
  });

  it("throws when nothing enclosed is on the plan", () => {
    const plan: ParsedPlan = { title: "", units: "unknown", north_up: true, entrance_room: "", confidence: 0, notes: "", rooms: [room("Deck", "outdoor", [0, 0, 1, 1], [300, 300])] };
    expect(() => planToScene(plan)).toThrow(/no enclosed rooms/);
  });
});

describe("starterFurniture", () => {
  it.each(FIXTURES)("%s: furnishes without a single conflict and keeps every item inside its room", (name) => {
    const { scene } = planToScene(fixture(name));
    const furniture = starterFurniture(scene, catalogSource);
    expect(furniture.length).toBeGreaterThanOrEqual(scene.rooms.filter((entry) => entry.type === "bedroom" || entry.type === "living").length);
    const furnished: Scene = { ...scene, furniture };
    expect(evaluateHome(furnished, catalog)).toEqual([]);
    for (const item of furniture) {
      const host = scene.rooms.find((candidate) => candidate.id === item.roomId)!;
      expect(polyInside(host.poly, footprint(item, productFor(item, catalog)!)), item.id).toBe(true);
    }
    expect(new Set(furniture.map(({ id }) => id)).size).toBe(furniture.length);
    expect(starterFurniture(scene, catalogSource)).toEqual(furniture);
  });
});
