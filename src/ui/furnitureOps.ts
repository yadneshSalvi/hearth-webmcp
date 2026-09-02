"use client";
/**
 * Human-side furniture size changes, with the manners the `resize_furniture` tool has (TOOLS.md
 * §37): the same clamps, the same nudge to stay inside the room, one undoable store action, a
 * warm toast with Undo instead of an exception.
 */
import { resolveAnchor } from "../engine/anchors";
import { createCatalog, withItemDims } from "../engine/catalog";
import { resizeDims } from "../engine/dims";
import type { ResizePatch } from "../engine/dims";
import type { CatalogItem, Furniture } from "../engine/types";
import { hearthStore } from "../state/store";
import { HearthError } from "../state/types";
import { dimsFull } from "./format";
import { historyMarker, undoTo } from "./useHearth";
import { pushToast } from "./toast-bus";

export interface ResizeOutcome {
  ok: boolean;
  detail?: string;
}

/** Stepper presses closer together than this are one change: one receipt, one undo step, one toast. */
const RUN_MS = 2_500;
let run: { itemId: string; marker: number; at: number } | undefined;

/** Applies a size change to a placed item; refusals become a toast and return `ok: false`. */
export function resizeItem(item: Furniture, product: CatalogItem, patch: ResizePatch): ResizeOutcome {
  const state = hearthStore.getState();
  const current = item.dims ?? product.dims;
  const outcome = resizeDims(product.dims, current, patch);
  if (!outcome.ok) {
    pushToast({ title: `${product.name} cannot be that size`, detail: outcome.detail, tone: "warn" });
    return { ok: false, detail: outcome.detail };
  }
  const next = outcome.dims ?? product.dims;
  const catalog = createCatalog(state.catalog);
  const sized = withItemDims({ catalogId: item.catalogId, dims: next }, product);
  const placement = resolveAnchor(state.scene, item.roomId, sized, { pos: item.pos, rotation: item.rotation, ignoreItemIds: [item.id] }, catalog);
  const now = Date.now();
  const continuing = run !== undefined && run.itemId === item.id && now - run.at < RUN_MS && !patch.reset;
  const marker = continuing && run ? run.marker : historyMarker();
  try {
    state.resizeItem("human", item.id, { dims: outcome.dims, ...(placement.ok ? { pos: placement.pos } : {}) }, { quiet: continuing });
  } catch (error) {
    const detail = error instanceof HearthError ? error.detail : "The studio refused that size.";
    pushToast({ title: `${product.name} cannot be that size`, detail, tone: "warn" });
    return { ok: false, detail };
  }
  run = patch.reset ? undefined : { itemId: item.id, marker, at: now };
  const nudged = placement.ok && placement.nudgedCm > 0 ? ` · nudged ${Math.round(placement.nudgedCm)} cm to stay clear` : "";
  if (continuing && placement.ok) return { ok: true };
  pushToast({
    title: outcome.dims ? `${product.name} is now ${dimsFull(next)}` : `${product.name} is back to its catalog size`,
    ...(placement.ok ? (nudged ? { detail: nudged.slice(3) } : {}) : { detail: "It no longer fits where it stands; the conflicts say what to move.", tone: "warn" as const }),
    ...(placement.ok ? { tone: "success" as const } : {}),
    action: { label: "Undo", run: () => undoTo(marker) },
  });
  return { ok: true };
}
