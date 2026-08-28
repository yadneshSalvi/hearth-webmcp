import * as z from "zod";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { fromCaught, productName, sourceForStore } from "./resolve";

export function cancelPreviewTool(): DefinedTool {
  return defineTool({
    name: "cancel_preview",
    title: "Cancel preview",
    description: "Discards the current preview ghost without changing the layout or the cart.",
    group: "preview",
    input: z.object({}).strict(),
    handler(_input, context) {
      const state = context.store.getState();
      const ghost = state.scene.furniture.find((item) => item.status === "ghost");
      if (!ghost) {
        return {
          ok: false,
          error: "not_found",
          detail: "No preview ghost exists.",
          alternatives: [],
        };
      }
      const name = productName(state, ghost);
      try {
        context.store.getState().clearGhost(sourceForStore(context.source));
        return {
          ok: true,
          room: ghost.roomId,
          discarded: { product: ghost.catalogId, name },
          item_ids: [ghost.id],
          hint: "Use preview_in_room to try another product.",
        };
      } catch (error) {
        return fromCaught(error);
      }
    },
    summarize(_input, result) {
      if (!result.ok) return "Cancel preview failed";
      const discarded = result.discarded as { name?: string } | undefined;
      return `Discarded preview of ${discarded?.name ?? "product"}`;
    },
  });
}
