/**
 * Room resizing (TOOLS.md §33, `update_room`): pure geometry for growing or shrinking one room of a
 * multi-room home. The anchored corner stays where it is, the opposite walls move, furniture keeps
 * its world position, openings keep their world position along their wall, and the rooms beyond a
 * moving wall are pushed along with it so the plan stays one connected home.
 */
import type { Catalog } from "./catalog";
import { productFor } from "./catalog";
import { footprint, polyBBox, polyInside, resolveWall } from "./geometry";
import type { CatalogItem, Furniture, Opening, Room, Scene } from "./types";

export type Corner = "nw" | "ne" | "sw" | "se";
export const CORNERS: readonly Corner[] = ["nw", "ne", "sw", "se"];

export interface RoomResize {
  width?: number;
  depth?: number;
  /** The corner that stays put; the opposite walls move. Default nw. */
  anchorCorner?: Corner;
  /** Shift the rooms beyond a moving wall so they keep touching. Default true. */
  pushNeighbors?: boolean;
}

export type RoomResizeResult =
  | {
    ok: true;
    rooms: Room[];
    openings: Opening[];
    furniture: Furniture[];
    /** Rooms moved to follow a wall. */
    shifted: string[];
    /** Items in the resized room whose footprint no longer lies inside it. */
    outside: string[];
    size: { w: number; d: number };
  }
  | { ok: false; detail: string };

const EPS = 1;

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function worldBox(room: Room): Box {
  const box = polyBBox(room.poly);
  return {
    minX: room.origin.x + box.minX,
    minY: room.origin.y + box.minY,
    maxX: room.origin.x + box.maxX,
    maxY: room.origin.y + box.maxY,
  };
}

/** Re-places one opening on the same wall of the resized room, keeping its world position where the wall allows. */
function carryOpening(opening: Opening, before: Room, after: Room): Opening | string {
  const oldWall = resolveWall(before, opening.wallId);
  const newWall = resolveWall(after, opening.wallId);
  if (!oldWall || !newWall) return `${opening.id} sits on a wall the resized room no longer has`;
  if (newWall.length < opening.width) {
    return `${opening.id} (${opening.offset}-${opening.offset + opening.width} cm) no longer fits the ${Math.round(newWall.length)} cm ${newWall.side} wall`;
  }
  const oldDir = { x: (oldWall.b.x - oldWall.a.x) / oldWall.length, y: (oldWall.b.y - oldWall.a.y) / oldWall.length };
  const startWorld = {
    x: before.origin.x + oldWall.a.x + oldDir.x * opening.offset,
    y: before.origin.y + oldWall.a.y + oldDir.y * opening.offset,
  };
  const newDir = { x: (newWall.b.x - newWall.a.x) / newWall.length, y: (newWall.b.y - newWall.a.y) / newWall.length };
  const newStart = { x: after.origin.x + newWall.a.x, y: after.origin.y + newWall.a.y };
  const along = (startWorld.x - newStart.x) * newDir.x + (startWorld.y - newStart.y) * newDir.y;
  // A shrink can leave an opening past the wall's end: it slides back inside rather than refusing.
  const offset = Math.round(Math.max(0, Math.min(newWall.length - opening.width, along)));
  return { ...opening, offset };
}

/** Resizes one room and returns the whole home's new rooms, openings and furniture. */
export function resizeRoom(scene: Scene, roomId: string, req: RoomResize, catalog: Catalog | CatalogItem[]): RoomResizeResult {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return { ok: false, detail: `Room ${roomId} was not found` };
  const box = polyBBox(room.poly);
  const width = Math.round(req.width ?? box.w);
  const depth = Math.round(req.depth ?? box.d);
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width <= 0 || depth <= 0) {
    return { ok: false, detail: "Room width and depth must be positive" };
  }
  const anchor = req.anchorCorner ?? "nw";
  const push = req.pushNeighbors ?? true;
  const dw = width - box.w;
  const dd = depth - box.d;
  const poly = room.poly.map((point) => ({
    x: Math.round(box.minX + (point.x - box.minX) * width / box.w),
    y: Math.round(box.minY + (point.y - box.minY) * depth / box.d),
  }));
  const shiftX = anchor === "ne" || anchor === "se" ? -dw : 0;
  const shiftY = anchor === "sw" || anchor === "se" ? -dd : 0;
  const resized: Room = { ...room, poly, origin: { x: room.origin.x + shiftX, y: room.origin.y + shiftY } };
  const old = worldBox(room);

  const shifted: string[] = [];
  const rooms = scene.rooms.map((other) => {
    if (other.id === room.id) return resized;
    if (!push || (dw === 0 && dd === 0)) return other;
    const ob = worldBox(other);
    let sx = 0;
    let sy = 0;
    if (dw !== 0) {
      if (shiftX === 0 && ob.minX >= old.maxX - EPS) sx = dw;
      if (shiftX !== 0 && ob.maxX <= old.minX + EPS) sx = -dw;
    }
    if (dd !== 0) {
      if (shiftY === 0 && ob.minY >= old.maxY - EPS) sy = dd;
      if (shiftY !== 0 && ob.maxY <= old.minY + EPS) sy = -dd;
    }
    if (sx === 0 && sy === 0) return other;
    shifted.push(other.id);
    return { ...other, origin: { x: other.origin.x + sx, y: other.origin.y + sy } };
  });

  const problems: string[] = [];
  const openings = scene.openings.map((opening) => {
    if (opening.roomId !== room.id) return opening;
    const carried = carryOpening(opening, room, resized);
    if (typeof carried === "string") {
      problems.push(carried);
      return opening;
    }
    return carried;
  });
  if (problems.length > 0) return { ok: false, detail: problems.join("; ") };

  const outside: string[] = [];
  const furniture = scene.furniture.map((item) => {
    if (item.roomId !== room.id) return item;
    const moved: Furniture = { ...item, pos: { x: item.pos.x - shiftX, y: item.pos.y - shiftY } };
    const product = productFor(moved, catalog);
    if (!product || !polyInside(poly, footprint(moved, product))) outside.push(item.id);
    return moved;
  });

  return { ok: true, rooms, openings, furniture, shifted, outside, size: { w: width, d: depth } };
}
