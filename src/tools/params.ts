import * as z from "zod";

/** Keeps contract descriptions at their declaration sites and rejects accidental bloat. */
export function describeParam(text: string): string {
  if (text.length > 150) throw new Error(`Parameter description exceeds 150 characters: ${text}`);
  return text;
}

export const roomParam = z.string().min(1).describe(describeParam(
  "Room id or name, e.g. living or Living Room. Defaults to the active room.",
));

export const itemParam = z.string().min(1).describe(describeParam(
  "Placed item id (e.g. sofa-1) or its name. Use selected for the human's current selection.",
));

export const productParam = z.string().min(1).describe(describeParam(
  "Catalog product id (e.g. sofa-endre) or product name from search_catalog.",
));

export const colorwayParam = z.string().min(1).describe(describeParam(
  "Colorway id or name, e.g. oak, sage, terracotta, dusty-blue.",
));

export const openingParam = z.string().min(1).describe(describeParam(
  "Opening id, e.g. door-1 or window-2.",
));

export const rotationParam = z.literal([0, 90, 180, 270]).describe(describeParam(
  "0, 90, 180 or 270 degrees clockwise; 0 = front faces south.",
));

export const posParam = z.object({
  x: z.number().describe(describeParam("Footprint centre x in cm; positive points east.")),
  y: z.number().describe(describeParam("Footprint centre y in cm; positive points south.")),
}).strict().describe(describeParam(
  "Raw footprint centre in cm, room-local (origin north-west corner, x east, y south). Use anchor when possible.",
));

export const anchorParam = z.object({
  wall: z.string().min(1).optional().describe(describeParam(
    "Wall the back goes against: north, east, south, west, or a wall id such as w2.",
  )),
  along: z.union([z.enum(["start", "center", "end"]), z.number()]).optional().describe(describeParam(
    "Position along that wall: start, center, end, or a number of cm from the wall's start (clockwise).",
  )),
  facing: z.string().min(1).optional().describe(describeParam(
    "What the front faces: an item id or name, room_center, wall:<side>, or window:<id>.",
  )),
  next_to: z.string().min(1).optional().describe(describeParam(
    "Item id or name to sit beside.",
  )),
  side: z.enum(["left", "right", "front", "behind"]).optional().describe(describeParam(
    "Side of next_to to use: left, right, front or behind (from that item's point of view).",
  )),
  gap_cm: z.number().nonnegative().optional().describe(describeParam(
    "Gap in cm between the two items (default 10).",
  )),
  centered: z.boolean().optional().describe(describeParam(
    "true to centre the item in the room.",
  )),
  under: z.string().min(1).optional().describe(describeParam(
    "window:<id> to centre the item under that window with its back to the wall.",
  )),
}).strict().describe(describeParam(
  "Where to put it, in words: wall + along, facing, next_to + side + gap_cm, centered, or under a window. Preferred over pos.",
));

export const sharedParams = {
  room: roomParam,
  item: itemParam,
  product: productParam,
  colorway: colorwayParam,
  opening: openingParam,
  rotation: rotationParam,
  pos: posParam,
  anchor: anchorParam,
} as const;

/**
 * Aliases the models actually send. TOOLS.md §0 names the parameters `room`, `item` and `product`,
 * and every schema is strict, so a model that writes `room_id` gets `invalid` and burns a turn
 * correcting itself — which is exactly what the live assistant run showed (`room_id` for `room`
 * three times in one conversation). The schema stays as documented; the alias is rewritten on the
 * way in, before zod sees it.
 *
 * Only the top level is rewritten. `anchor` speaks in its own words (`next_to`, `facing`, `under`)
 * and has never been sent with an `_id` suffix, so nothing is guessed there.
 */
const ALIASES: Record<string, string> = {
  room_id: "room",
  roomId: "room",
  item_id: "item",
  itemId: "item",
  product_id: "product",
  productId: "product",
};

/**
 * Rewrites known parameter aliases onto their contract names. The canonical key always wins, the
 * alias is dropped either way, and anything that is not a plain object is returned untouched so the
 * caller's own error handling still sees what it was given.
 */
export function normalizeToolInput(input: unknown): unknown {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return input;
  const source = input as Record<string, unknown>;
  if (!Object.keys(source).some((key) => key in ALIASES)) return input;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!(key in ALIASES)) result[key] = value;
  }
  for (const [key, value] of Object.entries(source)) {
    const canonical = ALIASES[key];
    if (canonical !== undefined && result[canonical] === undefined) result[canonical] = value;
  }
  return result;
}
