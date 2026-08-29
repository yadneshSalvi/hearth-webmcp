import { createStore, useStore } from "zustand";
import { immer } from "zustand/middleware/immer";
import { temporal } from "zundo";
import { catalogSource } from "../../data/catalog.source";
import { nextItemId, resolveColorway } from "../engine/catalog";
import { footprint, polyBBox, polyInside, resolveWall } from "../engine/geometry";
import { createTemplate } from "../engine/templates";
import type { Furniture, Opening, Room } from "../engine/types";
import { palettePresets } from "../tokens";
import {
  actionActivity as activity, assertRotation, cloneScene, nextOpeningId, notchPoly, placedOrigin, prependActivity,
  productName, recomputeCart, requiredItem, requiredOpening, requiredRoom, storeCatalog as catalog, uniqueRoomId, validateOpening,
} from "./store-helpers";
import { uid } from "./ids";
import { HearthError } from "./types";
import type { ActivityEntry, HearthStore, ToolMirror } from "./types";
import { toolBatchIsActive } from "./tool-batch";

const historyLabels: ActivityEntry[] = [];
const futureLabels: ActivityEntry[] = [];
let pendingHistoryLabel: ActivityEntry | undefined;

/** Newest-last toast queue depth; older entries are dropped rather than stacked over the canvas. */
const TOAST_LIMIT = 4;

/**
 * Runs a mutation without an undo entry. Pointer gestures repeat `setGhost` many times a second
 * while the catalog ghost tracks the cursor, and none of those frames is a step a person would
 * want to undo; the committed drop that follows is.
 */
function quietly(opts: { quiet?: boolean } | undefined, mutate: () => void): void {
  if (!opts?.quiet) {
    mutate();
    return;
  }
  const history = hearthStore.temporal.getState();
  history.pause();
  try {
    mutate();
  } finally {
    history.resume();
  }
}

function prepend(
  target: Parameters<typeof prependActivity>[0],
  entry: Parameters<typeof prependActivity>[1],
): void {
  if (!entry.tool) pendingHistoryLabel = structuredClone(entry);
  if (toolBatchIsActive() && entry.source !== "human" && !entry.tool) return;
  prependActivity(target, entry);
}

function withoutHistory(action: () => void): void {
  const temporalState = hearthStore.temporal.getState();
  const wasTracking = temporalState.isTracking;
  if (wasTracking) temporalState.pause();
  try {
    action();
  } finally {
    pendingHistoryLabel = undefined;
    if (wasTracking) temporalState.resume();
  }
}

function restoreTransientSceneState(selection: HearthStore["scene"]["meta"]["selection"], activeRoomId: string): void {
  withoutHistory(() => {
    const state = hearthStore.getState();
    const scene = cloneScene(state.scene);
    const roomIds = new Set(scene.rooms.map((room) => room.id));
    const itemIds = new Set(scene.furniture.map((item) => item.id));
    if (roomIds.has(activeRoomId)) scene.meta.activeRoomId = activeRoomId;
    scene.meta.selection = {
      ...selection,
      ...(selection.roomId && !roomIds.has(selection.roomId) ? { roomId: undefined } : {}),
      ...(selection.itemId && !itemIds.has(selection.itemId) ? { itemId: undefined } : {}),
      ...(selection.hoverItemId && !itemIds.has(selection.hoverItemId) ? { hoverItemId: undefined } : {}),
      ...(selection.lastMovedItemId && !itemIds.has(selection.lastMovedItemId) ? { lastMovedItemId: undefined } : {}),
    };
    for (const item of scene.furniture) {
      const line = state.cart.lines.find((candidate) => candidate.itemId === item.id);
      if (line) {
        item.cartLineId = line.id;
        item.shopifyVariantId = line.variantId;
      } else {
        delete item.cartLineId;
      }
    }
    hearthStore.setState({ scene });
  });
}

const initialScene = createTemplate("2br", { furnished: true });

