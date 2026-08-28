import * as z from "zod";
import type { DefinedTool, ToolResult, ToolSpec } from "../define";
import { defineTool } from "../define";
import {
  anchorParam, colorwayParam, describeParam, itemParam, posParam, productParam, roomParam, rotationParam,
} from "../params";

export const pendingTools = [
  "get_scene_summary", "get_room_details", "get_selection", "measure", "get_conflicts", "get_design_report",
  "search_catalog", "get_product", "get_cart", "place_furniture", "move_furniture", "arrange_room",
  "preview_in_room", "update_cart", "export_design_board", "confirm_preview", "compare_variants", "get_checkout_link",
] as const;

const unavailable: ToolResult = {
  ok: false,
  error: "unavailable",
  detail: "This tool is registered but its data-heavy engine adapter is not available yet.",
};

function pending<InputSchema extends z.ZodObject>(spec: Omit<ToolSpec<InputSchema>, "handler" | "summarize">): DefinedTool {
  return defineTool({
    ...spec,
    handler: () => unavailable,
    summarize: () => `${spec.title} — unavailable`,
  });
}

const category = z.enum(["sofa", "armchair", "bed", "wardrobe", "table", "desk", "chair", "shelf", "tv-unit", "rug", "floor-lamp", "table-lamp", "plant", "decor"]);

