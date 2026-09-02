// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import { toolBatchIsActive } from "../../src/state/tool-batch";
import { createConfirmGate } from "../../src/tools/confirm";
import type { ToolResult, ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import { emptyHome, furnished2br } from "../fixtures/scenes";
import { clearRealPolyfill, loadRealPolyfill, resetStore, testUi } from "./helpers";

beforeEach(() => resetStore(furnished2br()));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  clearRealPolyfill();
});

function registryWith(
  modelContext: WebMCP.ModelContext,
  ui: ToolUi = testUi(),
  schedule?: (fn: () => void) => void,
) {
  return createRegistry({
    modelContext,
    store: hearthStore,
    ui,
    shopify: createLocalShopify(hearthStore.getState().catalog),
    ...(schedule ? { schedule } : {}),
  });
}

const BUILD_TOOL_NAMES = new Set([
  "add_opening", "apply_template", "create_room", "move_opening", "remove_opening", "update_room",
]);

class DelayedBuildModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  private readonly tools = new Map<string, WebMCP.ModelContextTool>();

  constructor(private readonly delayMs: number) {
    super();
  }

  registerTool(tool: WebMCP.ModelContextTool, options?: WebMCP.ModelContextRegisterToolOptions): Promise<void> {
    const install = (): void => {
      this.tools.set(tool.name, tool);
      this.dispatchEvent(new Event("toolchange"));
    };
    const remove = (): void => {
      if (this.tools.delete(tool.name)) this.dispatchEvent(new Event("toolchange"));
    };
    if (!BUILD_TOOL_NAMES.has(tool.name)) {
      install();
      options?.signal?.addEventListener("abort", remove, { once: true });
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        install();
        resolve();
      }, this.delayMs);
      options?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        remove();
        reject(new DOMException("Stopped", "AbortError"));
      }, { once: true });
    });
  }

  async getTools(): Promise<WebMCP.RegisteredTool[]> {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      window,
      origin: window.origin,
    }));
  }
}

