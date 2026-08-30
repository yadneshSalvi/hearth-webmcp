// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import { createConfirmGate } from "../../src/tools/confirm";
import type { ToolUi } from "../../src/tools/define";
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

describe("registry lifecycle against the real polyfill", () => {
  it("registers exactly 26 default tools synchronously and alphabetically", async () => {
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext);
    registry.start();
    const names = (await modelContext.getTools()).map(({ name }) => name);
    expect(names).toHaveLength(26);
    expect(names).toEqual([...names].sort());
    expect(names).toContain("set_mode");
    expect(names).toContain("export_design_board");
    expect(names).not.toContain("apply_template");
    registry.stop();
  });

  it("adds and removes build tools on the deferred macrotask", async () => {
    const queued: Array<() => void> = [];
    const modelContext = loadRealPolyfill();
    const registry = registryWith(modelContext, testUi(), (fn) => queued.push(fn));
    registry.start();
    expect((await registry.execute("set_mode", { mode: "build" }, "agent")).ok).toBe(true);
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    queued.splice(0).forEach((fn) => fn());
    expect((await modelContext.getTools()).map(({ name }) => name)).toContain("apply_template");
    expect(await modelContext.getTools()).toHaveLength(32);
    expect((await registry.execute("set_mode", { mode: "design" }, "agent")).ok).toBe(true);
    queued.splice(0).forEach((fn) => fn());
    expect((await modelContext.getTools()).map(({ name }) => name)).not.toContain("apply_template");
    expect(await modelContext.getTools()).toHaveLength(26);
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
    expect(names).toHaveLength(30);
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
    await executing;
    expect(abortSpy).not.toHaveBeenCalled();
    queued.splice(0).forEach((fn) => fn());
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
    await vi.waitFor(() => expect(hearthStore.getState().tools.available).toHaveLength(26));
    expect(hearthStore.getState().tools.status).toBe("polyfill");
    expect(hearthStore.getState().tools.available[0]?.title).toBeTruthy();
    registry.stop();
    expect(await modelContext.getTools()).toEqual([]);
    expect(hearthStore.getState().tools.available).toEqual([]);
    expect(Object.values(registry.state().registered).every((value) => !value)).toBe(true);
  });
});
