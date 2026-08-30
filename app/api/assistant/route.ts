import { HEARTH_TOOL_NAME_SET } from "@/src/assistant/tool-names";
import type { AssistantMessage, AssistantToolSchema } from "@/src/assistant/types";

export const dynamic = "force-dynamic";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_BODY_CHARS = 500_000;
const MAX_MESSAGES = 200;
const MAX_TOOLS = 40;
const MAX_CALLS_PER_TURN = 60;
const TIMEOUT_MS = 60_000;

export const ASSISTANT_INSTRUCTIONS = [
  "You are Hearth, a concise interior-design studio assistant working in the human's live home.",
  "Use cm for lengths and USD for money. Room coordinates start at the north-west corner: x goes east, y south; rotation is clockwise and 0 faces south.",
  "Call get_scene_summary first when you do not know room or item ids. Prefer semantic anchors over raw positions.",
  "If a tool you need is not in your list, call set_mode first: build enables the floor-plan and room tools (apply_template, create_room, update_room, add_opening, move_opening, remove_opening); shop enables the cart and checkout. Then continue the task in the same turn.",
  "Before calling clear_room or apply_template, briefly explain what will be replaced and ask for confirmation through the tool flow.",
  "Purchases are completed by the human using get_checkout_link; never claim to purchase for them.",
  "Reply briefly because the UI already shows tool receipts.",
].join(" ");

interface AssistantRequestBody {
  messages: AssistantMessage[];
  tools: AssistantToolSchema[];
  turn: number;
}

interface OpenAIEvent {
  type?: string;
  delta?: unknown;
  item?: unknown;
  response?: unknown;
  error?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validShortString(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function parseMessage(value: unknown): AssistantMessage | undefined {
  if (!isRecord(value)) return undefined;
  if ((value.role === "user" || value.role === "assistant") && typeof value.content === "string" && value.content.length <= 20_000) {
    return { role: value.role, content: value.content };
  }
  if (value.type === "function_call"
    && validShortString(value.call_id, 200)
    && validShortString(value.name, 100)
    && HEARTH_TOOL_NAME_SET.has(value.name)
    && typeof value.arguments === "string"
    && value.arguments.length <= 20_000) {
    return { type: value.type, call_id: value.call_id, name: value.name, arguments: value.arguments };
  }
  if (value.type === "function_call_output"
    && validShortString(value.call_id, 200)
    && typeof value.output === "string"
    && value.output.length <= 20_000) {
    return { type: value.type, call_id: value.call_id, output: value.output };
  }
  return undefined;
}

function parseTool(value: unknown): AssistantToolSchema | undefined {
  if (!isRecord(value)
    || !validShortString(value.name, 100)
    || !HEARTH_TOOL_NAME_SET.has(value.name)
    || !validShortString(value.description, 500)
    || !isRecord(value.inputSchema)) return undefined;
  if (JSON.stringify(value.inputSchema).length > 50_000) return undefined;
  return { name: value.name, description: value.description, inputSchema: value.inputSchema };
}

function callsInCurrentTurn(messages: AssistantMessage[]): number {
  let lastUser = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && "role" in message && message.role === "user") {
      lastUser = index;
      break;
    }
  }
  if (lastUser < 0) return Number.POSITIVE_INFINITY;
  return messages.slice(lastUser + 1).filter((message) => "type" in message && message.type === "function_call").length;
}

function validateBody(value: unknown): { ok: true; body: AssistantRequestBody } | { ok: false; detail: string } {
  if (!isRecord(value)) return { ok: false, detail: "Request body must be an object." };
  if (!Array.isArray(value.messages) || value.messages.length === 0 || value.messages.length > MAX_MESSAGES) {
    return { ok: false, detail: `messages must contain 1-${MAX_MESSAGES} items.` };
  }
  const messages = value.messages.map(parseMessage);
  if (messages.some((message) => !message)) return { ok: false, detail: "messages contains an invalid item." };
  if (!Array.isArray(value.tools) || value.tools.length > MAX_TOOLS) {
    return { ok: false, detail: `tools must contain at most ${MAX_TOOLS} items.` };
  }
  const tools = value.tools.map(parseTool);
  if (tools.some((tool) => !tool)) return { ok: false, detail: "tools contains an invalid or non-Hearth tool." };
  const names = tools.map((tool) => tool?.name);
  if (new Set(names).size !== names.length) return { ok: false, detail: "tools contains duplicate names." };
  if (!Number.isInteger(value.turn) || (value.turn as number) < 0 || (value.turn as number) > 10_000) {
    return { ok: false, detail: "turn must be a non-negative integer." };
  }
  const parsedMessages = messages as AssistantMessage[];
  if (callsInCurrentTurn(parsedMessages) > MAX_CALLS_PER_TURN) {
    return { ok: false, detail: `A turn may contain at most ${MAX_CALLS_PER_TURN} function calls.` };
  }
  return {
    ok: true,
    body: { messages: parsedMessages, tools: tools as AssistantToolSchema[], turn: value.turn as number },
  };
}

function upstreamError(status: number): string {
  if (status === 429) return "The assistant is rate-limited. Retry in a moment.";
  if (status >= 500) return "The assistant service is temporarily unavailable. Retry shortly.";
  if (status === 401 || status === 403) return "The assistant credentials were rejected.";
  return `The assistant request failed (${status}).`;
}

function eventData(block: string): { event: string; data: string } | undefined {
  let event = "";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : undefined;
}

