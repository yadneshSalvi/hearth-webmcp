import * as z from "zod";
import type { StoreApi } from "zustand";
import type { ConflictKind, Scene } from "../engine/types";
import type { ShopifyClient } from "../shopify/types";
import type { ActionSource, HearthStore, ToolGroup } from "../state/types";
import { beginToolBatch, endToolBatch } from "../state/tool-batch";
import type { ConfirmResult } from "./confirm";

export type ToolSource = "agent" | "assistant" | "test";

export interface ConflictLite {
  kind: ConflictKind;
  severity: "error" | "warn";
  items: string[];
  detail: string;
  fix: string;
}

export type Ok = {
  ok: true;
  conflicts?: ConflictLite[] | number | { left: number; right: number };
  hint?: string;
  [data: string]: unknown;
};

export type ToolError = "blocked" | "not_found" | "invalid" | "needs_confirmation" | "cancelled" | "unavailable";

export type Err = {
  ok: false;
  error: ToolError;
  detail: string;
  suggestion?: string;
  alternatives?: string[];
  [extra: string]: unknown;
};

export type ToolResult = Ok | Err;

export type ToolFocus = { kind: "room" | "item"; id: string };

export interface ExportBoardResult {
  items: number;
  total_usd: number;
  size_px: string;
}

export interface ToolUi {
  confirm(message: string): Promise<ConfirmResult>;
  focus(target: ToolFocus): void;
  pulse(ids: string[]): void;
  exportBoard?(input: { roomId: string; title: string }): Promise<ExportBoardResult> | ExportBoardResult;
}

export interface ToolContext {
  store: StoreApi<HearthStore>;
  ui: ToolUi;
  shopify: ShopifyClient;
  signal?: AbortSignal;
  source: ToolSource;
}

type ToolInput<InputSchema extends z.ZodObject> = z.output<NoInfer<InputSchema>>;

export interface ToolSpec<InputSchema extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  group: ToolGroup;
  input: InputSchema;
  readOnly?: boolean;
  untrusted?: boolean;
  confirm?(input: ToolInput<InputSchema>, scene: Scene): string | null;
  cancelledDetail?(input: ToolInput<InputSchema>, scene: Scene): string;
  handler(input: ToolInput<InputSchema>, context: ToolContext): Promise<ToolResult> | ToolResult;
  summarize(input: ToolInput<InputSchema>, result: ToolResult): string;
  shrink?: ReadonlyArray<(result: ToolResult) => ToolResult>;
}

export type DefinedTool = WebMCP.ModelContextTool & {
  group: ToolGroup;
  spec: ToolSpec;
};

interface ToolRuntime {
  context(source: ToolSource, signal?: AbortSignal): ToolContext;
  before(): void;
  after(): void;
  now(): number;
}

export class HearthToolDefinitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HearthToolDefinitionError";
  }
}

const runtimes = new WeakMap<DefinedTool, ToolRuntime>();
let receiptSequence = 0;

function definitionError(message: string): never {
  throw new HearthToolDefinitionError(message);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assertSchemaBudgets(value: unknown, path = "inputSchema"): void {
  const schema = asRecord(value);
  if (!schema) return;
  const properties = asRecord(schema.properties);
  if (properties) {
    for (const [name, property] of Object.entries(properties)) {
      if (name.length > 30) definitionError(`${path}.${name} exceeds the 30-character parameter-name budget`);
      const propertyRecord = asRecord(property);
      if (typeof propertyRecord?.description === "string" && propertyRecord.description.length > 150) {
        definitionError(`${path}.${name} exceeds the 150-character parameter-description budget`);
      }
      assertSchemaBudgets(property, `${path}.${name}`);
    }
  }
  for (const key of ["items", "additionalProperties", "not", "if", "then", "else"] as const) {
    assertSchemaBudgets(schema[key], `${path}.${key}`);
  }
  for (const key of ["anyOf", "oneOf", "allOf", "prefixItems"] as const) {
    const values = schema[key];
    if (Array.isArray(values)) values.forEach((entry, index) => assertSchemaBudgets(entry, `${path}.${key}.${index}`));
  }
  for (const key of ["$defs", "definitions"] as const) {
    const definitions = asRecord(schema[key]);
    if (definitions) Object.entries(definitions).forEach(([name, entry]) => assertSchemaBudgets(entry, `${path}.${key}.${name}`));
  }
}

function cleanSchema(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(cleanSchema);
    return;
  }
  const schema = asRecord(value);
  if (!schema) return;
  if (schema.maximum === Number.MAX_SAFE_INTEGER) delete schema.maximum;
  Object.values(schema).forEach(cleanSchema);
}

