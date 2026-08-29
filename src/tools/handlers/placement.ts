import * as z from "zod";
import { resolveAnchor, describePlacement, rotateBy } from "../../engine/anchors";
import type { PlacementResult } from "../../engine/anchors";
import { arrangeRoom } from "../../engine/arrange";
import { createCatalog } from "../../engine/catalog";
import { conflictsForItem, evaluateRoom } from "../../engine/conflicts";
import { clip, dimsStr, posArr, truncateList } from "../../engine/describe";
import { walls } from "../../engine/geometry";
import { designReport } from "../../engine/report";
import type { CatalogItem, Conflict, Furniture, Rotation } from "../../engine/types";
import type { DefinedTool, Err } from "../define";
import { defineTool } from "../define";
import {
  anchorParam, colorwayParam, describeParam, itemParam, posParam, productParam, roomParam, rotationParam,
} from "../params";
import {
  alternatives, fromCaught, notFound, resolveItem, resolveOpening, resolveProduct, resolveRoom, sourceForStore,
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

function compactItem(item: Furniture, product: CatalogItem) {
  return {
    id: item.id,
    name: product.name,
    product: product.id,
    pos: posArr(item.pos),
    rotation: item.rotation,
    dims: dimsStr(product.dims),
    colorway: item.colorway,
    price_usd: Math.round(product.price ?? 0),
  };
}

function anchorFailure(
  result: Exclude<PlacementResult, { ok: true }>,
  state: import("../../state/types").HearthState,
  roomId: string,
): Err {
  const room = state.scene.rooms.find((candidate) => candidate.id === roomId);
  const candidates = [
    ...state.scene.rooms.map(({ id, name }) => ({ id, name })),
    ...state.scene.furniture.map((item) => ({
      id: item.id,
      name: state.catalog.find((product) => product.id === item.catalogId)?.name ?? item.catalogId,
    })),
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
        fits: span.fits,
      }))).slice(0, 6),
    } : {}),
    ...(result.suggestion ? { suggestion: result.suggestion } : {}),
    ...(result.error === "not_found" ? { alternatives: alternatives(result.detail, candidates) } : {}),
  };
}

function resolvedColorway(product: CatalogItem, requested: string | undefined, catalog: ReturnType<typeof createCatalog>) {
  const ref = requested ?? product.colorways[0]?.id ?? "";
  return catalog.resolveColorway(product, ref);
}

function placementHint(action: "Placed" | "Moved", scene: import("../../engine/types").Scene, item: Furniture, catalog: ReturnType<typeof createCatalog>): string {
  return clip(`${action} ${describePlacement(scene, item, catalog)}.`, 120);
}

function receiptPlacement(action: "Placed" | "Moved", name: string, note: string): string {
  const wall = note.match(/on the (north|east|south|west) wall/);
  if (wall?.[1]) return `${action} ${name} ${action === "Moved" ? "to" : "on"} the ${wall[1]} wall`;
  if (note.startsWith("centred")) return `${action} ${name} in the room centre`;
  return `${action} ${name}`;
}

