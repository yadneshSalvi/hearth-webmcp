import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import type { DefinedTool, Err } from "../define";
import { defineTool } from "../define";
import { colorwayParam, itemParam } from "../params";
import {
  fromCaught, productName, resolveColorway, resolveItem, sourceForStore, syncCart,
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
        const removed = await context.shopify.cartRemove([lineId]);
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
          hint: "Use search_catalog or undo to replace it.",
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
      if (linkedLine) {
        const removed = await context.shopify.cartRemove([linkedLine.id]);
        if (!removed.ok && removed.error === "unavailable") return unavailable(removed.detail);
        const variantId = product.shopify?.variantIds[colorway.id]
          ?? `gid://shopify/ProductVariant/local-${product.id}-${colorway.id}`;
        const added = await context.shopify.cartAdd([{
          variantId,
          quantity: linkedLine.quantity,
          itemId: item.id,
        }]);
        if (!added.ok) return unavailable(added.detail);
        syncCart(context, added.value);
        cartLineUpdated = true;
      }
      try {
        context.store.getState().setColorway(sourceForStore(context.source), item.id, colorway.id);
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
