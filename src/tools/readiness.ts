const DEFAULT_TIMEOUT_MS = 5_000;

/** Waits for the WebMCP registry without letting a tool call hang indefinitely. */
export async function waitForToolsReady(
  settled: (() => Promise<void>) | undefined,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<boolean> {
  if (!settled) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      settled().then(() => true, () => false),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
