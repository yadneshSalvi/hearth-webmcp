// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAssistant } from "../../src/assistant/loop";
import { clearRealPolyfill, loadRealPolyfill } from "../tools/helpers";

function events() {
  return {
    onText: vi.fn((delta: string) => { void delta; }),
    onToolCall: vi.fn((call: { id: string; name: string; input: unknown }) => { void call; }),
    onToolResult: vi.fn((call: { id: string; name: string; result: unknown; ms: number }) => { void call; }),
    onDone: vi.fn((turn: { text: string; calls: number }) => { void turn; }),
    onError: vi.fn((error: { message: string; retryable: boolean }) => { void error; }),
  };
}

function sse(parts: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const part of parts) controller.enqueue(encoder.encode(part));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

function done(): string {
  return "event: done\ndata: {\"usage\":{\"total_tokens\":12}}\n\n";
}

function call(id: string, name: string, args: Record<string, unknown> = {}): string {
  return `event: tool_call\ndata: ${JSON.stringify({ call_id: id, name, arguments: JSON.stringify(args) })}\n\n`;
}

function installTool(execute = vi.fn(async () => ({ ok: true }))): ReturnType<typeof vi.fn> {
  const modelContext = loadRealPolyfill();
  void modelContext.registerTool({
    name: "get_scene_summary",
    title: "Scene summary",
    description: "Read the home.",
    inputSchema: { type: "object", properties: {} },
    execute,
  });
  return execute;
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearRealPolyfill();
});

