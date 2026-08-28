import { rectPoly } from "./geometry";
import type { CatalogItem, Category, Furniture, Vec2 } from "./types";

/** Required wheelchair turning-circle diameter in centimetres. */
export const turningCircleDiameter = 150;

function rotateAround(point: Vec2, center: Vec2, degrees: number): Vec2 {
  const angle = degrees * Math.PI / 180;
  const x = point.x - center.x;
  const y = point.y - center.y;
  return { x: center.x + x * Math.cos(angle) - y * Math.sin(angle), y: center.y + x * Math.sin(angle) + y * Math.cos(angle) };
}

/** Returns the product's front-use rectangle in room-local centimetres. */
export function clearanceZone(item: Furniture, cat: CatalogItem): Vec2[] {
  if (cat.clearanceFront <= 0) return [];
  const center = { x: item.pos.x, y: item.pos.y + cat.dims.d / 2 + cat.clearanceFront / 2 };
  return rectPoly(center, cat.dims.w, cat.clearanceFront).map((point) => rotateAround(point, item.pos, item.rotation));
}

/** Returns the minimum walkway width in centimetres for the accessibility mode. */
export function walkwayMin(accessibility: boolean): 60 | 90 {
  return accessibility ? 90 : 60;
}

/** Returns category-specific side-use clearance in centimetres. */
export function sideClearance(category: Category): number {
  if (category === "bed") return 60;
  if (category === "desk") return 90;
  return 0;
}
