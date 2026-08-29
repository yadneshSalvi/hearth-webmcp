import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { Scene } from "../../src/engine/types";
import type { ToolContext, ToolUi } from "../../src/tools/define";

export function resetStore(scene: Scene): void {
  hearthStore.getState().resetScene(scene);
  hearthStore.setState({
    activity: [],
    cart: { lines: [], subtotalUsd: 0, status: "idle" },
    tools: { available: [], status: "unknown" },
    ui: { boardOpen: false, assistantOpen: false, toolsPanelOpen: false, pulseIds: [] },
  });
}

export function testUi(confirm: ToolUi["confirm"] = async () => ({ accepted: true, reason: "accepted" })): ToolUi {
  return {
    confirm,
    focus: vi.fn(),
    pulse: vi.fn(),
    exportBoard: vi.fn(async () => ({ items: 7, total_usd: 2_140, size_px: "1600x1000" })),
  };
}

export function toolContext(ui = testUi()): ToolContext {
  return {
    store: hearthStore,
    ui,
    shopify: createLocalShopify(hearthStore.getState().catalog),
    source: "test",
  };
}

export function loadRealPolyfill(): WebMCP.ModelContext {
  Reflect.deleteProperty(document, "modelContext");
  Reflect.set(window, "__webmcp_registered_tools", new Map<string, unknown>());
  const source = readFileSync(resolve(process.cwd(), "public/webmcp-polyfill.js"), "utf8");
  Function(source)();
  if (!document.modelContext) throw new Error("The WebMCP polyfill did not install modelContext");
  return document.modelContext;
}

export function clearRealPolyfill(): void {
  Reflect.deleteProperty(document, "modelContext");
  Reflect.deleteProperty(window, "__webmcp_registered_tools");
}
