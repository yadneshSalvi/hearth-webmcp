import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import { evaluateRoom } from "../../engine/conflicts";
import { palettePresets } from "../../tokens";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { describeParam, roomParam } from "../params";
import {
  fromCaught, notFound, productName, resolveItem, resolveRoom, resolveVariant, sourceForStore,
} from "./resolve";

const paletteIds = ["warm-clay", "sage-linen", "dusk", "nordic", "terrazzo", "ochre-sun"] as const;

export function applyPaletteTool(): DefinedTool {
  return defineTool({
    name: "apply_palette",
    title: "Apply palette",
    description: "Applies a palette preset to a room or the whole home: wall colour, floor material and the textile family used for re-tinted fabrics. Presets: warm-clay, sage-linen, dusk, nordic, terrazzo, ochre-sun.",
    group: "design",
    input: z.object({
      palette: z.enum(paletteIds).describe(describeParam("Palette preset id.")),
      room: roomParam.optional(),
      scope: z.enum(["room", "home"]).default("room").describe(describeParam("Apply to one room or the whole home; default room.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const roomIds = input.scope === "home" ? state.scene.rooms.map(({ id }) => id) : [room.id];
      try {
        context.store.getState().setPalette(sourceForStore(context.source), input.palette, roomIds);
        const preset = palettePresets[input.palette];
        return {
          ok: true,
          room: input.scope === "room" ? room.id : state.scene.meta.activeRoomId,
          palette: {
            id: input.palette,
            name: preset.name,
            walls: preset.walls,
            floor: preset.floor,
            textiles: preset.textiles,
          },
          rooms: roomIds,
          room_names: input.scope === "home" ? state.scene.rooms.map(({ name }) => name) : [room.name],
          hint: "Set the time of day to review the palette under another light.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Apply palette failed";
      const palette = result.palette as { name?: string } | undefined;
      const rooms = result.rooms as string[] | undefined;
      const roomNames = result.room_names as string[] | undefined;
      return `Applied ${palette?.name ?? "palette"} to ${rooms?.length === 1 ? roomNames?.[0] ?? rooms[0] : "the home"}`;
    },
  });
}

export function setTimeOfDayTool(): DefinedTool {
  return defineTool({
    name: "set_time_of_day",
    title: "Time of day",
    description: "Sets the lighting time of day: morning (cool soft light), noon (bright with short shadows), golden (warm low sun) or evening (dusk, every lamp glows). Changes the look only; the layout stays the same.",
    group: "design",
    input: z.object({
      time: z.enum(["morning", "noon", "golden", "evening"]).describe(describeParam("Lighting time: morning, noon, golden or evening.")),
    }).strict(),
    handler(input, context) {
      context.store.getState().setTimeOfDay(sourceForStore(context.source), input.time);
      return {
        ok: true,
        time_of_day: input.time,
        lamps_on: input.time === "evening",
        hint: "Use set_view to frame the room for the human.",
      };
    },
    summarize(input) {
      return `Time of day → ${input.time}`;
    },
  });
}

export function setViewTool(): DefinedTool {
  return defineTool({
    name: "set_view",
    title: "Set view",
    description: "Changes the camera: plan (top-down) or dollhouse (isometric), optionally focused on a room or an item, with the isometric yaw at nw, ne, se or sw. Use it to show the human what you are working on.",
    group: "design",
    input: z.object({
      view: z.enum(["plan", "dollhouse"]).optional().describe(describeParam("Camera view: plan or dollhouse.")),
      focus: z.string().min(1).optional().describe(describeParam("Room id/name or item id/name to frame. Defaults to the active room.")),
      yaw: z.enum(["nw", "ne", "se", "sw"]).optional().describe(describeParam("Dollhouse compass yaw: nw, ne, se or sw.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const focusRef = input.focus ?? state.scene.meta.activeRoomId;
      const room = resolveRoom(state, focusRef);
      let focus: { kind: "room" | "item"; id: string; name: string };
      if (!("ok" in room)) focus = { kind: "room", id: room.id, name: room.name };
      else {
        const item = resolveItem(state, focusRef);
        if ("ok" in item) {
          const candidates = [
            ...state.scene.rooms.map(({ id, name }) => ({ id, name })),
            ...state.scene.furniture.map((candidate) => ({ id: candidate.id, name: productName(state, candidate) })),
          ];
          return notFound("Focus", focusRef, candidates);
        }
        focus = { kind: "item", id: item.id, name: productName(state, item) };
      }
      try {
        context.store.getState().setView(sourceForStore(context.source), {
          view: input.view,
          yaw: input.yaw,
          ...(focus.kind === "room" ? { focusRoomId: focus.id } : { focusItemId: focus.id }),
        });
        context.ui.focus({ kind: focus.kind, id: focus.id });
        const current = context.store.getState().scene.meta;
        return {
          ok: true,
          room: focus.kind === "room" ? focus.id : state.scene.furniture.find((item) => item.id === focus.id)?.roomId,
          view: current.view,
          focus: { kind: focus.kind, id: focus.id },
          focus_name: focus.name,
          yaw: current.yaw,
          hint: "The camera is framed for the human.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Set view failed";
      return `View → ${String(result.view)}, focus ${String(result.focus_name ?? "room")}`;
    },
  });
}

export function setAccessibilityModeTool(): DefinedTool {
  return defineTool({
    name: "set_accessibility_mode",
    title: "Accessibility mode",
    description: "Turns accessibility mode on or off. On: paths must be at least 90 cm wide, a 150 cm turning circle is required beside the bed, desk and sofa, reach zones are shown, and get_conflicts and the overlays report these rules. Off: standard 60 cm walkways.",
    group: "design",
    input: z.object({
      enabled: z.boolean().describe(describeParam("true enables accessibility layout rules; false restores standard rules.")),
    }).strict(),
    handler(input, context) {
      context.store.getState().setAccessibility(sourceForStore(context.source), input.enabled);
      const next = context.store.getState();
      const conflicts = evaluateRoom(next.scene, next.scene.meta.activeRoomId, createCatalog(next.catalog)).length;
      return {
        ok: true,
        accessibility_mode: input.enabled,
        conflicts,
        hint: `get_conflicts lists the ${conflicts} accessibility issue${conflicts === 1 ? "" : "s"}.`,
      };
    },
    summarize(input, result) {
      const conflicts = result.ok && typeof result.conflicts === "number" ? result.conflicts : 0;
      return `Accessibility mode ${input.enabled ? "on" : "off"} (${conflicts} conflicts)`;
    },
  });
}

interface TemporalState {
  pastStates: unknown[];
}

interface TemporalStore {
  getState(): TemporalState;
}

export function undoTool(): DefinedTool {
  return defineTool({
    name: "undo",
    title: "Undo",
    description: "Undoes the last change(s) to the scene, whether made by the agent or the human, 1 to 10 steps at a time. Returns what was undone.",
    group: "design",
    input: z.object({
      steps: z.number().int().min(1).max(10).default(1).describe(describeParam("Number of scene changes to undo, from 1 to 10; default 1.")),
    }).strict(),
    handler(input, context) {
      try {
        const entries = context.store.getState().undo(input.steps);
        const temporal = (context.store as typeof context.store & { temporal?: TemporalStore }).temporal;
        return {
          ok: true,
          undone: entries.map((entry) => ({
            action: entry.tool ?? entry.title.toLowerCase().replace(/\s+/g, "_"),
            summary: entry.summary,
            by: entry.source,
          })),
          remaining: temporal?.getState().pastStates.length ?? 0,
          hint: "Scene undo does not recreate removed Shopify lines; use update_cart to re-add them.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input) {
      return `Undid ${input.steps} change${input.steps === 1 ? "" : "s"}`;
    },
  });
}

export function saveVariantTool(): DefinedTool {
  return defineTool({
    name: "save_variant",
    title: "Save variant",
    description: "Saves the current furniture layout of a room under a name (for example Cosy or Media wall) so it can be restored with load_variant or, once two or more exist, compared side by side with compare_variants.",
    group: "design",
    input: z.object({
      name: z.string().trim().min(1).max(80).describe(describeParam("Short name for this saved room layout.")),
      room: roomParam.optional(),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      try {
        context.store.getState().saveVariant(sourceForStore(context.source), room.id, input.name);
        const variants = context.store.getState().scene.variants.filter((variant) => variant.roomId === room.id);
        const saved = variants.find((variant) => variant.name.toLowerCase() === input.name.toLowerCase());
        return {
          ok: true,
          room: room.id,
          room_name: room.name,
          variant: { name: saved?.name ?? input.name, items: saved?.furniture.length ?? 0 },
          variants: variants.map(({ name }) => name),
          hint: "compare_variants is available once two variants exist.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input) {
      return `Saved variant “${input.name}”`;
    },
  });
}

export function loadVariantTool(): DefinedTool {
  return defineTool({
    name: "load_variant",
    title: "Load variant",
    description: "Restores a previously saved layout variant of a room by name, replacing the room's current furniture. Save the current layout first if you want to keep it.",
    group: "design",
    input: z.object({
      variant: z.string().min(1).describe(describeParam("Saved variant name (see save_variant).")),
      room: roomParam.optional(),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const variant = resolveVariant(state.scene, room.id, input.variant);
      if ("ok" in variant) return variant;
      const replaced = state.scene.furniture.filter((item) => item.roomId === room.id && item.status !== "ghost").length;
      try {
        context.store.getState().loadVariant(sourceForStore(context.source), room.id, variant.name);
        context.ui.pulse(variant.furniture.map(({ id }) => id));
        return {
          ok: true,
          room: room.id,
          variant: variant.name,
          items: variant.furniture.length,
          item_ids: variant.furniture.map(({ id }) => id),
          replaced,
          hint: "Save another variant to compare layouts side by side.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      return `Loaded variant “${result.ok ? String(result.variant) : input.variant}”`;
    },
  });
}

function sceneRoom(scene: { rooms: Array<{ id: string; name: string }> ; meta: { activeRoomId: string } }, ref?: string) {
  const needle = (ref ?? scene.meta.activeRoomId).toLowerCase();
  const exact = scene.rooms.find((room) => room.id.toLowerCase() === needle || room.name.toLowerCase() === needle);
  if (exact) return exact;
  const prefix = scene.rooms.filter((room) => room.id.toLowerCase().startsWith(needle) || room.name.toLowerCase().startsWith(needle));
  return prefix.length === 1 ? prefix[0] : undefined;
}

export function clearRoomTool(): DefinedTool {
  return defineTool({
    name: "clear_room",
    title: "Clear room",
    description: "Removes every item from a room after the human confirms in a dialog on the page. Returns cancelled if the human declines.",
    group: "design",
    input: z.object({ room: roomParam.optional() }).strict(),
    confirm(input, scene) {
      const room = sceneRoom(scene, input.room);
      if (!room) return null;
      const count = scene.furniture.filter((item) => item.roomId === room.id).length;
      return `Clear ${room.name} and remove ${count} item${count === 1 ? "" : "s"}?`;
    },
    cancelledDetail(input, scene) {
      const room = sceneRoom(scene, input.room);
      return `The human declined to clear ${room?.name ?? "the room"}.`;
    },
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const ids = state.scene.furniture.filter((item) => item.roomId === room.id).map(({ id }) => id);
      try {
        context.ui.pulse(ids);
        context.store.getState().clearRoom(sourceForStore(context.source), room.id);
        return {
          ok: true,
          room: room.id,
          room_name: room.name,
          removed: ids.length,
          removed_ids: ids,
          hint: "undo restores them.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return `Clear ${input.room ?? "room"} — declined`;
      return `Cleared ${String(result.room_name ?? result.room)} (${String(result.removed)} items)`;
    },
  });
}
