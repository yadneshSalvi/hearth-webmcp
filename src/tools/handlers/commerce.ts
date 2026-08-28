import * as z from "zod";
import { resolveAnchor } from "../../engine/anchors";
import { createCatalog, nextItemId } from "../../engine/catalog";
import { conflictsForItem, evaluateRoom } from "../../engine/conflicts";
import { fitNote, wallFits } from "../../engine/fit";
import { resolveWall, walls } from "../../engine/geometry";
import { dimsStr, posArr } from "../../engine/describe";
import type { CatalogItem, Conflict, Furniture } from "../../engine/types";
import type { CatalogProduct, ShopifyCart, ShopifyCartLine } from "../../shopify/types";
import type { DefinedTool, Err, ToolContext } from "../define";
import { defineTool } from "../define";
import {
  anchorParam, colorwayParam, describeParam, posParam, productParam, roomParam, rotationParam,
} from "../params";
import {
  alternatives, fromCaught, notFound, productName, resolveItem, resolveProduct, resolveRoom, sourceForStore, syncCart,
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

function placementError(
  result: Exclude<ReturnType<typeof resolveAnchor>, { ok: true }>,
  context: ToolContext,
  roomId: string,
): Err {
  const state = context.store.getState();
  const room = state.scene.rooms.find((candidate) => candidate.id === roomId);
  const candidates = [
    ...state.scene.rooms.map(({ id, name }) => ({ id, name })),
    ...state.scene.furniture.map((item) => ({ id: item.id, name: productName(state, item) })),
    ...state.scene.openings.map((opening) => ({ id: opening.id, name: opening.id })),
    ...(room ? walls(room).map((wall) => ({ id: wall.id, name: wall.side })) : []),
  ];
  return {
    ok: false,
    error: result.error,
    detail: result.detail,
    ...(result.freeSpans ? {
      free_spans: result.freeSpans.flatMap((entry) => entry.spans.map((span) => ({
        wall: entry.side,
        start: Math.round(span.start),
        end: Math.round(span.end),
      }))).slice(0, 6),
    } : {}),
    ...(result.suggestion ? { suggestion: result.suggestion } : {}),
    ...(result.error === "not_found" ? { alternatives: alternatives(result.detail, candidates) } : {}),
  };
}

function variantId(product: CatalogProduct | CatalogItem, colorway: string): string | undefined {
  if ("variants" in product) return product.variants.find((variant) => variant.colorway === colorway)?.id;
  return product.shopify?.variantIds[colorway] ?? `gid://shopify/ProductVariant/local-${product.id}-${colorway}`;
}

function linkItem(context: ToolContext, itemId: string, variant: string, lineId?: string): void {
  const state = context.store.getState();
  const furniture = state.scene.furniture.map((item) => item.id === itemId ? {
    ...item,
    shopifyVariantId: variant,
    ...(lineId ? { cartLineId: lineId } : {}),
  } : item);
  context.store.setState({ scene: { ...state.scene, furniture } });
}

function unlinkItem(context: ToolContext, itemId: string): void {
  const state = context.store.getState();
  const furniture = state.scene.furniture.map((item) => {
    if (item.id !== itemId) return item;
    const copy = { ...item };
    delete copy.cartLineId;
    return copy;
  });
  context.store.setState({ scene: { ...state.scene, furniture } });
}

function cartLine(line: ShopifyCartLine) {
  return {
    product: line.handle,
    name: line.title,
    colorway: line.colorway,
    qty: line.quantity,
    line_usd: Math.round(line.lineUsd),
    ...(line.itemId ? { item: line.itemId } : {}),
  };
}

function cartResult(cart: ShopifyCart, budgetUsd: number | undefined) {
  return {
    count: cart.count,
    subtotal_usd: Math.round(cart.subtotalUsd),
    ...(budgetUsd === undefined ? {} : { remaining_usd: Math.round(budgetUsd - cart.subtotalUsd) }),
    checkout_available: cart.lines.length > 0,
  };
}

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function previewInRoomTool(): DefinedTool {
  return defineTool({
    name: "preview_in_room",
    title: "Preview in room",
    description: "Try before you buy: shows a translucent ghost of a catalog product at an anchor or position in a room with its price, fit and conflicts, without changing the layout or the cart. One preview at a time; confirm_preview keeps it and cancel_preview discards it.",
    group: "shop",
    input: z.object({
      product: productParam,
      room: roomParam.optional(),
      anchor: anchorParam.optional(),
      pos: posParam.optional(),
      rotation: rotationParam.optional(),
      colorway: colorwayParam.optional(),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const product = resolveProduct(state, input.product);
      if ("ok" in product) return product;
      const catalog = createCatalog(state.catalog);
      const colorwayRef = input.colorway ?? product.colorways[0]?.id ?? "";
      const colorway = catalog.resolveColorway(product, colorwayRef);
      if (!colorway) return notFound("Colorway", colorwayRef, product.colorways);
      const placement = resolveAnchor(state.scene, room.id, product, {
        anchor: input.anchor,
        pos: input.pos,
        rotation: input.rotation,
      }, catalog);
      if (!placement.ok) return placementError(placement, context, room.id);
      const ghost: Furniture = {
        id: "ghost-1",
        catalogId: product.id,
        roomId: room.id,
        pos: placement.pos,
        rotation: placement.rotation,
        colorway: colorway.id,
        status: "ghost",
        shopifyVariantId: variantId(product, colorway.id),
      };
      try {
        context.store.getState().setGhost(sourceForStore(context.source), ghost);
        const next = context.store.getState();
        const conflicts = conflictsForItem(evaluateRoom(next.scene, room.id, catalog), ghost.id).slice(0, 6).map(conflictRow);
        const requestedWall = input.anchor?.wall ? resolveWall(room, input.anchor.wall) : undefined;
        const fit = requestedWall
          ? fitNote(state.scene, room, requestedWall, product, catalog)
          : (() => {
            const fittingWall = wallFits(state.scene, room, product, catalog).find((candidate) => candidate.fits);
            return fittingWall
              ? `fits ${fittingWall.side} wall · ${Math.round(fittingWall.spareCm)} cm spare`
              : `fits inside ${room.name}`;
          })();
        context.ui.pulse([ghost.id]);
        return {
          ok: true,
          room: room.id,
          preview: {
            id: ghost.id,
            product: product.id,
            name: product.name,
            pos: posArr(ghost.pos),
            rotation: ghost.rotation,
            dims: dimsStr(product.dims),
            colorway: ghost.colorway,
            price_usd: Math.round(product.price ?? 0),
          },
          item_ids: [ghost.id],
          fit,
          conflicts,
          hint: "Call confirm_preview to keep it or cancel_preview to discard it.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Preview failed";
      const preview = result.preview as { name?: string } | undefined;
      const wall = input.anchor?.wall ? ` on the ${input.anchor.wall} wall` : "";
      return `Previewing ${preview?.name ?? input.product}${wall}`;
    },
  });
}

const updateCartInput = z.object({
  action: z.enum(["add", "remove", "set_quantity"]).describe(describeParam("Cart action: add, remove or set_quantity.")),
  product: z.string().min(1).optional().describe(describeParam("Catalog product id or name. Give either product or item.")),
  item: z.string().min(1).optional().describe(describeParam("Placed item id or name; its product and colorway are used and the cart line is linked to it.")),
  colorway: colorwayParam.optional(),
  quantity: z.number().int().nonnegative().optional().describe(describeParam("Quantity for add (default 1) or set_quantity.")),
}).strict().refine((input) => Boolean(input.product) !== Boolean(input.item), {
  message: "Give exactly one of product or item.",
});

export function updateCartTool(): DefinedTool {
  return defineTool({
    name: "update_cart",
    title: "Update cart",
    description: "Changes the Shopify cart. add: adds a product (by product id or a placed item) in a colorway with a quantity; remove: removes that product's line; set_quantity: sets the line's quantity. Returns the new subtotal in USD and the remaining budget. Purchases are completed by the human at checkout.",
    group: "shop",
    input: updateCartInput,
    async handler(input, context) {
      const initial = context.store.getState();
      const item = input.item ? resolveItem(initial, input.item) : undefined;
      if (item && "ok" in item) return item;
      const resolved = item && !("ok" in item)
        ? initial.catalog.find((candidate) => candidate.id === item.catalogId)
        : resolveProduct(initial, input.product ?? "");
      if (!resolved) return notFound("Product", item && !("ok" in item) ? item.catalogId : input.product ?? "", initial.catalog);
      if ("ok" in resolved) return resolved;
      const remote = await context.shopify.product(resolved.id);
      if (!remote.ok) return unavailable(remote.detail);
      const colorwayRef = input.colorway ?? (item && !("ok" in item) ? item.colorway : resolved.colorways[0]?.id) ?? "";
      const colorway = createCatalog(initial.catalog).resolveColorway(resolved, colorwayRef);
      if (!colorway) return notFound("Colorway", colorwayRef, resolved.colorways);
      const variant = variantId(remote.value, colorway.id);
      if (!variant) return unavailable(`No Shopify variant exists for ${resolved.name} in ${colorway.id}.`);
      let beforeLine: ShopifyCartLine | undefined;
      let cart: ShopifyCart;

      if (input.action === "add") {
        const quantity = input.quantity ?? 1;
        if (quantity < 1) return { ok: false, error: "invalid", detail: "quantity must be at least 1 for add." };
        const added = await context.shopify.cartAdd([{
          variantId: variant,
          quantity,
          ...(item && !("ok" in item) ? { itemId: item.id } : {}),
        }]);
        if (!added.ok) return unavailable(added.detail);
        cart = added.value;
        const addedLine = [...cart.lines].reverse().find((line) => line.variantId === variant);
        if (addedLine && item && !("ok" in item)) addedLine.itemId = item.id;
        syncCart(context, cart);
        if (addedLine && item && !("ok" in item)) linkItem(context, item.id, variant, addedLine.id);
        beforeLine = addedLine;
      } else {
        const current = await context.shopify.cartGet();
        if (!current.ok) return unavailable(current.detail);
        cart = current.value;
        syncCart(context, cart);
        beforeLine = cart.lines.find((line) => item && !("ok" in item)
          ? line.itemId === item.id || line.id === item.cartLineId
          : line.handle === resolved.id && (!input.colorway || line.colorway === colorway.id));
        if (!beforeLine) return notFound("Cart line", input.item ?? input.product ?? "", cart.lines.map((line) => ({ id: line.id, name: line.title })));
        const changed = input.action === "remove"
          ? await context.shopify.cartRemove([beforeLine.id])
          : input.quantity === undefined
            ? { ok: false as const, error: "invalid" as const, detail: "quantity is required for set_quantity." }
            : await context.shopify.cartSetQuantity(beforeLine.id, input.quantity);
        if (!changed.ok) return changed.error === "invalid"
          ? { ok: false, error: "invalid", detail: changed.detail }
          : unavailable(changed.detail);
        cart = changed.value;
        syncCart(context, cart);
        if (beforeLine.itemId && (input.action === "remove" || input.quantity === 0)) unlinkItem(context, beforeLine.itemId);
      }

      const line = input.action === "remove" || input.quantity === 0
        ? beforeLine
        : cart.lines.find((candidate) => candidate.id === beforeLine?.id) ?? beforeLine;
      if (!line) return unavailable("Shopify did not return the affected cart line.");
      const state = context.store.getState();
      return {
        ok: true,
        room: item && !("ok" in item) ? item.roomId : state.scene.meta.activeRoomId,
        action: input.action,
        line: cartLine(line),
        ...(item && !("ok" in item) ? { item_ids: [item.id] } : {}),
        ...cartResult(cart, state.scene.meta.budgetUsd),
        hint: cart.lines.length > 0 ? "Use get_cart to review the order or get_checkout_link to continue." : "The cart is empty; add a product or placed item when ready.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Update cart failed";
      const line = result.line as { name?: string; colorway?: string; qty?: number } | undefined;
      const subtotal = typeof result.subtotal_usd === "number" ? result.subtotal_usd : 0;
      if (input.action === "remove") return `Removed ${line?.name ?? "product"} from cart · $${money(subtotal)}`;
      if (input.action === "set_quantity") return `Set ${line?.name ?? "product"} quantity to ${input.quantity ?? 0} · $${money(subtotal)}`;
      return `Added ${line?.name ?? "product"} (${line?.colorway ?? input.colorway ?? "default"}) to cart · $${money(subtotal)}`;
    },
  });
}

export function confirmPreviewTool(): DefinedTool {
  return defineTool({
    name: "confirm_preview",
    title: "Confirm preview",
    description: "Keeps the current preview: the ghost becomes a placed item with its colorway and Shopify variant linked. Optionally adds it to the cart in the same step.",
    group: "preview",
    input: z.object({
      add_to_cart: z.boolean().default(false).describe(describeParam("true also adds the kept preview to the cart.")),
    }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const ghost = state.scene.furniture.find((item) => item.status === "ghost");
      if (!ghost) return notFound("Preview", "ghost", []);
      const product = state.catalog.find((candidate) => candidate.id === ghost.catalogId);
      if (!product) return notFound("Product", ghost.catalogId, state.catalog);
      let variant = ghost.shopifyVariantId ?? variantId(product, ghost.colorway);
      let cart = state.cart;
      let lineId: string | undefined;
      const predictedId = nextItemId(product.category, state.scene.furniture.map((item) => item.id));
      if (input.add_to_cart) {
        const remote = await context.shopify.product(product.id);
        if (!remote.ok) return unavailable(remote.detail);
        variant = variantId(remote.value, ghost.colorway);
        if (!variant) return unavailable(`No Shopify variant exists for ${product.name} in ${ghost.colorway}.`);
        const added = await context.shopify.cartAdd([{ variantId: variant, quantity: 1, itemId: predictedId }]);
        if (!added.ok) return unavailable(added.detail);
        const linked = [...added.value.lines].reverse().find((line) => line.variantId === variant);
        if (linked) linked.itemId = predictedId;
        lineId = linked?.id;
        syncCart(context, added.value);
        cart = context.store.getState().cart;
      }
      try {
        const item = context.store.getState().confirmGhost(sourceForStore(context.source));
        if (variant) linkItem(context, item.id, variant, lineId);
        context.ui.pulse([item.id]);
        return {
          ok: true,
          room: item.roomId,
          item: { id: item.id, name: product.name, pos: posArr(item.pos), rotation: item.rotation, colorway: item.colorway },
          item_ids: [item.id],
          cart: { added: input.add_to_cart, subtotal_usd: Math.round(cart.subtotalUsd) },
          hint: input.add_to_cart ? "Use get_checkout_link when the human is ready to purchase." : "Use update_cart with this item id to add it later.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Confirm preview failed";
      const item = result.item as { name?: string } | undefined;
      const cart = result.cart as { added?: boolean } | undefined;
      return `Kept ${item?.name ?? "preview"}${cart?.added ? " (added to cart)" : ""}`;
    },
  });
}

export function getCheckoutLinkTool(): DefinedTool {
  return defineTool({
    name: "get_checkout_link",
    title: "Checkout link",
    description: "Returns the Shopify checkout URL for the current cart together with the store password. The human opens the link, enters the password once, and completes the purchase themselves (this is a test store: card number 1 succeeds).",
    group: "checkout",
    readOnly: true,
    input: z.object({}).strict(),
    async handler(_input, context) {
      const current = await context.shopify.cartGet();
      if (!current.ok) return unavailable(current.detail);
      syncCart(context, current.value);
      if (current.value.lines.length === 0) {
        return { ok: false, error: "blocked", detail: "The cart is empty.", suggestion: "Add a product with update_cart first." };
      }
      const checkout = await context.shopify.checkoutLink();
      if (!checkout.ok) return unavailable(checkout.detail);
      return {
        ok: true,
        checkout_url: checkout.value.checkoutUrl,
        store_password: checkout.value.storePassword,
        count: current.value.count,
        subtotal_usd: Math.round(current.value.subtotalUsd),
        note: "Development store: the checkout asks for the store password first.",
        hint: "Share the link and password with the human; they complete the purchase.",
      };
    },
    summarize(_input, result) {
      const subtotal = result.ok && typeof result.subtotal_usd === "number" ? result.subtotal_usd : 0;
      return result.ok ? `Prepared checkout link · $${money(subtotal)}` : "Checkout link failed";
    },
  });
}