/** Vanilla Hearth store for tools, tests and non-React callers. */
export const hearthStore = createStore<HearthStore>()(
  temporal(
    immer((set, get) => ({
      scene: initialScene,
      catalog: catalogSource,
      cart: { lines: [], subtotalUsd: 0, status: "idle" },
      activity: [],
      tools: { available: [], status: "unknown" },
      ui: { boardOpen: false, assistantOpen: false, toolsPanelOpen: false, toasts: [], pulseIds: [] },
      overlays: { conflicts: [] },

      placeItem: (source, input) => {
        const state = get();
        const room = requiredRoom(state, input.roomId);
        const product = catalog.byId(input.catalogId);
        if (!product) throw new HearthError("not_found", `Product ${input.catalogId} was not found`);
        assertRotation(input.rotation);
        const colorway = resolveColorway(product, input.colorway ?? product.colorways[0]?.id ?? "");
        if (!colorway) throw new HearthError("invalid", `Colorway ${input.colorway ?? ""} is not available for ${product.name}`);
        const status = input.status ?? "placed";
        const id = status === "ghost" ? "ghost-1" : nextItemId(product.category, state.scene.furniture.map((item) => item.id));
        const placed: Furniture = { id, catalogId: product.id, roomId: room.id, pos: { ...input.pos }, rotation: input.rotation, colorway: colorway.id, status };
        set((draft) => {
          if (status === "ghost") draft.scene.furniture = draft.scene.furniture.filter((item) => item.status !== "ghost");
          draft.scene.furniture.push(placed);
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Place furniture", `${status === "ghost" ? "previewed" : "placed"} ${product.name}`, [id]));
        });
        return { ...placed, pos: { ...placed.pos } };
      },

      moveItem: (source, id, patch) => {
        const state = get();
        const found = requiredItem(state, id);
        if (patch.roomId) requiredRoom(state, patch.roomId);
        if (patch.rotation !== undefined) assertRotation(patch.rotation);
        set((draft) => {
          const item = draft.scene.furniture.find((candidate) => candidate.id === id) as typeof draft.scene.furniture[number];
          if (patch.pos) item.pos = { ...patch.pos };
          if (patch.rotation !== undefined) item.rotation = patch.rotation;
          if (patch.roomId) item.roomId = patch.roomId;
          draft.scene.meta.selection.lastMovedItemId = id;
          draft.scene.meta.selection.lastMovedBy = source;
          draft.scene.meta.selection.lastMovedAt = Date.now();
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Move furniture", `moved ${productName(found)}`, [id]));
        });
      },

      removeItem: (source, id) => {
        const found = requiredItem(get(), id);
        set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.id !== id);
          draft.cart.lines = draft.cart.lines.filter((line) => line.itemId !== id && line.id !== found.cartLineId);
          recomputeCart(draft.cart);
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Remove furniture", `removed ${productName(found)}`, [id]));
        });
      },

      setColorway: (source, id, value) => {
        const found = requiredItem(get(), id);
        const product = catalog.byId(found.catalogId);
        const colorway = product && resolveColorway(product, value);
        if (!product || !colorway) throw new HearthError("invalid", `Colorway ${value} is not available for ${productName(found)}`);
        set((draft) => {
          const item = draft.scene.furniture.find((candidate) => candidate.id === id) as typeof draft.scene.furniture[number];
          item.colorway = colorway.id;
          const line = draft.cart.lines.find((candidate) => candidate.itemId === id);
          if (line) {
            line.colorway = colorway.id;
            const variantId = product.shopify?.variantIds[colorway.id];
            if (variantId) line.variantId = variantId;
          }
          prepend(draft, activity(source, "Set colorway", `set ${product.name} to ${colorway.name}`, [id]));
        });
      },

      setLocked: (source, id, locked) => {
        const found = requiredItem(get(), id);
        set((draft) => {
          const item = draft.scene.furniture.find((candidate) => candidate.id === id) as typeof draft.scene.furniture[number];
          item.locked = locked;
          prepend(draft, activity(source, "Lock furniture", `${locked ? "locked" : "unlocked"} ${productName(found)}`, [id]));
        });
      },

      setGhost: (source, furniture, opts) => {
        requiredRoom(get(), furniture.roomId);
        const product = catalog.byId(furniture.catalogId);
        if (!product) throw new HearthError("not_found", `Product ${furniture.catalogId} was not found`);
        assertRotation(furniture.rotation);
        if (!resolveColorway(product, furniture.colorway)) throw new HearthError("invalid", `Colorway ${furniture.colorway} is not available for ${product.name}`);
        quietly(opts, () => set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.status !== "ghost");
          draft.scene.furniture.push({ ...furniture, id: "ghost-1", status: "ghost", pos: { ...furniture.pos } });
          if (!opts?.quiet) prepend(draft, activity(source, "Preview furniture", `previewed ${product.name}`, ["ghost-1"]));
        }));
      },

      clearGhost: (source, opts) => {
        const found = get().scene.furniture.find((item) => item.status === "ghost");
        if (!found) throw new HearthError("not_found", "No preview ghost exists");
        quietly(opts, () => set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.status !== "ghost");
          if (!opts?.quiet) prepend(draft, activity(source, "Cancel preview", `discarded preview of ${productName(found)}`, [found.id]));
        }));
      },

      confirmGhost: (source) => {
        const found = get().scene.furniture.find((item) => item.status === "ghost");
        if (!found) throw new HearthError("not_found", "No preview ghost exists");
        const product = catalog.byId(found.catalogId) as NonNullable<ReturnType<typeof catalog.byId>>;
        const id = nextItemId(product.category, get().scene.furniture.map((item) => item.id));
        const confirmed = { ...found, id, status: "placed" as const, pos: { ...found.pos } };
        set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.status !== "ghost");
          draft.scene.furniture.push(confirmed);
          prepend(draft, activity(source, "Confirm preview", `kept ${product.name}`, [id]));
        });
        return confirmed;
      },

      setMode: (source, mode) => set((draft) => {
        draft.scene.meta.mode = mode;
        prepend(draft, activity(source, "Switch mode", `switched to ${mode} mode`));
      }),
      setView: (source, patch) => {
        if (patch.focusRoomId) requiredRoom(get(), patch.focusRoomId);
        if (patch.focusItemId) requiredItem(get(), patch.focusItemId);
        set((draft) => {
          if (patch.view) draft.scene.meta.view = patch.view;
          if (patch.yaw) draft.scene.meta.yaw = patch.yaw;
          if (patch.focusRoomId) draft.scene.meta.selection.roomId = patch.focusRoomId;
          if (patch.focusItemId) draft.scene.meta.selection.itemId = patch.focusItemId;
          prepend(draft, activity(source, "Set view", `changed the view to ${draft.scene.meta.view}`));
        });
      },
      setTimeOfDay: (source, time) => set((draft) => {
        draft.scene.meta.timeOfDay = time;
        prepend(draft, activity(source, "Set lighting", `set the light to ${time}`));
      }),
      setPalette: (source, paletteId, roomIds) => {
        const preset = palettePresets[paletteId];
        if (!preset) throw new HearthError("invalid", `Palette ${paletteId} is invalid`);
        const uniqueIds = [...new Set(roomIds)];
        uniqueIds.forEach((id) => requiredRoom(get(), id));
        set((draft) => {
          for (const room of draft.scene.rooms) if (uniqueIds.includes(room.id)) {
            room.floor = preset.floor;
            room.wallColor = preset.walls;
          }
          if (uniqueIds.length === draft.scene.rooms.length) draft.scene.meta.paletteId = paletteId;
          prepend(draft, activity(source, "Apply palette", `applied ${preset.name} to ${uniqueIds.length === draft.scene.rooms.length ? "the home" : `${uniqueIds.length} room${uniqueIds.length === 1 ? "" : "s"}`}`));
        });
      },
      setAccessibility: (source, on) => set((draft) => {
        draft.scene.meta.accessibilityMode = on;
        prepend(draft, activity(source, "Accessibility", `turned accessibility mode ${on ? "on" : "off"}`));
      }),
      setActiveRoom: (source, roomId) => {
        const room = requiredRoom(get(), roomId);
        withoutHistory(() => set((draft) => {
          draft.scene.meta.activeRoomId = roomId;
          prepend(draft, activity(source, "Select room", `selected ${room.name}`));
        }));
      },
      setSelection: (source, selection) => {
        if (selection.roomId) requiredRoom(get(), selection.roomId);
        if (selection.itemId) requiredItem(get(), selection.itemId);
        withoutHistory(() => set((draft) => {
          Object.assign(draft.scene.meta.selection, selection);
          prepend(draft, activity(source, "Set selection", "changed the selection", selection.itemId ? [selection.itemId] : []));
        }));
      },

      saveVariant: (source, roomId, name) => {
        requiredRoom(get(), roomId);
        if (!name.trim()) throw new HearthError("invalid", "Variant name cannot be empty");
        const furniture = get().scene.furniture.filter((item) => item.roomId === roomId && item.status !== "ghost").map((item) => structuredClone(item));
        set((draft) => {
          const existing = draft.scene.variants.find((variant) => variant.roomId === roomId && variant.name.toLowerCase() === name.trim().toLowerCase());
          if (existing) { existing.name = name.trim(); existing.furniture = furniture; existing.savedAt = Date.now(); }
          else draft.scene.variants.push({ name: name.trim(), roomId, furniture, savedAt: Date.now() });
          prepend(draft, activity(source, "Save variant", `saved variant “${name.trim()}”`, furniture.map((item) => item.id)));
        });
      },
      loadVariant: (source, roomId, name) => {
        requiredRoom(get(), roomId);
        const variant = get().scene.variants.find((candidate) => candidate.roomId === roomId && candidate.name.toLowerCase() === name.trim().toLowerCase());
        if (!variant) throw new HearthError("not_found", `Variant ${name} was not found in ${roomId}`);
        const furniture = variant.furniture.map((item) => structuredClone(item));
        set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.roomId !== roomId || item.status === "ghost");
          draft.scene.furniture.push(...furniture);
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Load variant", `loaded variant “${variant.name}”`, furniture.map((item) => item.id)));
        });
      },
      deleteVariant: (source, roomId, name) => {
        requiredRoom(get(), roomId);
        const variant = get().scene.variants.find((candidate) => candidate.roomId === roomId && candidate.name.toLowerCase() === name.trim().toLowerCase());
        if (!variant) throw new HearthError("not_found", `Variant ${name} was not found in ${roomId}`);
        set((draft) => {
          draft.scene.variants = draft.scene.variants.filter((candidate) => !(candidate.roomId === roomId && candidate.name.toLowerCase() === name.trim().toLowerCase()));
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Delete variant", `deleted variant “${variant.name}”`));
        });
      },
      clearRoom: (source, roomId) => {
        const room = requiredRoom(get(), roomId);
        const ids = get().scene.furniture.filter((item) => item.roomId === roomId).map((item) => item.id);
        set((draft) => {
          draft.scene.furniture = draft.scene.furniture.filter((item) => item.roomId !== roomId);
          draft.cart.lines = draft.cart.lines.filter((line) => !line.itemId || !ids.includes(line.itemId));
          recomputeCart(draft.cart);
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Clear room", `cleared ${room.name}`, ids));
        });
      },
      applyArrangement: (source, roomId, furniture) => {
        const room = requiredRoom(get(), roomId);
        const ids = new Set(get().scene.furniture.map((item) => item.id));
        if (furniture.length !== ids.size || furniture.some((item) => !ids.has(item.id))) {
          throw new HearthError("invalid", "An arrangement must preserve every furniture id");
        }
        set((draft) => {
          draft.scene.furniture = furniture.map((item) => ({ ...item, pos: { ...item.pos } }));
          draft.ui.compare = undefined;
          prepend(draft, activity(source, "Arrange room", `arranged ${room.name}`, furniture.filter((item) => item.roomId === roomId).map((item) => item.id)));
        });
      },
      applyTemplate: (source, id, furnished) => set((draft) => {
        draft.scene = createTemplate(id, { furnished });
        draft.ui.compare = undefined;
        prepend(draft, activity(source, "Apply template", `applied the ${id} template${furnished ? " furnished" : ""}`));
      }),

      createRoom: (source, input) => {
        const width = input.width ?? input.width_cm;
        const depth = input.depth ?? input.depth_cm;
        if (!input.poly && (!width || !depth || width <= 0 || depth <= 0)) throw new HearthError("invalid", "Room width and depth must be positive");
        const poly = input.poly?.map((point) => ({ ...point })) ?? notchPoly(width as number, depth as number, input.notch);
        if (poly.length !== 4 && poly.length !== 6) throw new HearthError("invalid", "Room polygon must have 4 or 6 points");
        const id = input.id ?? uniqueRoomId(input.name, get().scene.rooms);
        if (get().scene.rooms.some((room) => room.id === id)) throw new HearthError("invalid", `Room id ${id} already exists`);
        const room: Room = {
          id, name: input.name, type: input.type, poly,
          origin: placedOrigin(input, poly, get().scene.rooms),
          floor: input.floor ?? "oak",
          wallColor: input.wallColor ?? input.wall_color ?? "plaster",
        };
        set((draft) => {
          draft.scene.rooms.push(room);
          prepend(draft, activity(source, "Create room", `created ${room.name}`));
        });
        return structuredClone(room);
      },
      updateRoom: (source, id, patch) => {
        const current = requiredRoom(get(), id);
        const oldBox = polyBBox(current.poly);
        const width = patch.width ?? patch.width_cm ?? oldBox.w;
        const depth = patch.depth ?? patch.depth_cm ?? oldBox.d;
        if (width <= 0 || depth <= 0) throw new HearthError("invalid", "Room width and depth must be positive");
        const poly = current.poly.map((point) => ({ x: oldBox.minX + (point.x - oldBox.minX) * width / oldBox.w, y: oldBox.minY + (point.y - oldBox.minY) * depth / oldBox.d }));
        const resized = { ...current, poly };
        const invalidOpenings = get().scene.openings.flatMap((opening) => {
          if (opening.roomId !== id) return [];
          const wall = resolveWall(resized, opening.wallId);
          if (wall && opening.offset >= 0 && opening.width > 0 && opening.offset + opening.width <= wall.length) return [];
          const end = opening.offset + opening.width;
          return [`${opening.id} (${opening.offset}-${end} cm) no longer fits the ${Math.round(wall?.length ?? 0)} cm ${wall?.side ?? opening.wallId} wall`];
        });
        if (invalidOpenings.length > 0) throw new HearthError("invalid", invalidOpenings.join("; "));
        const outside = get().scene.furniture.filter((item) => item.roomId === id).filter((item) => {
          const product = catalog.byId(item.catalogId);
          return product ? !polyInside(poly, footprint(item, product)) : true;
        }).map((item) => item.id);
        set((draft) => {
          const room = draft.scene.rooms.find((candidate) => candidate.id === id) as typeof draft.scene.rooms[number];
          room.poly = poly;
          if (patch.name) room.name = patch.name;
          if (patch.type) room.type = patch.type;
          if (patch.floor) room.floor = patch.floor;
          if (patch.wallColor ?? patch.wall_color) room.wallColor = patch.wallColor ?? patch.wall_color;
          prepend(draft, activity(source, "Update room", `updated ${room.name}`, outside));
        });
        return outside;
      },
      addOpening: (source, input) => {
        const resolved = validateOpening(get(), input);
        const id = input.id ?? nextOpeningId(input.kind, get().scene.openings);
        if (get().scene.openings.some((candidate) => candidate.id === id)) throw new HearthError("invalid", `Opening id ${id} already exists`);
        const added: Opening = { ...input, id, wallId: resolved.wallId };
        set((draft) => {
          draft.scene.openings.push(added);
          prepend(draft, activity(source, "Add opening", `added ${added.kind} to ${resolved.room.name}`));
        });
        return structuredClone(added);
      },
      moveOpening: (source, id, patch) => {
        const found = requiredOpening(get(), id);
        const changed: Opening = { ...found, ...patch };
        const resolved = validateOpening(get(), changed);
        set((draft) => {
          const opening = draft.scene.openings.find((candidate) => candidate.id === id) as typeof draft.scene.openings[number];
          Object.assign(opening, changed, { wallId: resolved.wallId });
          prepend(draft, activity(source, "Move opening", `moved ${id} in ${resolved.room.name}`));
        });
      },
      removeOpening: (source, id) => {
        const found = requiredOpening(get(), id);
        set((draft) => {
          draft.scene.openings = draft.scene.openings.filter((opening) => opening.id !== id);
          prepend(draft, activity(source, "Remove opening", `removed ${found.id}`));
        });
      },

      linkCartLine: (_source, itemId, variantId, lineId) => {
        requiredItem(get(), itemId);
        withoutHistory(() => set((draft) => {
          const item = draft.scene.furniture.find((candidate) => candidate.id === itemId) as typeof draft.scene.furniture[number];
          item.shopifyVariantId = variantId;
          if (lineId) item.cartLineId = lineId;
          else delete item.cartLineId;
        }));
      },

      setCart: (cartState) => set((draft) => { draft.cart = structuredClone(cartState); }),
      setCartStatus: (status) => set((draft) => { draft.cart.status = status; }),
      setToolsMirror: (list: ToolMirror[], status) => set((draft) => { draft.tools = { available: structuredClone(list), status }; }),
      pushActivity: (entry) => set((draft) => { prepend(draft, structuredClone(entry)); }),
      setUi: (patch) => set((draft) => { Object.assign(draft.ui, patch); }),
      toast: (entry) => {
        const toastEntry = { ...entry, id: uid(), t: Date.now() };
        set((draft) => {
          draft.ui.toasts.push(toastEntry);
          if (draft.ui.toasts.length > TOAST_LIMIT) draft.ui.toasts.splice(0, draft.ui.toasts.length - TOAST_LIMIT);
        });
        return toastEntry.id;
      },
      dismissToast: (id) => set((draft) => { draft.ui.toasts = draft.ui.toasts.filter((entry) => entry.id !== id); }),
      pulse: (itemIds) => set((draft) => { draft.ui.pulseIds = [...new Set(itemIds)]; }),
      setDragging: (dragging) => set((draft) => { draft.ui.dragging = dragging ? { ...dragging } : undefined; }),
      setOverlays: (patch) => set((draft) => {
        draft.overlays = { conflicts: patch.conflicts ? structuredClone(patch.conflicts) : (draft.overlays?.conflicts ?? []) };
      }),
      undo: (steps = 1) => {
        if (!Number.isInteger(steps) || steps < 1) throw new HearthError("invalid", "Undo steps must be a positive integer");
        const temporalState = hearthStore.temporal.getState();
        const count = Math.min(steps, temporalState.pastStates.length);
        const { activeRoomId, selection } = get().scene.meta;
        const undone = historyLabels.splice(-count, count).reverse().map((entry) => structuredClone(entry));
        futureLabels.push(...undone.map((entry) => structuredClone(entry)));
        temporalState.undo(count);
        restoreTransientSceneState(structuredClone(selection), activeRoomId);
        return undone;
      },
      redo: (steps = 1) => {
        if (!Number.isInteger(steps) || steps < 1) throw new HearthError("invalid", "Redo steps must be a positive integer");
        const temporalState = hearthStore.temporal.getState();
        const count = Math.min(steps, temporalState.futureStates.length);
        const { activeRoomId, selection } = get().scene.meta;
        const redone = futureLabels.splice(-count, count).reverse().map((entry) => structuredClone(entry));
        temporalState.redo(count);
        restoreTransientSceneState(structuredClone(selection), activeRoomId);
        historyLabels.push(...redone.map((entry) => structuredClone(entry)));
        return redone;
      },
      resetScene: (scene) => {
        const history = hearthStore.temporal.getState();
        history.pause();
        set((draft) => { draft.scene = cloneScene(scene); });
        history.clear();
        historyLabels.length = 0;
        futureLabels.length = 0;
        pendingHistoryLabel = undefined;
        history.resume();
      },
    })),
    {
      partialize: (state) => ({ scene: state.scene }),
      limit: 100,
      equality: (past, current) => past.scene === current.scene || JSON.stringify(past.scene) === JSON.stringify(current.scene),
      handleSet: (handleSet) => (past, replace) => {
        handleSet(past, replace);
        if (historyLabels.length >= 100) historyLabels.shift();
        historyLabels.push(pendingHistoryLabel ?? activity("system", "Scene change", "changed the scene"));
        futureLabels.length = 0;
        pendingHistoryLabel = undefined;
      },
    },
  ),
);

/** React hook bound to the same vanilla Hearth store used by tools and tests. */
export function useHearthStore(): HearthStore;
export function useHearthStore<T>(selector: (state: HearthStore) => T): T;
export function useHearthStore<T>(selector?: (state: HearthStore) => T): HearthStore | T {
  const resolved: (state: HearthStore) => HearthStore | T = selector ?? ((state) => state);
  return useStore(hearthStore, resolved);
}
