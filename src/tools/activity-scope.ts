let depth = 0;

/** Enters a tool execution scope so the store emits one receipt, not action rows. */
export function beginToolActivity(): void {
  depth += 1;
}

/** Leaves one tool execution scope. */
export function endToolActivity(): void {
  depth = Math.max(0, depth - 1);
}

/** Reports whether non-human store action activity should be suppressed. */
export function toolActivityIsActive(): boolean {
  return depth > 0;
}
