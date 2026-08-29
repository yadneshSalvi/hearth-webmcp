/**
 * The single swap point between the stub loop and the real one.
 *
 * `src/assistant/loop.ts` (built in parallel) exports the identical `createAssistant` /
 * `AssistantEvents` contract, so switching Hearth from the scripted stand-in to the model loop is
 * exactly one edit: change the specifier on the next line from `loop.stub` to `loop`.
 */
export { createAssistant } from "../assistant/loop.stub";
export type { Assistant, AssistantEvents, AssistantOptions } from "../assistant/loop.stub";
