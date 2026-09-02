/**
 * Starter furniture for a home whose rooms came from an imported floor plan (TOOLS.md §40,
 * `furnished: true`). Every piece goes through `resolveAnchor`, so nothing overlaps, nothing leaves
 * its room, door swings stay clear, and a room the engine cannot furnish safely stays empty rather
 * than wrong. Deterministic: same scene in, same layout out.
 */
import { resolveAnchor } from "./anchors";
import type { Anchor } from "./anchors";
import { createCatalog } from "./catalog";
import type { Catalog } from "./catalog";
import { conflictsForItem, evaluateRoom } from "./conflicts";
import { freeSpans, roomArea, walls } from "./geometry";
import type { CatalogItem, Furniture, Room, Scene, Side } from "./types";
import type { ColorwayId } from "../tokens";

interface Piece {
  product: string;
  colorway: ColorwayId;
  /** Tried in order until one resolves. */
  anchors: Array<Anchor | "longest-wall" | "other-wall">;
  /** Skip the piece in rooms under this many m². */
  minAreaM2?: number;
}

const LIVING: Piece[] = [
  { product: "sofa-endre", colorway: "sage", anchors: ["longest-wall"] },
  { product: "rug-loop", colorway: "terracotta", anchors: [{ centered: true }] },
  { product: "tv-unit-linje", colorway: "oak", anchors: ["other-wall"], minAreaM2: 9 },
  { product: "armchair-nook", colorway: "terracotta", anchors: [{ next_to: "sofa", side: "right", gap_cm: 20 }, { next_to: "sofa", side: "left", gap_cm: 20 }], minAreaM2: 12 },
  { product: "lamp-glow", colorway: "ochre", anchors: [{ next_to: "sofa", side: "left", gap_cm: 10 }, { next_to: "sofa", side: "right", gap_cm: 10 }], minAreaM2: 8 },
  { product: "plant-fern", colorway: "sage", anchors: ["other-wall"], minAreaM2: 10 },
];

const BEDROOM: Piece[] = [
  { product: "bed-birk", colorway: "oak", anchors: ["longest-wall"] },
  { product: "wardrobe-skive", colorway: "plaster", anchors: ["other-wall"], minAreaM2: 8 },
  { product: "table-bord", colorway: "oak", anchors: [{ next_to: "bed", side: "left", gap_cm: 5 }, { next_to: "bed", side: "right", gap_cm: 5 }], minAreaM2: 8 },
  { product: "table-lamp-alva", colorway: "ochre", anchors: [{ next_to: "bed", side: "left", gap_cm: 5 }, { next_to: "bed", side: "right", gap_cm: 5 }], minAreaM2: 8 },
];

const SMALL_BEDROOM: Piece[] = [
  { product: "bed-ask", colorway: "dusty-blue", anchors: ["longest-wall"] },
  { product: "wardrobe-skive", colorway: "plaster", anchors: ["other-wall"], minAreaM2: 7 },
];

const DINING: Piece[] = [
  { product: "table-ake", colorway: "oak", anchors: [{ centered: true }] },
  { product: "chair-finn", colorway: "sage", anchors: [{ next_to: "table", side: "front", gap_cm: 5 }] },
  { product: "chair-ida", colorway: "dusty-blue", anchors: [{ next_to: "table", side: "behind", gap_cm: 5 }] },
  { product: "plant-pilea", colorway: "sage", anchors: ["other-wall"], minAreaM2: 9 },
];

const SMALL_DINING: Piece[] = [
  { product: "table-petit", colorway: "oak", anchors: [{ centered: true }] },
  { product: "chair-mysa", colorway: "sage", anchors: [{ next_to: "table", side: "front", gap_cm: 5 }] },
];

const OFFICE: Piece[] = [
  { product: "desk-soren", colorway: "oak", anchors: ["longest-wall"] },
  { product: "chair-mysa", colorway: "sage", anchors: [{ next_to: "desk", side: "front", gap_cm: 5 }] },
  { product: "shelf-lund", colorway: "plaster", anchors: ["other-wall"], minAreaM2: 7 },
];

