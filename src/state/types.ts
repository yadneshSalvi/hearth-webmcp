import type { ColorwayId, Floor, PaletteId, WallColor } from "../tokens";
import type {
  ActionSource, Conflict, Furniture, Mode, Opening, Room, RoomType, Rotation, Scene, Selection, Side, TemplateId, TimeOfDay, Vec2, View, Yaw,
} from "../engine/types";

export type { ActionSource } from "../engine/types";

/** One human-readable record in the newest-first studio activity feed. */
export interface ActivityEntry {
  id: string;
  t: number;
  source: ActionSource;
  tool?: string;
  title: string;
  summary: string;
  itemIds: string[];
  input?: unknown;
  result?: unknown;
}

/** A locally mirrored Shopify cart line; money is in USD. */
export interface CartLine {
  id: string;
  variantId: string;
  handle: string;
  title: string;
  colorway: string;
  quantity: number;
  unitUsd: number;
  lineUsd: number;
  itemId?: string;
}

/** Browser-visible tool metadata mirrored for the tools panel. */
export interface ToolMirror {
  name: string;
  title?: string;
  description: string;
  inputSchema: unknown;
}

export type ToolGroup = "core" | "design" | "shop" | "present" | "preview" | "variants" | "checkout" | "build";

export interface CartState {
  id?: string;
  lines: CartLine[];
  subtotalUsd: number;
  status: "idle" | "pending" | "offline";
}

/** One queued toast. The chrome renders and dismisses them; the canvas only pushes. */
export interface ToastEntry {
  id: string;
  t: number;
  tone: "info" | "success" | "warn" | "error";
  /** ≤ 90 chars, sentence case, units included (STYLE.md §4). */
  message: string;
  detail?: string;
}

/** Live direct-manipulation state, published so chrome can mirror what the pointer is doing. */
export interface DraggingState {
  itemId: string;
  valid: boolean;
  /** ≤ 44 chars, why the current position is refused. */
  reason?: string;
}

export interface HearthUiState {
  compare?: { left: string; right: string; roomId: string };
  boardOpen: boolean;
  assistantOpen: boolean;
  toolsPanelOpen: boolean;
  pendingConfirm?: { id: string; message: string };
  /** Newest-last toast queue, capped at 4. */
  toasts: ToastEntry[];
  /** Item ids the UI should pulse once (an invalid nudge, a fresh duplicate, a tool action). */
  pulseIds: string[];
  dragging?: DraggingState;
  /**
   * Studio chrome state (src/ui). Optional so existing store and tool fixtures stay valid literals;
   * every reader defaults it.
   */
  catalogCollapsed?: boolean;
  inspectorCollapsed?: boolean;
  cartOpen?: boolean;
  shortcutsOpen?: boolean;
  enableSheetOpen?: boolean;
}

/** Rules-engine output the renderer draws as floor diagrams (src/scene/Overlays.tsx). */
export interface OverlaysState {
  conflicts: Conflict[];
}

export interface HearthState {
  scene: Scene;
  catalog: import("../engine/types").CatalogItem[];
  cart: CartState;
  activity: ActivityEntry[];
  tools: { available: ToolMirror[]; status: "native" | "polyfill" | "unavailable" | "unknown" };
  ui: HearthUiState;
  /** Optional, non-undoable: the latest conflict set for the overlay layer. */
  overlays?: OverlaysState;
}

export interface PlaceItemInput {
  catalogId: string;
  roomId: string;
  pos: Vec2;
  rotation: Rotation;
  colorway?: string;
  status?: "placed" | "ghost";
}

export type RoomPlacement = "east_of" | "south_of" | "west_of" | "north_of";

export interface RoomInput {
  id?: string;
  name: string;
  type: RoomType;
  width?: number;
  depth?: number;
  width_cm?: number;
  depth_cm?: number;
  poly?: Vec2[];
  origin?: Vec2;
  notch?: { corner: "ne" | "se" | "sw" | "nw"; width_cm: number; depth_cm: number };
  place?: RoomPlacement;
  relativeTo?: string;
  relative_to?: string;
  floor?: Floor;
  wallColor?: WallColor;
  wall_color?: WallColor;
}

