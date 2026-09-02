import type { ToolGroup } from "../../state/types";
import { bindDefinedTool } from "../define";
import type { DefinedTool, ToolContext, ToolSource } from "../define";
import {
  addOpeningTool, applyTemplateTool, createRoomTool, moveOpeningTool, removeOpeningTool, updateRoomTool,
} from "./build";
import {
  applyPaletteTool, clearHomeTool, clearRoomTool, loadVariantTool, restoreFurnitureTool, saveVariantTool,
  setAccessibilityModeTool, setTimeOfDayTool, setViewTool, undoTool,
} from "./design";
import { importFloorPlanTool } from "./floorplan";
import {
  confirmPreviewTool, getCheckoutLinkTool, previewInRoomTool, updateCartTool,
} from "./commerce";
import { getProductTool, searchCatalogTool } from "./catalog";
import { removeFurnitureTool, resizeFurnitureTool, setColorwayTool } from "./furniture";
import { arrangeRoomTool, moveFurnitureTool, placeFurnitureTool } from "./placement";
import { cancelPreviewTool } from "./preview";
import { exportDesignBoardTool } from "./presentation";
import {
  getCartTool, getConflictsTool, getDesignReportTool, getRoomDetailsTool, getSceneSummaryTool,
  getSelectionTool, measureTool,
} from "./read";
import { setModeTool } from "./set-mode";
import { compareVariantsTool } from "./variants";

function toolNamesByGroup(tools: readonly DefinedTool[]): ReadonlyMap<ToolGroup, readonly string[]> {
  const grouped = new Map<ToolGroup, string[]>();
  for (const tool of tools) {
    const names = grouped.get(tool.group) ?? [];
    names.push(tool.name);
    grouped.set(tool.group, names);
  }
  return grouped;
}

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

/** All 40 fully implemented Hearth WebMCP handler definitions. */
export function allTools(context: ToolContext): DefinedTool[] {
  let groupedNames: ReadonlyMap<ToolGroup, readonly string[]> = new Map();
  const tools = [
    getSceneSummaryTool(() => groupedNames),
    getRoomDetailsTool(),
    getSelectionTool(),
    measureTool(),
    getConflictsTool(),
    getDesignReportTool(),
    searchCatalogTool(),
    getProductTool(),
    getCartTool(),
    setModeTool(),
    placeFurnitureTool(),
    moveFurnitureTool(),
    removeFurnitureTool(),
    setColorwayTool(),
    arrangeRoomTool(),
    applyPaletteTool(),
    setTimeOfDayTool(),
    setViewTool(),
    setAccessibilityModeTool(),
    undoTool(),
    saveVariantTool(),
    loadVariantTool(),
    clearRoomTool(),
    previewInRoomTool(),
    updateCartTool(),
    exportDesignBoardTool(),
    confirmPreviewTool(),
    cancelPreviewTool(),
    compareVariantsTool(),
    getCheckoutLinkTool(),
    applyTemplateTool(),
    createRoomTool(),
    updateRoomTool(),
    addOpeningTool(),
    moveOpeningTool(),
    removeOpeningTool(),
    resizeFurnitureTool(),
    clearHomeTool(),
    restoreFurnitureTool(),
    importFloorPlanTool(),
  ];
  groupedNames = toolNamesByGroup(tools);
  return bindStandalone(tools, context);
}

/** All 40 static definitions used by the lifecycle registry. */
export function allToolDefinitions(context: ToolContext): DefinedTool[] {
  return allTools(context);
}
