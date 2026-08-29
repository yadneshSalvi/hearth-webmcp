import { describe, expect, it } from "vitest";
import { HEARTH_TOOL_NAMES } from "../../src/assistant/tool-names";
import { allTools } from "../../src/tools/handlers";
import { toolContext } from "../tools/helpers";

describe("assistant tool allowlist", () => {
  it("stays synchronized with all handler definitions", () => {
    const handlerNames = allTools(toolContext()).map((tool) => tool.name).sort();
    expect(HEARTH_TOOL_NAMES).toEqual(handlerNames);
    expect(new Set(HEARTH_TOOL_NAMES).size).toBe(36);
  });
});

