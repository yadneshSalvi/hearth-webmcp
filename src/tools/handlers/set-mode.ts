import * as z from "zod";
import type { DefinedTool } from "../define";
import { defineTool } from "../define";
import { describeParam } from "../params";
import { sourceForStore } from "./resolve";

export function setModeTool(): DefinedTool {
  return defineTool({
    name: "set_mode",
    title: "Switch mode",
    description: "Switches the studio mode. build: edit rooms and openings (enables apply_template, create_room, update_room, add_opening, move_opening and remove_opening). design: place and arrange furniture. shop: browse products and manage the cart with prices shown; enables get_checkout_link. Design and shop tools stay available in every mode.",
    group: "core",
    waitForTools: true,
    input: z.object({
      mode: z.enum(["build", "design", "shop"]).describe(describeParam("Studio mode: build, design or shop.")),
    }).strict(),
    handler(input, context) {
      context.store.getState().setMode(sourceForStore(context.source), input.mode);
      return {
        ok: true,
        mode: input.mode,
        hint: input.mode === "build"
          ? "Build tools are now available: create_room, update_room and opening tools."
          : "Design and shop tools remain available in every mode.",
      };
    },
    summarize(input) {
      return `Switched to ${input.mode[0]?.toUpperCase()}${input.mode.slice(1)} mode`;
    },
  });
}
