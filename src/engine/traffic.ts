import type { Catalog } from "./catalog";
import { clearanceZone, walkwayMin } from "./clearance";
import { openingClearZone } from "./doors";
import { distancePointSegment, footprint, pointInPoly, polyBBox } from "./geometry";
import type { Category, Room, Scene, Vec2 } from "./types";

const GRID_CM = 10;
const EPSILON = 1e-7;
const USE_CATEGORIES = new Set<Category>(["sofa", "armchair", "bed", "desk"]);
const NON_BLOCKING = new Set<Category>(["rug", "table-lamp", "decor"]);

/** Options for ten-centimetre-grid traffic analysis. Unknown rooms yield no paths. */
export interface TrafficOptions {
  /** Changes the required clear width from 60 cm to 90 cm. Defaults to scene metadata. */
  accessibility?: boolean;
  /** Adds a deterministic routing cost to furniture use zones. Defaults to true. */
  clearanceCost?: boolean;
}

/** A required room-local route. Missing routes have no points and a zero width. */
export interface TrafficPath {
  from: string;
  to: string;
  /** Simplified room-local polyline in centimetres. */
  points: Vec2[];
  /** Narrowest free diameter along the route, in centimetres. */
  minWidthCm: number;
  /** Point at which `minWidthCm` was measured; absent when no route exists. */
  pinch?: Vec2;
  ok: boolean;
}

interface Endpoint {
  id: string;
  point: Vec2;
  excluded: Vec2[][];
}

interface Grid {
  room: Room;
  minX: number;
  minY: number;
  cols: number;
  rows: number;
  blocked: Uint8Array;
  soft: Uint8Array;
  distance: Float64Array;
  obstacles: Array<{ id: string; box: Bounds }>;
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function center(poly: Vec2[]): Vec2 {
  const box = polyBBox(poly);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

function roomOpenings(scene: Scene, room: Room): Endpoint[] {
  return scene.openings
    .filter((opening) => opening.roomId === room.id && opening.kind !== "window" && opening.width > 0)
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((opening) => {
      const zone = openingClearZone(opening, room);
      return zone && zone.length > 0 ? [{ id: opening.id, point: center(zone), excluded: [zone] }] : [];
    });
}

function furnitureUsePoints(scene: Scene, room: Room, catalog: Catalog): Endpoint[] {
  return scene.furniture
    .filter((item) => item.roomId === room.id && item.status === "placed")
    .sort((a, b) => a.id.localeCompare(b.id))
    .flatMap((item) => {
      const cat = catalog.byId(item.catalogId);
      if (!cat || !USE_CATEGORIES.has(cat.category)) return [];
      const zone = clearanceZone(item, cat);
      return zone.length > 0 ? [{ id: item.id, point: center(zone), excluded: [zone, footprint(item, cat)] }] : [];
    });
}

function insideEndpoint(point: Vec2, endpoint: Endpoint): boolean {
  return endpoint.excluded.some((poly) => pointInPoly(point, poly));
}

function measuredCells(grid: Grid, cells: number[], from: Endpoint, to: Endpoint): number[] {
  return cells.filter((cell) => {
    const point = cellPoint(grid, cell);
    return !insideEndpoint(point, from) && !insideEndpoint(point, to);
  });
}

function endpointDistance(grid: Grid, cell: number, from: Endpoint, to: Endpoint): number {
  const point = cellPoint(grid, cell);
  let distance = distanceToRoomEdge(point, grid.room);
  for (const obstacle of grid.obstacles) {
    if (obstacle.id !== from.id && obstacle.id !== to.id) {
      distance = Math.min(distance, distanceToBounds(point, obstacle.box));
    }
  }
  return distance;
}

function visibleCells(grid: Grid, cells: number[], from: Endpoint, to: Endpoint): number[] {
  let start = 0;
  while (start < cells.length && insideEndpoint(cellPoint(grid, cells[start] as number), from)) start += 1;
  let end = cells.length - 1;
  while (end >= start && insideEndpoint(cellPoint(grid, cells[end] as number), to)) end -= 1;
  return cells.slice(start, end + 1);
}

function cellPoint(grid: Grid, index: number): Vec2 {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return { x: grid.minX + col * GRID_CM + GRID_CM / 2, y: grid.minY + row * GRID_CM + GRID_CM / 2 };
}

function pointToCell(grid: Grid, point: Vec2): number | undefined {
  const col = Math.max(0, Math.min(grid.cols - 1, Math.floor((point.x - grid.minX) / GRID_CM)));
  const row = Math.max(0, Math.min(grid.rows - 1, Math.floor((point.y - grid.minY) / GRID_CM)));
  const index = row * grid.cols + col;
  return grid.blocked[index] === 0 ? index : undefined;
}

function distanceToBounds(point: Vec2, box: Bounds): number {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  return Math.hypot(dx, dy);
}

function inBounds(point: Vec2, box: Bounds): boolean {
  return point.x >= box.minX && point.x <= box.maxX && point.y >= box.minY && point.y <= box.maxY;
}

function distanceToRoomEdge(point: Vec2, room: Room): number {
  let distance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < room.poly.length; index += 1) {
    const a = room.poly[index];
    const b = room.poly[(index + 1) % room.poly.length];
    if (a && b) distance = Math.min(distance, distancePointSegment(point, a, b));
  }
  return distance;
}

function buildGrid(scene: Scene, room: Room, catalog: Catalog, clearanceCost: boolean): Grid | undefined {
  const bounds = polyBBox(room.poly);
  const cols = Math.ceil(bounds.w / GRID_CM);
  const rows = Math.ceil(bounds.d / GRID_CM);
  if (cols <= 0 || rows <= 0) return undefined;
  const blockers: Array<{ id: string; box: Bounds }> = [];
  const softZones: Bounds[] = [];
  for (const item of scene.furniture) {
    if (item.roomId !== room.id || item.status !== "placed") continue;
    const cat = catalog.byId(item.catalogId);
    if (!cat) continue;
    if (!NON_BLOCKING.has(cat.category)) blockers.push({ id: item.id, box: polyBBox(footprint(item, cat)) });
    if (clearanceCost) {
      const zone = clearanceZone(item, cat);
      if (zone.length > 0) softZones.push(polyBBox(zone));
    }
  }
  const size = cols * rows;
  const grid: Grid = {
    room,
    minX: bounds.minX,
    minY: bounds.minY,
    cols,
    rows,
    blocked: new Uint8Array(size),
    soft: new Uint8Array(size),
    distance: new Float64Array(size),
    obstacles: blockers,
  };
  for (let index = 0; index < size; index += 1) {
    const point = cellPoint(grid, index);
    const inside = pointInPoly(point, room.poly);
    const occupied = inside && blockers.some((blocker) => inBounds(point, blocker.box));
    if (!inside || occupied) {
      grid.blocked[index] = 1;
      grid.distance[index] = 0;
      continue;
    }
    let distance = distanceToRoomEdge(point, room);
    for (const blocker of blockers) distance = Math.min(distance, distanceToBounds(point, blocker.box));
    grid.distance[index] = distance;
    if (softZones.some((box) => inBounds(point, box))) grid.soft[index] = 1;
  }
  return grid;
}

class MinHeap {
  private readonly values: number[] = [];
  constructor(private readonly less: (a: number, b: number) => boolean) {}

