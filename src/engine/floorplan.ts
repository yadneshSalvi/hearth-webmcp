/**
 * Floor-plan import (TOOLS.md §40, SCENE_SCHEMA.md §Imported floor plans): turns what the plan
 * reader saw in an image — rooms with printed sizes and image-fraction boxes, door links, window
 * sides — into a Hearth scene laid out to scale in centimetres, with shared walls, paired doors,
 * an entrance, windows on exterior walls and every room reachable. Pure and deterministic.
 */
import type { Floor } from "../tokens";
import { walls } from "./geometry";
import type { Opening, Room, RoomType, Scene, SceneMeta, Side, Vec2, Wall } from "./types";
import { ROOM_TYPES } from "./types";

export type ParsedRoomType = RoomType | "outdoor" | "other";

/** One room as the plan reader reports it. */
export interface ParsedRoom {
  name: string;
  type: ParsedRoomType;
  /** The printed label, e.g. 9'0" x 10'0", or "". */
  dimension_label: string;
  /** Horizontal extent in cm (0 = unknown). */
  width_cm: number;
  /** Vertical extent in cm (0 = unknown). */
  depth_cm: number;
  /** Axis-aligned box as fractions of the image; x from the left, y from the top. */
  bbox: { x0: number; y0: number; x1: number; y1: number };
  /** Names of rooms this one has a door into, plus "outside" for an entrance. */
  doors_to: string[];
  /** Compass sides of walls with windows (north = top of the image). */
  windows: Side[];
}

export interface ParsedPlan {
  title: string;
  units: "ft" | "m" | "cm" | "unknown";
  north_up: boolean;
  rooms: ParsedRoom[];
  entrance_room: string;
  confidence: number;
  notes: string;
}

export interface PlanBuild {
  scene: Scene;
  /** Areas left out, e.g. "Deck (outdoor)". */
  skipped: string[];
  /** What the layout pass had to decide on the plan's behalf. */
  notes: string[];
}

/** Edges this close together are one wall (Hearth walls have no thickness; printed sizes are interior). */
const EDGE_CLUSTER_CM = 25;
const MAX_CLUSTER_SPAN_CM = 40;
const MIN_SIDE_CM = 60;
const MIN_SHARED_CM = 80;
const DOOR_CM = 90;
const SILL_CM = 90;
/** When no room carries a printed size, the plan is assumed to be this wide. */
const FALLBACK_HOME_WIDTH_CM = 1100;

interface Box { minX: number; minY: number; maxX: number; maxY: number }

interface Placed {
  source: ParsedRoom;
  type: RoomType;
  box: Box;
  id: string;
}

const FLOORS: Partial<Record<RoomType, Floor>> = { bath: "terrazzo", kitchen: "stone", bedroom: "pale-oak" };
const PRIVATE: ReadonlySet<RoomType> = new Set(["bedroom", "bath", "office"]);

function normalizeName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function roomType(type: ParsedRoomType): RoomType | undefined {
  if (type === "outdoor") return undefined;
  if (type === "other") return "hall";
  return (ROOM_TYPES as readonly string[]).includes(type) ? type : "hall";
}

/** A reader sometimes lists a box right-to-left; the box is the same either way. */
function normalizedBox(room: ParsedRoom): ParsedRoom {
  const { x0, y0, x1, y1 } = room.bbox;
  if (x0 <= x1 && y0 <= y1) return room;
  return { ...room, bbox: { x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) } };
}

function bboxValid(room: ParsedRoom): boolean {
  const { x0, y0, x1, y1 } = room.bbox;
  return [x0, y0, x1, y1].every((value) => Number.isFinite(value)) && x1 - x0 > 0.005 && y1 - y0 > 0.005;
}

