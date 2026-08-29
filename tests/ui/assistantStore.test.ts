import { describe, expect, it } from "vitest";
import {
  MAX_CALLS_PER_TURN, assistantReducer, capReached, initialAssistantState, retryableTurn,
} from "../../src/ui/assistantStore";
import type { AssistantAction, AssistantState } from "../../src/ui/assistantStore";

/** Folds a script of loop events into the transcript, the way the panel does. */
function fold(actions: AssistantAction[], from: AssistantState = initialAssistantState): AssistantState {
  return actions.reduce(assistantReducer, from);
}

const OK = { ok: true, room: "living", moved: 3 };

describe("assistantStore — sending a turn", () => {
  it("writes the human's bubble and opens a streaming reply", () => {
    const state = fold([{ type: "send", text: "Arrange this room for conversation" }]);
    expect(state.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(state.messages[0]?.text).toBe("Arrange this room for conversation");
    expect(state.messages[1]).toMatchObject({ text: "", status: "streaming", calls: [] });
    expect(state.running).toBe(true);
    expect(state.callsThisTurn).toBe(0);
  });

  it("gives every message a distinct id across turns", () => {
    const state = fold([
      { type: "send", text: "one" },
      { type: "done", text: "one", calls: 0 },
      { type: "send", text: "two" },
    ]);
    expect(new Set(state.messages.map((message) => message.id)).size).toBe(4);
  });
});

describe("assistantStore — streaming text", () => {
  it("appends deltas to the open reply", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "text", delta: "Arranging " },
      { type: "text", delta: "the room." },
    ]);
    expect(state.messages[1]?.text).toBe("Arranging the room.");
    expect(state.messages[1]?.status).toBe("streaming");
  });

  it("drops deltas that arrive after the turn closed, rather than inventing a message", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "done", text: "Done.", calls: 0 },
      { type: "text", delta: " late" },
    ]);
    expect(state.messages[1]?.text).toBe("Done.");
    expect(state.messages).toHaveLength(2);
  });

  it("falls back to the final text when a loop streams nothing", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "done", text: "The whole reply at once.", calls: 0 },
    ]);
    expect(state.messages[1]?.text).toBe("The whole reply at once.");
    expect(state.running).toBe(false);
  });
});

describe("assistantStore — tool calls", () => {
  it("links a result back to its call and records the receipt it wrote", () => {
    const state = fold([
      { type: "send", text: "Arrange this room" },
      { type: "call", id: "c1", name: "arrange_room", input: { style: "conversation" } },
      { type: "result", id: "c1", result: OK, ms: 42, receiptId: "tool-17-3", summary: "Arranged Living Room · conversation" },
    ]);
    const call = state.messages[1]?.calls[0];
    expect(call).toMatchObject({
      id: "c1",
      name: "arrange_room",
      input: { style: "conversation" },
      result: OK,
      ms: 42,
      ok: true,
      receiptId: "tool-17-3",
      summary: "Arranged Living Room · conversation",
    });
  });

  it("reads ok straight off the result envelope", () => {
    const state = fold([
      { type: "send", text: "clear it" },
      { type: "call", id: "c1", name: "clear_room", input: {} },
      { type: "result", id: "c1", result: { ok: false, error: "cancelled", detail: "The human declined" }, ms: 9 },
    ]);
    expect(state.messages[1]?.calls[0]?.ok).toBe(false);
  });

  it("ignores a duplicated call id and a result for a call it never saw", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "call", id: "c1", name: "measure", input: { subject: "north" } },
      { type: "call", id: "c1", name: "measure", input: { subject: "south" } },
      { type: "result", id: "ghost", result: OK, ms: 1 },
    ]);
    expect(state.messages[1]?.calls).toHaveLength(1);
    expect(state.callsThisTurn).toBe(1);
  });

  it("keeps linking results after the turn is done", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "call", id: "c1", name: "measure", input: {} },
      { type: "done", text: "Measured.", calls: 1 },
      { type: "result", id: "c1", result: OK, ms: 5 },
    ]);
    expect(state.messages[1]?.calls[0]?.ms).toBe(5);
  });
});

describe("assistantStore — the per-turn cap", () => {
  it("counts calls for the turn in flight and resets on the next send", () => {
    const spend = (n: number): AssistantAction[] =>
      Array.from({ length: n }, (_unused, index) => ({
        type: "call" as const, id: `c${index}`, name: "measure", input: {},
      }));

    let state = fold([{ type: "send", text: "hi" }, ...spend(MAX_CALLS_PER_TURN - 1)]);
    expect(state.callsThisTurn).toBe(MAX_CALLS_PER_TURN - 1);
    expect(capReached(state)).toBe(false);

    state = assistantReducer(state, { type: "call", id: "last", name: "measure", input: {} });
    expect(state.callsThisTurn).toBe(MAX_CALLS_PER_TURN);
    expect(capReached(state)).toBe(true);

    state = fold([{ type: "done", text: "ok", calls: 8 }, { type: "send", text: "again" }], state);
    expect(state.callsThisTurn).toBe(0);
    expect(capReached(state)).toBe(false);
  });
});

describe("assistantStore — errors, stopping and retry", () => {
  it("marks the reply failed and offers the same prompt again", () => {
    const state = fold([
      { type: "send", text: "Measure the north wall" },
      { type: "error", message: "The assistant endpoint timed out.", retryable: true },
    ]);
    expect(state.running).toBe(false);
    expect(state.messages[1]?.status).toBe("error");
    expect(state.messages[1]?.error).toEqual({ message: "The assistant endpoint timed out.", retryable: true });
    expect(retryableTurn(state)).toBe("Measure the north wall");
  });

  it("offers no retry for an error the loop called final", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "error", message: "No WebMCP tools are registered on this page.", retryable: false },
    ]);
    expect(retryableTurn(state)).toBeUndefined();
  });

  it("offers no retry once a turn has succeeded", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "error", message: "flaky", retryable: true },
      { type: "send", text: "hi" },
      { type: "done", text: "Done.", calls: 0 },
    ]);
    expect(retryableTurn(state)).toBeUndefined();
  });

  it("stops a running turn and keeps whatever streamed so far", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "text", delta: "Arranging the" },
      { type: "stop" },
    ]);
    expect(state.running).toBe(false);
    expect(state.messages[1]).toMatchObject({ status: "stopped", text: "Arranging the" });
  });

  it("says so when a turn is stopped before a single word arrived", () => {
    const state = fold([{ type: "send", text: "hi" }, { type: "stop" }]);
    expect(state.messages[1]?.text).toBe("Stopped.");
  });

  it("resets to an empty transcript without reusing message ids", () => {
    const state = fold([
      { type: "send", text: "hi" },
      { type: "done", text: "ok", calls: 0 },
      { type: "reset" },
      { type: "send", text: "fresh" },
    ]);
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]?.id).toBe("you-2");
    expect(state.maxCallsPerTurn).toBe(MAX_CALLS_PER_TURN);
  });
});
