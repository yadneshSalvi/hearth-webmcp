let sequence = 0;

/** Returns a process-unique readable id for activity and UI records. */
export function uid(prefix = "activity"): string {
  sequence += 1;
  return `${prefix}-${Date.now().toString(36)}-${sequence.toString(36)}`;
}