describe("registry lifecycle against the real polyfill", () => {
  it("registers exactly 29 default tools synchronously and alphabetically", async () => {
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    const names = (await modelContext.getTools()).map(({ name }) => name);
    expect(names).toHaveLength(29);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("set_mode");
    expect(names).toContain("export_design_board");
    expect(names).not.toContain("apply_template");
    registry.stop();
  });

  it("settles set_mode after its own deferred sync without deadlocking", async () => {
    const queued: Array<() => void> = [];
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext, testUi(), (fn) => queued.push(fn));
    registry.start();
    const building = registry.execute("set_mode", { mode: "build" }, "agent");
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.executing).toBe(0);
    expect(toolBatchIsActive()).toBe(false);
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    queued.splice(0).forEach((fn) => fn());
    expect(await building).toMatchObject({ ok: true, tools_ready: true });
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    expect(await modelContext.getTools()).toHaveLength(36);
    const designing = registry.execute("set_mode", { mode: "design" }, "agent");
    await Promise.resolve();
    await Promise.resolve();
    expect(registry.executing).toBe(0);
    queued.splice(0).forEach((fn) => fn());
    expect(await designing).toMatchObject({ ok: true, tools_ready: true });
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    expect(await modelContext.getTools()).toHaveLength(29);
    registry.stop();
  });

  it("uses only Hearth's 50 ms deferral on the synchronous polyfill path", async () => {
    vi.useFakeTimers();
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    let result: ToolResult | undefined;
    const execution = registry.execute("set_mode", { mode: "build" }, "agent").then((value) => {
      result = value;
    });

    await vi.advanceTimersByTimeAsync(49);
    expect(result).toBeUndefined();
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    await vi.advanceTimersByTimeAsync(1);
    await execution;
    expect(result).toMatchObject({ ok: true, tools_ready: true });
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    registry.stop();
  });

  it("settled waits for delayed host registration visibility after a group change", async () => {
    vi.useFakeTimers();
    const modelContext = new DelayedBuildModelContext(1_800);
    const registry = registryWith(modelContext);
    registry.start();
    hearthStore.getState().setMode("human", "build");
    let ready = false;
    const settling = registry.settled().then(() => {
      ready = true;
    });

    await vi.advanceTimersByTimeAsync(1_799);
    expect(ready).toBe(false);
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    await vi.advanceTimersByTimeAsync(1);
    await settling;
    expect(ready).toBe(true);
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    registry.stop();
  });

  it("caps a gating tool wait at five seconds and returns a retry hint", async () => {
    vi.useFakeTimers();
    const registry = registryWith(new DelayedBuildModelContext(6_000));
    registry.start();
    const execution = registry.execute("set_mode", { mode: "build" }, "agent");

    await vi.advanceTimersByTimeAsync(5_050);
    expect(await execution).toMatchObject({
      ok: true,
      mode: "build",
      tools_ready: false,
      hint: expect.stringContaining("refresh the tool list"),
    });
    registry.stop();
  });

  it("opens preview, variants and checkout groups only at their gates", async () => {
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    const product = hearthStore.getState().catalog[0];
    if (!product) throw new Error("Fixture catalog is empty");
    hearthStore.getState().setGhost("agent", {
      id: "ghost-1", catalogId: product.id, roomId: "living", pos: { x: 200, y: 200 },
      rotation: 0, colorway: product.colorways[0]?.id ?? "oak", status: "ghost",
    });
    expect((await modelContext.getTools()).map(({ name }) => name)).toEqual(expect.arrayContaining(["confirm_preview", "cancel_preview"]));
    hearthStore.getState().saveVariant("human", "kitchen", "Cosy");
    hearthStore.getState().saveVariant("human", "kitchen", "Media");
    expect(hearthStore.getState().scene.meta.activeRoomId).toBe("living");
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("compare_variants");
    hearthStore.getState().setCart({
      id: "cart", status: "idle", subtotalUsd: 10,
      lines: [{ id: "line", variantId: "variant", handle: product.id, title: product.name, colorway: "oak", quantity: 1, unitUsd: 10, lineUsd: 10 }],
    });
    const names = (await modelContext.getTools()).map(({ name }) => name);
    expect(names).toContain("get_checkout_link");
    expect(names).toHaveLength(33);
    registry.stop();
  });

  it("does not abort any group while a slow tool is executing", async () => {
    hearthStore.getState().setMode("human", "build");
    hearthStore.setState({ activity: [] });
    const queued: Array<() => void> = [];
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext, testUi(), (fn) => queued.push(fn));
    registry.start();
    let release: (() => void) | undefined;
    const wait = new Promise<void>((resolve) => { release = resolve; });
    const tool = registry.list().find(({ name }) => name === "set_mode");
    if (!tool) throw new Error("set_mode is missing");
    tool.spec.handler = async () => {
      await wait;
      return { ok: true, mode: "design" };
    };
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const executing = registry.execute("set_mode", { mode: "design" }, "agent");
    await Promise.resolve();
    expect(registry.executing).toBe(1);
    hearthStore.getState().setMode("human", "design");
    expect(abortSpy).not.toHaveBeenCalled();
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    release?.();
    expect(abortSpy).not.toHaveBeenCalled();
    await Promise.resolve();
    await Promise.resolve();
    queued.splice(0).forEach((fn) => fn());
    await executing;
    expect(abortSpy).toHaveBeenCalled();
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    registry.stop();
  });

  it("does not abort build tools while a confirmation dialog is pending", async () => {
    hearthStore.getState().setMode("human", "build");
    hearthStore.setState({ activity: [] });
    const queued: Array<() => void> = [];
    const gate = createConfirmGate(hearthStore);
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext, testUi((message) => gate.confirm(message)), (fn) => queued.push(fn));
    registry.start();
    const abortSpy = vi.spyOn(AbortController.prototype, "abort");
    const execution = registry.execute("apply_template", { template: "studio", furnished: false }, "agent");
    const confirmId = hearthStore.getState().ui.pendingConfirm?.id;
    expect(confirmId).toBeTruthy();
    expect(registry.executing).toBe(1);
    hearthStore.getState().setMode("human", "design");
    expect(abortSpy).not.toHaveBeenCalled();
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    if (confirmId) gate.resolve(confirmId, false);
    expect(await execution).toMatchObject({ ok: false, error: "cancelled" });
    queued.splice(0).forEach((fn) => fn());
    expect(abortSpy).toHaveBeenCalled();
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    registry.stop();
  });

  it("enforces dynamic gates for assistant execution", async () => {
    const registry = registryWith(loadRealPolyfill());
    const before = structuredClone(hearthStore.getState().scene);
    expect(await registry.execute("apply_template", { template: "studio" }, "assistant")).toEqual({
      ok: false,
      error: "blocked",
      detail: "apply_template is unavailable in design mode; set_mode build first.",
    });
    expect(hearthStore.getState().scene).toEqual(before);
  });

  it("ranks unknown tool alternatives by tokens and edit distance", async () => {
    const result = await registryWith(loadRealPolyfill()).execute("cart", {}, "assistant");
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(!result.ok && result.alternatives?.[0]).toBe("get_cart");
    expect(!result.ok && result.alternatives).toHaveLength(3);
  });

  it("accepts JSON strings and objects, validates paths, and writes one receipt each", async () => {
    const registry = registryWith(loadRealPolyfill());
    registry.start();
    const stringResult = await registry.execute("set_time_of_day", '{"time":"evening"}', "agent");
    const objectResult = await registry.execute("set_time_of_day", { time: "morning" }, "agent");
    const invalid = await registry.execute("set_time_of_day", { time: "dawn" }, "agent");
    expect(stringResult).toMatchObject({ ok: true, time_of_day: "evening" });
    expect(objectResult).toMatchObject({ ok: true, time_of_day: "morning" });
    expect(invalid).toMatchObject({ ok: false, error: "invalid" });
    expect(!invalid.ok && invalid.detail).toContain("time");
    expect(hearthStore.getState().activity).toHaveLength(3);
    expect(hearthStore.getState().activity.every((entry) => entry.source === "agent")).toBe(true);
    expect(hearthStore.getState().activity.every((entry) => entry.tool === "set_time_of_day")).toBe(true);
    registry.stop();
  });

  it("routes native polyfill execution through the shared lifecycle", async () => {
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    const tool = (await modelContext.getTools()).find(({ name }) => name === "set_time_of_day");
    if (!tool) throw new Error("set_time_of_day was not registered");
    const executable = modelContext as WebMCP.ModelContext & {
      executeTool(registeredTool: WebMCP.RegisteredTool, input: unknown): Promise<unknown>;
    };
    const result = await executable.executeTool(tool, '{"time":"evening"}');
    expect(result).toMatchObject({ ok: true, time_of_day: "evening" });
    expect(hearthStore.getState().activity).toHaveLength(1);
    expect(hearthStore.getState().activity[0]?.source).toBe("agent");
    registry.stop();
  });

  it("resolves confirmation acceptance, decline and timeout", async () => {
    const modelContext = loadRealPolyfill();
    const gate = createConfirmGate(hearthStore, { timeoutMs: 10 });
    const ui = testUi((message) => gate.confirm(message));
    const registry = registryWith(modelContext, ui);

    const acceptedPromise = registry.execute("clear_room", { room: "living" }, "agent");
    const acceptedId = hearthStore.getState().ui.pendingConfirm?.id;
    expect(acceptedId).toBeTruthy();
    if (acceptedId) gate.resolve(acceptedId, true);
    expect(await acceptedPromise).toMatchObject({ ok: true, room: "living" });

    resetStore(furnished2br());
    const declinedPromise = registry.execute("clear_room", { room: "living" }, "agent");
    const declinedId = hearthStore.getState().ui.pendingConfirm?.id;
    if (declinedId) gate.resolve(declinedId, false);
    expect(await declinedPromise).toEqual({ ok: false, error: "cancelled", detail: "The human declined to clear Living Room." });

    resetStore(emptyHome());
    vi.useFakeTimers();
    const timeoutPromise = registry.execute("clear_room", { room: "living" }, "agent");
    await vi.advanceTimersByTimeAsync(10);
    expect(await timeoutPromise).toEqual({ ok: false, error: "cancelled", detail: "No confirmation within 45 s" });
    expect(hearthStore.getState().ui.pendingConfirm).toBeUndefined();
  });

  it("mirrors toolchange and aborts every group on stop", async () => {
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    await vi.waitFor(() => expect(hearthStore.getState().tools.available).toHaveLength(29));
    expect(hearthStore.getState().tools.status).toBe("polyfill");
    expect(hearthStore.getState().tools.available[0]?.title).toBeTruthy();
    registry.stop();
    expect(await modelContext.getTools()).toEqual([]);
    expect(hearthStore.getState().tools.available).toEqual([]);
    expect(Object.values(registry.state().registered).every((value) => !value)).toBe(true);
  });
});