const STUDIO: Piece[] = [
  { product: "bed-ask", colorway: "dusty-blue", anchors: ["longest-wall"] },
  { product: "sofa-liva", colorway: "sage", anchors: ["other-wall"], minAreaM2: 16 },
  { product: "table-petit", colorway: "oak", anchors: [{ centered: true }], minAreaM2: 14 },
  { product: "wardrobe-skive", colorway: "plaster", anchors: ["other-wall"], minAreaM2: 12 },
];

const HALL: Piece[] = [
  { product: "plant-pilea", colorway: "sage", anchors: ["other-wall"], minAreaM2: 3 },
];

function piecesFor(room: Room): Piece[] {
  const area = roomArea(room) / 10_000;
  switch (room.type) {
    case "living": return LIVING;
    case "bedroom": return area >= 9 ? BEDROOM : SMALL_BEDROOM;
    case "kitchen":
    case "dining": return area >= 8 ? DINING : SMALL_DINING;
    case "office": return OFFICE;
    case "studio": return STUDIO;
    case "hall": return HALL;
    default: return [];
  }
}

/** Wall sides of a room ordered by their longest free span, longest first; `exclude` sides come last. */
function wallOrder(scene: Scene, room: Room, product: CatalogItem, catalog: Catalog, exclude: Set<Side>): Side[] {
  return walls(room)
    .map((wall) => ({
      side: wall.side,
      span: Math.max(0, ...freeSpans(room, wall, scene, catalog, { minLength: product.dims.w, itemHeight: product.dims.h }).map((span) => span.end - span.start)),
    }))
    .sort((a, b) => Number(exclude.has(a.side)) - Number(exclude.has(b.side)) || b.span - a.span || a.side.localeCompare(b.side))
    .map((entry) => entry.side);
}

function nextIndex(category: CatalogItem["category"], taken: Set<string>): number {
  let index = 1;
  while (taken.has(`${category}-${index}`)) index += 1;
  return index;
}

/** Places starter furniture in every room of the scene. Returns the new furniture list (existing items kept). */
export function starterFurniture(scene: Scene, catalogItems: CatalogItem[]): Furniture[] {
  const catalog = createCatalog(catalogItems);
  const taken = new Set(scene.furniture.map((item) => item.id));
  let working: Scene = { ...scene, furniture: [...scene.furniture] };
  for (const room of scene.rooms) {
    const area = roomArea(room) / 10_000;
    const usedWalls = new Set<Side>();
    const placedHere = new Map<string, string>();
    for (const piece of piecesFor(room)) {
      if (piece.minAreaM2 !== undefined && area < piece.minAreaM2) continue;
      const product = catalog.byId(piece.product);
      if (!product) continue;
      for (const anchor of piece.anchors) {
        const candidates: Anchor[] = anchor === "longest-wall"
          ? wallOrder(working, room, product, catalog, new Set()).map((wall) => ({ wall, along: "center" as const }))
          : anchor === "other-wall"
            ? wallOrder(working, room, product, catalog, usedWalls).map((wall) => ({ wall, along: "center" as const }))
            : [{ ...anchor, ...(anchor.next_to ? { next_to: placedHere.get(anchor.next_to) ?? anchor.next_to } : {}) }];
        if (anchor !== "longest-wall" && anchor !== "other-wall" && anchor.next_to && !placedHere.has(anchor.next_to)) continue;
        let done = false;
        for (const candidate of candidates) {
          const resolved = resolveAnchor(working, room.id, product, { anchor: candidate }, catalog);
          if (!resolved.ok) continue;
          const id = `${product.category}-${nextIndex(product.category, taken)}`;
          const item: Furniture = { id, catalogId: product.id, roomId: room.id, pos: resolved.pos, rotation: resolved.rotation, colorway: piece.colorway, status: "placed" };
          const tentative: Scene = { ...working, furniture: [...working.furniture, item] };
          // A starter layout has to be right, not merely legal: anything the rules engine would flag
          // (a bed blocking the door path, a wardrobe in the bed's clearance) is tried elsewhere or skipped.
          if (conflictsForItem(evaluateRoom(tentative, room.id, catalog), id).length > 0) continue;
          taken.add(id);
          working = tentative;
          placedHere.set(product.category, id);
          if (candidate.wall) usedWalls.add(candidate.wall as Side);
          done = true;
          break;
        }
        if (done) break;
      }
    }
  }
  return working.furniture;
}