  push(value: number): void {
    let index = this.values.push(value) - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      const parentValue = this.values[parent];
      if (parentValue === undefined || !this.less(value, parentValue)) break;
      this.values[index] = parentValue;
      index = parent;
    }
    this.values[index] = value;
  }

  pop(): number | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (first === undefined || last === undefined || this.values.length === 0) return first;
    let index = 0;
    this.values[0] = last;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let child = left;
      if (right < this.values.length && this.less(this.values[right] as number, this.values[left] as number)) child = right;
      const childValue = this.values[child];
      if (childValue === undefined || !this.less(childValue, this.values[index] as number)) break;
      this.values[index] = childValue;
      this.values[child] = this.values[index] as number;
      this.values[child] = last;
      index = child;
    }
    return first;
  }

  get size(): number {
    return this.values.length;
  }
}

const NEIGHBORS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, 10], [1, 0, 10], [0, 1, 10], [-1, 0, 10],
  [1, -1, Math.SQRT2 * 10], [1, 1, Math.SQRT2 * 10], [-1, 1, Math.SQRT2 * 10], [-1, -1, Math.SQRT2 * 10],
];

function octile(a: number, b: number, cols: number): number {
  const ax = a % cols;
  const ay = Math.floor(a / cols);
  const bx = b % cols;
  const by = Math.floor(b / cols);
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return GRID_CM * (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy));
}

