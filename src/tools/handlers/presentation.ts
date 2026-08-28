import * as z from "zod";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { describeParam, roomParam } from "../params";
import { resolveRoom } from "./resolve";

export function exportDesignBoardTool(): DefinedTool {
  return defineTool({
    name: "export_design_board",
    title: "Export design board",
    description: "Creates a design board PNG for a room: dollhouse render, plan view, palette swatches and an itemised list with prices and the total, then starts the download in the page. Use it to present or share a finished layout.",
    group: "present",
    input: z.object({
      room: roomParam.optional(),
      title: z.string().max(100).optional().describe(describeParam("Board title (default the room name).")),
    }).strict(),
    async handler(input, context) {
      const state = context.store.getState();
      const room = resolveRoom(state, input.room);
      if ("ok" in room) return room;
      if (!context.ui.exportBoard) {
        return { ok: false, error: "unavailable", detail: "Design-board export is not wired into this page yet." };
      }
      try {
        const title = input.title ?? room.name;
        const board = await context.ui.exportBoard({ roomId: room.id, title });
        return {
          ok: true,
          room: room.id,
          board: { title, ...board },
          download: "started",
          hint: "The PNG download has started; share it with the human when ready.",
        };
      } catch (error) {
        return {
          ok: false,
          error: "unavailable",
          detail: error instanceof Error ? error.message : "Design-board export failed.",
        };
      }
    },
    summarize(input, result) {
      if (!result.ok) return "Export design board failed";
      const board = result.board as { title?: string } | undefined;
      return `Exported design board · ${board?.title ?? input.title ?? "room"}`;
    },
  });
}