function jsonSchema(input: z.ZodObject): Record<string, unknown> {
  const generated = z.toJSONSchema(input, {
    target: "draft-07",
    unrepresentable: "any",
    io: "input",
    reused: "inline",
    cycles: "throw",
  }) as Record<string, unknown>;
  const { $schema: _schema, ...withoutDialect } = generated;
  void _schema;
  cleanSchema(withoutDialect);
  assertSchemaBudgets(withoutDialect);
  return withoutDialect;
}

function invalid(detail: string): Err {
  return {
    ok: false,
    error: "invalid",
    detail,
    suggestion: "Check the tool input schema and try again.",
  };
}

function parseJsonInput(input: unknown): { ok: true; value: unknown } | { ok: false; result: Err } {
  if (typeof input !== "string") return { ok: true, value: input };
  try {
    return { ok: true, value: JSON.parse(input) as unknown };
  } catch {
    return { ok: false, result: invalid("$ — input is not valid JSON") };
  }
}

function capArrays(value: unknown, limit: number): unknown {
  if (Array.isArray(value)) return value.slice(0, limit).map((entry) => capArrays(entry, limit));
  const record = asRecord(value);
  if (!record) return value;
  return Object.fromEntries(Object.entries(record).map(([key, entry]) => [key, capArrays(entry, limit)]));
}

function dropHint(result: ToolResult): ToolResult {
  const clone = structuredClone(result);
  delete clone.hint;
  return clone;
}

function fallbackCompact(result: ToolResult): ToolResult {
  const compact = capArrays(result, 2);
  const record = asRecord(compact);
  if (!record) return { ok: false, error: "unavailable", detail: "The tool result could not be serialised." };
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === "string" && value.length > 160) record[key] = `${value.slice(0, 157)}…`;
  }
  return record as ToolResult;
}

function resultLength(result: ToolResult): number {
  const serialised = JSON.stringify(result);
  if (typeof serialised !== "string") throw new Error("Tool result is not JSON serialisable");
  return serialised.length;
}

function fitBudget(result: ToolResult, spec: ToolSpec): ToolResult {
  if (resultLength(result) <= 1500) return result;
  console.warn(`[Hearth WebMCP] ${spec.name} exceeded 1500 result characters; applying shrink policy.`);
  const steps = spec.shrink ?? [dropHint, (value) => capArrays(value, 6) as ToolResult, (value) => capArrays(value, 4) as ToolResult];
  let compact = result;
  for (const step of steps) {
    compact = step(compact);
    if (resultLength(compact) <= 1500) return compact;
  }
  compact = fallbackCompact(compact);
  if (resultLength(compact) <= 1500) return compact;
  return { ok: false, error: "unavailable", detail: "The result was too large to return safely." };
}

function collectItemIds(result: ToolResult): string[] {
  const ids = new Set<string>();
  const record = asRecord(result);
  for (const key of ["item", "removed", "discarded"] as const) {
    const nested = asRecord(record?.[key]);
    if (typeof nested?.id === "string") ids.add(nested.id);
  }
  for (const key of ["item_ids", "removed_ids", "items_outside"] as const) {
    const values = record?.[key];
    if (Array.isArray(values)) values.forEach((value) => { if (typeof value === "string") ids.add(value); });
  }
  return [...ids];
}

function receiptSource(source: ToolSource): ActionSource {
  return source === "test" ? "system" : source;
}

function receiptSummary(spec: ToolSpec, input: unknown, result: ToolResult): string {
  if (!result.ok && result.error === "invalid") return `${spec.title} — invalid input`;
  try {
    const summary = spec.summarize(input as Record<string, unknown>, result);
    return summary.length <= 80 ? summary : `${summary.slice(0, 77)}…`;
  } catch {
    return result.ok ? spec.title : `${spec.title} — ${result.error}`;
  }
}

function recordReceipt(tool: DefinedTool, runtime: ToolRuntime, source: ToolSource, input: unknown, result: ToolResult): void {
  receiptSequence += 1;
  const context = runtime.context(source);
  context.store.getState().pushActivity({
    id: `tool-${runtime.now()}-${receiptSequence}`,
    t: runtime.now(),
    source: receiptSource(source),
    tool: tool.name,
    title: tool.title ?? tool.name,
    summary: receiptSummary(tool.spec, input, result),
    itemIds: collectItemIds(result),
    input: structuredClone(input),
    result: structuredClone(result),
  });
}

function safeRecordReceipt(tool: DefinedTool, runtime: ToolRuntime, source: ToolSource, input: unknown, result: ToolResult): void {
  try {
    recordReceipt(tool, runtime, source, input, result);
  } catch (error) {
    console.warn(`[Hearth WebMCP] Failed to record ${tool.name} receipt.`, error);
  }
}

