import { createCatalog } from "../engine/catalog";
import type { Furniture, Room, Variant } from "../engine/types";
import type { ActivityEntry, HearthState, ToolGroup } from "./types";

/** Returns the active room, or undefined if scene metadata is stale. */
export function activeRoom(state: HearthState): Room | undefined {
  return state.scene.rooms.find((room) => room.id === state.scene.meta.activeRoomId);
}

/** Finds a room by exact id, case-insensitively. */
export function roomById(state: HearthState, id: string): Room | undefined {
  const needle = id.trim().toLowerCase();
  return state.scene.rooms.find((room) => room.id.toLowerCase() === needle);
}

/** Resolves a room id, name, or unique prefix; returns undefined when ambiguous. */
export function resolveRoom(state: HearthState, ref: string): Room | undefined {
  const needle = ref.trim().toLowerCase();
  const exact = state.scene.rooms.find((room) => room.id.toLowerCase() === needle)
    ?? state.scene.rooms.find((room) => room.name.toLowerCase() === needle);
  if (exact) return exact;
  const matches = state.scene.rooms.filter((room) => room.id.toLowerCase().startsWith(needle) || room.name.toLowerCase().startsWith(needle));
  return matches.length === 1 ? matches[0] : undefined;
}

/** Resolves a placed item id, catalog name, unique prefix, or selected. */
export function resolveItem(state: HearthState, ref: string): Furniture | undefined {
  const needle = ref.trim().toLowerCase();
  if (needle === "selected") return state.scene.furniture.find((item) => item.id === state.scene.meta.selection.itemId);
  const exact = state.scene.furniture.find((item) => item.id.toLowerCase() === needle);
  if (exact) return exact;
  const catalog = createCatalog(state.catalog);
  const product = catalog.resolveProduct(ref);
  if (product) {
    const matches = state.scene.furniture.filter((item) => item.catalogId === product.id);
    if (matches.length === 1) return matches[0];
  }
  const prefixes = state.scene.furniture.filter((item) => item.id.toLowerCase().startsWith(needle));
  return prefixes.length === 1 ? prefixes[0] : undefined;
}

/** Lists room furniture, excluding ghosts unless explicitly requested. */
export function itemsInRoom(state: HearthState, roomId: string, opts: { includeGhost?: boolean } = {}): Furniture[] {
  return state.scene.furniture.filter((item) => item.roomId === roomId && (opts.includeGhost || item.status !== "ghost"));
}

/** Returns the scene's sole preview ghost, if present. */
export function ghost(state: HearthState): Furniture | undefined {
  return state.scene.furniture.find((item) => item.status === "ghost");
}

/** Returns variants saved for one room in their stored order. */
export function variantsForRoom(state: HearthState, roomId: string): Variant[] {
  return state.scene.variants.filter((variant) => variant.roomId === roomId);
}

/** Returns the active comparable room, or the first room with at least two variants. */
export function variantComparisonRoom(state: HearthState): Room | undefined {
  const active = activeRoom(state);
  if (active && variantsForRoom(state, active.id).length >= 2) return active;
  return state.scene.rooms.find((room) => variantsForRoom(state, room.id).length >= 2);
}

/** Returns the total cart quantity. */
export function cartCount(state: HearthState): number {
  return state.cart.lines.reduce((total, line) => total + line.quantity, 0);
}

/** Returns tool groups required by the exact registration gates in TOOLS.md §2. */
export function desiredToolGroups(state: HearthState): ToolGroup[] {
  const groups: ToolGroup[] = ["core", "design", "shop", "present"];
  if (ghost(state)) groups.push("preview");
  if (variantComparisonRoom(state)) groups.push("variants");
  if (state.cart.lines.length > 0) groups.push("checkout");
  if (state.scene.meta.mode === "build") groups.push("build");
  return groups;
}

/** Creates a selector for the newest n activity rows. */
export function activityRecent(n: number): (state: HearthState) => ActivityEntry[] {
  return (state) => state.activity.slice(0, Math.max(0, n));
}
