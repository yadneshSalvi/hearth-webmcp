import { bindDefinedTool } from "../define";
import type { DefinedTool, ToolContext, ToolSource } from "../define";
import {
  addOpeningTool, applyTemplateTool, createRoomTool, moveOpeningTool, removeOpeningTool, updateRoomTool,
} from "./build";
import {
  applyPaletteTool, clearRoomTool, loadVariantTool, saveVariantTool, setAccessibilityModeTool,
  setTimeOfDayTool, setViewTool, undoTool,
} from "./design";
import { removeFurnitureTool, setColorwayTool } from "./furniture";
import { pendingToolDefinitions, pendingTools } from "./pending";
import { cancelPreviewTool } from "./preview";
import { setModeTool } from "./set-mode";

function bindStandalone(tools: DefinedTool[], context: ToolContext): DefinedTool[] {
  for (const tool of tools) bindDefinedTool(tool, {
    context(source: ToolSource, signal?: AbortSignal) {
      return { ...context, source, ...(signal ? { signal } : {}) };
    },
    before() {},
    after() {},
    now: Date.now,
  });
  return tools;
}

/** The first-round 18 fully implemented handler definitions. */
export function allTools(_context: ToolContext): DefinedTool[] {
  return bindStandalone([
    setModeTool(),
    removeFurnitureTool(),
    setColorwayTool(),
    applyPaletteTool(),
    setTimeOfDayTool(),
    setViewTool(),
    setAccessibilityModeTool(),
    undoTool(),
    saveVariantTool(),
    loadVariantTool(),
    clearRoomTool(),
    cancelPreviewTool(),
    applyTemplateTool(),
    createRoomTool(),
    updateRoomTool(),
    addOpeningTool(),
    moveOpeningTool(),
    removeOpeningTool(),
  ], _context);
}

/** All 36 static definitions used by the lifecycle registry. */
export function allToolDefinitions(context: ToolContext): DefinedTool[] {
  return bindStandalone([...allTools(context), ...pendingToolDefinitions()], context);
}

export { pendingTools };
