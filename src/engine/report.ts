/**
 * Deterministic room-aware design heuristics. Balance distributes footprint mass across four
 * quadrants with a ±15 percentage-point tolerance; traffic keeps the existing conflict penalty.
 * Living/studio measure seat-to-focus direction, conversation pairs, task light and storage,
 * weighted 15/20/20/15/10/20 (balance/focal/conversation/lighting/storage/traffic).
 * Kitchen/dining use the table as focal anchor, chairs within 60 cm facing it, table light and
 * optional storage (7 when absent), weighted 10/25/25/15/5/20.
 * Bedrooms use a centred wall-backed headboard, calm (free floor plus 45 cm bed-side access),
 * head-end/window light and wardrobe plus shelf, weighted 10/25/20/15/15/15.
 * Offices use a window-facing desk, focus (desk clear of traffic), task light and shelf storage,
 * weighted 10/25/20/15/15/15. Bath and hall remain unscored utility spaces.
 */
import type { CatalogSource } from "./describe";
import { clip } from "./describe";
import { openingSegment } from "./doors";
import { distancePointSegment, footprint, polyBBox, roomArea, roomAreaM2, walls } from "./geometry";
import type { CatalogItem, Conflict, Furniture, Room, Scene, Vec2, Wall } from "./types";
/** The six integer scores in a Hearth design critique. */
export interface DesignScores { balance: number; focal_point: number; conversation: number; lighting: number; storage: number; traffic: number }
/** Compact design-report payload consumed by get_design_report. */
export interface DesignReport { score: number; scores: DesignScores; summary: string; suggestions: string[] }
type Profile = "living" | "dining" | "bedroom" | "office";
type ResolvedItem = { item: Furniture; cat: CatalogItem };
const profileWeights: Record<Profile, Record<keyof DesignScores, number>> = {
  living: { balance: 15, focal_point: 20, conversation: 20, lighting: 15, storage: 10, traffic: 20 },
  dining: { balance: 10, focal_point: 25, conversation: 25, lighting: 15, storage: 5, traffic: 20 },
  bedroom: { balance: 10, focal_point: 25, conversation: 20, lighting: 15, storage: 15, traffic: 15 },
  office: { balance: 10, focal_point: 25, conversation: 20, lighting: 15, storage: 15, traffic: 15 },
};
function profileFor(room: Room): Profile {
  if (room.type === "kitchen" || room.type === "dining") return "dining";
  return room.type === "bedroom" || room.type === "office" ? room.type : "living";
}
function catalogItem(catalog: CatalogSource, id: string): CatalogItem | undefined {
  return Array.isArray(catalog) ? catalog.find((item) => item.id === id) : catalog.byId(id);
}
function score(value: number): number { return Math.max(0, Math.min(10, Math.round(value))); }
function safeSummary(value: string): string { return clip(value.replaceAll("!", ""), 200); }
function roomItems(scene: Scene, roomId: string): Furniture[] {
  return scene.furniture.filter((item) => item.roomId === roomId && item.status !== "ghost");
}
function resolvedItems(scene: Scene, room: Room, catalog: CatalogSource): ResolvedItem[] {
  return roomItems(scene, room.id).flatMap((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    return cat ? [{ item, cat }] : [];
  });
}
function furnitureMass(cat: CatalogItem): number {
  return ["rug", "floor-lamp", "table-lamp", "plant", "decor"].includes(cat.category) ? 0 : cat.dims.w * cat.dims.d;
}
function primary(items: ResolvedItem[], category: CatalogItem["category"]): ResolvedItem | undefined {
  return items.filter((entry) => entry.cat.category === category)
    .sort((a, b) => furnitureMass(b.cat) - furnitureMass(a.cat) || a.item.id.localeCompare(b.item.id))[0];
}
function balanceScore(scene: Scene, room: Room, catalog: CatalogSource): number {
  const box = polyBBox(room.poly);
  const midX = (box.minX + box.maxX) / 2;
  const midY = (box.minY + box.maxY) / 2;
  const quadrants = [0, 0, 0, 0];
  for (const entry of resolvedItems(scene, room, catalog).filter(({ cat }) => furnitureMass(cat) > 0)) {
    const itemBox = polyBBox(footprint(entry.item, entry.cat));
    const xs: Array<[number, number]> = [[box.minX, midX], [midX, box.maxX]];
    const ys: Array<[number, number]> = [[box.minY, midY], [midY, box.maxY]];
    for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
      const xSpan = xs[x] as [number, number];
      const ySpan = ys[y] as [number, number];
      const area = Math.max(0, Math.min(itemBox.maxX, xSpan[1]) - Math.max(itemBox.minX, xSpan[0]))
        * Math.max(0, Math.min(itemBox.maxY, ySpan[1]) - Math.max(itemBox.minY, ySpan[0]));
      const index = x + y * 2;
      quadrants[index] = (quadrants[index] ?? 0) + area;
    }
  }
  const total = quadrants.reduce((sum, mass) => sum + mass, 0);
  if (total === 0) return 0;
  const excess = quadrants.reduce((sum, mass) => sum + Math.max(0, Math.abs(mass / total - 0.25) - 0.15), 0);
  return score(10 * (1 - excess / 0.9));
}
function frontVector(item: Furniture): Vec2 {
  switch (item.rotation) {
    case 0: return { x: 0, y: 1 };
    case 90: return { x: -1, y: 0 };
    case 180: return { x: 0, y: -1 };
    case 270: return { x: 1, y: 0 };
  }
}
function angleTo(item: Furniture, target: Vec2): number {
  const dx = target.x - item.pos.x;
  const dy = target.y - item.pos.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return 0;
  const front = frontVector(item);
  const cosine = Math.max(-1, Math.min(1, (front.x * dx + front.y * dy) / length));
  return Math.acos(cosine) * 180 / Math.PI;
}
function windowSegments(scene: Scene, room: Room): Array<{ id: string; a: Vec2; b: Vec2; wall: Wall }> {
  return scene.openings.filter((opening) => opening.roomId === room.id && opening.kind === "window").map((opening) => {
    const segment = openingSegment(opening, room);
    return { id: opening.id, ...segment };
  });
}
function livingFocusPoints(scene: Scene, room: Room, catalog: CatalogSource): Vec2[] {
  const media = resolvedItems(scene, room, catalog).filter(({ cat }) => cat.category === "tv-unit"
    || cat.name.toLowerCase().includes("fireplace")).map(({ item }) => ({ ...item.pos }));
  const windowPoints = windowSegments(scene, room).map(({ a, b }) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }));
  return [...media, ...windowPoints];
}
function seating(scene: Scene, room: Room, catalog: CatalogSource): ResolvedItem[] {
  return resolvedItems(scene, room, catalog).filter(({ cat }) => ["sofa", "armchair", "chair"].includes(cat.category));
}
function headEdge(item: Furniture, cat: CatalogItem): [Vec2, Vec2] {
  const { w, d } = cat.dims;
  switch (item.rotation) {
    case 0: return [{ x: item.pos.x - w / 2, y: item.pos.y - d / 2 }, { x: item.pos.x + w / 2, y: item.pos.y - d / 2 }];
    case 90: return [{ x: item.pos.x + d / 2, y: item.pos.y - w / 2 }, { x: item.pos.x + d / 2, y: item.pos.y + w / 2 }];
    case 180: return [{ x: item.pos.x + w / 2, y: item.pos.y + d / 2 }, { x: item.pos.x - w / 2, y: item.pos.y + d / 2 }];
    case 270: return [{ x: item.pos.x - d / 2, y: item.pos.y + w / 2 }, { x: item.pos.x - d / 2, y: item.pos.y - w / 2 }];
  }
}
function livingFocal(scene: Scene, room: Room, catalog: CatalogSource): number {
  const main = seating(scene, room, catalog).sort((a, b) => (b.cat.seatCount ?? 1) - (a.cat.seatCount ?? 1)
    || furnitureMass(b.cat) - furnitureMass(a.cat) || a.item.id.localeCompare(b.item.id))[0];
  const points = livingFocusPoints(scene, room, catalog);
  if (!main) return 0;
  if (points.length === 0) return 2;
  const angle = Math.min(...points.map((point) => angleTo(main.item, point)));
  if (angle <= 15) return 10;
  if (angle <= 30) return 8;
  if (angle <= 45) return 6;
  if (angle <= 90) return 3;
  return 1;
}
function diningFocal(scene: Scene, room: Room, catalog: CatalogSource): number {
  const table = primary(resolvedItems(scene, room, catalog), "table");
  if (!table) return 0;
  const box = polyBBox(room.poly);
  const centre = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  if (Math.hypot(table.item.pos.x - centre.x, table.item.pos.y - centre.y) <= Math.min(box.w, box.d) * 0.2) return 10;
  const aligned = windowSegments(scene, room).some(({ a, b }) => Math.abs(a.y - b.y) < 0.01
    ? Math.abs(table.item.pos.x - (a.x + b.x) / 2) <= 60
    : Math.abs(table.item.pos.y - (a.y + b.y) / 2) <= 60);
  return aligned ? 9 : 4;
}
function bedroomFocal(scene: Scene, room: Room, catalog: CatalogSource): number {
  const bed = primary(resolvedItems(scene, room, catalog), "bed");
  if (!bed) return 0;
  const edge = headEdge(bed.item, bed.cat);
  const nearest = walls(room).map((wall) => ({ wall, gap: Math.max(
    distancePointSegment(edge[0], wall.a, wall.b), distancePointSegment(edge[1], wall.a, wall.b),
  ) })).sort((a, b) => a.gap - b.gap || a.wall.id.localeCompare(b.wall.id))[0];
  if (!nearest || nearest.gap > 10) return 4;
  const head = { x: (edge[0].x + edge[1].x) / 2, y: (edge[0].y + edge[1].y) / 2 };
  const wallCentre = { x: (nearest.wall.a.x + nearest.wall.b.x) / 2, y: (nearest.wall.a.y + nearest.wall.b.y) / 2 };
  return Math.hypot(head.x - wallCentre.x, head.y - wallCentre.y) <= Math.max(30, nearest.wall.length * 0.1) ? 10 : 8;
}
function officeFocal(scene: Scene, room: Room, catalog: CatalogSource): number {
  const desk = primary(resolvedItems(scene, room, catalog), "desk");
  if (!desk) return 0;
  const roomWindows = windowSegments(scene, room);
  if (roomWindows.length === 0) return 2;
  const deskBox = polyBBox(footprint(desk.item, desk.cat));
  const under = roomWindows.some(({ a, b }) => segmentBoxDistance(a, b, deskBox) <= 15);
  const facing = roomWindows.some(({ a, b }) => angleTo(desk.item, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }) <= 30);
  return under || facing ? 10 : 4;
}
function focalPointScore(scene: Scene, room: Room, catalog: CatalogSource, profile: Profile): number {
  if (profile === "dining") return diningFocal(scene, room, catalog);
  if (profile === "bedroom") return bedroomFocal(scene, room, catalog);
  if (profile === "office") return officeFocal(scene, room, catalog);
  return livingFocal(scene, room, catalog);
}
function footprintGap(a: ResolvedItem, b: ResolvedItem): number {
  const left = polyBBox(footprint(a.item, a.cat));
  const right = polyBBox(footprint(b.item, b.cat));
  const dx = Math.max(0, right.minX - left.maxX, left.minX - right.maxX);
  const dy = Math.max(0, right.minY - left.maxY, left.minY - right.maxY);
  return Math.hypot(dx, dy);
}
function livingConversation(scene: Scene, room: Room, catalog: CatalogSource): number {
  const seats = seating(scene, room, catalog);
  if (seats.length < 2) return 0;
  let pairs = 0;
  let useful = 0;
  for (let left = 0; left < seats.length; left += 1) {
    for (let right = left + 1; right < seats.length; right += 1) {
      const a = seats[left];
      const b = seats[right];
      if (!a || !b) continue;
      pairs += 1;
      const close = footprintGap(a, b) <= 250;
      const facing = angleTo(a.item, b.item.pos) <= 90 && angleTo(b.item, a.item.pos) <= 90;
      if (close && facing) useful += 1;
    }
  }
  return score(10 * useful / Math.max(1, pairs));
}
function diningConversation(scene: Scene, room: Room, catalog: CatalogSource): number {
  const items = resolvedItems(scene, room, catalog);
  const table = primary(items, "table");
  if (!table) return 0;
  const useful = items.filter(({ cat }) => cat.category === "chair")
    .filter((chair) => footprintGap(chair, table) <= 60 && angleTo(chair.item, table.item.pos) <= 45).length;
  return useful >= 2 ? 10 : useful * 5;
}
function sideClearances(bed: ResolvedItem, items: ResolvedItem[], room: Room): [number, number] {
  const bedBox = polyBBox(footprint(bed.item, bed.cat));
  const roomBox = polyBBox(room.poly);
  const obstacles = items.filter((entry) => entry.item.id !== bed.item.id && furnitureMass(entry.cat) > 0)
    .map((entry) => polyBBox(footprint(entry.item, entry.cat)));
  if (bed.item.rotation === 0 || bed.item.rotation === 180) {
    const relevant = obstacles.filter((box) => box.maxY > bedBox.minY && box.minY < bedBox.maxY);
    const west = relevant.filter((box) => box.minX < bedBox.minX).reduce((gap, box) => Math.min(gap, Math.max(0, bedBox.minX - box.maxX)), bedBox.minX - roomBox.minX);
    const east = relevant.filter((box) => box.maxX > bedBox.maxX).reduce((gap, box) => Math.min(gap, Math.max(0, box.minX - bedBox.maxX)), roomBox.maxX - bedBox.maxX);
    return [west, east];
  }
  const relevant = obstacles.filter((box) => box.maxX > bedBox.minX && box.minX < bedBox.maxX);
  const north = relevant.filter((box) => box.minY < bedBox.minY).reduce((gap, box) => Math.min(gap, Math.max(0, bedBox.minY - box.maxY)), bedBox.minY - roomBox.minY);
  const south = relevant.filter((box) => box.maxY > bedBox.maxY).reduce((gap, box) => Math.min(gap, Math.max(0, box.minY - bedBox.maxY)), roomBox.maxY - bedBox.maxY);
  return [north, south];
}
function bedroomCalm(scene: Scene, room: Room, catalog: CatalogSource): number {
  const items = resolvedItems(scene, room, catalog);
  const bed = primary(items, "bed");
  if (!bed) return 0;
  const occupied = items.reduce((sum, entry) => sum + furnitureMass(entry.cat), 0);
  const freeRatio = Math.max(0, 1 - occupied / roomArea(room));
  const freeComponent = Math.min(1, freeRatio / 0.5);
  const reachableSides = sideClearances(bed, items, room).filter((gap) => gap >= 45).length;
  return score(10 * (freeComponent * 0.45 + reachableSides / 2 * 0.55));
}
function officeFocus(scene: Scene, room: Room, catalog: CatalogSource, conflicts: Conflict[]): number {
  const desk = primary(resolvedItems(scene, room, catalog), "desk");
  if (!desk) return 0;
  const relevant = conflicts.filter((conflict) => conflict.roomId === room.id
    && (conflict.kind === "traffic" || conflict.kind === "access_path") && conflict.items.includes(desk.item.id));
  return score(10 - relevant.reduce((sum, conflict) => sum + (conflict.severity === "error" ? 4 : 2), 0));
}
function conversationScore(scene: Scene, room: Room, catalog: CatalogSource, conflicts: Conflict[], profile: Profile): number {
  if (profile === "dining") return diningConversation(scene, room, catalog);
  if (profile === "bedroom") return bedroomCalm(scene, room, catalog);
  if (profile === "office") return officeFocus(scene, room, catalog, conflicts);
  return livingConversation(scene, room, catalog);
}
function pointBoxDistance(point: Vec2, box: ReturnType<typeof polyBBox>): number {
  const dx = Math.max(box.minX - point.x, 0, point.x - box.maxX);
  const dy = Math.max(box.minY - point.y, 0, point.y - box.maxY);
  return Math.hypot(dx, dy);
}
function segmentBoxDistance(a: Vec2, b: Vec2, box: ReturnType<typeof polyBBox>): number {
  if (a.y === b.y) {
    const dx = Math.max(box.minX - Math.max(a.x, b.x), 0, Math.min(a.x, b.x) - box.maxX);
    const dy = Math.max(box.minY - a.y, 0, a.y - box.maxY);
    return Math.hypot(dx, dy);
  }
  const dx = Math.max(box.minX - a.x, 0, a.x - box.maxX);
  const dy = Math.max(box.minY - Math.max(a.y, b.y), 0, Math.min(a.y, b.y) - box.maxY);
  return Math.hypot(dx, dy);
}
function lamps(items: ResolvedItem[]): ResolvedItem[] {
  return items.filter(({ cat }) => cat.category === "floor-lamp" || cat.category === "table-lamp");
}
function livingLighting(scene: Scene, room: Room, catalog: CatalogSource): { score: number; uncovered?: Furniture } {
  const items = resolvedItems(scene, room, catalog);
  const targets = items.filter(({ cat }) => ["sofa", "armchair", "chair", "bed", "desk"].includes(cat.category));
  if (targets.length === 0) return { score: 0 };
  const lightItems = lamps(items);
  const roomWindows = windowSegments(scene, room);
  let general = 0;
  let evening = 0;
  let uncovered: Furniture | undefined;
  for (const target of targets) {
    const box = polyBBox(footprint(target.item, target.cat));
    const lampLit = lightItems.some(({ item }) => pointBoxDistance(item.pos, box) <= 150);
    const daylight = roomWindows.some(({ a, b }) => segmentBoxDistance(a, b, box) <= 150);
    if (lampLit || daylight) general += 1;
    else uncovered ??= target.item;
    if (lampLit) evening += 1;
  }
  return { score: score(10 * (0.7 * general / targets.length + 0.3 * evening / targets.length)), ...(uncovered ? { uncovered } : {}) };
}
function lightingScore(scene: Scene, room: Room, catalog: CatalogSource, profile: Profile): { score: number; uncovered?: Furniture } {
  if (profile === "living" || profile === "office") return livingLighting(scene, room, catalog);
  const items = resolvedItems(scene, room, catalog);
  const anchor = primary(items, profile === "dining" ? "table" : "bed");
  if (!anchor) return { score: 0 };
  if (profile === "dining") {
    const box = polyBBox(footprint(anchor.item, anchor.cat));
    const lit = windowSegments(scene, room).some(({ a, b }) => segmentBoxDistance(a, b, box) <= 250)
      || lamps(items).some(({ item }) => pointBoxDistance(item.pos, box) <= 150);
    return { score: lit ? 10 : 2, ...(lit ? {} : { uncovered: anchor.item }) };
  }
  const edge = headEdge(anchor.item, anchor.cat);
  const lit = windowSegments(scene, room).length > 0
    || lamps(items).some(({ item }) => distancePointSegment(item.pos, edge[0], edge[1]) <= 100);
  return { score: lit ? 10 : 2, ...(lit ? {} : { uncovered: anchor.item }) };
}
function storageScore(scene: Scene, room: Room, catalog: CatalogSource, profile: Profile): number {
  const items = resolvedItems(scene, room, catalog);
  const has = (category: CatalogItem["category"]): boolean => items.some(({ cat }) => cat.category === category);
  if (profile === "dining") return has("shelf") || has("tv-unit") ? 10 : 7;
  if (profile === "bedroom") return has("wardrobe") ? (has("shelf") ? 10 : 8) : has("shelf") ? 4 : 0;
  if (profile === "office") return has("shelf") ? 10 : 0;
  const count = items.filter(({ cat }) => ["shelf", "tv-unit", "wardrobe"].includes(cat.category)).length;
  return score(10 * count / Math.max(1, Math.ceil(roomAreaM2(room) / 15)));
}
function trafficScore(conflicts: Conflict[], roomId: string): number {
  const relevant = conflicts.filter((conflict) => conflict.roomId === roomId
    && (conflict.kind === "traffic" || conflict.kind === "access_path" || conflict.kind === "door_swing"));
  return score(10 - relevant.reduce((total, conflict) => total + (conflict.severity === "error" ? 3 : 2), 0));
}
function anchorSuggestion(profile: Profile): string {
  if (profile === "dining") return "Centre a dining table within 60 cm of the room midpoint, then gather chairs around it.";
  if (profile === "bedroom") return "Start with a bed headboard within 10 cm of a wall, centred with 45 cm clear on both sides.";
  if (profile === "office") return "Set a desk within 15 cm of a window wall or turn it directly toward the window.";
  return "Start with a sofa against a clear wall, keeping a 60 cm route between openings.";
}
function suggestionFor(key: keyof DesignScores, scene: Scene, room: Room, catalog: CatalogSource, conflicts: Conflict[], uncovered: Furniture | undefined, profile: Profile): string {
  const items = resolvedItems(scene, room, catalog);
  if (key === "traffic") {
    const conflict = conflicts.find((entry) => entry.roomId === room.id
      && (entry.kind === "traffic" || entry.kind === "access_path" || entry.kind === "door_swing"));
    return conflict ? `Clear the route: ${conflict.fix}.` : "Keep a 60 cm clear route between the room's openings.";
  }
  if (key === "lighting") {
    const anchor = uncovered ?? primary(items, profile === "dining" ? "table" : profile === "bedroom" ? "bed" : profile === "office" ? "desk" : "sofa")?.item;
    const distance = profile === "bedroom" ? 100 : 150;
    return anchor ? `Add a warm lamp within ${distance} cm of ${anchor.id} for a softer evening layer.`
      : "Add a warm floor lamp, keeping it within 150 cm of the room's main activity.";
  }
  if (key === "storage") {
    const kind = profile === "bedroom" ? "wardrobe" : "shelf";
    return `Add a ${kind} on a clear wall in ${room.id}, keeping 70 cm open in front.`;
  }
  if (key === "conversation") {
    if (profile === "dining") {
      const table = primary(items, "table");
      return table ? `Turn at least two chairs toward ${table.item.id}, each within 60 cm of its edge.` : anchorSuggestion(profile);
    }
    if (profile === "bedroom") {
      const bed = primary(items, "bed");
      return bed ? `Keep 45 cm clear on both sides of ${bed.item.id} so the room feels calm.` : anchorSuggestion(profile);
    }
    if (profile === "office") {
      const desk = primary(items, "desk");
      const conflict = desk && conflicts.find((entry) => entry.items.includes(desk.item.id)
        && (entry.kind === "traffic" || entry.kind === "access_path"));
      return conflict ? `Settle the focus zone: ${conflict.fix}.` : `Keep a 60 cm traffic lane clear around ${desk?.item.id ?? room.id}.`;
    }
    const seat = seating(scene, room, catalog)[0];
    return seat ? `Place another seat within 250 cm of ${seat.item.id}, with the two seats turned toward each other.`
      : "Start with two seats within 250 cm, turned toward each other.";
  }
  if (key === "focal_point") {
    if (profile === "dining") {
      const table = primary(items, "table");
      const window = windowSegments(scene, room)[0];
      return table ? `Move ${table.item.id} within 60 cm of room centre${window ? ` or align it with ${window.id}` : ""}.`
        : anchorSuggestion(profile);
    }
    if (profile === "bedroom") {
      const bed = primary(items, "bed");
      return bed ? `Set ${bed.item.id}'s headboard within 10 cm of a wall and centre it along that wall.` : anchorSuggestion(profile);
    }
    if (profile === "office") {
      const desk = primary(items, "desk");
      const window = windowSegments(scene, room)[0];
      return desk && window ? `Turn ${desk.item.id} toward ${window.id}, or set it within 15 cm below the window.`
        : anchorSuggestion(profile);
    }
    const seat = seating(scene, room, catalog)[0];
    const focus = items.find(({ cat }) => cat.category === "tv-unit");
    if (seat && focus) return `Turn ${seat.item.id} toward ${focus.item.id}, within 15° of the focal line.`;
    return seat ? `Turn ${seat.item.id} within 15° of a window or media focus.` : anchorSuggestion(profile);
  }
  const first = items.find(({ cat }) => furnitureMass(cat) > 0);
  return first ? `Shift ${first.item.id} 40 cm toward the lighter half of the room to balance its visual mass.`
    : "Spread the first large pieces across the room while preserving a 60 cm route.";
}
function labels(room: Room): Record<keyof DesignScores, string> {
  const dining = room.type === "kitchen" || room.type === "dining";
  return {
    balance: "balance",
    focal_point: room.type === "bedroom" ? "bed placement" : room.type === "office" ? "desk placement" : dining ? "table placement" : "focal direction",
    conversation: room.type === "bedroom" ? "calm" : room.type === "office" ? "focus" : dining ? "table seating" : "conversation seating",
    lighting: "lighting",
    storage: "storage",
    traffic: "traffic flow",
  };
}
function summary(room: Room, total: number, scores: DesignScores, hasItems: boolean): string {
  if (!hasItems) {
    if (room.type === "bedroom") return safeSummary(`${room.name} is ready for its anchor. A bed will begin the layout; calm starts with 45 cm clear on both sides.`);
    return safeSummary(`${room.name} is ready for its anchor piece; start there, then let warm light and clear routes shape the room.`);
  }
  const names = labels(room);
  const ordered = (Object.keys(scores) as Array<keyof DesignScores>)
    .filter((key) => !(profileFor(room) === "dining" && key === "storage" && scores.storage === 7))
    .sort((a, b) => scores[a] - scores[b] || a.localeCompare(b));
  const tone = total >= 80 ? "feels settled and practical" : total >= 65 ? "has a sound foundation" : "is ready for a clearer plan";
  if (room.type === "bedroom") return safeSummary(`${room.name} ${tone}. Calm is ${scores.conversation}/10; ${names[ordered[0] as keyof DesignScores]} needs the most care.`);
  if (room.type === "office") return safeSummary(`${room.name} ${tone}. Focus is ${scores.conversation}/10; ${names[ordered[0] as keyof DesignScores]} needs the most care.`);
  const strongest = [...ordered].sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))[0] as keyof DesignScores;
  const strength = names[strongest];
  return safeSummary(`${room.name} ${tone}. ${strength[0]?.toUpperCase()}${strength.slice(1)} works best; ${names[ordered[0] as keyof DesignScores]} needs the most care.`);
}
/** Produces a deterministic, room-aware six-part design critique. */
export function designReport(scene: Scene, roomId: string, catalog: CatalogSource, conflicts: Conflict[]): DesignReport {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return { score: 0, scores: { balance: 0, focal_point: 0, conversation: 0, lighting: 0, storage: 0, traffic: 0 }, summary: "The room was not found, so there is nothing to critique.", suggestions: [] };
  if (room.type === "bath" || room.type === "hall") {
    return { score: 100, scores: { balance: 10, focal_point: 10, conversation: 10, lighting: 10, storage: 10, traffic: 10 }, summary: safeSummary(`${room.name} is a utility or circulation space, so there is nothing to critique.`), suggestions: [] };
  }
  const profile = profileFor(room);
  const weights = profileWeights[profile];
  const lighting = lightingScore(scene, room, catalog, profile);
  const scores: DesignScores = {
    balance: balanceScore(scene, room, catalog),
    focal_point: focalPointScore(scene, room, catalog, profile),
    conversation: conversationScore(scene, room, catalog, conflicts, profile),
    lighting: lighting.score,
    storage: storageScore(scene, room, catalog, profile),
    traffic: trafficScore(conflicts, room.id),
  };
  const total = Math.max(0, Math.min(100, Math.round(
    Object.entries(scores).reduce((sum, [key, value]) => sum + value * weights[key as keyof DesignScores], 0) / 10,
  )));
  const ordered = (Object.keys(scores) as Array<keyof DesignScores>)
    .sort((a, b) => (10 - scores[b]) * weights[b] - (10 - scores[a]) * weights[a] || a.localeCompare(b));
  const items = resolvedItems(scene, room, catalog);
  const anchorCategory: CatalogItem["category"] = profile === "dining" ? "table" : profile === "bedroom" ? "bed" : profile === "office" ? "desk" : "sofa";
  const hasAnchor = primary(items, anchorCategory) !== undefined;
  const suggestions = hasAnchor ? [] : [anchorSuggestion(profile)];
  for (const key of ordered) {
    if (suggestions.length >= 3) break;
    if (scores[key] >= 8 || (!hasAnchor && (key === "focal_point" || key === "conversation" || key === "balance"))) continue;
    if (profile === "dining" && key === "storage" && scores.storage === 7) continue;
    suggestions.push(clip(suggestionFor(key, scene, room, catalog, conflicts, lighting.uncovered, profile), 120));
  }
  return { score: total, scores, summary: summary(room, total, scores, roomItems(scene, room.id).length > 0), suggestions };
}
