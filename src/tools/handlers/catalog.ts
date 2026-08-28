import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import { clip, dimsStr } from "../../engine/describe";
import { fitNote, searchCatalog, wallFits } from "../../engine/fit";
import type { Category } from "../../engine/types";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { colorwayParam, describeParam, productParam, roomParam } from "../params";
import { notFound, resolveProduct, resolveRoom, resolveRoomWall } from "./resolve";

const categories = [
  "sofa", "armchair", "bed", "wardrobe", "table", "desk", "chair", "shelf", "tv-unit", "rug",
  "floor-lamp", "table-lamp", "plant", "decor",
] as const satisfies readonly Category[];

function searchSummary(input: {
  query?: string;
  category?: Category;
  max_price_usd?: number;
}, count: number): string {
  const noun = input.query?.trim() || (input.category ? `${input.category}s` : "catalog");
  const price = input.max_price_usd === undefined ? "" : ` under $${Math.round(input.max_price_usd)}`;
  return `Searched catalog: ${noun}${price} (${count})`;
}

export function searchCatalogTool(): DefinedTool {
  return defineTool({
    name: "search_catalog",
    title: "Search catalog",
    description: "Searches Hearth Studio's furniture catalog (Shopify). Filter by category, maximum price in USD, maximum width and depth in cm, style, colorway, or the wall it must fit (fits_wall) in a room. Returns up to 6 products with id, price, dimensions, colorways and a fit note such as fits north wall · 12 cm spare. Product ids from here are used by place_furniture, preview_in_room and update_cart.",
    group: "core",
    readOnly: true,
    untrusted: true,
    input: z.object({
      query: z.string().optional().describe(describeParam("Free-text search, e.g. small oak desk.")),
      category: z.enum(categories).optional().describe(describeParam("Furniture category.")),
      max_price_usd: z.number().nonnegative().optional().describe(describeParam("Maximum product price in USD.")),
      max_width_cm: z.number().positive().optional().describe(describeParam("Maximum product width in cm.")),
      max_depth_cm: z.number().positive().optional().describe(describeParam("Maximum product depth in cm.")),
      fits_wall: z.string().min(1).optional().describe(describeParam("Only products whose width fits a free span on this wall (north, east, south, west or wall id) of the room.")),
      room: roomParam.optional(),
      style: z.string().min(1).optional().describe(describeParam("Style tag such as scandinavian, japandi, mid-century, rustic, modern.")),
      colorway: colorwayParam.optional(),
      limit: z.number().int().min(1).max(6).default(6).describe(describeParam("Maximum results, from 1 to 6; default 6.")),
    }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const room = input.fits_wall || input.room ? resolveRoom(state, input.room) : undefined;
      if (room && "ok" in room) return room;
      const wall = room && input.fits_wall ? resolveRoomWall(room, input.fits_wall) : undefined;
      if (wall && "ok" in wall) return wall;
      const searched = await context.shopify.search(input.query ?? "");
      if (!searched.ok) return { ok: false, error: "unavailable", detail: searched.detail };
      const remote = new Map(searched.value.map((product) => [product.id, product]));
      const catalog = state.catalog.map((product) => remote.get(product.id) ?? product);
      const products = searchCatalog(catalog, {
        query: input.query,
        category: input.category,
        maxPriceUsd: input.max_price_usd,
        maxWidthCm: input.max_width_cm,
        maxDepthCm: input.max_depth_cm,
        style: input.style,
        colorway: input.colorway,
        limit: input.limit,
      }, room ? {
        scene: state.scene,
        roomId: room.id,
        ...(input.fits_wall ? { fitsWall: input.fits_wall } : {}),
      } : undefined);
      return {
        ok: true,
        count: products.length,
        results: products.map((product) => ({
          id: product.id,
          name: product.name,
          category: product.category,
          price_usd: Math.round(product.price ?? 0),
          dims: dimsStr(product.dims),
          colorways: product.colorways.map((colorway) => colorway.id).join(", "),
          ...(room && wall && !("ok" in wall) ? { fit: fitNote(state.scene, room, wall, product, catalog) } : {}),
          style: product.styleTags.join(", "),
        })),
        hint: products.length > 0 ? "Use get_product to inspect one result, or place_furniture to add it." : "Broaden the filters or try a smaller product.",
      };
    },
    summarize(input, result) {
      return result.ok
        ? searchSummary(input, typeof result.count === "number" ? result.count : 0)
        : "Search catalog failed";
    },
  });
}

export function getProductTool(): DefinedTool {
  return defineTool({
    name: "get_product",
    title: "Product details",
    description: "Full details of one catalog product: dimensions in cm, price in USD, colorways, front clearance needed, seat count, style tags and which walls of a room it fits with the spare cm. Use it to confirm a product before placing, previewing or adding it to the cart.",
    group: "core",
    readOnly: true,
    untrusted: true,
    input: z.object({ product: productParam, room: roomParam.optional() }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const resolved = resolveProduct(state, input.product);
      if ("ok" in resolved) return resolved;
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const remote = await context.shopify.product(resolved.id);
      if (!remote.ok) {
        if (remote.error === "not_found") return notFound("Product", input.product, state.catalog);
        return { ok: false, error: "unavailable", detail: remote.detail };
      }
      const product = remote.value;
      const catalog = createCatalog(state.catalog);
      return {
        ok: true,
        product: {
          id: product.id,
          name: product.name,
          category: product.category,
          price_usd: Math.round(product.price),
          dims: dimsStr(product.dims),
          clearance_front_cm: Math.round(product.clearanceFront),
          ...(product.seatCount === undefined ? {} : { seat_count: product.seatCount }),
          colorways: product.colorways.map((colorway) => colorway.id),
          style_tags: product.styleTags,
          description: clip(product.description ?? "", 200),
        },
        fits: {
          room: room.id,
          walls: wallFits(state.scene, room, product, catalog).slice(0, 6).map((fit) => ({
            wall: fit.wall,
            side: fit.side,
            fits: fit.fits,
            spare_cm: Math.round(fit.spareCm),
          })),
        },
        in_scene: state.scene.furniture.filter((item) => item.catalogId === product.id && item.status === "placed").map((item) => item.id),
        hint: "Use place_furniture or preview_in_room with this product id.",
      };
    },
    summarize(_input, result) {
      if (!result.ok) return "Read product failed";
      const product = result.product as { name?: string } | undefined;
      return `Read product ${product?.name ?? "details"}`;
    },
  });
}
