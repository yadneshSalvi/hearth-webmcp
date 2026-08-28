import { describe, expect, it, vi } from "vitest";
import * as z from "zod";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import {
  bindDefinedTool, defineTool, executeDefinedTool, HearthToolDefinitionError,
} from "../../src/tools/define";
import { furnished2br } from "../fixtures/scenes";
import { resetStore, testUi } from "./helpers";

function bind(tool: ReturnType<typeof defineTool>): void {
  bindDefinedTool(tool, {
    context(source, signal) {
      return {
        store: hearthStore,
        ui: testUi(),
        shopify: createLocalShopify(hearthStore.getState().catalog),
        source,
        ...(signal ? { signal } : {}),
      };
    },
    before: vi.fn(),
    after: vi.fn(),
    now: () => 100,
  });
}

describe("defineTool", () => {
  it("emits strict draft-07-compatible input schemas", () => {
    const tool = defineTool({
      name: "schema_probe",
      title: "Schema probe",
      description: "Checks schema generation.",
      group: "core",
      input: z.object({ value: z.string().describe("A required value.") }).strict(),
      handler: () => ({ ok: true }),
      summarize: () => "Probed schema",
    });
    expect(tool.inputSchema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["value"],
      properties: { value: { type: "string", description: "A required value." } },
    });
    expect((tool.inputSchema as Record<string, unknown>).$schema).toBeUndefined();
  });

  it.each([
    ["Bad-name", "Valid description", "name"],
    ["a".repeat(31), "Valid description", "name"],
    ["valid_name", "d".repeat(501), "description"],
  ])("rejects invalid definition metadata %#", (name, description) => {
    expect(() => defineTool({
      name,
      title: "Invalid",
      description,
      group: "core",
      input: z.object({}).strict(),
      handler: () => ({ ok: true }),
      summarize: () => "Invalid",
    })).toThrow(HearthToolDefinitionError);
  });

  it("rejects nested parameter-name and description overages", () => {
    expect(() => defineTool({
      name: "nested_name_probe",
      title: "Nested probe",
      description: "Checks nested names.",
      group: "core",
      input: z.object({ nested: z.object({ ["x".repeat(31)]: z.string() }).strict() }).strict(),
      handler: () => ({ ok: true }),
      summarize: () => "Nested",
    })).toThrow(HearthToolDefinitionError);
    expect(() => defineTool({
      name: "nested_desc_probe",
      title: "Nested probe",
      description: "Checks nested descriptions.",
      group: "core",
      input: z.object({ nested: z.object({ value: z.string().describe("x".repeat(151)) }).strict() }).strict(),
      handler: () => ({ ok: true }),
      summarize: () => "Nested",
    })).toThrow(HearthToolDefinitionError);
  });

  it("converts handler exceptions into unavailable results", async () => {
    resetStore(furnished2br());
    const tool = defineTool({
      name: "throw_probe",
      title: "Throw probe",
      description: "Checks handler isolation.",
      group: "core",
      input: z.object({}).strict(),
      handler: () => { throw new Error("boom"); },
      summarize: () => "Threw",
    });
    bind(tool);
    await expect(executeDefinedTool(tool, {}, "agent")).resolves.toEqual({ ok: false, error: "unavailable", detail: "boom" });
    expect(hearthStore.getState().activity).toHaveLength(1);
  });

  it("shrinks oversized arrays and warns without throwing", async () => {
    resetStore(furnished2br());
    const tool = defineTool({
      name: "shrink_probe",
      title: "Shrink probe",
      description: "Checks output shrinking.",
      group: "core",
      input: z.object({}).strict(),
      handler: () => ({ ok: true, rows: Array.from({ length: 20 }, (_, index) => ({ index, text: "x".repeat(200) })), hint: "Next." }),
      summarize: () => "Shrank",
    });
    bind(tool);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await executeDefinedTool(tool, {}, "agent");
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
    expect(result.hint).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });
});
