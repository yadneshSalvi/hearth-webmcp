"use client";
/**
 * One furniture record resolved into what the renderer needs: the world position it stands at
 * (already raised onto any surface beneath it, SCENE_SCHEMA.md §Stacking) and the footprint its
 * halo, dust ring and cut-away test are measured from.
 */
import { footprint, polyBBox } from "../engine/geometry";
import type { CatalogItem, Furniture as FurnitureData, Room } from "../engine/types";
import { M, stackElevationCm } from "./math";
import type { Vec3 } from "./math";

export interface Resolved {
  item: FurnitureData;
  room: Room;
  product: CatalogItem;
  /** Item centre in world metres, already elevated onto any surface beneath it. */
  position: Vec3;
  footprintM: { w: number; d: number };
}

/** Resolves one furniture record into world-space render data, or undefined if the scene is stale. */
export function resolveOne(
  item: FurnitureData,
  rooms: Room[],
  byId: (id: string) => CatalogItem | undefined,
  furniture: FurnitureData[],
): Resolved | undefined {
  const room = rooms.find((candidate) => candidate.id === item.roomId);
  const product = byId(item.catalogId);
  if (!room || !product) return undefined;
  const elevation = stackElevationCm(item, product, { furniture }, byId);
  const bounds = polyBBox(footprint(item, product));
  return {
    item,
    room,
    product,
    position: [(room.origin.x + item.pos.x) * M, elevation * M, (room.origin.y + item.pos.y) * M],
    footprintM: { w: (bounds.maxX - bounds.minX) * M, d: (bounds.maxY - bounds.minY) * M },
  };
}

