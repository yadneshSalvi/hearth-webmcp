import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import type { DefinedTool, Err } from "../define";
import { defineTool } from "../define";
import { colorwayParam, itemParam } from "../params";
import {
  fromCaught, productName, resolveColorway, resolveItem, sourceForStore, syncCart, trackShopifyResult, variantId,
} from "./resolve";

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
      const product = createCatalog(state.catalog).byId(item.catalogId);
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
