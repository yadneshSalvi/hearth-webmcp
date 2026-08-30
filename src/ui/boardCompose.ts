/**
 * Design-board layout — pure geometry and copy for the 1600 × 1000 PNG (TOOLS.md §26).
 *
 * Everything here is deterministic and canvas-free so the composition is unit-tested rather than
 * eyeballed: the frame is a fixed grid, images are fitted into their boxes with cover/contain maths,
 * and the itemised list groups duplicates and truncates to the rows the board has room for.
 */
import { roomAreaM2 } from "../engine/geometry";
import type { CatalogItem, Furniture, Room, TimeOfDay } from "../engine/types";
import type { PaletteId } from "../tokens";
import { floorHex, palettePresets, wallColorHex } from "../tokens";
import { colorwayHex, colorwayLabel, dimsLine, plural, timeOfDayLabel, usd } from "./format";

export const BOARD_WIDTH = 1600;
export const BOARD_HEIGHT = 1000;
export const BOARD_SIZE_PX = `${BOARD_WIDTH}x${BOARD_HEIGHT}`;

/** Rows the itemised list can show before it collapses the rest into one "+ n more" line. */
export const MAX_LIST_ROWS = 8;

/** Header and total block reserved inside the list column, in px. */
const LIST_HEAD = 40;
const LIST_TOTAL = 74;
const ROW_MIN = 34;
const ROW_MAX = 56;
/** The "+ n more items" line, when there is one. */
const MORE_LINE = 24;

export interface BoardRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardLayout {
  pad: number;
  /** Baseline of the Fraunces title. */
  titleBaseline: number;
  capsBaseline: number;
  markRight: number;
  headRuleY: number;
  dollhouse: BoardRect;
  plan: BoardRect;
  palette: BoardRect;
  list: BoardRect;
  footRuleY: number;
  footBaseline: number;
}

/**
 * The board's grid: a 2 × 2 field between two hairlines. Dollhouse and itemised list on top, plan
 * and palette across the bottom, so no corner of the board is left empty.
 */
export function boardLayout(): BoardLayout {
  const pad = 56;
  const contentWidth = BOARD_WIDTH - pad * 2;
  const gap = 40;
  const listWidth = 448;
  // Shaped like a room rather than like the window: the plan shot is cropped to the room's own
  // footprint before it lands here (`planCrop` in src/ui/boardExport.ts), so a tile near 3:2 holds
  // an ordinary room with barely any letterbox — and a wide room keeps its southern wall.
  const planWidth = 300;
  const contentTop = 196;
  const footRuleY = BOARD_HEIGHT - pad - 48;
  const contentBottom = footRuleY - 14;
  const upperHeight = 468;
  const lowerTop = contentTop + upperHeight + 22;

  return {
    pad,
    titleBaseline: 118,
    capsBaseline: 152,
    markRight: BOARD_WIDTH - pad,
    headRuleY: 176,
    dollhouse: { x: pad, y: contentTop, w: contentWidth - listWidth - gap, h: upperHeight },
    list: { x: pad + contentWidth - listWidth, y: contentTop, w: listWidth, h: upperHeight },
    plan: { x: pad, y: lowerTop, w: planWidth, h: contentBottom - lowerTop },
    palette: { x: pad + planWidth + gap, y: lowerTop, w: contentWidth - planWidth - gap, h: contentBottom - lowerTop },
    footRuleY,
    footBaseline: BOARD_HEIGHT - pad + 4,
  };
}

/**
 * Row height for the itemised list: a short list breathes, a long one tightens, and neither ever
 * runs into the total pinned at the foot of the column.
 */
export function listRowHeight(rows: number, boxHeight: number, hasMore = false): number {
  if (rows <= 0) return ROW_MAX;
  const available = boxHeight - LIST_HEAD - LIST_TOTAL - (hasMore ? MORE_LINE : 0);
  return Math.max(ROW_MIN, Math.min(ROW_MAX, Math.floor(available / rows)));
}

