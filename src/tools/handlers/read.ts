import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import { evaluateHome, evaluateRoom } from "../../engine/conflicts";
import { cartPayload, roomDetails, roomRow, selectionPayload, truncateList } from "../../engine/describe";
import { measure as measureScene } from "../../engine/measure";
import { designReport } from "../../engine/report";
import type { Conflict } from "../../engine/types";
import type { DefinedTool, ToolResult } from "../define";
import { defineTool } from "../define";
import { describeParam, roomParam } from "../params";
import { resolveRoom, syncCart, trackShopifyResult } from "./resolve";

function conflictRow(conflict: Conflict): {
  kind: Conflict["kind"];
  severity: Conflict["severity"];
  items: string[];
  detail: string;
  fix: string;
} {
  return {
    kind: conflict.kind,
    severity: conflict.severity,
    items: conflict.items.slice(0, 4),
    detail: conflict.detail.slice(0, 80),
    fix: conflict.fix.slice(0, 80),
  };
}

function money(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function getSceneSummaryTool(): DefinedTool {
  return defineTool({
    name: "get_scene_summary",
    title: "Scene summary",
    description: "Overview of the whole home: every room with id, name, type, size in m², wall sides with lengths in cm, item count and conflict count; plus the current mode, view, time of day, accessibility flag, active room, the human's selection, cart subtotal and design budget in USD. Call it first to learn room and item ids before reading details or placing furniture.",
    group: "core",
    readOnly: true,
    input: z.object({}).strict(),
    handler(_input, context) {
      const state = context.store.getState();
      const catalog = createCatalog(state.catalog);
      const conflicts = evaluateHome(state.scene, catalog);
      const counts = new Map<string, number>();
      for (const conflict of conflicts) counts.set(conflict.roomId, (counts.get(conflict.roomId) ?? 0) + 1);
      const rooms = truncateList(state.scene.rooms.map((room) => roomRow(
        state.scene,
        room,
        catalog,
        counts.get(room.id) ?? 0,
      )), 8);
      const selection = state.scene.meta.selection;
      return {
        ok: true,
        home: {
          template: state.scene.meta.template,
          rooms: state.scene.rooms.length,
          items: state.scene.furniture.filter((item) => item.status === "placed").length,
        },
        mode: state.scene.meta.mode,
        view: state.scene.meta.view,
        time_of_day: state.scene.meta.timeOfDay,
        accessibility: state.scene.meta.accessibilityMode,
        active_room: state.scene.meta.activeRoomId,
        rooms: rooms.items,
        ...(rooms.more > 0 ? { more: rooms.more } : {}),
        selection: {
          item: selection.itemId ?? null,
          room: selection.roomId ?? state.scene.meta.activeRoomId,
        },
        cart: { lines: state.cart.lines.length, subtotal_usd: Math.round(state.cart.subtotalUsd) },
        ...(state.scene.meta.budgetUsd === undefined ? {} : { budget_usd: Math.round(state.scene.meta.budgetUsd) }),
        hint: "Use get_room_details for walls, openings and item positions of one room.",
      };
    },
    summarize: () => "Read scene summary",
  });
}

export function getRoomDetailsTool(): DefinedTool {
  return defineTool({
    name: "get_room_details",
    title: "Room details",
    description: "Details of one room: walls (id, side, length in cm and the free spans where furniture can go), openings (doors, windows, arches with wall, offset, width and swing) and every placed item with id, name, position, rotation, footprint and colorway. Coordinates are room-local in cm: origin at the north-west corner, x east, y south. Use it before placing or moving furniture in that room.",
    group: "core",
    readOnly: true,
    input: z.object({ room: roomParam.optional() }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const catalog = createCatalog(state.catalog);
      const details = roomDetails(state.scene, room, catalog, evaluateRoom(state.scene, room.id, catalog).length);
      return {
        ok: true,
        ...details,
        hint: "Items are 'id name @x,y rotation WxD colorway'. measure gives gaps and spans.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Read room details failed";
      const room = result.room as { name?: string } | undefined;
      return `Read ${room?.name ?? input.room ?? "room"} details`;
    },
  });
}

export function getSelectionTool(): DefinedTool {
  return defineTool({
    name: "get_selection",
    title: "Human selection",
    description: "What the human is pointing at right now: the selected item, hovered item, last moved item (and whether the human or the agent moved it), the selected room and the camera focus. Use it to resolve words like this, that, here or the one I clicked before acting.",
    group: "core",
    readOnly: true,
    input: z.object({}).strict(),
    handler(_input, context) {
      const state = context.store.getState();
      const payload = selectionPayload(state.scene, state.catalog);
      const movedAt = state.scene.meta.selection.lastMovedAt;
      if (payload.last_moved && movedAt !== undefined) {
        payload.last_moved.ago_s = Math.max(0, Math.round((Date.now() - movedAt) / 1_000));
      }
      return {
        ok: true,
        ...payload,
        hint: payload.selected_item
          ? `Use ${payload.selected_item.id} or selected in the next tool call.`
          : "Ask the human to select an item, or use a room or item id from the scene summary.",
      };
    },
    summarize: () => "Read selection",
  });
}

export function measureTool(): DefinedTool {
  return defineTool({
    name: "measure",
    title: "Measure",
    description: "Measures in cm: a wall's length and free spans, an item's footprint, the gap between two items, or the distance from an item to a wall or opening. Subjects are wall sides (north, east, south, west), wall ids (w0…), item ids or names, or opening ids. Use it to check fit before placing or moving.",
    group: "core",
    readOnly: true,
    input: z.object({
      subject: z.string().min(1).describe(describeParam("What to measure: a wall side or id, an item id or name, or an opening id.")),
      to: z.string().min(1).optional().describe(describeParam("Optional second thing (wall, item or opening) to measure the gap or distance to.")),
      room: roomParam.optional(),
    }).strict(),
    handler(input, context): ToolResult {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const measured = measureScene(state.scene, room.id, input.subject, input.to, state.catalog);
      if (!measured.ok) {
        return {
          ok: false,
          error: "not_found",
          detail: `${input.to ?? input.subject} could not be measured in ${room.name}.`,
          alternatives: measured.alternatives.slice(0, 3),
        };
      }
      return {
        ...measured,
        hint: input.to ? "Use the measured gap to choose a safe move or a smaller product." : "Add to to measure a gap or distance from this subject.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Measure failed";
      const subject = result.subject as { id?: string } | undefined;
      const to = result.to as { id?: string } | undefined;
      if (to?.id) return `Measured ${subject?.id ?? input.subject} → ${to.id}`;
      const kind = (result.subject as { kind?: string } | undefined)?.kind;
      return `Measured ${input.subject}${kind === "wall" ? " wall" : ""}`;
    },
  });
}

export function getConflictsTool(): DefinedTool {
  return defineTool({
    name: "get_conflicts",
    title: "Layout conflicts",
    description: "Lists layout problems in a room or the whole home: overlapping items, items outside the room, missing clearance in front of seating, beds and desks, blocked door swings, pinched traffic paths and, when accessibility mode is on, paths under 90 cm and missing 150 cm turning circles. Each conflict names the items involved and a concrete fix in cm.",
    group: "core",
    readOnly: true,
    input: z.object({
      room: z.string().min(1).optional().describe(describeParam("Room id or name, or all for the whole home. Defaults to the active room.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const catalog = createCatalog(state.catalog);
      const all = input.room?.trim().toLowerCase() === "all";
      const room = all ? undefined : resolveRoom(state, input.room);
      if (room && "ok" in room) return room;
      const conflicts = all ? evaluateHome(state.scene, catalog) : evaluateRoom(state.scene, room?.id ?? state.scene.meta.activeRoomId, catalog);
      const listed = truncateList(conflicts, 6);
      return {
        ok: true,
        room: all ? "all" : room?.id ?? state.scene.meta.activeRoomId,
        room_name: all ? "the whole home" : room?.name,
        accessibility_mode: state.scene.meta.accessibilityMode,
        count: conflicts.length,
        conflicts: listed.items.map(conflictRow),
        more: listed.more,
        hint: conflicts.length > 0 ? "Apply the first error's fix, then call get_conflicts again." : "No layout conflicts found; get_design_report can review the design quality.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Check conflicts failed";
      const count = typeof result.count === "number" ? result.count : 0;
      const room = String(result.room_name ?? (result.room === "all" ? "the whole home" : result.room ?? input.room ?? "room"));
      return `Checked conflicts in ${room} (${count})`;
    },
  });
}

export function getDesignReportTool(): DefinedTool {
  return defineTool({
    name: "get_design_report",
    title: "Design report",
    description: "Design critique of a room scored 0–10 on balance, focal point, conversation seating, lighting coverage, storage and traffic flow, with an overall score out of 100 and the top three improvements. Use it to review a layout or to explain why a room feels off.",
    group: "core",
    readOnly: true,
    input: z.object({ room: roomParam.optional() }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const catalog = createCatalog(state.catalog);
      const report = designReport(state.scene, room.id, catalog, evaluateRoom(state.scene, room.id, catalog));
      return {
        ok: true,
        room: room.id,
        room_name: room.name,
        ...report,
        hint: report.suggestions.length > 0 ? "Apply the first suggestion, then run the report again." : "This room is ready to present or save as a variant.",
      };
    },
    summarize(input, result) {
      if (!result.ok) return "Design report failed";
      return `Design report for ${String(result.room_name ?? result.room ?? input.room ?? "room")} · ${String(result.score ?? 0)}/100`;
    },
  });
}

export function getCartTool(): DefinedTool {
  return defineTool({
    name: "get_cart",
    title: "Cart",
    description: "The shopping cart: each line with product, colorway, quantity, unit and line price in USD, the subtotal, the design budget and how much of it remains, and whether checkout is available. Lines note which placed item they belong to.",
    group: "core",
    readOnly: true,
    input: z.object({}).strict(),
    async handler(_input, context) {
      const result = trackShopifyResult(context, await context.shopify.cartGet());
      if (!result.ok) return { ok: false, error: "unavailable", detail: result.detail };
      syncCart(context, result.value);
      const state = context.store.getState();
      return {
        ok: true,
        ...cartPayload(state.cart, state.scene.meta.budgetUsd),
        hint: result.value.lines.length > 0
          ? "Use get_checkout_link when the human is ready to purchase."
          : "Use update_cart with a product or placed item to add the first line.",
      };
    },
    summarize(_input, result) {
      const subtotal = result.ok && typeof result.subtotal_usd === "number" ? result.subtotal_usd : 0;
      return result.ok ? `Read cart · $${money(subtotal)}` : "Read cart failed";
    },
  });
}