/** Per-axis scale in cm per image fraction, from the rooms that carry a printed size. */
function scales(rooms: ParsedRoom[]): { x: number; y: number; estimated: boolean } {
  const xs = rooms.filter((room) => room.width_cm > 0).map((room) => room.width_cm / (room.bbox.x1 - room.bbox.x0));
  const ys = rooms.filter((room) => room.depth_cm > 0).map((room) => room.depth_cm / (room.bbox.y1 - room.bbox.y0));
  const x = median(xs);
  const y = median(ys);
  if (x !== undefined && y !== undefined) return { x, y, estimated: false };
  if (x !== undefined) return { x, y: x, estimated: true };
  if (y !== undefined) return { x: y, y, estimated: true };
  const minX = Math.min(...rooms.map((room) => room.bbox.x0));
  const maxX = Math.max(...rooms.map((room) => room.bbox.x1));
  const span = Math.max(0.05, maxX - minX);
  return { x: FALLBACK_HOME_WIDTH_CM / span, y: FALLBACK_HOME_WIDTH_CM / span, estimated: true };
}

/**
 * Rooms whose printed width × depth contradicts the drawing. For a correctly read label,
 * (width/depth) ÷ (bbox width fraction / bbox height fraction) equals the image's own aspect ratio,
 * the same number for every room; a swapped label lands far from that shared value and closer to it
 * once its two numbers trade places. Needs three or more labelled rooms to have a majority.
 */
function swappedLabels(rooms: ParsedRoom[]): Set<ParsedRoom> {
  const labelled = rooms.filter((room) => room.width_cm > 0 && room.depth_cm > 0);
  const swapped = new Set<ParsedRoom>();
  if (labelled.length < 3) return swapped;
  const ratio = (room: ParsedRoom, flip: boolean): number => {
    const label = flip ? room.depth_cm / room.width_cm : room.width_cm / room.depth_cm;
    return label / ((room.bbox.x1 - room.bbox.x0) / (room.bbox.y1 - room.bbox.y0));
  };
  const aspect = median(labelled.map((room) => Math.log(ratio(room, false)))) as number;
  for (const room of labelled) {
    const asIs = Math.abs(Math.log(ratio(room, false)) - aspect);
    const flipped = Math.abs(Math.log(ratio(room, true)) - aspect);
    if (asIs > 0.25 && flipped * 1.5 < asIs) swapped.add(room);
  }
  return swapped;
}

/** Sizes a room from its printed label, or from the drawing when it has none. */
function sizeOf(room: ParsedRoom, scale: { x: number; y: number }): { w: number; d: number } {
  const bw = (room.bbox.x1 - room.bbox.x0) * scale.x;
  const bh = (room.bbox.y1 - room.bbox.y0) * scale.y;
  const w = room.width_cm > 0 ? room.width_cm : bw;
  const d = room.depth_cm > 0 ? room.depth_cm : bh;
  return { w: Math.max(MIN_SIDE_CM, Math.round(w)), d: Math.max(MIN_SIDE_CM, Math.round(d)) };
}

/** Snaps near-equal coordinates to one value so neighbours share a wall. */
function clusterEdges(values: number[]): Map<number, number> {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  const mapping = new Map<number, number>();
  let cluster: number[] = [];
  const flush = (): void => {
    if (cluster.length === 0) return;
    const mean = Math.round(cluster.reduce((sum, value) => sum + value, 0) / cluster.length / 5) * 5;
    for (const value of cluster) mapping.set(value, mean);
    cluster = [];
  };
  for (const value of sorted) {
    const first = cluster[0];
    const last = cluster[cluster.length - 1];
    if (first !== undefined && last !== undefined && (value - last > EDGE_CLUSTER_CM || value - first > MAX_CLUSTER_SPAN_CM)) flush();
    cluster.push(value);
  }
  flush();
  return mapping;
}

function snapBoxes(boxes: Box[]): Box[] {
  const xs = clusterEdges(boxes.flatMap((box) => [box.minX, box.maxX]));
  const ys = clusterEdges(boxes.flatMap((box) => [box.minY, box.maxY]));
  return boxes.map((box) => {
    let minX = xs.get(box.minX) ?? box.minX;
    let maxX = xs.get(box.maxX) ?? box.maxX;
    let minY = ys.get(box.minY) ?? box.minY;
    let maxY = ys.get(box.maxY) ?? box.maxY;
    if (maxX - minX < MIN_SIDE_CM) { minX = box.minX; maxX = box.maxX; }
    if (maxY - minY < MIN_SIDE_CM) { minY = box.minY; maxY = box.maxY; }
    return { minX, minY, maxX, maxY };
  });
}

