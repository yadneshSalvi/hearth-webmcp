// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class NativeModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

beforeEach(() => {
  vi.resetModules();
  Reflect.deleteProperty(document, "modelContext");
  document.querySelectorAll("script[data-hearth-webmcp-polyfill]").forEach((script) => script.remove());
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, "modelContext");
});

describe("polyfill loader", () => {
  it("keeps native-only as the default and accepts the eval query flag", async () => {
    const { webMcpPolyfillRequested } = await import("../../src/tools/polyfill-loader");
    expect(webMcpPolyfillRequested()).toBe(false);
    window.history.replaceState({}, "", "/?webmcp=polyfill");
    expect(webMcpPolyfillRequested()).toBe(true);
    window.history.replaceState({}, "", "/");
    expect(webMcpPolyfillRequested("allow-polyfill")).toBe(true);
  });

  it("detects native WebMCP and never injects the polyfill", async () => {
    Object.defineProperty(document, "modelContext", { configurable: true, value: new NativeModelContext() });
    const { detectModelContext, ensureModelContext } = await import("../../src/tools/polyfill-loader");
    expect(detectModelContext()).toBe("native");
    expect(await ensureModelContext()).toBe("native");
    expect(document.querySelector("script[data-hearth-webmcp-polyfill]")).toBeNull();
  });

  it("injects one script and resolves polyfill when it installs modelContext", async () => {
    const { detectModelContext, ensureModelContext } = await import("../../src/tools/polyfill-loader");
    expect(detectModelContext()).toBe("missing");
    const first = ensureModelContext({ src: "/test-polyfill.js" });
    const second = ensureModelContext({ src: "/test-polyfill.js" });
    const scripts = document.querySelectorAll<HTMLScriptElement>("script[data-hearth-webmcp-polyfill]");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.src).toContain("/test-polyfill.js");
    Object.defineProperty(document, "modelContext", { configurable: true, value: new NativeModelContext() });
    scripts[0]?.dispatchEvent(new Event("load"));
    expect(await first).toBe("polyfill");
    expect(await second).toBe("polyfill");
  });

  it("returns unavailable after the three-second timeout", async () => {
    vi.useFakeTimers();
    const { ensureModelContext } = await import("../../src/tools/polyfill-loader");
    const pending = ensureModelContext();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toBe("unavailable");
  });
});
