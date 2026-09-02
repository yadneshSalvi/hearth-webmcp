import * as z from "zod";
import { resolveAnchor } from "../../engine/anchors";
import { createCatalog, productFor, withItemDims } from "../../engine/catalog";
import { conflictsForItem, evaluateRoom } from "../../engine/conflicts";
import { dimsStr, posArr } from "../../engine/describe";
import { closestProducts, resizeDims } from "../../engine/dims";
import type { Conflict } from "../../engine/types";
import type { DefinedTool, Err } from "../define";
import { defineTool } from "../define";
import { colorwayParam, describeParam, itemParam } from "../params";
import {
  fromCaught, productName, resolveColorway, resolveItem, sourceForStore, syncCart, trackShopifyResult, variantId,
} from "./resolve";

function conflictRow(conflict: Conflict) {
  return {
    kind: conflict.kind,
    severity: conflict.severity,
    items: conflict.items.slice(0, 4),
    detail: conflict.detail.slice(0, 80),
    fix: conflict.fix.slice(0, 80),
  };
}

function unavailable(detail: string): Err {
  return { ok: false, error: "unavailable", detail };
}

export function removeFurnitureTool(): DefinedTool {
  return defineTool({
    name: "remove_furniture",
    title: "Remove furniture",
    description: "Removes one placed item from its room. If the item is linked to a cart line, that line is removed as well and the result says so. Use clear_room to empty a whole room.",
    group: "design",
    input: z.object({ item: itemParam }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const item = resolveItem(state, input.item);
      if ("ok" in item) return item;
      const name = productName(state, item);
      const lineId = item.cartLineId ?? state.cart.lines.find((line) => line.itemId === item.id)?.id;
      if (lineId) {
        const removed = trackShopifyResult(context, await context.shopify.cartRemove([lineId]));
        if (!removed.ok && removed.error === "unavailable") return unavailable(removed.detail);
        if (removed.ok) syncCart(context, removed.value);
      }
      try {
        context.ui.pulse([item.id]);
        context.store.getState().removeItem(sourceForStore(context.source), item.id);
        return {
          ok: true,
          room: item.roomId,
          removed: { id: item.id, name },
          removed_ids: [item.id],
          cart_line_removed: Boolean(lineId),
          hint: lineId
            ? "Undo restores the item; re-add its removed Shopify line with update_cart."
            : "Use search_catalog or undo to replace it.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Remove furniture failed";
      const removed = result.removed as { name?: string } | undefined;
      return `Removed ${removed?.name ?? "furniture"}`;
    },
  });
}

export function setColorwayTool(): DefinedTool {
  return defineTool({
    name: "set_colorway",
    title: "Set colorway",
    description: "Changes a placed item's colorway (for example oak, sage, terracotta or dusty-blue). If the product is in the cart, the cart line switches to the matching variant. Lists the available colorways when the requested one is unknown.",
    group: "design",
    input: z.object({ item: itemParam, colorway: colorwayParam }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const item = resolveItem(state, input.item);
      if ("ok" in item) return item;
      const product = productFor(item, state.catalog);
      if (!product) return { ok: false, error: "not_found", detail: `Product ${item.catalogId} was not found.`, alternatives: [] };
      const colorway = resolveColorway(state, item, input.colorway);
      if ("ok" in colorway) return colorway;
      const linkedLine = state.cart.lines.find((line) => line.itemId === item.id || line.id === item.cartLineId);
      let cartLineUpdated = false;
      let targetVariant: string | undefined;
      let targetLineId: string | undefined;
      if (linkedLine) {
        const remote = trackShopifyResult(context, await context.shopify.product(product.id));
        if (!remote.ok) return unavailable(remote.detail);
        targetVariant = variantId(remote.value, colorway.id);
        if (!targetVariant) return unavailable(`No Shopify variant exists for ${product.name} in ${colorway.id}.`);
        const updated = trackShopifyResult(context, await context.shopify.cartUpdateLine(linkedLine.id, targetVariant, linkedLine.quantity));
        if (!updated.ok) return unavailable(updated.detail);
        targetLineId = updated.value.lines.find((line) => line.itemId === item.id || line.variantId === targetVariant)?.id
          ?? linkedLine.id;
        syncCart(context, updated.value);
        cartLineUpdated = true;
      }
      try {
        context.store.getState().setColorway(sourceForStore(context.source), item.id, colorway.id);
        if (targetVariant && targetLineId) {
          context.store.getState().linkCartLine(sourceForStore(context.source), item.id, targetVariant, targetLineId);
        }
        context.ui.pulse([item.id]);
        return {
          ok: true,
          room: item.roomId,
          item: { id: item.id, name: product.name, colorway: colorway.id },
          item_ids: [item.id],
          cart_line_updated: cartLineUpdated,
          available: product.colorways.map(({ id }) => id),
          hint: "Use set_time_of_day to review the material under different light.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Set colorway failed";
      const item = result.item as { name?: string; colorway?: string } | undefined;
      return `${item?.name ?? input.item} → ${item?.colorway ?? input.colorway}`;
    },
  });
}

export function resizeFurnitureTool(): DefinedTool {
  return defineTool({
    name: "resize_furniture",
    title: "Resize furniture",
    description: "Changes a placed item's size in cm: width, depth and height, or scale_percent of its catalog size; reset restores the catalog size. The 3D model stretches to the new size and every rule (overlap, clearance, walls) uses it. Nudges the item up to 60 cm to stay inside the room and reports conflicts. Returns the new and the catalog dimensions and the closest catalog product to the new size.",
    group: "design",
    input: z.object({
      item: itemParam,
      width_cm: z.number().positive().optional().describe(describeParam("New width in cm (10–1000), left–right facing the front. Sides not given keep their current size.")),
      depth_cm: z.number().positive().optional().describe(describeParam("New depth in cm (10–1000), front–back.")),
      height_cm: z.number().positive().optional().describe(describeParam("New height in cm (10–1000), floor to top.")),
      scale_percent: z.number().positive().optional().describe(describeParam("Scale every side to this percentage of the catalog size, 25–400; 100 restores it.")),
      reset: z.boolean().optional().describe(describeParam("true restores the catalog size.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const item = resolveItem(state, input.item);
      if ("ok" in item) return item;
      const catalog = createCatalog(state.catalog);
      const product = catalog.byId(item.catalogId);
      if (!product) return { ok: false, error: "not_found", detail: `Product ${item.catalogId} was not found.`, alternatives: [] };
      const current = item.dims ?? product.dims;
      const outcome = resizeDims(product.dims, current, {
        width_cm: input.width_cm, depth_cm: input.depth_cm, height_cm: input.height_cm, scale_percent: input.scale_percent, reset: input.reset,
      });
      if (!outcome.ok) return { ok: false, error: "invalid", detail: outcome.detail, suggestion: `Catalog size is ${dimsStr(product.dims)} cm; sizes must stay within 25–400% of it.` };
      const next = outcome.dims ?? product.dims;
      const sized = withItemDims({ catalogId: item.catalogId, dims: next }, product);
      // The new footprint may leave the room or collide; the same nudge place_furniture gets.
      const placement = resolveAnchor(state.scene, item.roomId, sized, { pos: item.pos, rotation: item.rotation, ignoreItemIds: [item.id] }, catalog);
      const pos = placement.ok ? placement.pos : item.pos;
      const nudged = placement.ok ? Math.round(placement.nudgedCm) : 0;
      try {
        context.store.getState().resizeItem(sourceForStore(context.source), item.id, { dims: outcome.dims, ...(placement.ok ? { pos } : {}) });
        const after = context.store.getState();
        const conflicts = conflictsForItem(evaluateRoom(after.scene, item.roomId, catalog), item.id).slice(0, 6).map(conflictRow);
        const closest = outcome.dims
          ? closestProducts(state.catalog, next, { category: product.category, excludeId: product.id, limit: 1 })[0]
          : undefined;
        return {
          ok: true,
          room: item.roomId,
          item: {
            id: item.id,
            name: product.name,
            dims: dimsStr(next),
            catalog_dims: dimsStr(product.dims),
            scale: `${outcome.scalePercent}%`,
            pos: posArr(pos),
            rotation: item.rotation,
          },
          item_ids: [item.id],
          nudged_cm: nudged,
          conflicts,
          ...(closest ? {
            closest_product: {
              id: closest.product.id,
              name: closest.product.name,
              dims: dimsStr(closest.product.dims),
              match: closest.comparison.match,
              delta_cm: closest.comparison.delta,
            },
          } : {}),
          hint: !placement.ok
            ? `The new size does not fit where it stands (${placement.detail}); move it or resize again.`
            : conflicts.length > 0
              ? "Apply the first conflict's fix, or resize a little smaller."
              : outcome.dims
                ? "search_catalog with like_item finds Shopify products closest to this size."
                : "The item is back at its catalog size.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Resize furniture failed";
      const item = result.item as { name?: string; dims?: string } | undefined;
      if (input.reset || input.scale_percent === 100) return `Reset ${item?.name ?? input.item} to its catalog size`;
      return `Resized ${item?.name ?? input.item} → ${(item?.dims ?? "").replace(/x/g, "×")} cm`;
    },
  });
}
