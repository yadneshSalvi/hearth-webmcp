"use client";
/**
 * Narrow typed hooks over the single Hearth store so scene components subscribe to the least
 * state they need (hovering one item must not re-render the whole home).
 */
import { useMemo } from "react";
import { createCatalog } from "../engine/catalog";
import type { CatalogItem, Conflict, Furniture, Opening, Room, Scene, SceneMeta } from "../engine/types";
import { useHearthStore } from "../state/store";

/** The whole scene graph. Use only where every part is needed (Studio root). */
export function useScene(): Scene {
  return useHearthStore((state) => state.scene);
}

/** Scene metadata: view, yaw, time of day, palette, selection. */
export function useMeta(): SceneMeta {
  return useHearthStore((state) => state.scene.meta);
}

/** All rooms. */
export function useRooms(): Room[] {
  return useHearthStore((state) => state.scene.rooms);
}

/** All openings (doors, windows, arches). */
export function useOpenings(): Opening[] {
  return useHearthStore((state) => state.scene.openings);
}

/** All furniture, placed and ghost. */
export function useFurniture(): Furniture[] {
  return useHearthStore((state) => state.scene.furniture);
}

/** The active room, or the first room when metadata is stale. */
export function useActiveRoom(): Room | undefined {
  return useHearthStore((state) => state.scene.rooms.find((room) => room.id === state.scene.meta.activeRoomId) ?? state.scene.rooms[0]);
}

/** The raw catalog array. */
export function useCatalogItems(): CatalogItem[] {
  return useHearthStore((state) => state.catalog);
}

/** A stable id → product lookup for the current catalog. */
export function useProductLookup(): (id: string) => CatalogItem | undefined {
  const items = useCatalogItems();
  return useMemo(() => {
    const catalog = createCatalog(items);
    return (id: string) => catalog.byId(id);
  }, [items]);
}

/** Conflicts published by the rules engine for the overlay layer; empty until it runs. */
export function useConflicts(): Conflict[] {
  return useHearthStore((state) => state.overlays?.conflicts ?? EMPTY_CONFLICTS);
}

const EMPTY_CONFLICTS: Conflict[] = [];

/**
 * Ids of items the newest activity entry touched, plus the tool that produced it. Subscribes to the
 * entry itself (a stable store reference) and derives the shape, so the snapshot never changes
 * identity on every read.
 */
export function useLatestActivity(): { tool?: string; itemIds: string[]; t: number } {
  const entry = useHearthStore((state) => state.activity[0]);
  return useMemo(() => (entry ? { tool: entry.tool, itemIds: entry.itemIds, t: entry.t } : EMPTY_ACTIVITY), [entry]);
}

const EMPTY_ACTIVITY = { itemIds: [] as string[], t: 0 };
