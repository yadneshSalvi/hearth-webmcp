import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSISTANT_INSTRUCTIONS, POST } from "../../app/api/assistant/route";

const validTool = {
  name: "get_scene_summary",
  description: "Read the home.",
  inputSchema: { type: "object", properties: {} },
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function upstreamSse(value: string): Response {
  return new Response(value, { headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  process.env.OPENAI_API_KEY = "test-key";
  delete process.env.ASSISTANT_MODEL;
  delete process.env.ASSISTANT_REASONING_EFFORT;
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  delete process.env.OPENAI_API_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("assistant route", () => {
  it("maps the Responses stream to Hearth SSE events", async () => {
    vi.mocked(fetch).mockResolvedValue(upstreamSse([
      "event: response.output_text.delta\n",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"Checking.\"}\n\n",
      "event: response.output_item.done\n",
      "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"status\":\"completed\",\"call_id\":\"call-1\",\"name\":\"get_scene_summary\",\"arguments\":\"{}\"}}\n\n",
      "event: response.completed\n",
      "data: {\"type\":\"response.completed\",\"response\":{\"usage\":{\"total_tokens\":21}}}\n\n",
    ].join("")));

    const response = await POST(request({
      messages: [{ role: "user", content: "What rooms are here?" }],
      tools: [validTool],
      turn: 1,
    }));
    const body = await response.text();

    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: text\ndata: {\"delta\":\"Checking.\"}");
    expect(body).toContain("event: tool_call\ndata: {\"call_id\":\"call-1\",\"name\":\"get_scene_summary\",\"arguments\":\"{}\"}");
    expect(body).toContain("event: done\ndata: {\"usage\":{\"total_tokens\":21}}");
    const upstreamInit = vi.mocked(fetch).mock.calls[0]?.[1];
    const upstreamBody = JSON.parse(String(upstreamInit?.body)) as Record<string, unknown>;
    expect(upstreamBody).toMatchObject({
      model: "gpt-5.6-sol",
      reasoning: { effort: "high" },
      stream: true,
      tool_choice: "auto",
      parallel_tool_calls: true,
    });
    expect(upstreamBody.tools).toEqual([expect.objectContaining({
      type: "function",
      name: "get_scene_summary",
      strict: false,
      parameters: validTool.inputSchema,
    })]);
    expect(ASSISTANT_INSTRUCTIONS.length).toBeLessThanOrEqual(900);
  });

  it("rejects tool names outside the static Hearth allowlist", async () => {
    const response = await POST(request({
      messages: [{ role: "user", content: "Hello" }],
      tools: [{ ...validTool, name: "steal_secrets" }],
      turn: 1,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects more than sixty calls in the current turn", async () => {
    const calls = Array.from({ length: 61 }, (_, index) => ({
      type: "function_call" as const,
      call_id: `call-${index}`,
      name: "get_scene_summary",
      arguments: "{}",
    }));
    const response = await POST(request({
      messages: [{ role: "user", content: "Loop" }, ...calls],
      tools: [validTool],
      turn: 1,
    }));

    expect(response.status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("turns upstream rate limits into a retryable SSE hint", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("rate limited", { status: 429 }));
    const response = await POST(request({
      messages: [{ role: "user", content: "Hello" }],
      tools: [validTool],
      turn: 1,
    }));

    expect(await response.text()).toContain("event: error\ndata: {\"message\":\"The assistant is rate-limited. Retry in a moment.\"}");
  });
});

