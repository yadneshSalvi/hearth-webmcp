import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { allToolDefinitions, allTools } from "../../src/tools/handlers";
import { toolContext } from "./helpers";

interface ContractTool {
  name: string;
  title: string;
  description: string;
}

function contractTools(): ContractTool[] {
  const markdown = readFileSync(resolve(process.cwd(), "TOOLS.md"), "utf8");
  const pattern = /### \d+\. `([^`]+)`[^\n]*\n\*\*Title:\*\* ([^\n]+)\n\*\*Description:\*\* ([^\n]+)/g;
  return [...markdown.matchAll(pattern)].map((match) => ({
    name: match[1] ?? "",
    title: match[2] ?? "",
    description: match[3] ?? "",
  }));
}

describe("tool contract coverage", () => {
  it("implements all 36 contract names", () => {
    const contract = contractTools();
    const implemented = allTools(toolContext());
    expect(contract).toHaveLength(36);
    expect(implemented).toHaveLength(36);
    expect(new Set(implemented.map(({ name }) => name)).size).toBe(36);
    expect(implemented.map(({ name }) => name).sort()).toEqual(contract.map(({ name }) => name).sort());
  });

  it("keeps implemented titles and descriptions verbatim", () => {
    const contract = new Map(contractTools().map((tool) => [tool.name, tool]));
    for (const tool of allTools(toolContext())) {
      const expected = contract.get(tool.name);
      expect(expected, tool.name).toBeDefined();
      expect(tool.title, tool.name).toBe(expected?.title);
      expect(tool.description, tool.name).toBe(expected?.description);
      expect(tool.group, tool.name).toBeTruthy();
    }
  });

  it("defines every name exactly once", () => {
    const definitions = allToolDefinitions(toolContext());
    expect(definitions).toHaveLength(36);
    expect(new Set(definitions.map(({ name }) => name)).size).toBe(36);
    for (const tool of definitions) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(tool.title).toBeTruthy();
      expect(tool.description.length).toBeGreaterThan(0);
    }
  });
});