/** Definitions stay registered so the 26-tool cold-start contract holds while handlers land in round two. */
export function pendingToolDefinitions(): DefinedTool[] {
  return [
    pending({
      name: "get_scene_summary", title: "Scene summary", group: "core", readOnly: true,
      description: "Overview of the whole home: every room with id, name, type, size in m², wall sides with lengths in cm, item count and conflict count; plus the current mode, view, time of day, accessibility flag, active room, the human's selection, cart subtotal and design budget in USD. Call it first to learn room and item ids before reading details or placing furniture.",
      input: z.object({}).strict(),
    }),
    pending({
      name: "get_room_details", title: "Room details", group: "core", readOnly: true,
      description: "Details of one room: walls (id, side, length in cm and the free spans where furniture can go), openings (doors, windows, arches with wall, offset, width and swing) and every placed item with id, name, position, rotation, footprint and colorway. Coordinates are room-local in cm: origin at the north-west corner, x east, y south. Use it before placing or moving furniture in that room.",
      input: z.object({ room: roomParam.optional() }).strict(),
    }),
    pending({
      name: "get_selection", title: "Human selection", group: "core", readOnly: true,
      description: "What the human is pointing at right now: the selected item, hovered item, last moved item (and whether the human or the agent moved it), the selected room and the camera focus. Use it to resolve words like this, that, here or the one I clicked before acting.",
      input: z.object({}).strict(),
    }),
    pending({
      name: "measure", title: "Measure", group: "core", readOnly: true,
      description: "Measures in cm: a wall's length and free spans, an item's footprint, the gap between two items, or the distance from an item to a wall or opening. Subjects are wall sides (north, east, south, west), wall ids (w0…), item ids or names, or opening ids. Use it to check fit before placing or moving.",
      input: z.object({
        subject: z.string().min(1).describe(describeParam("What to measure: a wall side or id, an item id or name, or an opening id.")),
        to: z.string().min(1).optional().describe(describeParam("Optional second thing (wall, item or opening) to measure the gap or distance to.")),
        room: roomParam.optional(),
      }).strict(),
    }),
    pending({
      name: "get_conflicts", title: "Layout conflicts", group: "core", readOnly: true,
      description: "Lists layout problems in a room or the whole home: overlapping items, items outside the room, missing clearance in front of seating, beds and desks, blocked door swings, pinched traffic paths and, when accessibility mode is on, paths under 90 cm and missing 150 cm turning circles. Each conflict names the items involved and a concrete fix in cm.",
      input: z.object({
        room: z.string().min(1).optional().describe(describeParam("Room id or name, or all for the whole home. Defaults to the active room.")),
      }).strict(),
    }),
    pending({
      name: "get_design_report", title: "Design report", group: "core", readOnly: true,
      description: "Design critique of a room scored 0–10 on balance, focal point, conversation seating, lighting coverage, storage and traffic flow, with an overall score out of 100 and the top three improvements. Use it to review a layout or to explain why a room feels off.",
      input: z.object({ room: roomParam.optional() }).strict(),
    }),
    pending({
      name: "search_catalog", title: "Search catalog", group: "core", readOnly: true, untrusted: true,
      description: "Searches Hearth Studio's furniture catalog (Shopify). Filter by category, maximum price in USD, maximum width and depth in cm, style, colorway, or the wall it must fit (fits_wall) in a room. Returns up to 6 products with id, price, dimensions, colorways and a fit note such as fits north wall · 12 cm spare. Product ids from here are used by place_furniture, preview_in_room and update_cart.",
      input: z.object({
        query: z.string().optional().describe(describeParam("Free-text search, e.g. small oak desk.")),
        category: category.optional().describe(describeParam("Furniture category.")),
        max_price_usd: z.number().nonnegative().optional().describe(describeParam("Maximum product price in USD.")),
        max_width_cm: z.number().positive().optional().describe(describeParam("Maximum product width in cm.")),
        max_depth_cm: z.number().positive().optional().describe(describeParam("Maximum product depth in cm.")),
        fits_wall: z.string().optional().describe(describeParam("Only products whose width fits a free span on this wall (north, east, south, west or wall id) of the room.")),
        room: roomParam.optional(),
        style: z.string().optional().describe(describeParam("Style tag such as scandinavian, japandi, mid-century, rustic, modern.")),
        colorway: colorwayParam.optional(),
        limit: z.number().int().min(1).max(6).default(6).describe(describeParam("Maximum results, from 1 to 6; default 6.")),
      }).strict(),
    }),
    pending({
      name: "get_product", title: "Product details", group: "core", readOnly: true, untrusted: true,
      description: "Full details of one catalog product: dimensions in cm, price in USD, colorways, front clearance needed, seat count, style tags and which walls of a room it fits with the spare cm. Use it to confirm a product before placing, previewing or adding it to the cart.",
      input: z.object({ product: productParam, room: roomParam.optional() }).strict(),
    }),
    pending({
      name: "get_cart", title: "Cart", group: "core", readOnly: true,
      description: "The shopping cart: each line with product, colorway, quantity, unit and line price in USD, the subtotal, the design budget and how much of it remains, and whether checkout is available. Lines note which placed item they belong to.",
      input: z.object({}).strict(),
    }),
    pending({
      name: "place_furniture", title: "Place furniture", group: "design",
      description: "Places a catalog product in a room as a new item. Position it with an anchor in words (back against a wall at start, center, end or N cm along it; facing an item or the room centre; next to an item with a gap; centred; or under a window) or with a raw pos in cm and a rotation. The engine snaps to the wall, nudges up to 60 cm to avoid collisions and reports conflicts. Returns the new item id.",
      input: z.object({ product: productParam, room: roomParam.optional(), anchor: anchorParam.optional(), pos: posParam.optional(), rotation: rotationParam.optional(), colorway: colorwayParam.optional() }).strict(),
    }),
    pending({
      name: "move_furniture", title: "Move furniture", group: "design",
      description: "Moves and/or rotates a placed item. Give an anchor in words (wall + along, facing, next_to, centered, under), a raw pos in cm, a delta in cm, a rotation (0, 90, 180 or 270 clockwise; 0 faces south) or rotate_by, and optionally another room. Snaps and nudges like place_furniture and returns the resolved position and any conflicts.",
      input: z.object({
        item: itemParam, anchor: anchorParam.optional(), pos: posParam.optional(),
        delta_cm: z.object({
          x: z.number().optional().describe(describeParam("East-west shift in cm; positive is east.")),
          y: z.number().optional().describe(describeParam("North-south shift in cm; positive is south.")),
        }).strict().optional().describe(describeParam("Shift by this many cm: x positive = east, y positive = south.")),
        rotation: rotationParam.optional(),
        rotate_by: z.union([z.literal(90), z.literal(-90), z.literal(180)]).optional().describe(describeParam("Turn by 90 (clockwise), -90 (counter-clockwise) or 180 degrees.")),
        room: z.string().optional().describe(describeParam("Move the item into this room (id or name). Defaults to its current room.")),
      }).strict(),
    }),
    pending({
      name: "arrange_room", title: "Arrange room", group: "design",
      description: "Re-arranges all unlocked furniture in a room in one animated pass. Styles: conversation (seating faces each other around a focal point), media (seating faces the TV or media wall), open (maximum clear floor and walkways), work (desk by the window, storage on the walls). Keeps door swings and clearances free and reports what moved with the conflict count before and after.",
      input: z.object({
        room: roomParam.optional(),
        style: z.enum(["conversation", "media", "open", "work"]).describe(describeParam("Arrangement style: conversation, media, open or work.")),
        keep_locked: z.boolean().default(true).describe(describeParam("Keep locked furniture in place; default true.")),
        focus: z.string().optional().describe(describeParam("Optional focal point: an item id or name (e.g. the fireplace or TV) or window:<id>.")),
      }).strict(),
    }),
    pending({
      name: "preview_in_room", title: "Preview in room", group: "shop",
      description: "Try before you buy: shows a translucent ghost of a catalog product at an anchor or position in a room with its price, fit and conflicts, without changing the layout or the cart. One preview at a time; confirm_preview keeps it and cancel_preview discards it.",
      input: z.object({ product: productParam, room: roomParam.optional(), anchor: anchorParam.optional(), pos: posParam.optional(), rotation: rotationParam.optional(), colorway: colorwayParam.optional() }).strict(),
    }),
    pending({
      name: "update_cart", title: "Update cart", group: "shop",
      description: "Changes the Shopify cart. add: adds a product (by product id or a placed item) in a colorway with a quantity; remove: removes that product's line; set_quantity: sets the line's quantity. Returns the new subtotal in USD and the remaining budget. Purchases are completed by the human at checkout.",
      input: z.object({
        action: z.enum(["add", "remove", "set_quantity"]).describe(describeParam("Cart action: add, remove or set_quantity.")),
        product: z.string().optional().describe(describeParam("Catalog product id or name. Give either product or item.")),
        item: z.string().optional().describe(describeParam("Placed item id or name; its product and colorway are used and the cart line is linked to it.")),
        colorway: colorwayParam.optional(),
        quantity: z.number().int().nonnegative().optional().describe(describeParam("Quantity for add (default 1) or set_quantity.")),
      }).strict(),
    }),
    pending({
      name: "export_design_board", title: "Export design board", group: "present",
      description: "Creates a design board PNG for a room: dollhouse render, plan view, palette swatches and an itemised list with prices and the total, then starts the download in the page. Use it to present or share a finished layout.",
      input: z.object({ room: roomParam.optional(), title: z.string().max(100).optional().describe(describeParam("Board title (default the room name).")) }).strict(),
    }),
    pending({
      name: "confirm_preview", title: "Confirm preview", group: "preview",
      description: "Keeps the current preview: the ghost becomes a placed item with its colorway and Shopify variant linked. Optionally adds it to the cart in the same step.",
      input: z.object({ add_to_cart: z.boolean().default(false).describe(describeParam("true also adds the kept preview to the cart.")) }).strict(),
    }),
    pending({
      name: "compare_variants", title: "Compare variants", group: "variants",
      description: "Shows two saved layout variants of a room side by side with a draggable split slider and returns their differences (items only in one of them, items that moved) and the conflict count of each. Any layout change closes the comparison.",
      input: z.object({
        left: z.string().min(1).describe(describeParam("Saved variant name for the left/right half.")),
        right: z.string().min(1).describe(describeParam("Saved variant name for the left/right half.")),
        room: roomParam.optional(),
      }).strict(),
    }),
    pending({
      name: "get_checkout_link", title: "Checkout link", group: "checkout", readOnly: true,
      description: "Returns the Shopify checkout URL for the current cart together with the store password. The human opens the link, enters the password once, and completes the purchase themselves (this is a test store: card number 1 succeeds).",
      input: z.object({}).strict(),
    }),
  ];
}