export function placeFurnitureTool(): DefinedTool {
  return defineTool({
    name: "place_furniture",
    title: "Place furniture",
    description: "Places a catalog product in a room as a new item. Position it with an anchor in words (back against a wall at start, center, end or N cm along it; facing an item or the room centre; next to an item with a gap; centred; or under a window) or with a raw pos in cm and a rotation. The engine snaps to the wall, nudges up to 60 cm to avoid collisions and reports conflicts. Returns the new item id.",
    group: "design",
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
      const colorway = resolvedColorway(product, input.colorway, catalog);
      if (!colorway) return notFound("Colorway", input.colorway ?? "default", product.colorways);
      const placement = resolveAnchor(state.scene, room.id, product, {
        anchor: input.anchor,
        pos: input.pos,
        rotation: input.rotation,
      }, catalog);
      if (!placement.ok) return anchorFailure(placement, state, room.id);
      try {
        const item = context.store.getState().placeItem(sourceForStore(context.source), {
          catalogId: product.id,
          roomId: room.id,
          pos: placement.pos,
          rotation: placement.rotation,
          colorway: colorway.id,
        });
        const next = context.store.getState();
        const conflicts = conflictsForItem(evaluateRoom(next.scene, room.id, catalog), item.id).slice(0, 6).map(conflictRow);
        context.ui.pulse([item.id]);
        return {
          ok: true,
          room: room.id,
          item: compactItem(item, product),
          item_ids: [item.id],
          nudged_cm: Math.round(placement.nudgedCm),
          conflicts,
          hint: placementHint("Placed", next.scene, item, catalog),
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Place furniture failed";
      const item = result.item as { id?: string; name?: string } | undefined;
      const note = typeof result.hint === "string" ? result.hint.replace(/^Placed /, "").replace(/\.$/, "") : "";
      return receiptPlacement("Placed", item?.name ?? input.product, note);
    },
  });
}

const moveInput = z.object({
  item: itemParam,
  anchor: anchorParam.optional(),
  pos: posParam.optional(),
  delta_cm: z.object({
    x: z.number().optional().describe(describeParam("East-west shift in cm; positive is east.")),
    y: z.number().optional().describe(describeParam("North-south shift in cm; positive is south.")),
  }).strict().optional().describe(describeParam("Shift by this many cm: x positive = east, y positive = south.")),
  rotation: rotationParam.optional(),
  rotate_by: z.literal([90, -90, 180]).optional().describe(describeParam("Turn by 90 (clockwise), -90 (counter-clockwise) or 180 degrees.")),
  room: z.string().min(1).optional().describe(describeParam("Move the item into this room (id or name). Defaults to its current room.")),
}).strict().refine((input) => Boolean(
  input.anchor || input.pos || input.delta_cm || input.rotation !== undefined || input.rotate_by !== undefined || input.room,
), { message: "Give an anchor, pos, delta_cm, rotation, rotate_by or room." });

export function moveFurnitureTool(): DefinedTool {
  return defineTool({
    name: "move_furniture",
    title: "Move furniture",
    description: "Moves and/or rotates a placed item. Give an anchor in words (wall + along, facing, next_to, centered, under), a raw pos in cm, a delta in cm, a rotation (0, 90, 180 or 270 clockwise; 0 faces south) or rotate_by, and optionally another room. Snaps and nudges like place_furniture and returns the resolved position and any conflicts.",
    group: "design",
    input: moveInput,
    handler(input, context) {
      const state = context.store.getState();
      const item = resolveItem(state, input.item);
      if ("ok" in item) return item;
      const room = resolveRoom(state, input.room ?? item.roomId);
      if ("ok" in room) return room;
      const catalog = createCatalog(state.catalog);
      const product = catalog.byId(item.catalogId);
      if (!product) return notFound("Product", item.catalogId, state.catalog);
      const rotation: Rotation | undefined = input.rotation ?? (input.rotate_by === undefined ? undefined : rotateBy(item, input.rotate_by));
      const movedToAnotherRoom = room.id !== item.roomId;
      const relativePos = input.delta_cm
        ? { x: item.pos.x + (input.delta_cm.x ?? 0), y: item.pos.y + (input.delta_cm.y ?? 0) }
        : undefined;
      const keepPosition = !movedToAnotherRoom && !input.anchor && !input.pos && !relativePos;
      const placement = resolveAnchor(state.scene, room.id, product, {
        anchor: input.anchor,
        pos: input.pos ?? relativePos ?? (keepPosition ? item.pos : undefined),
        rotation: rotation ?? (keepPosition || relativePos ? item.rotation : undefined),
        ignoreItemIds: [item.id],
      }, catalog);
      if (!placement.ok) return anchorFailure(placement, state, room.id);
      try {
        context.store.getState().moveItem(sourceForStore(context.source), item.id, {
          roomId: room.id,
          pos: placement.pos,
          rotation: placement.rotation,
        });
        const next = context.store.getState();
        const updated = next.scene.furniture.find((candidate) => candidate.id === item.id) ?? item;
        const conflicts = conflictsForItem(evaluateRoom(next.scene, room.id, catalog), item.id).slice(0, 6).map(conflictRow);
        context.ui.pulse([item.id]);
        return {
          ok: true,
          room: room.id,
          item: { id: item.id, name: product.name, pos: posArr(updated.pos), rotation: updated.rotation },
          item_ids: [item.id],
          moved_cm: Math.round(Math.hypot(updated.pos.x - item.pos.x, updated.pos.y - item.pos.y)),
          nudged_cm: Math.round(placement.nudgedCm),
          conflicts,
          hint: placementHint("Moved", next.scene, updated, catalog),
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Move furniture failed";
      const item = result.item as { name?: string } | undefined;
      const note = typeof result.hint === "string" ? result.hint.replace(/^Moved /, "").replace(/\.$/, "") : "";
      return receiptPlacement("Moved", item?.name ?? input.item, note);
    },
  });
}

export function arrangeRoomTool(): DefinedTool {
  return defineTool({
    name: "arrange_room",
    title: "Arrange room",
    description: "Re-arranges all unlocked furniture in a room in one animated pass. Styles: conversation (seating faces each other around a focal point), media (seating faces the TV or media wall), open (maximum clear floor and walkways), work (desk by the window, storage on the walls). Keeps door swings and clearances free and reports what moved with the conflict count before and after.",
    group: "design",
    input: z.object({
      room: roomParam.optional(),
      style: z.enum(["conversation", "media", "open", "work"]).describe(describeParam("Arrangement style: conversation, media, open or work.")),
      keep_locked: z.boolean().default(true).describe(describeParam("Keep locked furniture in place; default true.")),
      focus: z.string().min(1).optional().describe(describeParam("Optional focal point: an item id or name (e.g. the fireplace or TV) or window:<id>.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      if (input.focus) {
        if (input.focus.toLowerCase().startsWith("window:")) {
          const opening = resolveOpening(state, input.focus.slice(input.focus.indexOf(":") + 1));
          if ("ok" in opening || opening.roomId !== room.id || opening.kind !== "window") {
            return notFound("Window", input.focus, state.scene.openings.filter((candidate) => candidate.roomId === room.id && candidate.kind === "window").map((candidate) => ({ id: candidate.id, name: candidate.id })));
          }
        } else {
          const focus = resolveItem(state, input.focus);
          if ("ok" in focus || focus.roomId !== room.id) {
            return notFound("Focus", input.focus, state.scene.furniture.filter((candidate) => candidate.roomId === room.id).map((candidate) => ({
              id: candidate.id,
              name: state.catalog.find((product) => product.id === candidate.catalogId)?.name ?? candidate.catalogId,
            })));
          }
        }
      }
      const catalog = createCatalog(state.catalog);
      const beforeConflicts = evaluateRoom(state.scene, room.id, catalog);
      const before = beforeConflicts.length;
      const beforeScore = designReport(state.scene, room.id, catalog, beforeConflicts).score;
      const arranged = arrangeRoom(state.scene, room.id, input.style, catalog, {
        keepLocked: input.keep_locked,
        focus: input.focus,
      });
      if (arranged.moved.length === 0 && arranged.note.includes("no complete")) {
        return {
          ok: false,
          error: "blocked",
          detail: arranged.note,
          note: arranged.note,
          suggestion: "Remove or lock fewer items, resolve conflicts, or try another arrangement style.",
          hint: "Try another style after clearing space or reducing the unlocked set.",
        };
      }
      const nextScene = { ...state.scene, furniture: arranged.furniture.map((item) => ({ ...item, pos: { ...item.pos } })) };
      context.store.getState().applyArrangement(sourceForStore(context.source), room.id, arranged.furniture);
      const afterConflicts = evaluateRoom(nextScene, room.id, catalog);
      const after = afterConflicts.length;
      const afterScore = designReport(nextScene, room.id, catalog, afterConflicts).score;
      const listed = truncateList(arranged.moved, 10);
      const names = new Map(state.catalog.map((product) => [product.id, product.name]));
      context.ui.pulse(arranged.moved.map((item) => item.id));
      return {
        ok: true,
        room: room.id,
        room_name: room.name,
        style: input.style,
        moved: listed.items.map((move) => {
          const item = arranged.furniture.find((candidate) => candidate.id === move.id);
          return {
            id: move.id,
            name: clip(names.get(item?.catalogId ?? "") ?? item?.catalogId ?? move.id, 24),
            to: posArr(move.to),
            rotation: move.rotation,
          };
        }),
        kept: arranged.kept,
        item_ids: arranged.moved.map((move) => move.id),
        conflicts_before: before,
        conflicts_after: after,
        report_delta: { before: beforeScore, after: afterScore },
        note: arranged.note,
        ...(listed.more > 0 ? { more: listed.more } : {}),
        hint: after > 0 ? "Call get_conflicts to inspect the remaining issues." : "Save this layout as a variant if the human likes it.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Arrange room failed";
      const moved = Array.isArray(result.moved) ? result.moved.length + (typeof result.more === "number" ? result.more : 0) : 0;
      return `Arranged ${String(result.room_name ?? result.room ?? input.room ?? "room")} · ${input.style} (${moved} moved)`;
    },
  });
}
