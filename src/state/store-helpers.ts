import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../engine/catalog";
import { polyBBox, resolveWall } from "../engine/geometry";
import { ROTATIONS } from "../engine/types";
import type { ActionSource, Furniture, Opening, Room, Scene, Vec2 } from "../engine/types";
import { uid } from "./ids";
import { HearthError } from "./types";
import type { ActivityEntry, CartState, HearthState, OpeningInput, RoomInput } from "./types";

/** Shared built-in catalog instance used by store action validation. */
export const storeCatalog = createCatalog(catalogSource);

/** Deep-clones a scene before accepting it across the store boundary. */
export function cloneScene(scene: Scene): Scene {
  return structuredClone(scene);
}

function actor(source: ActionSource): string {
  if (source === "human") return "You";
  if (source === "agent") return "Agent";
  if (source === "assistant") return "Assistant";
  return "System";
}

/** Creates a complete human-readable action activity record. */
export function actionActivity(source: ActionSource, title: string, summary: string, itemIds: string[] = []): ActivityEntry {
  return { id: uid(), t: Date.now(), source, title, summary: `${actor(source)} ${summary}`, itemIds };
}

/** Prepends one activity record and enforces the 200-row cap. */
export function prependActivity(target: { activity: ActivityEntry[] }, entry: ActivityEntry): void {
  target.activity.unshift(entry);
  if (target.activity.length > 200) target.activity.length = 200;
}

/** Returns a room or throws a coded not-found error. */
export function requiredRoom(state: HearthState, id: string): Room {
  const room = state.scene.rooms.find((candidate) => candidate.id === id);
  if (!room) throw new HearthError("not_found", `Room ${id} was not found`);
  return room;
}

/** Returns furniture or throws a coded not-found error. */
export function requiredItem(state: HearthState, id: string): Furniture {
  const item = state.scene.furniture.find((candidate) => candidate.id === id);
  if (!item) throw new HearthError("not_found", `Item ${id} was not found`);
  return item;
}

/** Returns an opening or throws a coded not-found error. */
export function requiredOpening(state: HearthState, id: string): Opening {
  const opening = state.scene.openings.find((candidate) => candidate.id === id);
  if (!opening) throw new HearthError("not_found", `Opening ${id} was not found`);
  return opening;
}

/** Returns the catalog display name for placed furniture. */
export function productName(item: Furniture): string {
  return storeCatalog.byId(item.catalogId)?.name ?? item.catalogId;
}

/** Narrows a runtime number to a supported rotation or throws invalid. */
export function assertRotation(rotation: number): asserts rotation is Furniture["rotation"] {
  if (!ROTATIONS.includes(rotation as Furniture["rotation"])) throw new HearthError("invalid", `Rotation ${rotation} must be 0, 90, 180 or 270`);
}

/** Returns the first unused opening id for its kind. */
export function nextOpeningId(kind: Opening["kind"], openings: Opening[]): string {
  const ids = new Set(openings.map((opening) => opening.id));
  let index = 1;
  while (ids.has(`${kind}-${index}`)) index += 1;
  return `${kind}-${index}`;
}

function roomSlug(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
}

/** Returns a unique slug id for a newly created room. */
export function uniqueRoomId(name: string, rooms: Room[]): string {
  const base = roomSlug(name);
  const used = new Set(rooms.map((room) => room.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** Creates a clockwise rectangle or corner-notched L polygon in centimetres. */
export function notchPoly(width: number, depth: number, notch?: RoomInput["notch"]): Vec2[] {
  if (!notch) return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }];
  const nw = notch.width_cm;
  const nd = notch.depth_cm;
  if (nw <= 0 || nd <= 0 || nw >= width || nd >= depth) throw new HearthError("invalid", "Room notch must be smaller than the room");
  switch (notch.corner) {
    case "ne": return [{ x: 0, y: 0 }, { x: width - nw, y: 0 }, { x: width - nw, y: nd }, { x: width, y: nd }, { x: width, y: depth }, { x: 0, y: depth }];
    case "se": return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth - nd }, { x: width - nw, y: depth - nd }, { x: width - nw, y: depth }, { x: 0, y: depth }];
    case "sw": return [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: nw, y: depth }, { x: nw, y: depth - nd }, { x: 0, y: depth - nd }];
    case "nw": return [{ x: 0, y: nd }, { x: nw, y: nd }, { x: nw, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }];
  }
}

/** Computes a flush world origin from placement input or the current east edge. */
export function placedOrigin(input: RoomInput, poly: Vec2[], rooms: Room[]): Vec2 {
  if (input.origin) return { ...input.origin };
  const newBox = polyBBox(poly);
  const relativeId = input.relativeTo ?? input.relative_to;
  if (input.place && relativeId) {
    const relative = rooms.find((room) => room.id === relativeId || room.name.toLowerCase() === relativeId.toLowerCase());
    if (!relative) throw new HearthError("not_found", `Relative room ${relativeId} was not found`);
    const box = polyBBox(relative.poly);
    switch (input.place) {
      case "east_of": return { x: relative.origin.x + box.maxX - newBox.minX, y: relative.origin.y + box.minY - newBox.minY };
      case "west_of": return { x: relative.origin.x + box.minX - newBox.maxX, y: relative.origin.y + box.minY - newBox.minY };
      case "south_of": return { x: relative.origin.x + box.minX - newBox.minX, y: relative.origin.y + box.maxY - newBox.minY };
      case "north_of": return { x: relative.origin.x + box.minX - newBox.minX, y: relative.origin.y + box.minY - newBox.maxY };
    }
  }
  if (rooms.length === 0) return { x: -newBox.minX, y: -newBox.minY };
  const east = Math.max(...rooms.map((room) => room.origin.x + polyBBox(room.poly).maxX));
  const north = Math.min(...rooms.map((room) => room.origin.y + polyBBox(room.poly).minY));
  return { x: east - newBox.minX, y: north - newBox.minY };
}

/** Resolves and bounds-checks an opening against its stored room. */
export function validateOpening(state: HearthState, input: OpeningInput | Opening): { room: Room; wallId: string } {
  const room = requiredRoom(state, input.roomId);
  const wall = resolveWall(room, input.wallId);
  if (!wall) throw new HearthError("not_found", `Wall ${input.wallId} was not found in ${room.name}`);
  if (input.width <= 0 || input.offset < 0 || input.offset + input.width > wall.length) {
    throw new HearthError("invalid", `Opening must fit within ${wall.id} (${wall.length} cm)`);
  }
  return { room, wallId: wall.id };
}

/** Recomputes cart subtotal in USD from immutable line values. */
export function recomputeCart(cartState: CartState): void {
  cartState.subtotalUsd = cartState.lines.reduce((total, line) => total + line.lineUsd, 0);
}