/** Installs the registry-owned execution lifecycle for a defined tool. */
export function bindDefinedTool(tool: DefinedTool, runtime: ToolRuntime): void {
  runtimes.set(tool, runtime);
}

/** Executes one definition through the same path used by native WebMCP and the assistant. */
export async function executeDefinedTool(
  tool: DefinedTool,
  input: unknown,
  source: ToolSource,
  signal?: AbortSignal,
): Promise<ToolResult> {
  const runtime = runtimes.get(tool);
  if (!runtime) return { ok: false, error: "unavailable", detail: `Tool ${tool.name} is not attached to a registry.` };
  const parsedJson = parseJsonInput(input);
  let result: ToolResult;
  let receiptInput: unknown = input;
  if (!parsedJson.ok) {
    result = parsedJson.result;
    safeRecordReceipt(tool, runtime, source, receiptInput, result);
    return result;
  }
  const parsed = tool.spec.input.safeParse(parsedJson.value);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.length ? issue.path.join(".") : "$";
    result = invalid(`${path} — ${issue?.message ?? "Invalid input"}`);
    safeRecordReceipt(tool, runtime, source, receiptInput, result);
    return result;
  }
  receiptInput = parsed.data;
  const context = runtime.context(source, signal);
  runtime.before();
  try {
    let confirmation: string | null;
    try {
      confirmation = tool.spec.confirm?.(parsed.data, context.store.getState().scene) ?? null;
    } catch (error) {
      result = { ok: false, error: "unavailable", detail: error instanceof Error ? error.message.slice(0, 500) : "Confirmation is unavailable." };
      safeRecordReceipt(tool, runtime, source, receiptInput, result);
      return result;
    }
    if (confirmation) {
      let decision: ConfirmResult;
      try {
        decision = await context.ui.confirm(confirmation);
      } catch (error) {
        result = { ok: false, error: "unavailable", detail: error instanceof Error ? error.message.slice(0, 500) : "Confirmation is unavailable." };
        safeRecordReceipt(tool, runtime, source, receiptInput, result);
        return result;
      }
      if (!decision.accepted) {
        let detail = `The human declined ${confirmation.toLowerCase().replace(/[?.!]$/, "")}.`;
        if (decision.reason === "timeout") detail = "No confirmation within 45 s";
        else if (tool.spec.cancelledDetail) {
          try {
            detail = tool.spec.cancelledDetail(parsed.data, context.store.getState().scene);
          } catch {
            // The generic decline message remains actionable.
          }
        }
        result = { ok: false, error: "cancelled", detail };
        safeRecordReceipt(tool, runtime, source, receiptInput, result);
        return result;
      }
    }

    beginToolBatch();
    try {
      try {
        result = await tool.spec.handler(parsed.data, context);
      } catch (error) {
        result = {
          ok: false,
          error: "unavailable",
          detail: error instanceof Error ? error.message : "The tool is temporarily unavailable.",
        };
      }
      const resultRecord = asRecord(result);
      if (!resultRecord || typeof resultRecord.ok !== "boolean") {
        result = { ok: false, error: "unavailable", detail: "The tool returned an invalid result." };
      }
      try {
        result = fitBudget(result, tool.spec);
      } catch (error) {
        result = { ok: false, error: "unavailable", detail: error instanceof Error ? error.message.slice(0, 500) : "The tool returned an invalid result." };
      }
      safeRecordReceipt(tool, runtime, source, receiptInput, result);
      return result;
    } finally {
      endToolBatch();
    }
  } finally {
    runtime.after();
  }
}

/** Defines a budget-checked WebMCP tool from a strict Zod input object. */
export function defineTool<const InputSchema extends z.ZodObject>(spec: ToolSpec<InputSchema>): DefinedTool {
  if (!/^[a-z][a-z0-9_]*$/.test(spec.name)) definitionError(`${spec.name} is not a valid Hearth tool name`);
  if (spec.name.length > 30) definitionError(`${spec.name} exceeds the 30-character tool-name budget`);
  if (spec.description.length > 500) definitionError(`${spec.name} exceeds the 500-character description budget`);
  const inputSchema = jsonSchema(spec.input);
  const tool: DefinedTool = {
    name: spec.name,
    title: spec.title,
    description: spec.description,
    inputSchema,
    annotations: {
      ...(spec.readOnly ? { readOnlyHint: true } : {}),
      ...(spec.untrusted ? { untrustedContentHint: true } : {}),
    },
    group: spec.group,
    spec: spec as ToolSpec,
    execute(input: Record<string, unknown>, options?: WebMCP.ToolExecuteCallbackOptions): Promise<ToolResult> {
      return executeDefinedTool(tool, input, "agent", options?.signal);
    },
  } satisfies DefinedTool;
  return tool;
}