export interface BoardFit {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/** Fills the box and crops the overflow — used for the dollhouse render, which has room to spare. */
export function fitCover(source: { w: number; h: number }, box: BoardRect): BoardFit {
  if (source.w <= 0 || source.h <= 0) return { sx: 0, sy: 0, sw: 1, sh: 1, dx: box.x, dy: box.y, dw: box.w, dh: box.h };
  const scale = Math.max(box.w / source.w, box.h / source.h);
  const sw = Math.min(source.w, box.w / scale);
  const sh = Math.min(source.h, box.h / scale);
  return {
    sx: (source.w - sw) / 2,
    sy: (source.h - sh) / 2,
    sw,
    sh,
    dx: box.x,
    dy: box.y,
    dw: box.w,
    dh: box.h,
  };
}

/** Fits the whole frame inside the box, letterboxed on the tile's plaster. */
export function fitContain(source: { w: number; h: number }, box: BoardRect): BoardFit {
  if (source.w <= 0 || source.h <= 0) return { sx: 0, sy: 0, sw: 1, sh: 1, dx: box.x, dy: box.y, dw: box.w, dh: box.h };
  const scale = Math.min(box.w / source.w, box.h / source.h);
  const dw = source.w * scale;
  const dh = source.h * scale;
  return {
    sx: 0,
    sy: 0,
    sw: source.w,
    sh: source.h,
    dx: box.x + (box.w - dw) / 2,
    dy: box.y + (box.h - dh) / 2,
    dw,
    dh,
  };
}

/** How much of the source a cover fit would throw away, as a fraction of its longer overflow. */
export function cropFraction(source: { w: number; h: number }, box: BoardRect): number {
  if (source.w <= 0 || source.h <= 0 || box.w <= 0 || box.h <= 0) return 0;
  const scale = Math.max(box.w / source.w, box.h / source.h);
  const keptWidth = Math.min(source.w, box.w / scale);
  const keptHeight = Math.min(source.h, box.h / scale);
  return Math.max(1 - keptWidth / source.w, 1 - keptHeight / source.h);
}

/**
 * Fills the box, unless filling it would crop away more than `maxCrop` of the frame — a wide home in
 * plan view would lose a room that way, and a letterboxed plan is better than a cut one.
 */
export function fitImage(source: { w: number; h: number }, box: BoardRect, maxCrop = 0.3): BoardFit {
  return cropFraction(source, box) > maxCrop ? fitContain(source, box) : fitCover(source, box);
}

/** A rectangle of a captured frame, in 0–1 of its width and height. */
export interface BoardCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Contains `crop` — a sub-rectangle of the source, in normalised coordinates — inside the box.
 * Nothing inside the crop is ever cut: the board says "Living Room · 22.9 m²", so the picture under
 * that heading has to be the whole of it, southern wall included.
 */
export function fitCropped(source: { w: number; h: number }, crop: BoardCrop, box: BoardRect): BoardFit {
  const sw = Math.max(1, crop.w * source.w);
  const sh = Math.max(1, crop.h * source.h);
  const contained = fitContain({ w: sw, h: sh }, box);
  return { ...contained, sx: crop.x * source.w, sy: crop.y * source.h, sw, sh };
}

export interface BoardRow {
  /** "Endre Sofa" or "Nook Armchair ×2". */
  name: string;
  /** "Oak · 220 × 95 cm". */
  meta: string;
  /** "$1,580" — the line total for the group. */
  price: string;
  count: number;
}

export interface BoardSwatch {
  label: string;
  name: string;
  hex: string;
}

export interface BoardModel {
  title: string;
  /** "LIVING ROOM · 24.5 M² · 7 ITEMS" */
  caps: string;
  rows: BoardRow[];
  /** Items the list had no room for, already summarised in `moreLine`. */
  hidden: number;
  moreLine?: string;
  totalUsd: number;
  total: string;
  itemCount: number;
  swatches: BoardSwatch[];
  footerLeft: string;
  footerRight: string;
}

function groupKey(item: Furniture): string {
  return `${item.catalogId}|${item.colorway}`;
}

/**
 * Groups the room's placed items by product and colourway, sorted by spend so the board leads with
 * the pieces that carry the room, and keeps the total honest even when rows are truncated.
 */
export function boardRows(
  items: Furniture[],
  byId: (id: string) => CatalogItem | undefined,
  maxRows = MAX_LIST_ROWS,
): { rows: BoardRow[]; hidden: number; moreLine?: string; totalUsd: number } {
  const groups = new Map<string, { product: CatalogItem; colorway: string; count: number }>();
  let totalUsd = 0;
  for (const item of items) {
    const product = byId(item.catalogId);
    if (!product) continue;
    totalUsd += product.price ?? 0;
    const key = groupKey(item);
    const current = groups.get(key);
    if (current) current.count += 1;
    else groups.set(key, { product, colorway: item.colorway, count: 1 });
  }

  const all: Array<BoardRow & { spend: number }> = [...groups.values()]
    .map((group) => {
      const spend = (group.product.price ?? 0) * group.count;
      return {
        name: group.count > 1 ? `${group.product.name} ×${group.count}` : group.product.name,
        meta: `${colorwayLabel(group.colorway)} · ${dimsLine(group.product.dims)}`,
        price: usd(spend),
        count: group.count,
        spend,
      };
    })
    .sort((a, b) => b.spend - a.spend || a.name.localeCompare(b.name));

  const row = (entry: BoardRow & { spend: number }): BoardRow => ({
    name: entry.name, meta: entry.meta, price: entry.price, count: entry.count,
  });
  if (all.length <= maxRows) {
    return { rows: all.map(row), hidden: 0, totalUsd: Math.round(totalUsd) };
  }
  const rest = all.slice(maxRows - 1);
  const hidden = rest.reduce((sum, entry) => sum + entry.count, 0);
  return {
    rows: all.slice(0, maxRows - 1).map(row),
    hidden,
    moreLine: `+ ${plural(hidden, "more item")} · ${usd(rest.reduce((sum, entry) => sum + entry.spend, 0))}`,
    totalUsd: Math.round(totalUsd),
  };
}

/** Wall, floor and textile of the room's palette — the three colours the render is actually made of. */
export function boardSwatches(room: Room, paletteId: PaletteId): BoardSwatch[] {
  const preset = palettePresets[paletteId];
  return [
    { label: "Wall", name: wallLabel(room.wallColor ?? "plaster"), hex: wallColorHex(room.wallColor ?? "plaster") },
    { label: "Floor", name: floorLabel(room.floor), hex: floorHex(room.floor) },
    { label: "Textile", name: colorwayLabel(preset.textiles), hex: colorwayHex(preset.textiles) },
  ];
}

function wallLabel(color: string): string {
  return color === "plaster" ? "Plaster" : `${colorwayLabel(color.replace(/-tint$/, ""))} tint`;
}

function floorLabel(floor: string): string {
  return floor.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());
}

