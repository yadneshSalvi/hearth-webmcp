import * as z from "zod";
import { planToScene } from "../../engine/floorplan";
import { roomSize } from "../../engine/geometry";
import { starterFurniture } from "../../engine/starter";
import type { Scene } from "../../engine/types";
import type { DefinedTool, Err } from "../define";
import { defineTool } from "../define";
import { describeParam } from "../params";
import { fromCaught, sourceForStore } from "./resolve";

const MAX_ROOMS = 12;
const MAX_NOTES = 4;
const MAX_IDS = 20;

function placedCount(scene: Scene): number {
  return scene.furniture.filter((item) => item.status === "placed").length;
}

export function importFloorPlanTool(): DefinedTool {
  return defineTool({
    name: "import_floor_plan",
    title: "Import floor plan",
    description: "Builds the home from a floor-plan image: the plan the human uploaded in the studio (the default) or an image_url. A vision model reads room names, printed dimensions, doors and windows; the engine lays the rooms out to scale in cm, adds doors and windows, and furnished adds starter furniture. Takes 20 to 60 s. Asks for confirmation if the current home has furniture.",
    group: "build",
    input: z.object({
      image_url: z.string().url().max(2_000).optional().describe(describeParam("http(s) URL of a floor-plan image (png, jpg, webp, ≤ 8 MB). Omit to use the plan the human uploaded in the studio.")),
      furnished: z.boolean().default(false).describe(describeParam("true adds starter furniture to every room (bed, wardrobe, sofa, table…) placed by the engine.")),
    }).strict(),
    confirm(input, scene, state) {
      // Nothing to read yet means nothing to replace: the handler answers not_found without a dialog.
      if (!input.image_url && !state.ui.uploadedPlan) return null;
      const count = placedCount(scene);
      return count > 0 ? `Replace this home and its ${count} placed items with the imported floor plan?` : null;
    },
    cancelledDetail() {
      return "The human declined the imported floor plan.";
    },
    async handler(input, context) {
      const state = context.store.getState();
      const uploaded = state.ui.uploadedPlan;
      if (!input.image_url && !uploaded) {
        const missing: Err = {
          ok: false,
          error: "not_found",
          detail: "No floor plan has been uploaded. Ask the human to drop one on the studio (Layouts → Import a plan), or pass image_url.",
          alternatives: [],
        };
        return missing;
      }
      if (!context.planReader) return { ok: false, error: "unavailable", detail: "The plan reader is not available on this page." };
      const read = await context.planReader(
        input.image_url ? { url: input.image_url } : { image: uploaded?.dataUrl },
        context.signal,
      );
      if (!read.ok) return { ok: false, error: read.error, detail: read.detail, ...(read.error === "not_found" ? { alternatives: [] } : {}) };
      let build: ReturnType<typeof planToScene>;
      try {
        build = planToScene(read.plan);
      } catch (error) {
        return { ok: false, error: "invalid", detail: error instanceof Error ? error.message : "The plan could not be laid out." };
      }
      const scene = input.furnished
        ? { ...build.scene, furniture: starterFurniture(build.scene, state.catalog) }
        : build.scene;
      const label = uploaded && !input.image_url ? uploaded.name : (read.plan.title.trim() || "the image");
      try {
        context.store.getState().applyImportedPlan(sourceForStore(context.source), scene, label);
        context.ui.focus({ kind: "home", id: "home" });
        const next = context.store.getState().scene;
        const rooms = next.rooms.slice(0, MAX_ROOMS).map((room) => ({ id: room.id, name: room.name, size_cm: roomSize(room) }));
        const itemIds = next.furniture.map(({ id }) => id);
        return {
          ok: true,
          room: next.meta.activeRoomId,
          plan: { title: read.plan.title.trim() || label, confidence: Math.round(read.plan.confidence * 100) / 100, units: read.plan.units, read_ms: read.ms },
          rooms,
          ...(next.rooms.length > MAX_ROOMS ? { more_rooms: next.rooms.length - MAX_ROOMS } : {}),
          openings: next.openings.length,
          items: next.furniture.length,
          item_ids: itemIds.slice(0, MAX_IDS),
          ...(itemIds.length > MAX_IDS ? { more: itemIds.length - MAX_IDS } : {}),
          skipped: build.skipped.slice(0, MAX_NOTES),
          notes: build.notes.slice(0, MAX_NOTES),
          hint: "The studio shows the whole home; set_view with a room id zooms in, set_mode design furnishes.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(input, result) {
      if (!result.ok) return result.error === "cancelled" ? "Import floor plan — declined" : "Import floor plan failed";
      const rooms = Array.isArray(result.rooms) ? result.rooms.length + (typeof result.more_rooms === "number" ? result.more_rooms : 0) : 0;
      return `Imported floor plan · ${rooms} room${rooms === 1 ? "" : "s"}${input.furnished ? " (furnished)" : ""}`;
    },
  });
}
