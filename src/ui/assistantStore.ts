"use client";
/**
 * Transcript state for the fallback Hearth Assistant (`src/ui/Assistant.tsx`).
 *
 * The reducer is pure so the wording, the tool-call → result linking and the per-turn call cap are
 * unit-tested rather than eyeballed (`tests/ui/assistantStore.test.ts`); the module store around it
 * is deliberately outside the zustand scene store, because a conversation is not an undoable design
 * change and must never land in the zundo history.
 */
import { useSyncExternalStore } from "react";

/** TOOLS.md §4 guardrail mirrored in the UI: one turn may spend at most this many tool calls. */
export const MAX_CALLS_PER_TURN = 8;

export interface AssistantToolCall {
  /** Call id from the loop; unique within a turn. */
  id: string;
  name: string;
  input: unknown;
  /** Set once the tool resolved. */
  result?: unknown;
  /** Wall-clock duration of the call in ms. */
  ms?: number;
  /** The result envelope's `ok` (TOOLS.md §0). Undefined while the call is in flight. */
  ok?: boolean;
  /** Id of the activity receipt the registry wrote for this call, so the chip can point at the row. */
  receiptId?: string;
  /** The receipt's own sentence ("Placed Endre Sofa"), so the chip reads like the log row. */
  summary?: string;
}

export interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  calls: AssistantToolCall[];
  status: "streaming" | "done" | "error" | "stopped";
  error?: { message: string; retryable: boolean };
}

export interface AssistantState {
  messages: AssistantMessage[];
  /** True between `send` and `done`/`error`/`stop`. */
  running: boolean;
  /** Tool calls spent by the turn in flight (or by the last turn), for the cap indicator. */
  callsThisTurn: number;
  maxCallsPerTurn: number;
  /** The text of the last turn, offered again by Retry after a retryable error. */
  retryPrompt?: string;
  /** Monotonic id source, kept in state so the reducer stays pure. */
  sequence: number;
}

export type AssistantAction =
  | { type: "send"; text: string }
  | { type: "text"; delta: string }
  | { type: "call"; id: string; name: string; input: unknown }
  | { type: "result"; id: string; result: unknown; ms: number; receiptId?: string; summary?: string }
  | { type: "done"; text: string; calls: number }
  | { type: "error"; message: string; retryable: boolean }
  | { type: "stop" }
  | { type: "reset" };

export const initialAssistantState: AssistantState = {
  messages: [],
  running: false,
  callsThisTurn: 0,
  maxCallsPerTurn: MAX_CALLS_PER_TURN,
  sequence: 0,
};

/** The result envelope reports success with `ok: true`; anything else is a failure (TOOLS.md §0). */
function envelopeOk(result: unknown): boolean {
  return typeof result === "object" && result !== null && (result as { ok?: unknown }).ok === true;
}

/** Index of the assistant message a streamed event belongs to: the newest one, or -1. */
function openIndex(messages: AssistantMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message && message.role === "assistant") return index;
  }
  return -1;
}

function patchAt(
  messages: AssistantMessage[],
  index: number,
  patch: (message: AssistantMessage) => AssistantMessage,
): AssistantMessage[] {
  const target = messages[index];
  if (!target) return messages;
  const next = [...messages];
  next[index] = patch(target);
  return next;
}

/**
 * Folds one loop event into the transcript. Events that arrive with no turn open (a late `text`
 * after `abort`, a duplicated `result`) are dropped rather than inventing a message.
 */
export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case "send": {
      const sequence = state.sequence + 1;
      const user: AssistantMessage = {
        id: `you-${sequence}`,
        role: "user",
        text: action.text,
        calls: [],
        status: "done",
      };
      const reply: AssistantMessage = {
        id: `hearth-${sequence}`,
        role: "assistant",
        text: "",
        calls: [],
        status: "streaming",
      };
      return {
        ...state,
        messages: [...state.messages, user, reply],
        running: true,
        callsThisTurn: 0,
        retryPrompt: action.text,
        sequence,
      };
    }

    case "text": {
      const index = openIndex(state.messages);
      if (index < 0 || !state.running) return state;
      return {
        ...state,
        messages: patchAt(state.messages, index, (message) => ({ ...message, text: message.text + action.delta })),
      };
    }

    case "call": {
      const index = openIndex(state.messages);
      if (index < 0 || !state.running) return state;
      if (state.messages[index]?.calls.some((call) => call.id === action.id)) return state;
      return {
        ...state,
        callsThisTurn: state.callsThisTurn + 1,
        messages: patchAt(state.messages, index, (message) => ({
          ...message,
          calls: [...message.calls, { id: action.id, name: action.name, input: action.input }],
        })),
      };
    }

    case "result": {
      const index = state.messages.findIndex((message) => message.calls.some((call) => call.id === action.id));
      if (index < 0) return state;
      return {
        ...state,
        messages: patchAt(state.messages, index, (message) => ({
          ...message,
          calls: message.calls.map((call) => call.id === action.id
            ? {
              ...call,
              result: action.result,
              ms: action.ms,
              ok: envelopeOk(action.result),
              ...(action.receiptId ? { receiptId: action.receiptId } : {}),
              ...(action.summary ? { summary: action.summary } : {}),
            }
            : call),
        })),
      };
    }

    case "done": {
      const index = openIndex(state.messages);
      if (index < 0) return { ...state, running: false };
      return {
        ...state,
        running: false,
        messages: patchAt(state.messages, index, (message) => ({
          ...message,
          // A loop that only reports the final text (no deltas) still renders as a full reply.
          text: message.text.length > 0 ? message.text : action.text,
          status: "done",
        })),
      };
    }

    case "error": {
      const index = openIndex(state.messages);
      const error = { message: action.message, retryable: action.retryable };
      if (index < 0) return { ...state, running: false };
      return {
        ...state,
        running: false,
        messages: patchAt(state.messages, index, (message) => ({ ...message, status: "error", error })),
      };
    }

    case "stop": {
      const index = openIndex(state.messages);
      if (index < 0 || !state.running) return { ...state, running: false };
      return {
        ...state,
        running: false,
        messages: patchAt(state.messages, index, (message) => ({
          ...message,
          status: "stopped",
          text: message.text.length > 0 ? message.text : "Stopped.",
        })),
      };
    }

    case "reset":
      return { ...initialAssistantState, maxCallsPerTurn: state.maxCallsPerTurn, sequence: state.sequence };
  }
}

/** True once a turn has spent its whole allowance, so the composer can say why it stopped. */
export function capReached(state: AssistantState): boolean {
  return state.callsThisTurn >= state.maxCallsPerTurn;
}

/** The turn a Retry would repeat, or undefined when the last turn did not fail retryably. */
export function retryableTurn(state: AssistantState): string | undefined {
  const index = openIndex(state.messages);
  const message = index >= 0 ? state.messages[index] : undefined;
  if (!message || message.status !== "error" || message.error?.retryable !== true) return undefined;
  return state.retryPrompt;
}

let current: AssistantState = initialAssistantState;
const listeners = new Set<() => void>();

/** Folds an event into the shared transcript and notifies the panel. */
export function dispatchAssistant(action: AssistantAction): AssistantState {
  const next = assistantReducer(current, action);
  if (next === current) return current;
  current = next;
  for (const listener of listeners) listener();
  return current;
}

export function assistantSnapshot(): AssistantState {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribes a component to the transcript. */
export function useAssistantState(): AssistantState {
  return useSyncExternalStore(subscribe, assistantSnapshot, () => initialAssistantState);
}
