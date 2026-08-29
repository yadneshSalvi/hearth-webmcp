const loads = new WeakMap<Document, Promise<"polyfill" | "unavailable">>();

export type WebMCPPolyfillMode = "native-only" | "allow-polyfill";

/** Polyfill loading is opt-in through configuration or the eval/browser query flag. */
export function webMcpPolyfillRequested(mode: WebMCPPolyfillMode = "native-only"): boolean {
  if (mode === "allow-polyfill") return true;
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get("webmcp") === "polyfill";
}

/** Synchronous native WebMCP feature detection. */
export function detectModelContext(): "native" | "missing" {
  if (typeof document === "undefined") return "missing";
  return typeof document.modelContext?.registerTool === "function" ? "native" : "missing";
}

/** Loads the Apache-2.0 WebMCP polyfill once when no native API is present. */
export function ensureModelContext(
  opts: { src?: string } = {},
): Promise<"native" | "polyfill" | "unavailable"> {
  if (detectModelContext() === "native") return Promise.resolve("native");
  if (typeof document === "undefined") return Promise.resolve("unavailable");
  const existing = loads.get(document);
  if (existing) return existing;
  const src = opts.src ?? "/webmcp-polyfill.js";
  const promise = new Promise<"polyfill" | "unavailable">((resolve) => {
    const selector = "script[data-hearth-webmcp-polyfill]";
    const script = document.querySelector<HTMLScriptElement>(selector) ?? document.createElement("script");
    let settled = false;
    const finish = (status: "polyfill" | "unavailable"): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.removeEventListener("load", onLoad);
      script.removeEventListener("error", onError);
      resolve(status);
    };
    const onLoad = (): void => finish(detectModelContext() === "native" ? "polyfill" : "unavailable");
    const onError = (): void => finish("unavailable");
    const timer = setTimeout(() => finish(detectModelContext() === "native" ? "polyfill" : "unavailable"), 3_000);
    script.addEventListener("load", onLoad, { once: true });
    script.addEventListener("error", onError, { once: true });
    if (!script.dataset.hearthWebmcpPolyfill) {
      script.dataset.hearthWebmcpPolyfill = "true";
      script.src = src;
      script.async = true;
      document.head.appendChild(script);
    }
  });
  loads.set(document, promise);
  return promise;
}