function route(
  grid: Grid,
  start: number,
  goal: number,
  requiredWidth: number,
  from: Endpoint,
  to: Endpoint,
  constrainWidth: boolean,
): number[] {
  const size = grid.cols * grid.rows;
  const g = new Float64Array(size);
  const f = new Float64Array(size);
  const previous = new Int32Array(size);
  const closed = new Uint8Array(size);
  g.fill(Number.POSITIVE_INFINITY);
  f.fill(Number.POSITIVE_INFINITY);
  previous.fill(-1);
  g[start] = 0;
  f[start] = octile(start, goal, grid.cols);
  const heap = new MinHeap((a, b) => f[a]! < f[b]! - EPSILON
    || (Math.abs(f[a]! - f[b]!) <= EPSILON && (octile(a, goal, grid.cols) < octile(b, goal, grid.cols) - EPSILON
      || (Math.abs(octile(a, goal, grid.cols) - octile(b, goal, grid.cols)) <= EPSILON && a < b))));
  heap.push(start);
  const blocked = (cell: number): boolean => {
    if (grid.blocked[cell] === 1) return true;
    if (!constrainWidth || grid.distance[cell]! >= requiredWidth / 2 - EPSILON) return false;
    const point = cellPoint(grid, cell);
    if (!insideEndpoint(point, from) && !insideEndpoint(point, to)) return true;
    return grid.obstacles.some((obstacle) => obstacle.id !== from.id && obstacle.id !== to.id
      && distanceToBounds(point, obstacle.box) < requiredWidth / 2 - EPSILON);
  };
  while (heap.size > 0) {
    const current = heap.pop();
    if (current === undefined || closed[current] === 1) continue;
    if (current === goal) {
      const path: number[] = [];
      for (let at = goal; at >= 0; at = previous[at] ?? -1) {
        path.push(at);
        if (at === start) return path.reverse();
      }
      return [];
    }
    closed[current] = 1;
    const col = current % grid.cols;
    const row = Math.floor(current / grid.cols);
    for (const [dx, dy, baseCost] of NEIGHBORS) {
      const nextCol = col + dx;
      const nextRow = row + dy;
      if (nextCol < 0 || nextCol >= grid.cols || nextRow < 0 || nextRow >= grid.rows) continue;
      const next = nextRow * grid.cols + nextCol;
      if (blocked(next) || closed[next] === 1) continue;
      if (dx !== 0 && dy !== 0) {
        const horizontal = row * grid.cols + nextCol;
        const vertical = nextRow * grid.cols + col;
        if (blocked(horizontal) || blocked(vertical)) continue;
      }
      const widthPenalty = constrainWidth ? 0 : Math.max(0, requiredWidth / 2 - grid.distance[next]!) * 4;
      const tentative = g[current]! + baseCost + widthPenalty + (grid.soft[next] === 1 ? GRID_CM * 2 : 0);
      if (tentative + EPSILON < g[next]!) {
        previous[next] = current;
        g[next] = tentative;
        f[next] = tentative + octile(next, goal, grid.cols);
        heap.push(next);
      }
    }
  }
  return [];
}

function simplify(points: Vec2[], tolerance = 5): Vec2[] {
  if (points.length <= 2) return points.map((point) => ({ ...point }));
  const first = points[0] as Vec2;
  const last = points[points.length - 1] as Vec2;
  let farthest = 0;
  let farthestIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distancePointSegment(points[index] as Vec2, first, last);
    if (distance > farthest) {
      farthest = distance;
      farthestIndex = index;
    }
  }
  if (farthest <= tolerance) return [{ ...first }, { ...last }];
  const left = simplify(points.slice(0, farthestIndex + 1), tolerance);
  const right = simplify(points.slice(farthestIndex), tolerance);
  return [...left.slice(0, -1), ...right];
}

function requiredPairs(openings: Endpoint[], uses: Endpoint[]): Array<readonly [Endpoint, Endpoint]> {
  const pairs: Array<readonly [Endpoint, Endpoint]> = [];
  for (let left = 0; left < openings.length; left += 1) {
    for (let right = left + 1; right < openings.length; right += 1) {
      pairs.push([openings[left] as Endpoint, openings[right] as Endpoint]);
    }
  }
  const primary = openings[0];
  if (primary) for (const use of uses) pairs.push([primary, use]);
  return pairs;
}

/**
 * Finds all required door-to-door and primary-door-to-use routes on a 10 cm grid.
 * Unknown rooms, degenerate rooms, and rooms without doors return an empty array.
 */
export function trafficPaths(scene: Scene, roomId: string, catalog: Catalog, opts: TrafficOptions = {}): TrafficPath[] {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return [];
  const openings = roomOpenings(scene, room);
  if (openings.length === 0) return [];
  const pairs = requiredPairs(openings, furnitureUsePoints(scene, room, catalog));
  if (pairs.length === 0) return [];
  const grid = buildGrid(scene, room, catalog, opts.clearanceCost ?? true);
  if (!grid) return [];
  const requiredWidth = walkwayMin(opts.accessibility ?? scene.meta.accessibilityMode);
  return pairs.map(([from, to]) => {
    const start = pointToCell(grid, from.point);
    const goal = pointToCell(grid, to.point);
    if (start === undefined || goal === undefined) return { from: from.id, to: to.id, points: [], minWidthCm: 0, ok: false };
    const constrained = route(grid, start, goal, requiredWidth, from, to, true);
    const cells = constrained.length > 0
      ? constrained
      : route(grid, start, goal, requiredWidth, from, to, false);
    if (cells.length === 0) return { from: from.id, to: to.id, points: [], minWidthCm: 0, ok: false };
    const measured = measuredCells(grid, cells, from, to);
    let pinchCell = measured[0];
    for (const cell of measured) {
      if (pinchCell === undefined || endpointDistance(grid, cell, from, to) < endpointDistance(grid, pinchCell, from, to) - EPSILON) pinchCell = cell;
    }
    const minWidthCm = pinchCell === undefined
      ? requiredWidth
      : Math.max(0, Math.floor(endpointDistance(grid, pinchCell, from, to) * 2 + EPSILON));
    const visible = visibleCells(grid, cells, from, to);
    const raw = (visible.length > 0 ? visible : cells).map((cell) => cellPoint(grid, cell));
    return {
      from: from.id,
      to: to.id,
      points: simplify(raw),
      minWidthCm,
      ...(pinchCell === undefined ? {} : { pinch: cellPoint(grid, pinchCell) }),
      ok: minWidthCm >= requiredWidth,
    };
  });
}