export interface BoardModelInput {
  title: string;
  room: Room;
  items: Furniture[];
  byId: (id: string) => CatalogItem | undefined;
  paletteId: PaletteId;
  timeOfDay: TimeOfDay;
  maxRows?: number;
}

/** Everything the painter needs, computed once from the scene. */
export function boardModel(input: BoardModelInput): BoardModel {
  const { rows, hidden, moreLine, totalUsd } = boardRows(input.items, input.byId, input.maxRows ?? MAX_LIST_ROWS);
  return {
    title: input.title,
    // The title is usually the room's name; repeating it in the caps line would be noise.
    caps: [
      input.room.name.trim().toLowerCase() === input.title.trim().toLowerCase() ? undefined : input.room.name,
      `${roomAreaM2(input.room).toFixed(1)} m²`,
      plural(input.items.length, "item"),
    ].filter((part): part is string => part !== undefined).join(" · ").toUpperCase(),
    rows,
    hidden,
    ...(moreLine ? { moreLine } : {}),
    totalUsd,
    total: usd(totalUsd),
    itemCount: input.items.length,
    swatches: boardSwatches(input.room, input.paletteId),
    footerLeft: "Hearth Studio · hearth.yadneshsalvi.com",
    footerRight: `${palettePresets[input.paletteId].name} · ${timeOfDayLabel(input.timeOfDay)} light`.toUpperCase(),
  };
}

/**
 * Trims a string to a pixel width with a trailing ellipsis. `measure` is the canvas text measurer,
 * injected so the maths is testable without a DOM.
 */
export function truncateToWidth(text: string, maxWidth: number, measure: (value: string) => number): string {
  if (maxWidth <= 0) return "";
  if (measure(text) <= maxWidth) return text;
  let low = 0;
  let high = text.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measure(`${text.slice(0, middle).trimEnd()}…`) <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return low === 0 ? "…" : `${text.slice(0, low).trimEnd()}…`;
}