/** Pushes overlapping boxes apart along the axis of least penetration; later boxes move. */
function resolveOverlaps(boxes: Box[]): number {
  let moves = 0;
  for (let pass = 0; pass < 40; pass += 1) {
    let moved = false;
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i] as Box;
        const b = boxes[j] as Box;
        const px = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
        const py = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY);
        if (px <= 0.5 || py <= 0.5) continue;
        moved = true;
        moves += 1;
        if (px <= py) {
          const dir = (b.minX + b.maxX) / 2 >= (a.minX + a.maxX) / 2 ? 1 : -1;
          boxes[j] = { ...b, minX: b.minX + dir * px, maxX: b.maxX + dir * px };
        } else {
          const dir = (b.minY + b.maxY) / 2 >= (a.minY + a.maxY) / 2 ? 1 : -1;
          boxes[j] = { ...b, minY: b.minY + dir * py, maxY: b.maxY + dir * py };
        }
      }
    }
    if (!moved) break;
  }
  return moves;
}

const ID_BASE: Record<RoomType, string> = {
  living: "living", bedroom: "bed", kitchen: "kitchen", dining: "dining", office: "office", bath: "bath", hall: "hall", studio: "studio",
};

/** Template-style ids: living, kitchen, bed-1, bed-2, bath, bath-2, hall, hall-2. */
function assignIds(types: RoomType[]): string[] {
  const counts = new Map<RoomType, number>();
  return types.map((type) => {
    const index = (counts.get(type) ?? 0) + 1;
    counts.set(type, index);
    const base = ID_BASE[type];
    if (type === "bedroom") return `${base}-${index}`;
    return index === 1 ? base : `${base}-${index}`;
  });
}

/** Plans print room names in capitals; the studio's chrome sets them in title case ("M. Bedroom"). */
export function roomDisplayName(printed: string): string {
  const name = printed.trim().replace(/\s+/g, " ");
  if (!name) return "";
  if (name !== name.toUpperCase() || !/[A-Z]/.test(name)) return name;
  return name
    .toLowerCase()
    .replace(/(^|[\s(/.-])([a-z])/g, (_match, before: string, letter: string) => `${before}${letter.toUpperCase()}`)
    .replace(/\bw\/c\b/gi, "W/C")
    .replace(/\b(\d+)(st|nd|rd|th)\b/g, "$1$2");
}

function roomFrom(placed: Placed): Room {
  const w = placed.box.maxX - placed.box.minX;
  const d = placed.box.maxY - placed.box.minY;
  return {
    id: placed.id,
    name: roomDisplayName(placed.source.name) || placed.id,
    type: placed.type,
    poly: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }],
    origin: { x: placed.box.minX, y: placed.box.minY },
    floor: FLOORS[placed.type] ?? "oak",
    wallColor: "plaster",
  };
}

/** A segment two rooms share, in world cm, and which side of each it lies on. */
interface Shared { a: Placed; b: Placed; sideA: Side; sideB: Side; start: number; end: number; axis: "x" | "y" }

function sharedWall(a: Placed, b: Placed): Shared | undefined {
  const ab = a.box;
  const bb = b.box;
  const yStart = Math.max(ab.minY, bb.minY);
  const yEnd = Math.min(ab.maxY, bb.maxY);
  if (Math.abs(ab.maxX - bb.minX) <= 1 && yEnd - yStart >= MIN_SHARED_CM) return { a, b, sideA: "east", sideB: "west", start: yStart, end: yEnd, axis: "y" };
  if (Math.abs(bb.maxX - ab.minX) <= 1 && yEnd - yStart >= MIN_SHARED_CM) return { a, b, sideA: "west", sideB: "east", start: yStart, end: yEnd, axis: "y" };
  const xStart = Math.max(ab.minX, bb.minX);
  const xEnd = Math.min(ab.maxX, bb.maxX);
  if (Math.abs(ab.maxY - bb.minY) <= 1 && xEnd - xStart >= MIN_SHARED_CM) return { a, b, sideA: "south", sideB: "north", start: xStart, end: xEnd, axis: "x" };
  if (Math.abs(bb.maxY - ab.minY) <= 1 && xEnd - xStart >= MIN_SHARED_CM) return { a, b, sideA: "north", sideB: "south", start: xStart, end: xEnd, axis: "x" };
  return undefined;
}

