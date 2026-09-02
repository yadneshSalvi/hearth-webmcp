import type { Catalog } from "./catalog";
import { freeSpans, roomArea, roomSize, rotateDims, walls } from "./geometry";
import type { CatalogItem, Dims, Furniture, Opening, Room, Scene, Span, Vec2 } from "./types";
import { productFor } from "./catalog";

/** Catalog input accepted by compact engine describers. */
export type CatalogSource = Catalog | CatalogItem[];

/** Minimal cart shape consumed by the pure cart formatter. */
export interface CartDescription {
  lines: Array<{
    handle: string;
    title: string;
    colorway: string;
    quantity: number;
    unitUsd: number;
    lineUsd: number;
    itemId?: string;
  }>;
  subtotalUsd: number;
}

/** Formats catalog dimensions as compact WxDxH centimetres. */
export function dimsStr(dims: Dims): string {
  return `${dims.w}x${dims.d}x${dims.h}`;
}

/** Formats the rotated footprint as compact WxD centimetres. */
export function footStr(cat: CatalogItem, rotation: Furniture["rotation"]): string {
  const dims = rotateDims(cat.dims, rotation);
  return `${dims.w}x${dims.d}`;
}

/** Converts a point to the integer pair used by tool payloads. */
export function posArr(pos: Vec2): [number, number] {
  return [Math.round(pos.x), Math.round(pos.y)];
}

/** Lists every derived room wall clockwise in a single compact line. */
export function wallsLine(room: Room): string {
  return walls(room).map((wall) => `${wall.side[0]?.toUpperCase()} ${Math.round(wall.length)}`).join(" · ");
}

/** Formats free wall spans without unit noise. */
export function spansStr(spans: readonly Span[]): string {
  return spans.map((span) => `${Math.round(span.start)}-${Math.round(span.end)}`).join(",");
}

/** Formats one furniture row for get_room_details. */
export function itemLine(item: Furniture, cat: CatalogItem): string {
  const [x, y] = posArr(item.pos);
  return `${item.id} ${cat.name} @${x},${y} r${item.rotation} ${footStr(cat, item.rotation)} ${item.colorway}${item.dims ? " resized" : ""}${item.status === "ghost" ? " ghost" : ""}`;
}

/** Formats one room row for get_scene_summary. */
export function roomRow(scene: Scene, room: Room, _catalog: CatalogSource, conflictsCount: number): {
  id: string;
  name: string;
  type: Room["type"];
  area_m2: number;
  walls: string;
  items: number;
  conflicts: number;
} {
  const items = scene.furniture.filter((item) => item.roomId === room.id);
  const result = {
    id: room.id,
    name: room.name,
    type: room.type,
    area_m2: m2(roomArea(room)),
    walls: wallsLine(room),
    items: items.length,
    conflicts: conflictsCount,
  };
  return result;
}

function openingRow(opening: Opening): {
  id: string;
  kind: Opening["kind"];
  wall: string;
  offset_cm: number;
  width_cm: number;
  swing?: Opening["swing"];
  hinge?: Opening["hinge"];
} {
  return {
    id: opening.id,
    kind: opening.kind,
    wall: opening.wallId,
    offset_cm: Math.round(opening.offset),
    width_cm: Math.round(opening.width),
    ...(opening.swing ? { swing: opening.swing } : {}),
    ...(opening.hinge ? { hinge: opening.hinge } : {}),
  };
}

/** Builds the compact get_room_details data payload (without the common envelope or hint). */
export function roomDetails(scene: Scene, room: Room, catalog: CatalogSource, conflictsCount: number): {
  room: {
    id: string;
    name: string;
    type: Room["type"];
    size_cm: string;
    area_m2: number;
    floor: Room["floor"];
    wall_color: NonNullable<Room["wallColor"]>;
  };
  walls: Array<{ id: string; side: string; length_cm: number; free_spans: string }>;
  openings: ReturnType<typeof openingRow>[];
  items: string[];
  more: number;
  conflicts: number;
} {
  const roomWalls = truncateList(walls(room), 6).items.map((wall) => ({
    id: wall.id,
    side: wall.side,
    length_cm: Math.round(wall.length),
    free_spans: spansStr(freeSpans(room, wall, scene, Array.isArray(catalog) ? catalog : catalog.all())),
  }));
  const roomOpenings = truncateList(scene.openings.filter((opening) => opening.roomId === room.id), 8).items.map(openingRow);
  const described = scene.furniture
    .filter((item) => item.roomId === room.id)
    .flatMap((item) => {
      const cat = productFor(item, catalog);
      return cat ? [itemLine(item, cat)] : [];
    });
  const itemRows = truncateList(described, 12);
  const result = {
    room: {
      id: room.id,
      name: room.name,
      type: room.type,
      size_cm: roomSize(room),
      area_m2: m2(roomArea(room)),
      floor: room.floor,
      wall_color: room.wallColor ?? "plaster",
    },
    walls: roomWalls,
    openings: roomOpenings,
    items: itemRows.items,
    more: itemRows.more,
    conflicts: conflictsCount,
  };
  // Reserve 140 characters for {ok:true} plus the contracted ≤120-char hint.
  while (JSON.stringify(result).length > 1_360 && result.items.length > 0) {
    result.items.pop();
    result.more += 1;
  }
  return result;
}

