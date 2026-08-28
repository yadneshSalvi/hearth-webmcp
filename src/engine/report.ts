import type { CatalogSource } from "./describe";
import { clip } from "./describe";
import { openingSegment } from "./doors";
import { footprint, itemToWallDistance, polyBBox, roomAreaM2, walls } from "./geometry";
import type { CatalogItem, Conflict, Furniture, Room, Scene, Vec2 } from "./types";

/** The six integer scores in a Hearth design critique. */
export interface DesignScores {
  balance: number;
  focal_point: number;
  conversation: number;
  lighting: number;
  storage: number;
  traffic: number;
}

/** Compact design-report payload consumed by get_design_report. */
export interface DesignReport {
  score: number;
  scores: DesignScores;
  summary: string;
  suggestions: string[];
}

const weights: Record<keyof DesignScores, number> = {
  balance: 15,
  focal_point: 20,
  conversation: 20,
  lighting: 15,
  storage: 10,
  traffic: 20,
};

const labels: Record<keyof DesignScores, string> = {
  balance: "balance",
  focal_point: "focal direction",
  conversation: "conversation seating",
  lighting: "lighting",
  storage: "storage",
  traffic: "traffic flow",
};

function catalogItem(catalog: CatalogSource, id: string): CatalogItem | undefined {
  return Array.isArray(catalog) ? catalog.find((item) => item.id === id) : catalog.byId(id);
}

function score(value: number): number {
  return Math.max(0, Math.min(10, Math.round(value)));
}

function safeSummary(value: string): string {
  return clip(value.replaceAll("!", ""), 200);
}

function roomItems(scene: Scene, roomId: string): Furniture[] {
  return scene.furniture.filter((item) => item.roomId === roomId && item.status !== "ghost");
}

function furnitureMass(cat: CatalogItem): number {
  if (["rug", "floor-lamp", "table-lamp", "plant", "decor"].includes(cat.category)) return 0;
  return cat.dims.w * cat.dims.d;
}

