import { ensureModelContext } from "../tools/polyfill-loader";
import type { AssistantMessage, AssistantToolSchema } from "./types";

export type { AssistantMessage } from "./types";

export interface AssistantEvents {
  onText(delta: string): void;
  onToolCall(call: { id: string; name: string; input: unknown }): void;
  onToolResult(call: { id: string; name: string; result: unknown; ms: number }): void;
  onDone(turn: { text: string; calls: number }): void;
  onError(err: { message: string; retryable: boolean }): void;
}

export interface AssistantOptions {
  endpoint?: string;
  maxCallsPerTurn?: number;
  execute?: (name: string, input: unknown) => Promise<unknown>;
}

interface ClientSseEvent {
  event: string;
  data: unknown;
}

interface ExecutableModelContext extends WebMCP.ModelContext {
  executeTool(tool: WebMCP.RegisteredTool, args: string): Promise<unknown>;
}

class AssistantLoopError extends Error {
  retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "AssistantLoopError";
    this.retryable = retryable;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorDetail(value: unknown, fallback: string): string {
  if (!isRecord(value)) return fallback;
  for (const key of ["detail", "message", "error"] as const) {
    if (typeof value[key] === "string" && value[key].length > 0) return value[key];
  }
  return fallback;
}

function retryableMessage(message: string): boolean {
  return /retry|rate.limit|temporar|timed out|interrupted|could not be reached/i.test(message);
}

function parseBlock(block: string): ClientSseEvent | undefined {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (data.length === 0) return undefined;
  try {
    return { event, data: JSON.parse(data.join("\n")) as unknown };
  } catch {
    throw new AssistantLoopError("The assistant returned malformed stream data.", true);
  }
}

function serialiseResult(result: unknown): string {
  try {
    const value = JSON.stringify(result);
    if (typeof value === "string") return value;
  } catch {
    // Replace a non-serialisable tool result with an actionable envelope.
  }
  return JSON.stringify({ ok: false, error: "unavailable", detail: "The tool returned a non-serialisable result." });
}

function parseArguments(raw: string): { input: unknown; error?: unknown } {
  try {
    return { input: JSON.parse(raw) as unknown };
  } catch {
    const error = { ok: false, error: "invalid", detail: "Tool arguments were not valid JSON." };
    return { input: {}, error };
  }
}

function toolSchemas(tools: WebMCP.RegisteredTool[]): AssistantToolSchema[] {
  if (tools.length > 40) throw new AssistantLoopError("The page exposed more than 40 tools.", false);
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: isRecord(tool.inputSchema) ? structuredClone(tool.inputSchema) : {},
  }));
}

async function httpError(response: Response): Promise<AssistantLoopError> {
  let detail = `Assistant request failed (${response.status}).`;
  try {
    const body = JSON.parse(await response.text()) as unknown;
    detail = errorDetail(body, detail);
  } catch {
    // Preserve the status-only message for non-JSON responses.
  }
  return new AssistantLoopError(detail, response.status === 429 || response.status >= 500);
}

async function consumeSse(
  response: Response,
  signal: AbortSignal,
  handle: (event: ClientSseEvent) => Promise<void> | void,
): Promise<void> {
  if (!response.body) throw new AssistantLoopError("The assistant returned an empty response.", true);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;

  const processBlock = async (block: string): Promise<void> => {
    const parsed = parseBlock(block);
    if (!parsed) return;
    if (parsed.event === "done") done = true;
    await handle(parsed);
  };

  while (!done) {
    const chunk = await reader.read();
    if (chunk.done) break;
    if (signal.aborted) return;
    buffer = `${buffer}${decoder.decode(chunk.value, { stream: true })}`.replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      await processBlock(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
      if (done) break;
      boundary = buffer.indexOf("\n\n");
    }
  }
  if (!done && buffer.trim()) await processBlock(buffer);
  if (!done && !signal.aborted) throw new AssistantLoopError("The assistant stream ended before completion.", true);
  if (done) await reader.cancel().catch(() => undefined);
}

