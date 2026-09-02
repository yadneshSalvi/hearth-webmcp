import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import { conflictsForItem, evaluateRoom } from "../../engine/conflicts";
import { roomAreaM2, roomSize, walls } from "../../engine/geometry";
import { CORNERS } from "../../engine/rooms";
import { templateLabel, templateShortLabel } from "../../engine/templates";
import { ROOM_TYPES, TEMPLATE_IDS } from "../../engine/types";
import type { Conflict } from "../../engine/types";
import { floors, wallColors } from "../../tokens";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { describeParam, openingParam, roomParam } from "../params";
import {
  compactOpening, fromCaught, openingOffset, resolveOpening, resolveRoom, resolveRoomWall, sourceForStore,
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

export function applyTemplateTool(): DefinedTool {
  return defineTool({
    name: "apply_template",
    title: "Apply floor-plan template",
    description: "Replaces the whole home with one of seven floor plans: studio, 1br, 2br, 3br, 4br, 5br, or loft. The 3br/4br/5br homes contain living, kitchen and dining, N bedrooms, one or two baths, and a hall. Every template has doors and windows; furnished adds a starter layout. Keeps the current mode, time of day, accessibility and palette. Asks for confirmation if the current home has furniture.",
    group: "build",
    input: z.object({
      template: z.enum(TEMPLATE_IDS).describe(describeParam("Template id: studio, 1br, 2br, 3br, 4br, 5br or loft.")),
      furnished: z.boolean().default(false).describe(describeParam("true adds the template's starter furniture layout.")),
    }).strict(),
    confirm(input, scene) {
      const count = scene.furniture.filter((item) => item.status === "placed").length;
      return count > 0 ? `Replace this home and its ${count} placed items with the ${templateLabel(input.template)} layout?` : null;
    },
    cancelledDetail(input) {
      return `The human declined the ${templateLabel(input.template)} layout.`;
    },
    handler(input, context) {
      try {
        context.store.getState().applyTemplate(sourceForStore(context.source), input.template, input.furnished);
        const scene = context.store.getState().scene;
        return {
          ok: true,
          room: scene.meta.activeRoomId,
          template: input.template,
          rooms: scene.rooms.map(({ id }) => id),
          openings: scene.openings.length,
          items: scene.furniture.length,
          item_ids: scene.furniture.map(({ id }) => id),
          hint: "The studio now shows the whole home; call set_view with a room id to zoom in, or set mode to design to furnish.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input) {
      return `Applied ${templateShortLabel(input.template)} layout${input.furnished ? " (furnished)" : ""}`;
    },
  });
}

export function createRoomTool(): DefinedTool {
  return defineTool({
    name: "create_room",
    title: "Create room",
    description: "Adds a room with a name, type and size in cm, rectangular or L-shaped (a notched corner), placed beside an existing room (east_of, south_of, west_of, north_of) or at the home's free edge. Returns the room id and its walls.",
    group: "build",
    input: z.object({
      name: z.string().trim().min(1).max(80).describe(describeParam("Human-readable room name.")),
      type: z.enum(ROOM_TYPES).describe(describeParam("Room type.")),
      width_cm: z.number().int().positive().describe(describeParam("Room width in cm.")),
      depth_cm: z.number().int().positive().describe(describeParam("Room depth in cm.")),
      notch: z.object({
        corner: z.enum(["ne", "se", "sw", "nw"]).describe(describeParam("Corner to cut away: ne, se, sw or nw.")),
        width_cm: z.number().int().positive().describe(describeParam("Notch width in cm.")),
        depth_cm: z.number().int().positive().describe(describeParam("Notch depth in cm.")),
      }).strict().optional().describe(describeParam("For an L-shape: which corner to cut away and the cut's width and depth in cm.")),
      place: z.enum(["east_of", "south_of", "west_of", "north_of"]).optional().describe(describeParam("Put the new room on this side of relative_to (room id or name).")),
      relative_to: z.string().min(1).optional().describe(describeParam("Put the new room on this side of relative_to (room id or name).")),
      floor: z.enum(floors).optional().describe(describeParam("Floor material: oak, pale-oak, stone or terrazzo.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      let relativeTo = input.relative_to;
      if (relativeTo) {
        const relative = resolveRoom(state, relativeTo);
        if ("ok" in relative) return relative;
        relativeTo = relative.id;
      }
      try {
        const room = context.store.getState().createRoom(sourceForStore(context.source), {
          name: input.name,
          type: input.type,
          width_cm: input.width_cm,
          depth_cm: input.depth_cm,
          notch: input.notch,
          place: input.place,
          relative_to: relativeTo,
          floor: input.floor,
        });
        const wallText = walls(room).map((wall) => `${wall.side[0]?.toUpperCase()} ${wall.length}`).join(" · ");
        return {
          ok: true,
          room: {
            id: room.id,
            name: room.name,
            type: room.type,
            size_cm: roomSize(room),
            area_m2: roomAreaM2(room),
            walls: wallText,
          },
          hint: "add_opening adds a door; set_mode design to furnish.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input) {
      return `Created ${input.name} · ${input.width_cm}×${input.depth_cm} cm`;
    },
  });
}

export function updateRoomTool(): DefinedTool {
  return defineTool({
    name: "update_room",
    title: "Update room",
    description: "Changes a room's name, type, width and depth in cm, floor material or wall colour. When resizing, anchor_corner (default nw) is the corner that stays put and the opposite walls move; rooms beyond a moving wall are pushed along with it unless push_neighbors is false. Openings keep their place on the wall. Items that no longer fit are reported so you can move them.",
    group: "build",
    input: z.object({
      room: roomParam.optional(),
      name: z.string().trim().min(1).max(80).optional().describe(describeParam("New room name.")),
      type: z.enum(ROOM_TYPES).optional().describe(describeParam("New room type.")),
      width_cm: z.number().int().positive().optional().describe(describeParam("New room width in cm.")),
      depth_cm: z.number().int().positive().optional().describe(describeParam("New room depth in cm.")),
      floor: z.enum(floors).optional().describe(describeParam("New floor material.")),
      wall_color: z.enum(wallColors).optional().describe(describeParam("New wall colour token.")),
      anchor_corner: z.enum(CORNERS).optional().describe(describeParam("Corner that stays fixed while resizing: nw (default), ne, sw or se. The opposite walls move.")),
      push_neighbors: z.boolean().optional().describe(describeParam("true (default) shifts the rooms beyond a moving wall so they keep touching; false leaves them where they are.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const hasPatch = [input.name, input.type, input.width_cm, input.depth_cm, input.floor, input.wall_color]
        .some((value) => value !== undefined);
      if (!hasPatch) return { ok: false, error: "invalid", detail: "Give at least one room field to update.", suggestion: "Set name, type, width_cm, depth_cm, floor or wall_color." };
      try {
        const { outside, shifted } = context.store.getState().updateRoom(sourceForStore(context.source), room.id, {
          name: input.name,
          type: input.type,
          width_cm: input.width_cm,
          depth_cm: input.depth_cm,
          floor: input.floor,
          wall_color: input.wall_color,
          anchorCorner: input.anchor_corner,
          pushNeighbors: input.push_neighbors,
        });
        const updated = context.store.getState().scene.rooms.find((candidate) => candidate.id === room.id);
        if (!updated) return { ok: false, error: "unavailable", detail: "The updated room could not be read." };
        const next = context.store.getState();
        const conflicts = evaluateRoom(next.scene, room.id, createCatalog(next.catalog));
        return {
          ok: true,
          room: { id: updated.id, name: updated.name, size_cm: roomSize(updated), area_m2: roomAreaM2(updated) },
          items_outside: outside,
          item_ids: outside,
          shifted_rooms: shifted,
          conflicts: conflicts.slice(0, 6).map(conflictRow),
          conflicts_count: conflicts.length,
          hint: outside.length
            ? "Move the listed items back inside the resized room."
            : shifted.length
              ? `${shifted.length} neighbouring room${shifted.length === 1 ? "" : "s"} moved to keep touching; the furniture still fits.`
              : "The room and its furniture still fit.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Update room failed";
      const room = result.room as { name?: string; size_cm?: string } | undefined;
      return `Updated ${room?.name ?? "room"} · ${room?.size_cm ?? "size unchanged"} cm`;
    },
  });
}

const offsetSchema = z.union([z.number().nonnegative(), z.enum(["start", "center", "end"])]);

export function addOpeningTool(): DefinedTool {
  return defineTool({
    name: "add_opening",
    title: "Add opening",
    description: "Adds a door, window or arch to a wall of a room at an offset from the wall's start (or start, center, end) with a width in cm; doors take a swing (in or out) and hinge (left or right), windows a sill height. Reports items that now block the door swing.",
    group: "build",
    input: z.object({
      room: roomParam.optional(),
      wall: z.string().min(1).describe(describeParam("Wall side (north, east, south, west) or wall id (w0…).")),
      kind: z.enum(["door", "window", "arch"]).describe(describeParam("Opening kind: door, window or arch.")),
      offset_cm: offsetSchema.optional().describe(describeParam("Distance in cm from the wall's start (clockwise) to the opening, or start, center, end.")),
      width_cm: z.number().int().positive().optional().describe(describeParam("Opening width in cm (defaults: door 90, window 120, arch 140).")),
      swing: z.enum(["in", "out"]).optional().describe(describeParam("Door swing: in or out.")),
      hinge: z.enum(["left", "right"]).optional().describe(describeParam("Door hinge from inside the room: left or right.")),
      sill_height_cm: z.number().nonnegative().optional().describe(describeParam("Window sill height in cm.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const wall = resolveRoomWall(room, input.wall);
      if ("ok" in wall) return wall;
      const width = input.width_cm ?? { door: 90, window: 120, arch: 140 }[input.kind];
      const offset = openingOffset(wall, width, input.offset_cm);
      try {
        const opening = context.store.getState().addOpening(sourceForStore(context.source), {
          roomId: room.id,
          wallId: wall.id,
          kind: input.kind,
          offset,
          width,
          ...(input.kind === "door" ? { swing: input.swing ?? "in", hinge: input.hinge ?? "left" } : {}),
          ...(input.kind === "window" ? { sillHeight: input.sill_height_cm ?? 90 } : {}),
        });
        const next = context.store.getState();
        const conflicts = conflictsForItem(
          evaluateRoom(next.scene, room.id, createCatalog(next.catalog)),
          opening.id,
        ).slice(0, 6).map(conflictRow);
        return {
          ok: true,
          room: room.id,
          room_name: room.name,
          opening: compactOpening(opening),
          opening_ids: [opening.id],
          conflicts,
          hint: "Use move_opening to adjust its position or width.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input) {
      const side = input.wall.toLowerCase();
      return `Added ${input.kind} on the ${side} wall`;
    },
  });
}

export function moveOpeningTool(): DefinedTool {
  return defineTool({
    name: "move_opening",
    title: "Move opening",
    description: "Moves or resizes an existing opening: a new wall, offset in cm, width, swing or hinge. Reports items that block the new door swing.",
    group: "build",
    input: z.object({
      opening: openingParam,
      wall: z.string().min(1).optional().describe(describeParam("New wall side or wall id.")),
      offset_cm: offsetSchema.optional().describe(describeParam("New offset in cm from wall start, or start, center, end.")),
      width_cm: z.number().int().positive().optional().describe(describeParam("New opening width in cm.")),
      swing: z.enum(["in", "out"]).optional().describe(describeParam("New door swing: in or out.")),
      hinge: z.enum(["left", "right"]).optional().describe(describeParam("New door hinge: left or right.")),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const opening = resolveOpening(state, input.opening);
      if ("ok" in opening) return opening;
      const room = resolveRoom(state, opening.roomId);
      if ("ok" in room) return room;
      const wall = resolveRoomWall(room, input.wall ?? opening.wallId);
      if ("ok" in wall) return wall;
      const width = input.width_cm ?? opening.width;
      const offset = input.offset_cm === undefined ? opening.offset : openingOffset(wall, width, input.offset_cm);
      try {
        context.store.getState().moveOpening(sourceForStore(context.source), opening.id, {
          wallId: wall.id,
          offset,
          width,
          ...(input.swing ? { swing: input.swing } : {}),
          ...(input.hinge ? { hinge: input.hinge } : {}),
        });
        const moved = context.store.getState().scene.openings.find((candidate) => candidate.id === opening.id);
        if (!moved) return { ok: false, error: "unavailable", detail: "The moved opening could not be read." };
        const next = context.store.getState();
        const conflicts = conflictsForItem(
          evaluateRoom(next.scene, room.id, createCatalog(next.catalog)),
          moved.id,
        ).slice(0, 6).map(conflictRow);
        return {
          ok: true,
          room: room.id,
          opening: compactOpening(moved),
          wall_side: wall.side,
          opening_ids: [moved.id],
          conflicts,
          hint: "Review the room for furniture near the opening.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      const opening = result.ok ? result.opening as { offset_cm?: number; wall?: string } : undefined;
      return `Moved ${input.opening} to ${opening?.offset_cm ?? input.offset_cm ?? "its offset"} cm on the ${String(result.ok ? result.wall_side ?? input.wall ?? "same" : input.wall ?? "same")} wall`;
    },
  });
}

export function removeOpeningTool(): DefinedTool {
  return defineTool({
    name: "remove_opening",
    title: "Remove opening",
    description: "Removes a door, window or arch by id.",
    group: "build",
    input: z.object({ opening: openingParam }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const opening = resolveOpening(state, input.opening);
      if ("ok" in opening) return opening;
      try {
        context.store.getState().removeOpening(sourceForStore(context.source), opening.id);
        return {
          ok: true,
          room: opening.roomId,
          removed: { id: opening.id, kind: opening.kind },
          opening_ids: [opening.id],
          hint: "Add another opening if the room still needs access or daylight.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      const removed = result.ok ? result.removed as { id?: string } : undefined;
      return `Removed ${removed?.id ?? input.opening}`;
    },
  });
}