function selectedItem(scene: Scene, catalog: CatalogSource, itemId: string | undefined): {
  id: string;
  name: string;
  room: string;
  pos: [number, number];
  rotation: Furniture["rotation"];
  dims: string;
  catalog_dims?: string;
} | null {
  const item = scene.furniture.find((candidate) => candidate.id === itemId);
  if (!item) return null;
  const cat = productFor(item, catalog);
  if (!cat) return null;
  const original = item.dims ? productFor({ catalogId: item.catalogId }, catalog) : undefined;
  return {
    id: item.id, name: cat.name, room: item.roomId, pos: posArr(item.pos), rotation: item.rotation, dims: dimsStr(cat.dims),
    ...(original ? { catalog_dims: dimsStr(original.dims) } : {}),
  };
}

/** Builds the fixed-size get_selection data payload. */
export function selectionPayload(scene: Scene, catalog: CatalogSource): {
  selected_item: ReturnType<typeof selectedItem>;
  hovered_item: ReturnType<typeof selectedItem>;
  last_moved: { id: string; by: NonNullable<Scene["meta"]["selection"]["lastMovedBy"]>; ago_s: number } | null;
  selected_room: string;
  camera: { view: Scene["meta"]["view"]; focus: string };
} {
  const selection = scene.meta.selection;
  const lastMoved = selection.lastMovedItemId && selection.lastMovedBy
    ? { id: selection.lastMovedItemId, by: selection.lastMovedBy, ago_s: 0 }
    : null;
  const selectedRoom = selection.roomId ?? scene.meta.activeRoomId;
  return {
    selected_item: selectedItem(scene, catalog, selection.itemId),
    hovered_item: selectedItem(scene, catalog, selection.hoverItemId),
    last_moved: lastMoved,
    selected_room: selectedRoom,
    camera: { view: scene.meta.view, focus: selectedRoom },
  };
}

/** Builds the compact get_cart data payload. */
export function cartPayload(cart: CartDescription, budgetUsd?: number): {
  lines: Array<{ product: string; name: string; colorway: string; qty: number; unit_usd: number; line_usd: number; item?: string }>;
  count: number;
  subtotal_usd: number;
  budget_usd?: number;
  remaining_usd?: number;
  checkout_available: boolean;
  more?: number;
} {
  const lines = truncateList(cart.lines, 10);
  const lineRows = lines.items.map((line) => ({
      product: line.handle,
      name: line.title,
      colorway: line.colorway,
      qty: line.quantity,
      unit_usd: usd(line.unitUsd),
      line_usd: usd(line.lineUsd),
      ...(line.itemId ? { item: line.itemId } : {}),
    }));
  let more = lines.more;
  const result = {
    lines: lineRows,
    count: cart.lines.reduce((total, line) => total + line.quantity, 0),
    subtotal_usd: usd(cart.subtotalUsd),
    ...(budgetUsd === undefined ? {} : { budget_usd: usd(budgetUsd), remaining_usd: usd(budgetUsd - cart.subtotalUsd) }),
    checkout_available: cart.lines.length > 0,
  };
  while (JSON.stringify({ ...result, ...(more > 0 ? { more } : {}) }).length > 1_360 && result.lines.length > 0) {
    result.lines.pop();
    more += 1;
  }
  return { ...result, ...(more > 0 ? { more } : {}) };
}

/** Keeps the first max rows and reports how many were omitted. */
export function truncateList<T>(list: readonly T[], max: number): { items: T[]; more: number } {
  const count = Math.max(0, Math.floor(max));
  return { items: list.slice(0, count), more: Math.max(0, list.length - count) };
}

/** Clips a string to max UTF-16 characters, including a single ellipsis. */
export function clip(str: string, max: number): string {
  const limit = Math.max(0, Math.floor(max));
  if (str.length <= limit) return str;
  if (limit === 0) return "";
  let prefix = "";
  for (const character of str) {
    if (prefix.length + character.length + 1 > limit) break;
    prefix += character;
  }
  return `${prefix}…`;
}

/** Rounds a monetary value to integer USD. */
export function usd(n: number): number {
  return Math.round(n);
}

/** Converts square centimetres to square metres, rounded to one decimal. */
export function m2(cm2: number): number {
  return Math.round((cm2 / 10_000) * 10) / 10;
}

/** Tests the hard WebMCP serialized-result budget. */
export function fitsBudget(payload: unknown): boolean {
  try {
    const serialized = JSON.stringify(payload);
    return serialized !== undefined && serialized.length <= 1_500;
  } catch {
    return false;
  }
}

function visitRecords(value: unknown, visit: (record: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) visitRecords(item, visit);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) visitRecords(child, visit);
}

function dropKey(payload: unknown, key: string): void {
  visitRecords(payload, (record) => { delete record[key]; });
}

function limitArrays(value: unknown, max: number): void {
  if (Array.isArray(value)) {
    if (value.length > max) value.length = max;
    for (const child of value) limitArrays(child, max);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  for (const child of Object.values(value as Record<string, unknown>)) limitArrays(child, max);
}

function limitStrings(value: unknown, max: number): void {
  visitRecords(value, (record) => {
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && child.length > max) record[key] = clip(child, max);
    }
  });
}

/** Mutates a payload through ordered shrink steps and conservative fallbacks until it fits. */
export function shrinkToBudget<T>(payload: T, steps: Array<() => void>): T {
  if (fitsBudget(payload)) return payload;
  for (const step of steps) {
    step();
    if (fitsBudget(payload)) return payload;
  }
  dropKey(payload, "description");
  if (fitsBudget(payload)) return payload;
  for (const max of [8, 6, 4]) {
    limitArrays(payload, max);
    if (fitsBudget(payload)) return payload;
  }
  dropKey(payload, "hint");
  if (fitsBudget(payload)) return payload;
  for (const max of [200, 120, 80, 40, 16, 8, 1, 0]) {
    limitStrings(payload, max);
    if (fitsBudget(payload)) return payload;
  }
  return payload;
}