/** Offset along a rectangular room's wall (clockwise from its start) for a world-axis segment. */
function wallOffset(room: Room, wall: Wall, worldStart: number, worldEnd: number, axis: "x" | "y"): number {
  const origin = axis === "x" ? room.origin.x : room.origin.y;
  const a = axis === "x" ? wall.a.x : wall.a.y;
  const b = axis === "x" ? wall.b.x : wall.b.y;
  const dir = b >= a ? 1 : -1;
  const localStart = worldStart - origin;
  const localEnd = worldEnd - origin;
  return Math.round(dir === 1 ? localStart - a : a - localEnd);
}

function wallOn(room: Room, side: Side): Wall {
  return walls(room).find((wall) => wall.side === side) as Wall;
}

/** The parts of one wall not shared with a neighbour and not already holding an opening. */
function exteriorSpans(room: Room, side: Side, placed: Placed[], self: Placed, openings: Opening[]): Array<{ start: number; end: number }> {
  const wall = wallOn(room, side);
  const blocked: Array<{ start: number; end: number }> = [];
  for (const other of placed) {
    if (other === self) continue;
    const shared = sharedWall(self, other);
    if (!shared || shared.sideA !== side) continue;
    const offset = wallOffset(room, wall, shared.start, shared.end, shared.axis);
    blocked.push({ start: offset, end: offset + (shared.end - shared.start) });
  }
  for (const opening of openings) {
    if (opening.roomId !== room.id || opening.wallId !== wall.id) continue;
    blocked.push({ start: opening.offset - 10, end: opening.offset + opening.width + 10 });
  }
  blocked.sort((left, right) => left.start - right.start);
  const free: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  for (const span of blocked) {
    if (span.start > cursor) free.push({ start: cursor, end: Math.min(span.start, wall.length) });
    cursor = Math.max(cursor, span.end);
  }
  if (cursor < wall.length) free.push({ start: cursor, end: wall.length });
  return free.filter((span) => span.end - span.start >= 40);
}

function doorPair(shared: Shared, rooms: Map<string, Room>): Opening[] {
  const roomA = rooms.get(shared.a.id) as Room;
  const roomB = rooms.get(shared.b.id) as Room;
  const overlap = shared.end - shared.start;
  const width = Math.max(70, Math.min(DOOR_CM, Math.floor((overlap - 10) / 2) * 2));
  // Whole centimetres on both sides, so the two records describe one world segment.
  const worldStart = Math.round((shared.start + shared.end) / 2 - width / 2);
  const worldEnd = worldStart + width;
  const wallA = wallOn(roomA, shared.sideA);
  const wallB = wallOn(roomB, shared.sideB);
  const aPrivate = PRIVATE.has(shared.a.type) && !PRIVATE.has(shared.b.type);
  const bPrivate = PRIVATE.has(shared.b.type) && !PRIVATE.has(shared.a.type);
  const swingIntoA = aPrivate || (!bPrivate && shared.a.type !== "hall");
  return [
    { id: `door-${roomA.id}-${roomB.id}`, roomId: roomA.id, wallId: wallA.id, offset: wallOffset(roomA, wallA, worldStart, worldEnd, shared.axis), width, kind: "door", swing: swingIntoA ? "in" : "out", hinge: "left" },
    { id: `door-${roomB.id}-${roomA.id}`, roomId: roomB.id, wallId: wallB.id, offset: wallOffset(roomB, wallB, worldStart, worldEnd, shared.axis), width, kind: "door", swing: swingIntoA ? "out" : "in", hinge: "right" },
  ];
}

function resolveRoomName(name: string, placed: Placed[]): Placed | undefined {
  const needle = normalizeName(name);
  if (!needle || needle === "outside") return undefined;
  return placed.find((room) => normalizeName(room.source.name) === needle)
    ?? placed.find((room) => normalizeName(room.source.name).startsWith(needle) || needle.startsWith(normalizeName(room.source.name)));
}