function balanceScore(scene: Scene, room: Room, catalog: CatalogSource): number {
  const box = polyBBox(room.poly);
  const center = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const quadrants = [0, 0, 0, 0];
  const massItems = roomItems(scene, room.id).flatMap((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    return cat && furnitureMass(cat) > 0 ? [{ item, cat, mass: furnitureMass(cat) }] : [];
  });
  const total = massItems.reduce((sum, entry) => sum + entry.mass, 0);
  if (total === 0) return 0;
  for (const entry of massItems) {
    const east = entry.item.pos.x >= center.x ? 1 : 0;
    const south = entry.item.pos.y >= center.y ? 2 : 0;
    quadrants[east + south] = (quadrants[east + south] as number) + entry.mass;
  }
  const deviation = quadrants.reduce((sum, mass) => sum + Math.abs(mass / total - 0.25), 0);
  const distribution = Math.max(0, 1 - deviation / 1.5);
  const wallPreferred = massItems.filter(({ cat }) => cat.againstWall);
  const againstWall = wallPreferred.length === 0 ? 1 : wallPreferred.filter(({ item, cat }) =>
    Math.min(...walls(room).map((wall) => itemToWallDistance(item, cat, wall))) <= 10).length / wallPreferred.length;
  return score(10 * (distribution * 0.75 + againstWall * 0.25));
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

function focusPoints(scene: Scene, room: Room, catalog: CatalogSource): Vec2[] {
  const items = roomItems(scene, room.id).flatMap((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    const focus = cat?.category === "tv-unit" || cat?.name.toLowerCase().includes("fireplace");
    return focus ? [{ ...item.pos }] : [];
  });
  const windows = scene.openings.filter((opening) => opening.roomId === room.id && opening.kind === "window").map((opening) => {
    const segment = openingSegment(opening, room);
    return { x: (segment.a.x + segment.b.x) / 2, y: (segment.a.y + segment.b.y) / 2 };
  });
  return [...items, ...windows];
}

function seating(scene: Scene, room: Room, catalog: CatalogSource): Array<{ item: Furniture; cat: CatalogItem }> {
  return roomItems(scene, room.id).flatMap((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    return cat && ["sofa", "armchair", "chair"].includes(cat.category) ? [{ item, cat }] : [];
  });
}

function focalPointScore(scene: Scene, room: Room, catalog: CatalogSource): number {
  const seats = seating(scene, room, catalog);
  if (seats.length === 0) {
    const hasBedOrDesk = roomItems(scene, room.id).some((item) => {
      const category = catalogItem(catalog, item.catalogId)?.category;
      return category === "bed" || category === "desk";
    });
    return hasBedOrDesk && (room.type === "bedroom" || room.type === "office") ? 10 : 0;
  }
  const main = [...seats].sort((a, b) => (b.cat.seatCount ?? 1) - (a.cat.seatCount ?? 1)
    || b.cat.dims.w * b.cat.dims.d - a.cat.dims.w * a.cat.dims.d || a.item.id.localeCompare(b.item.id))[0];
  const points = focusPoints(scene, room, catalog);
  if (!main || points.length === 0) return 2;
  const angle = Math.min(...points.map((point) => angleTo(main.item, point)));
  if (angle <= 15) return 10;
  if (angle <= 30) return 8;
  if (angle <= 45) return 6;
  if (angle <= 90) return 3;
  return 1;
}

function footprintGap(a: Furniture, catA: CatalogItem, b: Furniture, catB: CatalogItem): number {
  const left = polyBBox(footprint(a, catA));
  const right = polyBBox(footprint(b, catB));
  const dx = Math.max(0, right.minX - left.maxX, left.minX - right.maxX);
  const dy = Math.max(0, right.minY - left.maxY, left.minY - right.maxY);
  return Math.hypot(dx, dy);
}

function conversationScore(scene: Scene, room: Room, catalog: CatalogSource): number {
  const seats = seating(scene, room, catalog);
  if (seats.length < 2) {
    const hasPrimaryFunction = roomItems(scene, room.id).some((item) => {
      const category = catalogItem(catalog, item.catalogId)?.category;
      return category === "bed" || category === "desk";
    });
    return hasPrimaryFunction && (room.type === "bedroom" || room.type === "office") ? 10 : 0;
  }
  let pairs = 0;
  let useful = 0;
  for (let left = 0; left < seats.length; left += 1) {
    for (let right = left + 1; right < seats.length; right += 1) {
      const a = seats[left];
      const b = seats[right];
      if (!a || !b) continue;
      pairs += 1;
      const close = footprintGap(a.item, a.cat, b.item, b.cat) <= 250;
      const facing = angleTo(a.item, b.item.pos) <= 90 && angleTo(b.item, a.item.pos) <= 90;
      if (close && facing) useful += 1;
    }
  }
  return score(10 * useful / Math.max(1, pairs));
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

function lightingCoverage(scene: Scene, room: Room, catalog: CatalogSource): { score: number; uncovered?: Furniture } {
  const targets = roomItems(scene, room.id).flatMap((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    return cat && ["sofa", "armchair", "chair", "bed", "desk"].includes(cat.category) ? [{ item, cat }] : [];
  });
  if (targets.length === 0) return { score: 0 };
  const lamps = roomItems(scene, room.id).filter((item) => {
    const category = catalogItem(catalog, item.catalogId)?.category;
    return category === "floor-lamp" || category === "table-lamp";
  });
  const windows = scene.openings.filter((opening) => opening.roomId === room.id && opening.kind === "window")
    .map((opening) => openingSegment(opening, room));
  let general = 0;
  let evening = 0;
  let uncovered: Furniture | undefined;
  for (const target of targets) {
    const box = polyBBox(footprint(target.item, target.cat));
    const lampLit = lamps.some((lamp) => pointBoxDistance(lamp.pos, box) <= 150);
    const daylight = windows.some((window) => segmentBoxDistance(window.a, window.b, box) <= 150);
    if (lampLit || daylight) general += 1;
    else uncovered ??= target.item;
    if (lampLit) evening += 1;
  }
  return { score: score(10 * (0.7 * general / targets.length + 0.3 * evening / targets.length)), ...(uncovered ? { uncovered } : {}) };
}

function storageScore(scene: Scene, room: Room, catalog: CatalogSource): number {
  const categories = room.type === "bedroom" ? ["wardrobe"]
    : room.type === "living" || room.type === "studio" ? ["shelf", "tv-unit", "wardrobe"]
      : room.type === "office" ? ["shelf", "wardrobe"] : [];
  if (categories.length === 0) return room.type === "kitchen" || room.type === "dining" ? 6 : 5;
  const count = roomItems(scene, room.id).filter((item) => {
    const category = catalogItem(catalog, item.catalogId)?.category;
    return category ? categories.includes(category) : false;
  }).length;
  const needed = Math.max(1, Math.ceil(roomAreaM2(room) / 15));
  return score(10 * count / needed);
}

function trafficScore(conflicts: Conflict[], roomId: string): number {
  const relevant = conflicts.filter((conflict) => conflict.roomId === roomId
    && (conflict.kind === "traffic" || conflict.kind === "access_path" || conflict.kind === "door_swing"));
  return score(10 - relevant.reduce((total, conflict) => total + (conflict.severity === "error" ? 3 : 2), 0));
}

function itemNearFocus(scene: Scene, room: Room, catalog: CatalogSource): { seat?: Furniture; focus?: Furniture } {
  const seat = seating(scene, room, catalog).sort((a, b) => (b.cat.seatCount ?? 1) - (a.cat.seatCount ?? 1))[0]?.item;
  const focus = roomItems(scene, room.id).find((item) => catalogItem(catalog, item.catalogId)?.category === "tv-unit");
  return { ...(seat ? { seat } : {}), ...(focus ? { focus } : {}) };
}

function suggestionFor(key: keyof DesignScores, scene: Scene, room: Room, catalog: CatalogSource, conflicts: Conflict[], uncovered?: Furniture): string {
  const items = roomItems(scene, room.id);
  if (key === "traffic") {
    const conflict = conflicts.find((entry) => entry.roomId === room.id
      && (entry.kind === "traffic" || entry.kind === "access_path" || entry.kind === "door_swing"));
    return conflict ? `Clear the route: ${conflict.fix}.` : "Keep a 60 cm clear route between the room's openings.";
  }
  if (key === "lighting") {
    const target = uncovered ?? items.find((item) => {
      const category = catalogItem(catalog, item.catalogId)?.category;
      return category === "sofa" || category === "armchair" || category === "bed" || category === "desk";
    });
    return target ? `Add a floor lamp within 150 cm of ${target.id} for dependable evening light.` : "Add a warm floor lamp to give this room an evening light layer.";
  }
  if (key === "storage") {
    const kind = room.type === "bedroom" ? "wardrobe" : "shelf";
    return `Add a ${kind} in ${room.id}; aim for one storage piece per 15 m².`;
  }
  if (key === "conversation") {
    const seat = seating(scene, room, catalog)[0]?.item;
    return seat ? `Place another seat within 250 cm of ${seat.id} and turn the two seats toward each other.` : "Start with two seats no more than 250 cm apart, facing each other.";
  }
  if (key === "focal_point") {
    const pair = itemNearFocus(scene, room, catalog);
    if (pair.seat && pair.focus) return `Turn ${pair.seat.id} toward ${pair.focus.id}, within 15° of the focal line.`;
    if (pair.seat) return `Give ${pair.seat.id} a clear focus, such as a window or media unit, within 15°.`;
    return "Choose a main seat and aim it within 15° of a window or media focus.";
  }
  const first = items.find((item) => {
    const cat = catalogItem(catalog, item.catalogId);
    return cat && furnitureMass(cat) > 0;
  });
  return first ? `Shift ${first.id} 40 cm toward the room centre to improve the visual balance.` : "Place the first large piece near a wall, leaving a 60 cm clear route.";
}

function summary(room: Room, total: number, scores: DesignScores, hasItems: boolean): string {
  if (!hasItems) return safeSummary(`${room.name} is ready for a first layout; furniture is needed before balance, lighting and function can settle.`);
  const applicable: Array<keyof DesignScores> = room.type === "bedroom" || room.type === "office"
    ? ["balance", "lighting", "storage", "traffic"]
    : (Object.keys(scores) as Array<keyof DesignScores>);
  const ordered = applicable.sort((a, b) => scores[a] - scores[b] || a.localeCompare(b));
  const strongest = [...ordered].sort((a, b) => scores[b] - scores[a] || a.localeCompare(b))[0] as keyof DesignScores;
  const tone = total >= 80 ? "feels settled and practical" : total >= 65 ? "has a sound foundation" : "needs a clearer plan";
  const strength = labels[strongest];
  const sentenceStrength = `${strength[0]?.toUpperCase()}${strength.slice(1)}`;
  return safeSummary(`${room.name} ${tone}. ${sentenceStrength} works best; ${labels[ordered[0] as keyof DesignScores]} needs the most care.`);
}

/** Produces a deterministic, room-aware six-part design critique. */
export function designReport(scene: Scene, roomId: string, catalog: CatalogSource, conflicts: Conflict[]): DesignReport {
  const room = scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return { score: 0, scores: { balance: 0, focal_point: 0, conversation: 0, lighting: 0, storage: 0, traffic: 0 }, summary: "The room was not found, so there is nothing to critique.", suggestions: [] };
  if (room.type === "bath" || room.type === "hall") {
    return { score: 100, scores: { balance: 10, focal_point: 10, conversation: 10, lighting: 10, storage: 10, traffic: 10 }, summary: safeSummary(`${room.name} is a utility or circulation space, so there is nothing to critique.`), suggestions: [] };
  }
  const lighting = lightingCoverage(scene, room, catalog);
  const scores: DesignScores = {
    balance: balanceScore(scene, room, catalog),
    focal_point: focalPointScore(scene, room, catalog),
    conversation: conversationScore(scene, room, catalog),
    lighting: lighting.score,
    storage: storageScore(scene, room, catalog),
    traffic: trafficScore(conflicts, room.id),
  };
  const total = Math.max(0, Math.min(100, Math.round(
    Object.entries(scores).reduce((sum, [key, value]) => sum + value * weights[key as keyof DesignScores], 0) / 10,
  )));
  const ordered = (Object.keys(scores) as Array<keyof DesignScores>)
    .sort((a, b) => (10 - scores[b]) * weights[b] - (10 - scores[a]) * weights[a] || a.localeCompare(b));
  const suggestions = ordered.filter((key) => scores[key] < 8).slice(0, 3)
    .map((key) => clip(suggestionFor(key, scene, room, catalog, conflicts, lighting.uncovered), 120));
  return { score: total, scores, summary: summary(room, total, scores, roomItems(scene, room.id).length > 0), suggestions };
}