function functionCall(item: unknown): { call_id: string; name: string; arguments: string } | undefined {
  if (!isRecord(item)
    || item.type !== "function_call"
    || !validShortString(item.call_id, 200)
    || !validShortString(item.name, 100)
    || !HEARTH_TOOL_NAME_SET.has(item.name)
    || typeof item.arguments !== "string") return undefined;
  return { call_id: item.call_id, name: item.name, arguments: item.arguments };
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.message === "string") return value.message.slice(0, 500);
  const nested = isRecord(value.error) ? value.error : undefined;
  return typeof nested?.message === "string" ? nested.message.slice(0, 500) : undefined;
}

export async function POST(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return Response.json({ error: "invalid", detail: "Request body could not be read." }, { status: 400 });
  }
  if (raw.length > MAX_BODY_CHARS) {
    return Response.json({ error: "invalid", detail: "Request body is too large." }, { status: 413 });
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ error: "invalid", detail: "Request body must be valid JSON." }, { status: 400 });
  }
  const parsed = validateBody(decoded);
  if (!parsed.ok) return Response.json({ error: "invalid", detail: parsed.detail }, { status: 400 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return Response.json({ error: "unavailable", detail: "The assistant is not configured." }, { status: 503 });

  const encoder = new TextEncoder();
  const upstreamAbort = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let timedOut = false;
      const emit = (event: "text" | "tool_call" | "done" | "error", data: unknown): void => {
        if (closed || cancelled) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };
      const close = (): void => {
        if (closed || cancelled) return;
        closed = true;
        controller.close();
      };
      const onDisconnect = (): void => upstreamAbort.abort(new DOMException("Client disconnected", "AbortError"));
      request.signal.addEventListener("abort", onDisconnect, { once: true });
      const timer = setTimeout(() => {
        timedOut = true;
        upstreamAbort.abort(new DOMException("Assistant timeout", "TimeoutError"));
      }, TIMEOUT_MS);

      void (async () => {
        try {
          const upstream = await fetch(OPENAI_URL, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: process.env.ASSISTANT_MODEL ?? "gpt-5.6-sol",
              instructions: ASSISTANT_INSTRUCTIONS,
              input: parsed.body.messages,
              reasoning: { effort: process.env.ASSISTANT_REASONING_EFFORT ?? "high" },
              stream: true,
              stream_options: { include_obfuscation: false },
              tools: parsed.body.tools.map((tool) => ({
                type: "function",
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
                strict: false,
              })),
              tool_choice: "auto",
              parallel_tool_calls: true,
              max_output_tokens: 2_000,
            }),
            signal: upstreamAbort.signal,
          });
          if (!upstream.ok) {
            emit("error", { message: upstreamError(upstream.status) });
            return;
          }
          if (!upstream.body) {
            emit("error", { message: "The assistant returned an empty stream. Retry shortly." });
            return;
          }

          const reader = upstream.body.getReader();
          const decoder = new TextDecoder();
          const sentCalls = new Set<string>();
          let callCount = callsInCurrentTurn(parsed.body.messages);
          let buffer = "";
          let terminal = false;

          const handle = (block: string): void => {
            const payload = eventData(block);
            if (!payload || payload.data === "[DONE]") return;
            let value: OpenAIEvent;
            try {
              value = JSON.parse(payload.data) as OpenAIEvent;
            } catch {
              return;
            }
            const type = value.type ?? payload.event;
            if (type === "response.output_text.delta" && typeof value.delta === "string") {
              emit("text", { delta: value.delta });
              return;
            }
            if (type === "response.output_item.done") {
              const call = functionCall(value.item);
              if (!call || sentCalls.has(call.call_id)) return;
              if (callCount >= MAX_CALLS_PER_TURN) {
                emit("error", { message: `The assistant exceeded the ${MAX_CALLS_PER_TURN}-call limit for this turn.` });
                terminal = true;
                return;
              }
              callCount += 1;
              sentCalls.add(call.call_id);
              emit("tool_call", call);
              return;
            }
            if (type === "response.completed") {
              const response = isRecord(value.response) ? value.response : undefined;
              emit("done", { usage: response?.usage ?? null });
              terminal = true;
              return;
            }
            if (type === "response.failed" || type === "response.incomplete" || type === "error") {
              emit("error", { message: errorMessage(value) ?? "The assistant stream failed. Retry shortly." });
              terminal = true;
            }
          };

          while (!terminal) {
            const chunk = await reader.read();
            if (chunk.done) break;
            buffer = `${buffer}${decoder.decode(chunk.value, { stream: true })}`.replace(/\r\n/g, "\n");
            let boundary = buffer.indexOf("\n\n");
            while (boundary >= 0) {
              handle(buffer.slice(0, boundary));
              buffer = buffer.slice(boundary + 2);
              if (terminal) break;
              boundary = buffer.indexOf("\n\n");
            }
          }
          if (!terminal && buffer.trim()) handle(buffer);
          if (!terminal && !request.signal.aborted) emit("error", { message: "The assistant stream ended early. Retry shortly." });
          if (terminal) await reader.cancel().catch(() => undefined);
        } catch (error) {
          if (request.signal.aborted || cancelled) return;
          emit("error", {
            message: timedOut
              ? "The assistant timed out after 60 seconds. Retry."
              : error instanceof Error && error.name !== "AbortError"
                ? "The assistant could not be reached. Retry shortly."
                : "The assistant request was interrupted. Retry.",
          });
        } finally {
          clearTimeout(timer);
          request.signal.removeEventListener("abort", onDisconnect);
          close();
        }
      })();
    },
    cancel() {
      cancelled = true;
      upstreamAbort.abort(new DOMException("Client disconnected", "AbortError"));
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-store",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream; charset=utf-8",
      "X-Accel-Buffering": "no",
    },
  });
}
