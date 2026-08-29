/**
 * The tool-execution batch marker. It does two jobs, both of which have to be readable *outside*
 * React: it suppresses duplicate activity rows while a tool runs, and it names the tool that is
 * mutating the store so the renderer can choreograph the change in the very same render as the
 * mutation (`arrange_room`'s stagger — the receipt is written afterwards, far too late).
 */
let depth = 0;
let name: string | undefined;

/** Enters a tool batch so scene actions produce one tool receipt, not duplicate action rows. */
export function beginToolBatch(toolName?: string): void {
  depth += 1;
  if (depth === 1) name = toolName;
}

/** Leaves one tool batch. Nested and concurrent executions share the depth safely. */
export function endToolBatch(): void {
  depth = Math.max(0, depth - 1);
}

/** Reports whether non-human action activity should be suppressed in favour of a tool receipt. */
export function toolBatchIsActive(): boolean {
  return depth > 0;
}

/**
 * The tool whose mutation the store is showing. The name deliberately outlives `endToolBatch()`: a
 * store mutation and the React render that shows it are separated by a scheduler tick, so clearing
 * on exit would blank the marker before the renderer ever saw it. It is replaced, not cleared, by
 * the next tool — and the renderer only acts on it in the one render where poses actually changed.
 */
export function toolBatch(): string | undefined {
  return name;
}

/** Test seam: forgets the last batch. */
export function resetToolBatch(): void {
  depth = 0;
  name = undefined;
}