function sceneMeta(activeRoomId: string, plan: ParsedPlan, skipped: string[]): SceneMeta {
  return {
    mode: "design",
    view: "dollhouse",
    yaw: "sw",
    timeOfDay: "golden",
    paletteId: "warm-clay",
    accessibilityMode: false,
    activeRoomId,
    budgetUsd: 3000,
    selection: {},
    importedPlan: {
      title: plan.title.trim() || "Imported plan",
      confidence: Math.max(0, Math.min(1, Number.isFinite(plan.confidence) ? plan.confidence : 0)),
      roomsDetected: plan.rooms.length,
      skipped,
    },
  };
}

/** Builds a scene from a parsed plan. Throws only when the plan has no usable room at all. */
export function planToScene(plan: ParsedPlan): PlanBuild {
  const notes: string[] = [];
  const skipped: string[] = [];
  const usable: Array<{ source: ParsedRoom; type: RoomType }> = [];
  for (const raw of plan.rooms) {
    const room = normalizedBox(raw);
    const type = roomType(room.type);
    if (!type) { skipped.push(`${room.name.trim() || "Area"} (outdoor)`); continue; }
    if (!bboxValid(room)) { skipped.push(`${room.name.trim() || "Area"} (no position)`); continue; }
    usable.push({ source: room, type });
  }
  if (usable.length === 0) throw new Error("The plan reader found no enclosed rooms in this image.");

  const swapped = swappedLabels(usable.map((entry) => entry.source));
  for (const entry of usable) {
    if (!swapped.has(entry.source)) continue;
    notes.push(`${entry.source.name.trim()}: printed size read as depth × width to match the drawing.`);
    entry.source = { ...entry.source, width_cm: entry.source.depth_cm, depth_cm: entry.source.width_cm };
  }
  const scale = scales(usable.map((entry) => entry.source));
  if (scale.estimated) notes.push("No usable printed dimensions on some axis; sizes are estimated from the drawing.");
  const boxes: Box[] = usable.map(({ source }) => {
    const size = sizeOf(source, scale);
    const cx = ((source.bbox.x0 + source.bbox.x1) / 2) * scale.x;
    const cy = ((source.bbox.y0 + source.bbox.y1) / 2) * scale.y;
    return { minX: Math.round(cx - size.w / 2), minY: Math.round(cy - size.d / 2), maxX: Math.round(cx + size.w / 2), maxY: Math.round(cy + size.d / 2) };
  });
  const snapped = snapBoxes(boxes);
  const moves = resolveOverlaps(snapped);
  if (moves > 0) notes.push(`${moves} overlap${moves === 1 ? "" : "s"} between rooms resolved by nudging.`);
  const minX = Math.min(...snapped.map((box) => box.minX));
  const minY = Math.min(...snapped.map((box) => box.minY));
  const ids = assignIds(usable.map((entry) => entry.type));
  const placed: Placed[] = usable.map((entry, index) => {
    const box = snapped[index] as Box;
    return {
      source: entry.source,
      type: entry.type,
      id: ids[index] as string,
      box: { minX: box.minX - minX, minY: box.minY - minY, maxX: box.maxX - minX, maxY: box.maxY - minY },
    };
  });
  const rooms = placed.map(roomFrom);
  const byId = new Map(rooms.map((room) => [room.id, room]));

  // Doors: one pair per link the reader saw on a shared wall.
  const openings: Opening[] = [];
  const linked = new Set<string>();
  const pairKey = (a: Placed, b: Placed): string => [a.id, b.id].sort().join("|");
  for (const room of placed) {
    for (const target of room.source.doors_to) {
      const other = resolveRoomName(target, placed);
      if (!other || other === room) continue;
      const key = pairKey(room, other);
      if (linked.has(key)) continue;
      const shared = sharedWall(room, other);
      if (!shared) { notes.push(`${room.source.name.trim()} and ${other.source.name.trim()} share no wall, so no door joins them.`); linked.add(key); continue; }
      openings.push(...doorPair(shared, byId));
      linked.add(key);
    }
  }

  // Entrance: a door on an exterior wall of the entrance room.
  const entrance = resolveRoomName(plan.entrance_room, placed)
    ?? placed.find((room) => room.source.doors_to.some((name) => normalizeName(name) === "outside"))
    ?? placed.find((room) => room.type === "living")
    ?? placed[0] as Placed;
  const entranceRoom = byId.get(entrance.id) as Room;
  let entranceDone = false;
  for (const side of ["south", "east", "west", "north"] as const) {
    const span = exteriorSpans(entranceRoom, side, placed, entrance, openings).sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
    if (!span || span.end - span.start < DOOR_CM + 10) continue;
    const wall = wallOn(entranceRoom, side);
    openings.push({ id: "door-entrance", roomId: entranceRoom.id, wallId: wall.id, offset: Math.round((span.start + span.end) / 2 - DOOR_CM / 2), width: DOOR_CM, kind: "door", swing: "in", hinge: "left" });
    entranceDone = true;
    break;
  }
  if (!entranceDone) notes.push(`${entrance.source.name.trim()} has no free exterior wall for an entrance door.`);

  // Connectivity: every room reachable from the entrance through doors.
  const adjacency = new Map<string, Set<string>>();
  const connect = (a: string, b: string): void => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  };
  for (const key of linked) {
    const [a, b] = key.split("|");
    if (a && b && openings.some((opening) => opening.id === `door-${a}-${b}`)) connect(a, b);
  }
  for (let guard = 0; guard < placed.length; guard += 1) {
    const reachable = new Set<string>([entrance.id]);
    const queue = [entrance.id];
    while (queue.length > 0) {
      const current = queue.shift() as string;
      for (const next of adjacency.get(current) ?? []) if (!reachable.has(next)) { reachable.add(next); queue.push(next); }
    }
    const missing = placed.filter((room) => !reachable.has(room.id));
    if (missing.length === 0) break;
    let added = false;
    const hosts = placed.filter((room) => reachable.has(room.id)).sort((a, b) => (a.type === "hall" || a.type === "living" ? 0 : 1) - (b.type === "hall" || b.type === "living" ? 0 : 1));
    for (const room of missing) {
      for (const host of hosts) {
        const shared = sharedWall(host, room);
        if (!shared) continue;
        openings.push(...doorPair(shared, byId));
        connect(host.id, room.id);
        notes.push(`Added a door between ${host.source.name.trim()} and ${room.source.name.trim()} so it can be reached.`);
        added = true;
        break;
      }
      if (added) break;
    }
    if (!added) {
      notes.push(`${missing.map((room) => room.source.name.trim()).join(", ")}: no shared wall with a reachable room.`);
      break;
    }
  }

  // Windows on exterior walls: the sides the reader listed, plus one for a habitable room with none.
  const habitable: ReadonlySet<RoomType> = new Set(["living", "bedroom", "kitchen", "dining", "office", "studio"]);
  for (const entry of placed) {
    const room = byId.get(entry.id) as Room;
    const sides = [...new Set(entry.source.windows.filter((side) => ["north", "east", "south", "west"].includes(side)))];
    let count = 0;
    const addWindow = (side: Side): boolean => {
      const span = exteriorSpans(room, side, placed, entry, openings).sort((left, right) => (right.end - right.start) - (left.end - left.start))[0];
      if (!span || span.end - span.start < 100) return false;
      const width = Math.round(Math.max(100, Math.min(180, (span.end - span.start) * 0.6)) / 10) * 10;
      const wall = wallOn(room, side);
      openings.push({ id: `window-${room.id}-${side}`, roomId: room.id, wallId: wall.id, offset: Math.round((span.start + span.end) / 2 - width / 2), width, kind: "window", sillHeight: SILL_CM });
      count += 1;
      return true;
    };
    for (const side of sides) addWindow(side);
    if (count === 0 && habitable.has(entry.type)) {
      for (const side of ["north", "south", "east", "west"] as const) if (addWindow(side)) { notes.push(`${room.name}: added a window on its exterior ${side} wall.`); break; }
    }
  }

  const activeRoomId = (placed.find((room) => room.type === "living") ?? entrance).id;
  const scene: Scene = { rooms, openings, furniture: [], variants: [], meta: sceneMeta(activeRoomId, plan, skipped) };
  return { scene, skipped, notes };
}

/** World-space centre of a room, for tests and the import preview. */
export function roomCentre(room: Room): Vec2 {
  const xs = room.poly.map((point) => point.x);
  const ys = room.poly.map((point) => point.y);
  return { x: room.origin.x + (Math.min(...xs) + Math.max(...xs)) / 2, y: room.origin.y + (Math.min(...ys) + Math.max(...ys)) / 2 };
}