export interface RoomPatch {
  name?: string;
  type?: RoomType;
  width?: number;
  depth?: number;
  width_cm?: number;
  depth_cm?: number;
  floor?: Floor;
  wallColor?: WallColor;
  wall_color?: WallColor;
}

/**
 * Opts for actions a pointer gesture repeats many times a second. `quiet` skips the activity row
 * and pauses undo history, so a drag-over ghost cannot flood the feed or the undo stack.
 */
export interface QuietOpts {
  quiet?: boolean;
}

export type OpeningInput = Omit<Opening, "id"> & { id?: string };
export type OpeningPatch = Partial<Omit<Opening, "id" | "roomId">>;

/** Runtime validation error thrown by direct store actions. */
export class HearthError extends Error {
  constructor(public readonly code: "not_found" | "invalid", public readonly detail: string) {
    super(detail);
    this.name = "HearthError";
  }
}

export interface HearthActions {
  placeItem(source: ActionSource, input: PlaceItemInput): Furniture;
  moveItem(source: ActionSource, id: string, patch: { pos?: Vec2; rotation?: Rotation; roomId?: string }): void;
  removeItem(source: ActionSource, id: string): void;
  setColorway(source: ActionSource, id: string, colorway: string): void;
  setLocked(source: ActionSource, id: string, locked: boolean): void;
  setGhost(source: ActionSource, furniture: Furniture, opts?: QuietOpts): void;
  clearGhost(source: ActionSource, opts?: QuietOpts): void;
  confirmGhost(source: ActionSource): Furniture;
  setMode(source: ActionSource, mode: Mode): void;
  setView(source: ActionSource, patch: { view?: View; yaw?: Yaw; focusRoomId?: string; focusItemId?: string }, opts?: QuietOpts): void;
  setTimeOfDay(source: ActionSource, time: TimeOfDay): void;
  setPalette(source: ActionSource, paletteId: PaletteId, roomIds: string[]): void;
  setAccessibility(source: ActionSource, on: boolean): void;
  setBudget(source: ActionSource, budgetUsd: number | undefined): void;
  setActiveRoom(source: ActionSource, roomId: string): void;
  setSelection(source: ActionSource, selection: Partial<Selection>): void;
  saveVariant(source: ActionSource, roomId: string, name: string): void;
  loadVariant(source: ActionSource, roomId: string, name: string): void;
  deleteVariant(source: ActionSource, roomId: string, name: string): void;
  clearRoom(source: ActionSource, roomId: string): void;
  applyArrangement(source: ActionSource, roomId: string, furniture: Furniture[]): void;
  applyTemplate(source: ActionSource, id: TemplateId, furnished: boolean): void;
  createRoom(source: ActionSource, input: RoomInput): Room;
  updateRoom(source: ActionSource, id: string, patch: RoomPatch): string[];
  addOpening(source: ActionSource, input: OpeningInput): Opening;
  moveOpening(source: ActionSource, id: string, patch: OpeningPatch): void;
  removeOpening(source: ActionSource, id: string): void;
  linkCartLine(source: ActionSource, itemId: string, variantId: string, lineId?: string): void;
  setCart(cart: CartState): void;
  setCartStatus(status: CartState["status"]): void;
  setToolsMirror(list: ToolMirror[], status: HearthState["tools"]["status"]): void;
  pushActivity(entry: ActivityEntry): void;
  setUi(patch: Partial<HearthUiState>): void;
  toast(entry: Omit<ToastEntry, "id" | "t">): string;
  dismissToast(id: string): void;
  pulse(itemIds: string[]): void;
  setDragging(dragging: DraggingState | undefined): void;
  setOverlays(patch: Partial<OverlaysState>): void;
  /**
   * Swaps the whole furniture list for a transient capture — the compare split view and the design
   * board load a variant, photograph it and put the room back. No receipt, no undo entry: nothing a
   * person did, so nothing to undo. Callers pass furniture that already belongs to this scene.
   */
  previewFurniture(furniture: Furniture[]): void;
  undo(steps?: number): ActivityEntry[];
  redo(steps?: number): ActivityEntry[];
  resetScene(scene: Scene): void;
}

export type HearthStore = HearthState & HearthActions;

export type { ColorwayId, Furniture, Mode, Opening, Room, Rotation, Scene, Selection, Side, TemplateId, TimeOfDay, Vec2, View, Yaw };