/** Creates the framework-free client loop used by Hearth's fallback assistant panel. */
export function createAssistant(opts: AssistantOptions = {}): {
  send(userText: string, ev: AssistantEvents): Promise<void>;
  abort(): void;
  history(): AssistantMessage[];
  reset(): void;
} {
  const endpoint = opts.endpoint ?? "/api/assistant";
  const configuredMax = opts.maxCallsPerTurn ?? 8;
  const maxCalls = Math.max(1, Math.min(8, Math.floor(configuredMax)));
  let messages: AssistantMessage[] = [];
  let active: AbortController | undefined;
  let turn = 0;

  const reportError = (ev: AssistantEvents, error: unknown): void => {
    const message = error instanceof Error ? error.message : "The assistant failed unexpectedly.";
    const retryable = error instanceof AssistantLoopError ? error.retryable : true;
    ev.onError({ message, retryable });
  };

  return {
    async send(userText, ev) {
      if (active) {
        ev.onError({ message: "An assistant turn is already in progress.", retryable: false });
        return;
      }
      if (!userText.trim()) {
        ev.onError({ message: "Enter a message before sending.", retryable: false });
        return;
      }
      const controller = new AbortController();
      active = controller;
      let fullText = "";
      let callCount = 0;
      let limitReached = false;
      turn += 1;
      messages.push({ role: "user", content: userText });

      try {
        const status = await ensureModelContext();
        if (controller.signal.aborted) return;
        if (status === "unavailable" || !document.modelContext) {
          throw new AssistantLoopError("WebMCP tools are unavailable in this browser.", false);
        }

        let shouldContinue = true;
        while (shouldContinue && !controller.signal.aborted) {
          const registeredTools = await document.modelContext.getTools();
          const byName = new Map(registeredTools.map((tool) => [tool.name, tool]));
          const schemas = toolSchemas(registeredTools);
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, tools: schemas, turn }),
            signal: controller.signal,
          });
          if (!response.ok) throw await httpError(response);

          let roundCalls = 0;
          let roundText = "";
          await consumeSse(response, controller.signal, async ({ event, data }) => {
            if (event === "text") {
              if (!isRecord(data) || typeof data.delta !== "string") {
                throw new AssistantLoopError("The assistant returned an invalid text event.", true);
              }
              roundText += data.delta;
              fullText += data.delta;
              ev.onText(data.delta);
              return;
            }
            if (event === "error") {
              const message = errorDetail(data, "The assistant stream failed.");
              throw new AssistantLoopError(message, retryableMessage(message));
            }
            if (event !== "tool_call") return;
            if (!isRecord(data)
              || typeof data.call_id !== "string"
              || typeof data.name !== "string"
              || typeof data.arguments !== "string") {
              throw new AssistantLoopError("The assistant returned an invalid tool call.", false);
            }
            if (limitReached) {
              throw new AssistantLoopError("The assistant kept calling tools after the turn limit was reached.", false);
            }

            callCount += 1;
            roundCalls += 1;
            const parsed = parseArguments(data.arguments);
            ev.onToolCall({ id: data.call_id, name: data.name, input: parsed.input });
            messages.push({
              type: "function_call",
              call_id: data.call_id,
              name: data.name,
              arguments: data.arguments,
            });

            const started = performance.now();
            let result: unknown;
            if (callCount >= maxCalls) {
              limitReached = true;
              result = { ok: false, error: "blocked", detail: "tool-call limit reached for this turn" };
            } else if (parsed.error) {
              result = parsed.error;
            } else {
              try {
                if (opts.execute) result = await opts.execute(data.name, parsed.input);
                else {
                  const modelContext = document.modelContext as ExecutableModelContext;
                  const tool = byName.get(data.name);
                  if (!tool) result = { ok: false, error: "not_found", detail: `Tool ${data.name} is no longer available.` };
                  else if (typeof modelContext.executeTool !== "function") {
                    result = { ok: false, error: "unavailable", detail: "This browser cannot execute WebMCP tools." };
                  } else result = await modelContext.executeTool(tool, JSON.stringify(parsed.input));
                }
              } catch (error) {
                result = {
                  ok: false,
                  error: "unavailable",
                  detail: error instanceof Error ? error.message.slice(0, 500) : "The tool could not be executed.",
                };
              }
            }
            const ms = Math.max(0, Math.round(performance.now() - started));
            ev.onToolResult({ id: data.call_id, name: data.name, result, ms });
            messages.push({ type: "function_call_output", call_id: data.call_id, output: serialiseResult(result) });
          });

          if (roundText) messages.push({ role: "assistant", content: roundText });
          shouldContinue = roundCalls > 0;
        }
        if (!controller.signal.aborted) ev.onDone({ text: fullText, calls: callCount });
      } catch (error) {
        if (!controller.signal.aborted) reportError(ev, error);
      } finally {
        if (active === controller) active = undefined;
      }
    },
    abort() {
      active?.abort(new DOMException("Assistant turn aborted", "AbortError"));
    },
    history() {
      return structuredClone(messages);
    },
    reset() {
      active?.abort(new DOMException("Assistant reset", "AbortError"));
      messages = [];
      turn = 0;
    },
  };
}