describe("assistant client loop", () => {
  it("streams text and records the assistant response", async () => {
    installTool();
    vi.mocked(fetch).mockResolvedValue(sse([
      "event: text\ndata: {\"del",
      "ta\":\"Hello \"}\n\nevent: text\ndata: {\"delta\":\"there\"}\n\n",
      done(),
    ]));
    const ev = events();
    const assistant = createAssistant();

    await assistant.send("Help me", ev);

    expect(ev.onText.mock.calls.flatMap((args) => args)).toEqual(["Hello ", "there"]);
    expect(ev.onDone).toHaveBeenCalledWith({ text: "Hello there", calls: 0 });
    expect(ev.onError).not.toHaveBeenCalled();
    expect(assistant.history()).toEqual([
      { role: "user", content: "Help me" },
      { role: "assistant", content: "Hello there" },
    ]);
  });

  it("executes a two-step tool loop through the registered WebMCP tool", async () => {
    const execute = installTool(vi.fn(async () => ({ ok: true, rooms: 6 })));
    vi.mocked(fetch)
      .mockResolvedValueOnce(sse([call("call-1", "get_scene_summary"), done()]))
      .mockResolvedValueOnce(sse([call("call-2", "get_scene_summary"), done()]))
      .mockResolvedValueOnce(sse(["event: text\ndata: {\"delta\":\"Six rooms.\"}\n\n", done()]));
    const ev = events();
    const assistant = createAssistant();

    await assistant.send("What is here?", ev);

    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0]?.[0]).toEqual({});
    expect(ev.onToolCall).toHaveBeenCalledTimes(2);
    expect(ev.onToolResult).toHaveBeenCalledTimes(2);
    expect(ev.onDone).toHaveBeenCalledWith({ text: "Six rooms.", calls: 2 });
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
    const secondRequest = vi.mocked(fetch).mock.calls[1]?.[1];
    const secondBody = JSON.parse(String(secondRequest?.body)) as { messages: unknown[]; tools: Record<string, unknown>[] };
    expect(secondBody.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "function_call", call_id: "call-1" }),
      expect.objectContaining({ type: "function_call_output", call_id: "call-1" }),
    ]));
    expect(secondBody.tools[0]).toEqual({
      name: "get_scene_summary",
      description: "Read the home.",
      inputSchema: { type: "object", properties: {} },
    });
  });

  it("keeps two rounds of speech from running into one another", async () => {
    installTool(vi.fn(async () => ({ ok: true, rooms: 6 })));
    vi.mocked(fetch)
      .mockResolvedValueOnce(sse([
        "event: text\ndata: {\"delta\":\"Please confirm in the on-page dialog.\"}\n\n",
        call("call-1", "get_scene_summary"),
        done(),
      ]))
      .mockResolvedValueOnce(sse(["event: text\ndata: {\"delta\":\"Done — six rooms.\"}\n\n", done()]));
    const ev = events();

    await createAssistant().send("Give me a home", ev);

    // One bubble, two sentences, and a break between them rather than "dialog.Done".
    expect(ev.onDone).toHaveBeenCalledWith({ text: "Please confirm in the on-page dialog.\n\nDone — six rooms.", calls: 1 });
    expect(ev.onText.mock.calls.flatMap((args) => args)).toEqual([
      "Please confirm in the on-page dialog.",
      "\n\n",
      "Done — six rooms.",
    ]);
  });

  it("lets the registry finish changing before it reads the tool list again", async () => {
    installTool(vi.fn(async () => ({ ok: true, mode: "build" })));
    vi.mocked(fetch)
      .mockResolvedValueOnce(sse([call("call-1", "get_scene_summary"), done()]))
      .mockResolvedValueOnce(sse(["event: text\ndata: {\"delta\":\"Done.\"}\n\n", done()]));
    const order: string[] = [];
    const settle = vi.fn(async () => { order.push("settle"); });
    const ev = events();

    await createAssistant({ settle }).send("Switch to build", ev);

    // Once, after the round that called something — and before the request that follows it, which
    // is the one whose tool list has to be current.
    expect(settle).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["settle"]);
    expect(ev.onDone).toHaveBeenCalledWith({ text: "Done.", calls: 1 });
  });

  it("blocks the attempt that hits the per-turn guard and gives the model a final answer pass", async () => {
    installTool();
    const fetchMock = vi.mocked(fetch);
    for (let index = 1; index <= 8; index += 1) {
      fetchMock.mockResolvedValueOnce(sse([call(`call-${index}`, "get_scene_summary"), done()]));
    }
    fetchMock.mockResolvedValueOnce(sse(["event: text\ndata: {\"delta\":\"Stopped.\"}\n\n", done()]));
    const execute = vi.fn(async () => ({ ok: true }));
    const ev = events();
    // The guard is DEFAULT_MAX_CALLS_PER_TURN in production; pinned low here so the test can reach it.
    const assistant = createAssistant({ execute, maxCallsPerTurn: 8 });

    await assistant.send("Keep checking", ev);

    expect(execute).toHaveBeenCalledTimes(7);
    expect(ev.onToolCall).toHaveBeenCalledTimes(8);
    expect(ev.onDone).toHaveBeenCalledWith({ text: "Stopped.", calls: 8 });
    const blocked = assistant.history().find((message) => (
      "type" in message && message.type === "function_call_output" && message.call_id === "call-8"
    ));
    expect(blocked && "output" in blocked ? JSON.parse(blocked.output) : null).toEqual({
      ok: false,
      error: "blocked",
      detail: "tool-call limit reached for this turn",
    });
  });

  it("aborts an in-flight request without surfacing an error", async () => {
    installTool();
    vi.mocked(fetch).mockImplementation((_input, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    const ev = events();
    const assistant = createAssistant();
    const sending = assistant.send("Wait", ev);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());

    assistant.abort();
    await sending;

    expect(ev.onError).not.toHaveBeenCalled();
    expect(ev.onDone).not.toHaveBeenCalled();
  });

  it("surfaces retryable SSE errors", async () => {
    installTool();
    vi.mocked(fetch).mockResolvedValue(sse([
      "event: error\ndata: {\"message\":\"The service is temporarily unavailable. Retry shortly.\"}\n\n",
    ]));
    const ev = events();

    await createAssistant().send("Hello", ev);

    expect(ev.onError).toHaveBeenCalledWith({
      message: "The service is temporarily unavailable. Retry shortly.",
      retryable: true,
    });
  });

  it("handles a route allowlist rejection as a non-retryable error", async () => {
    installTool();
    vi.mocked(fetch).mockResolvedValue(Response.json({
      error: "invalid",
      detail: "tools contains an invalid or non-Hearth tool.",
    }, { status: 400 }));
    const ev = events();

    await createAssistant().send("Hello", ev);

    expect(ev.onError).toHaveBeenCalledWith({
      message: "tools contains an invalid or non-Hearth tool.",
      retryable: false,
    });
  });
});
