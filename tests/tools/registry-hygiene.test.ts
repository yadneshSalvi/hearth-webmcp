// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import { createRegistry } from "../../src/tools/registry";
import { testUi } from "./helpers";

class AbortRejectingContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;

  registerTool(_tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions): Promise<void> {
    return new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
    });
  }

  async getTools(): Promise<WebMCP.RegisteredTool[]> {
    return [];
  }
}

afterEach(() => vi.restoreAllMocks());

describe("registry warning hygiene", () => {
  it("does not warn when stop aborts pending registrations", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const registry = createRegistry({
      modelContext: new AbortRejectingContext(),
      store: hearthStore,
      ui: testUi(),
      shopify: createLocalShopify(hearthStore.getState().catalog),
    });

    registry.start();
    registry.stop();
    await Promise.resolve();

    expect(warn).not.toHaveBeenCalled();
  });
});

