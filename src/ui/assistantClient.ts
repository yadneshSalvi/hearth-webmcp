/**
 * The panel's single door onto the assistant loop.
 *
 * `src/assistant/loop.ts` is the real thing: it streams from `/api/assistant`, keeps the Responses
 * message history and drives the tool round-trips. The panel imports the loop only through this file
 * so the wiring lives in one place — and so the per-turn guard the copy quotes is the very constant
 * the loop enforces.
 */
export { DEFAULT_MAX_CALLS_PER_TURN, createAssistant } from "../assistant/loop";
export type { AssistantEvents, AssistantOptions } from "../assistant/loop";

import type { createAssistant as create } from "../assistant/loop";

/** One conversation: `send` a turn, `abort` it, read or clear its history. */
export type AssistantSession = ReturnType<typeof create>;
