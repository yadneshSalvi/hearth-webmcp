/**
 * Scene-graph types — the executable form of SCENE_SCHEMA.md. Units: centimetres (integers preferred).
 * Room-local frame: origin at the room's north-west corner, x → east, y → south.
 * Rotation: degrees clockwise seen from above; 0 = the item's front faces south.
 */
import type { ColorwayId, Floor, PaletteId, WallColor } from "../tokens";

export type Vec2 = { x: number; y: number };
export type Rotation = 0 | 90 | 180 | 270;
export type Side = "north" | "east" | "south" | "west";

export const ROTATIONS: readonly Rotation[] = [0, 90, 180, 270];
export const SIDES: readonly Side[] = ["north", "east", "south", "west"];

/** Derived from Room.poly — never stored. Ids are "w0".."wn", clockwise from the NW corner. */
export interface Wall {
  id: string;
  side: Side;
  a: Vec2;
  b: Vec2;
  length: number;
}

export type RoomType = "living" | "bedroom" | "kitchen" | "dining" | "office" | "bath" | "hall" | "studio";
export const ROOM_TYPES: readonly RoomType[] = ["living", "bedroom", "kitchen", "dining", "office", "bath", "hall", "studio"];

export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** Clockwise, rectangular (4 points) or L-shaped (6 points), room-local. */
  poly: Vec2[];
  /** World offset of the room's NW corner. */
  origin: Vec2;
  floor: Floor;
  /** Palette token name; default "plaster". */
  wallColor?: WallColor;
}

export type OpeningKind = "door" | "window" | "arch";

export interface Opening {
  id: string;
  roomId: string;
  wallId: string;
  /** cm from the wall's start (clockwise) to the opening's start. */
  offset: number;
  width: number;
  kind: OpeningKind;
  /** Doors only; "in" = swings into this room. */
  swing?: "in" | "out";
  /** Looking at the wall from inside the room. */
  hinge?: "left" | "right";
  /** Windows only. */
  sillHeight?: number;
}

export type Category =
  | "sofa"
  | "armchair"
  | "bed"
  | "wardrobe"
  | "table"
  | "desk"
  | "chair"
  | "shelf"
  | "tv-unit"
  | "rug"
  | "floor-lamp"
  | "table-lamp"
  | "plant"
  | "decor";

export const CATEGORIES: readonly Category[] = [
  "sofa", "armchair", "bed", "wardrobe", "table", "desk", "chair", "shelf", "tv-unit", "rug", "floor-lamp", "table-lamp", "plant", "decor",
];

export interface Dims {
  /** Left–right when facing the item's front. */
  w: number;
  d: number;
  h: number;
}

export interface Colorway {
  id: ColorwayId;
  name: string;
  hex: string;
}

/** Static per product (Shopify snapshot or built-in kit). `id` = Shopify handle. */
export interface CatalogItem {
  id: string;
  name: string;
  category: Category;
  dims: Dims;
  /** cm of walkway/use space required in front (sofa 75, bed 60, desk 90 …). */
  clearanceFront: number;
  seatCount?: number;
  /** /assets/glb/<id>.glb */
  glb: string;
  colorways: Colorway[];
  styleTags: string[];
  /** USD */
  price?: number;
  /** ≤ 200 chars, shown in the catalog and pushed to Shopify. */
  description?: string;
  shopify?: { productId: string; variantIds: Record<string, string> };
  /** Sofas/beds/wardrobes prefer a wall; rugs/tables do not. */
  againstWall?: boolean;
}

export type FurnitureStatus = "placed" | "ghost";

export interface Furniture {
  id: string;
  catalogId: string;
  roomId: string;
  /** Centre of the footprint, room-local. */
  pos: Vec2;
  rotation: Rotation;
  colorway: ColorwayId;
  status: FurnitureStatus;
  /** arrange_room keeps locked items. */
  locked?: boolean;
  shopifyVariantId?: string;
  /** Cart line linked to this item (SHOPIFY.md §7). */
  cartLineId?: string;
}

export interface Variant {
  name: string;
  roomId: string;
  furniture: Furniture[];
  savedAt: number;
}

export type Mode = "build" | "design" | "shop";
export type View = "plan" | "dollhouse";
export type TimeOfDay = "morning" | "noon" | "golden" | "evening";
export type Yaw = "nw" | "ne" | "se" | "sw";

export interface Selection {
  itemId?: string;
  roomId?: string;
  hoverItemId?: string;
  lastMovedItemId?: string;
  lastMovedBy?: ActionSource;
  lastMovedAt?: number;
}

export interface SceneMeta {
  mode: Mode;
  view: View;
  yaw: Yaw;
  timeOfDay: TimeOfDay;
  paletteId: PaletteId;
  accessibilityMode: boolean;
  activeRoomId: string;
  budgetUsd?: number;
  selection: Selection;
  /** Which template the home was created from (for get_scene_summary). */
  template?: TemplateId;
}

export interface Scene {
  rooms: Room[];
  openings: Opening[];
  furniture: Furniture[];
  variants: Variant[];
  meta: SceneMeta;
}

export type TemplateId = "studio" | "1br" | "2br" | "3br" | "4br" | "5br" | "loft";
export const TEMPLATE_IDS: readonly TemplateId[] = ["studio", "1br", "2br", "3br", "4br", "5br", "loft"];

export type ActionSource = "human" | "agent" | "assistant" | "system";

export type ConflictKind =
  | "overlap"
  | "outside"
  | "clearance"
  | "door_swing"
  | "traffic"
  | "access_path"
  | "turning_circle"
  | "reach";

/** Engine output, tool output, overlay input. */
export interface Conflict {
  kind: ConflictKind;
  /** Furniture/opening ids involved. */
  items: string[];
  roomId: string;
  /** ≤ 80 chars, human-readable, with cm. */
  detail: string;
  /** ≤ 80 chars, actionable ("move sofa-1 40 cm east"). */
  fix: string;
  /** Polygon to render, room-local. */
  zone?: Vec2[];
  severity: "error" | "warn";
}

export interface Span {
  start: number;
  end: number;
}
