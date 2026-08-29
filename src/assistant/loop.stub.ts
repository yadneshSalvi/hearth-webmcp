"use client";
/**
 * A stand-in for the real fallback agent (`src/assistant/loop.ts`, built in parallel) with exactly
 * the same contract, so the Assistant panel can be designed, screenshotted and end-to-end tested
 * before the model loop lands. Swap it in one line — see `src/ui/assistantClient.ts`.
 *
 * It is honest about what it is: it streams a scripted reply and runs **one real tool** through
 * `document.modelContext.executeTool`, i.e. the same WebMCP path a native agent takes, so the orb
 * flies, the receipt is written and the result the panel shows is the result a model would read.
 */

export interface AssistantEvents {
  onText(delta: string): void;
  onToolCall(call: { id: string; name: string; input: unknown }): void;
  onToolResult(call: { id: string; name: string; result: unknown; ms: number }): void;
  onDone(turn: { text: string; calls: number }): void;
  onError(err: { message: string; retryable: boolean }): void;
}

export interface Assistant {
  send(userText: string, ev: AssistantEvents): Promise<void>;
  abort(): void;
  history(): unknown[];
  reset(): void;
}

export interface AssistantOptions {
  endpoint?: string;
  maxCallsPerTurn?: number;
}

/** `executeTool` ships in Chrome and in the polyfill but is not in `webmcp-types` yet. */
interface ModelContextRuntime {
  getTools(): Promise<{ name: string }[]>;
  executeTool(tool: unknown, input: string): Promise<unknown>;
}

interface Plan {
  opening: string;
  tool: string;
  input: Record<string, unknown>;
  closing: string;
}

const WORD_MS = 26;

/**
 * A tiny keyword router in place of a model. Every branch names a tool that is registered by
 * default (TOOLS.md §2, the 26 visible tools), so the stub never asks for a gated one.
 */
function plan(text: string): Plan {
  const prompt = text.toLowerCase();
  if (/wheelchair|accessib|step-free/.test(prompt)) {
    return {
      opening: "Turning on accessibility mode so I can measure the paths properly.",
      tool: "set_accessibility_mode",
      input: { enabled: true },
      closing: "Accessibility mode is on — 90 cm paths and 150 cm turning circles are now checked.",
    };
  }
  if (/arrange|conversation|movie|cosy|cozy|set up/.test(prompt)) {
    return {
      opening: "Arranging the room around the focal wall — seating first, then the lighting.",
      tool: "arrange_room",
      input: { style: /movie/.test(prompt) ? "media" : "conversation" },
      closing: "That is the new layout. Undo is one click away if you would rather keep the old one.",
    };
  }
  if (/score|report|critique|rate|how does/.test(prompt)) {
    return {
      opening: "Let me score the room on balance, focal point, seating, lighting, storage and flow.",
      tool: "get_design_report",
      input: {},
      closing: "The report is in the receipt below, with the top three improvements.",
    };
  }
  if (/find|search|under \$|cheap|sofa|lamp|rug|desk|shelf/.test(prompt)) {
    return {
      opening: "Searching the Hearth Studio catalog for something that fits.",
      tool: "search_catalog",
      input: { query: text.slice(0, 60) },
      closing: "Those are the closest matches, each with its footprint and a fit note for this room.",
    };
  }
  if (/measure|how (wide|long|far)|gap|clearance/.test(prompt)) {
    return {
      opening: "Measuring the north wall and its free spans.",
      tool: "measure",
      input: { subject: "north" },
      closing: "Those are the spans furniture can go in, in centimetres.",
    };
  }
  if (/evening|golden|morning|noon|light|lamps/.test(prompt)) {
    const time = /morning/.test(prompt) ? "morning" : /noon/.test(prompt) ? "noon" : /golden/.test(prompt) ? "golden" : "evening";
    return {
      opening: `Setting the light to ${time}.`,
      tool: "set_time_of_day",
      input: { time },
      closing: "The sun angle, the environment and the page gradient all moved together.",
    };
  }
  if (/free|wall|what.s in|show me|detail/.test(prompt)) {
    return {
      opening: "Reading this room's walls, openings and everything placed in it.",
      tool: "get_room_details",
      input: {},
      closing: "Free spans are listed per wall, so we can see what still fits.",
    };
  }
  return {
    opening: "Reading the whole home first, so I know the room and item ids.",
    tool: "get_scene_summary",
    input: {},
    closing: "That is the home as an agent sees it. Ask me to place, measure, arrange or shop next.",
  };
}

async function stream(text: string, events: AssistantEvents, signal: AbortSignal): Promise<void> {
  for (const word of text.split(" ")) {
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, WORD_MS));
    if (signal.aborted) return;
    events.onText(`${word} `);
  }
}

/**
 * Chrome's `executeTool` takes the arguments as a JSON string and answers with one; the polyfill
 * parses a string just as happily, so serialising is the one form both accept.
 */
async function runTool(name: string, input: unknown): Promise<unknown> {
  const runtime = document.modelContext as unknown as ModelContextRuntime | undefined;
  if (!runtime || typeof runtime.executeTool !== "function") {
    throw new Error("No WebMCP tools are registered on this page yet.");
  }
  const tools = await runtime.getTools();
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} is not registered right now.`);
  const result = await runtime.executeTool(tool, JSON.stringify(input));
  return typeof result === "string" ? safeParse(result) : result;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Creates the stub loop. `endpoint` is accepted and ignored: nothing here talks to a model. */
export function createAssistant(opts: AssistantOptions = {}): Assistant {
  const maxCalls = Math.max(1, opts.maxCallsPerTurn ?? 8);
  let controller = new AbortController();
  let turns: { role: "user" | "assistant"; content: string }[] = [];
  let sequence = 0;

  return {
    async send(userText, events) {
      controller = new AbortController();
      const { signal } = controller;
      const script = plan(userText);
      turns = [...turns, { role: "user", content: userText }];
      sequence += 1;
      let calls = 0;

      await stream(script.opening, events, signal);
      if (signal.aborted) return;

      if (calls < maxCalls) {
        const id = `stub-${sequence}-1`;
        events.onToolCall({ id, name: script.tool, input: script.input });
        const startedAt = Date.now();
        try {
          const result = await runTool(script.tool, script.input);
          if (signal.aborted) return;
          calls += 1;
          events.onToolResult({ id, name: script.tool, result, ms: Date.now() - startedAt });
        } catch (error) {
          if (signal.aborted) return;
          events.onToolResult({
            id,
            name: script.tool,
            result: { ok: false, error: "unavailable", detail: error instanceof Error ? error.message : "The tool call failed." },
            ms: Date.now() - startedAt,
          });
          events.onError({
            message: error instanceof Error ? error.message : "The tool call failed.",
            retryable: true,
          });
          return;
        }
      }

      await stream(script.closing, events, signal);
      if (signal.aborted) return;
      const text = `${script.opening} ${script.closing}`;
      turns = [...turns, { role: "assistant", content: text }];
      events.onDone({ text, calls });
    },

    abort() {
      controller.abort();
    },

    history() {
      return [...turns];
    },

    reset() {
      controller.abort();
      turns = [];
    },
  };
}
