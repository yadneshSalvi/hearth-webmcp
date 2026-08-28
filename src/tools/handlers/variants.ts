import * as z from "zod";
import { createCatalog } from "../../engine/catalog";
import { evaluateRoom } from "../../engine/conflicts";
import type { Scene, Variant } from "../../engine/types";
import { diffVariants } from "../../engine/variants";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { describeParam, roomParam } from "../params";
import { resolveRoom, resolveVariant } from "./resolve";

function sceneForVariant(scene: Scene, variant: Variant): Scene {
  return {
    ...scene,
    furniture: [
      ...scene.furniture.filter((item) => item.roomId !== variant.roomId),
      ...variant.furniture.map((item) => ({ ...item, pos: { ...item.pos }, status: "placed" as const })),
    ],
  };
}

export function compareVariantsTool(): DefinedTool {
  return defineTool({
    name: "compare_variants",
    title: "Compare variants",
    description: "Shows two saved layout variants of a room side by side with a draggable split slider and returns their differences (items only in one of them, items that moved) and the conflict count of each. Any layout change closes the comparison.",
    group: "variants",
    input: z.object({
      left: z.string().min(1).describe(describeParam("Saved variant name for the left/right half.")),
      right: z.string().min(1).describe(describeParam("Saved variant name for the left/right half.")),
      room: roomParam.optional(),
    }).strict(),
    handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      const left = resolveVariant(state.scene, room.id, input.left);
      if ("ok" in left) return left;
      const right = resolveVariant(state.scene, room.id, input.right);
      if ("ok" in right) return right;
      if (left.name.toLowerCase() === right.name.toLowerCase()) {
        return { ok: false, error: "invalid", detail: "left and right must be different saved variants." };
      }
      const catalog = createCatalog(state.catalog);
      context.store.getState().setUi({ compare: { left: left.name, right: right.name, roomId: room.id } });
      return {
        ok: true,
        room: room.id,
        left: left.name,
        right: right.name,
        diff: diffVariants(left, right, catalog),
        conflicts: {
          left: evaluateRoom(sceneForVariant(state.scene, left), room.id, catalog).length,
          right: evaluateRoom(sceneForVariant(state.scene, right), room.id, catalog).length,
        },
        hint: "Drag the split slider to compare; any layout change closes this view.",
      };
    },
    summarize(input, result) {
      return result.ok
        ? `Comparing “${String(result.left ?? input.left)}” vs “${String(result.right ?? input.right)}”`
        : "Compare variants failed";
    },
  });
}
