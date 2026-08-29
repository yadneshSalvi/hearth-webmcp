let depth = 0;

/** Enters a tool batch so scene actions produce one tool receipt, not duplicate action rows. */
export function beginToolBatch(): void {
  depth += 1;
}

/** Leaves one tool batch. Nested and concurrent executions share the depth safely. */
export function endToolBatch(): void {
  depth = Math.max(0, depth - 1);
}

/** Reports whether non-human action activity should be suppressed in favour of a tool receipt. */
export function toolBatchIsActive(): boolean {
  return depth > 0;
}
