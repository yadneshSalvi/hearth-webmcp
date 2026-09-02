// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ParsedPlan } from "../../src/engine/floorplan";
import type { PlanReader } from "../../src/floorplan/schema";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import { furnished2br } from "../fixtures/scenes";
import { resetStore, testUi } from "./helpers";

class EmptyModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

function plan(name: string): ParsedPlan {
  return JSON.parse(readFileSync(resolve(process.cwd(), `tests/fixtures/floorplans/${name}.json`), "utf8")) as ParsedPlan;
}

function registry(options: { ui?: ToolUi; planReader?: PlanReader } = {}) {
  return createRegistry({
    modelContext: new EmptyModelContext(),
    store: hearthStore,
    ui: options.ui ?? testUi(),
    shopify: createLocalShopify(hearthStore.getState().catalog),
    ...(options.planReader ? { planReader: options.planReader } : {}),
  });
}

beforeEach(() => resetStore(furnished2br()));

describe("resize_furniture", () => {
  it("resizes a sofa, keeps it in the room and names the closest catalog product", async () => {
    const result = await registry().execute("resize_furniture", { item: "sofa-1", width_cm: 240 }, "test");
    expect(result).toMatchObject({
      ok: true,
      room: "living",
      item: { id: "sofa-1", dims: "240x95x85", catalog_dims: "220x95x85" },
      item_ids: ["sofa-1"],
      closest_product: { id: expect.any(String), match: expect.stringMatching(/exact|close|off/) },
    });
    const sofa = hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")!;
    expect(sofa.dims).toEqual({ w: 240, d: 95, h: 85 });
    expect(hearthStore.getState().activity[0]?.summary).toBe("Resized Endre Sofa → 240×95×85 cm");
  });

  it("reports the resized size in room details, selection and measure", async () => {
    const tools = registry();
    await tools.execute("resize_furniture", { item: "sofa-1", scale_percent: 120 }, "test");
    const details = await tools.execute("get_room_details", { room: "living" }, "test");
    expect(details.ok && (details.items as string[]).find((line) => line.startsWith("sofa-1"))).toMatch(/264x114 sage resized/);
    hearthStore.getState().setSelection("human", { itemId: "sofa-1" });
    const selection = await tools.execute("get_selection", {}, "test");
    expect(selection).toMatchObject({ ok: true, selected_item: { id: "sofa-1", dims: "264x114x102", catalog_dims: "220x95x85" } });
    const measured = await tools.execute("measure", { subject: "sofa-1", room: "living" }, "test");
    expect(measured).toMatchObject({ ok: true, dims: "264x114x102", catalog_dims: "220x95x85" });
  });

  it("resets to the catalog size and refuses impossible sizes", async () => {
    const tools = registry();
    await tools.execute("resize_furniture", { item: "sofa-1", width_cm: 240 }, "test");
    const reset = await tools.execute("resize_furniture", { item: "sofa-1", reset: true }, "test");
    expect(reset).toMatchObject({ ok: true, item: { dims: "220x95x85", scale: "100%" } });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.dims).toBeUndefined();
    expect(await tools.execute("resize_furniture", { item: "sofa-1", width_cm: 2000 }, "test")).toMatchObject({ ok: false, error: "invalid" });
    expect(await tools.execute("resize_furniture", { item: "sofa-1" }, "test")).toMatchObject({ ok: false, error: "invalid" });
    expect(await tools.execute("resize_furniture", { item: "nope", width_cm: 100 }, "test")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("undo restores the catalog size", async () => {
    const tools = registry();
    await tools.execute("resize_furniture", { item: "sofa-1", depth_cm: 120 }, "test");
    expect(await tools.execute("undo", { steps: 1 }, "test")).toMatchObject({ ok: true });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.dims).toBeUndefined();
  });
});

describe("clear_home and restore_furniture", () => {
  it("clears every room after confirmation and restores the same items", async () => {
    const tools = registry();
    const before = hearthStore.getState().scene.furniture.map(({ id }) => id).sort();
    const cleared = await tools.execute("clear_home", {}, "test");
    expect(cleared).toMatchObject({ ok: true, removed: before.length, rooms_cleared: expect.any(Number) });
    expect(hearthStore.getState().scene.furniture).toHaveLength(0);
    expect(hearthStore.getState().activity[0]?.summary).toBe(`Cleared the whole home (${before.length} items)`);
    const restored = await tools.execute("restore_furniture", {}, "test");
    expect(restored).toMatchObject({ ok: true, restored: before.length, skipped: [] });
    expect(hearthStore.getState().scene.furniture.map(({ id }) => id).sort()).toEqual(before);
    expect(await tools.execute("restore_furniture", {}, "test")).toMatchObject({ ok: false, error: "not_found" });
  });

  it("asks first and returns cancelled when declined", async () => {
    const tools = registry({ ui: testUi(async () => ({ accepted: false, reason: "declined" })) });
    const result = await tools.execute("clear_home", {}, "test");
    expect(result).toMatchObject({ ok: false, error: "cancelled", detail: "The human declined to clear the home." });
    expect(hearthStore.getState().scene.furniture.length).toBeGreaterThan(0);
  });

  it("restores a cleared room and re-ids items whose ids were taken", async () => {
    const tools = registry();
    expect(await tools.execute("clear_room", { room: "living" }, "test")).toMatchObject({ ok: true, room: "living" });
    const placed = hearthStore.getState().placeItem("human", { catalogId: "sofa-liva", roomId: "bed-1", pos: { x: 200, y: 100 }, rotation: 0 });
    expect(placed.id).toBe("sofa-1");
    const restored = await tools.execute("restore_furniture", {}, "test");
    expect(restored).toMatchObject({ ok: true, rooms: ["living"] });
    const ids = hearthStore.getState().scene.furniture.map(({ id }) => id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(hearthStore.getState().scene.furniture.filter((item) => item.roomId === "living").length).toBeGreaterThan(0);
  });

  it("skips items whose room disappeared with a template change", async () => {
    const tools = registry();
    await tools.execute("clear_home", {}, "test");
    hearthStore.getState().applyTemplate("human", "studio", false);
    const restored = await tools.execute("restore_furniture", {}, "test");
    expect(restored).toMatchObject({ ok: true, restored: 0 });
    expect((restored as unknown as { skipped: string[] }).skipped.length).toBeGreaterThan(0);
  });
});

describe("search_catalog and get_product size matching", () => {
  it("ranks by closest size and flags exact matches", async () => {
    const tools = registry();
    const result = await tools.execute("search_catalog", { category: "sofa", width_cm: 240, depth_cm: 98, height_cm: 104 }, "test");
    expect(result).toMatchObject({ ok: true, target_dims: "240x98x104", exact_match: true });
    const rows = (result as unknown as { results: Array<{ id: string; dims_match: string; delta_cm: string }> }).results;
    expect(rows[0]).toMatchObject({ id: "sofa-maren", dims_match: "exact", delta_cm: "w0 d0 h0" });
    expect(rows.every((row) => typeof row.dims_match === "string")).toBe(true);
  });

  it("takes the target from a placed item, resized or not", async () => {
    const tools = registry();
    await tools.execute("resize_furniture", { item: "sofa-1", width_cm: 258, depth_cm: 100, height_cm: 94 }, "test");
    const result = await tools.execute("search_catalog", { like_item: "sofa-1" }, "test");
    expect(result).toMatchObject({ ok: true, target_dims: "258x100x94" });
    const rows = (result as unknown as { results: Array<{ id: string; category: string; dims_match: string }> }).results;
    expect(rows[0]).toMatchObject({ id: "sofa-fjord", dims_match: "close" });
    expect(rows.every((row) => row.category === "sofa")).toBe(true);
  });

  it("compares a product with a placed item", async () => {
    const tools = registry();
    const result = await tools.execute("get_product", { product: "sofa-endre", compare_to: "sofa-1" }, "test");
    expect(result).toMatchObject({ ok: true, size_match: { item: "sofa-1", item_dims: "220x95x85", match: "exact", delta_cm: "w0 d0 h0" } });
    const other = await tools.execute("get_product", { product: "sofa-fjord", compare_to: "selected" }, "test");
    expect(other).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("update_room with an anchor corner", () => {
  it("grows toward the west from the north-east corner and reports pushed rooms", async () => {
    hearthStore.getState().setMode("human", "build");
    const tools = registry();
    const result = await tools.execute("update_room", { room: "kitchen", width_cm: 400, anchor_corner: "ne" }, "test");
    expect(result).toMatchObject({ ok: true, room: { id: "kitchen", size_cm: "400x440" }, shifted_rooms: expect.arrayContaining(["living"]) });
    const living = hearthStore.getState().scene.rooms.find((room) => room.id === "living")!;
    expect(living.origin.x).toBe(-40);
  });
});

describe("import_floor_plan", () => {
  it("needs an uploaded plan or a URL", async () => {
    hearthStore.getState().setMode("human", "build");
    const result = await registry({ planReader: vi.fn() }).execute("import_floor_plan", {}, "test");
    expect(result).toMatchObject({ ok: false, error: "not_found", detail: expect.stringContaining("No floor plan has been uploaded") });
  });

  it("builds the home from the uploaded plan after confirmation, furnished, and frames it", async () => {
    hearthStore.getState().setMode("human", "build");
    hearthStore.getState().setUi({ uploadedPlan: { name: "my-plan.jpg", dataUrl: "data:image/jpeg;base64,AAAA", width: 10, height: 10, at: 1 } });
    const reader = vi.fn<PlanReader>(async (request) => {
      expect(request).toEqual({ image: "data:image/jpeg;base64,AAAA" });
      return { ok: true, plan: plan("two-bed-deck"), ms: 42 };
    });
    const ui = testUi();
    const result = await registry({ ui, planReader: reader }).execute("import_floor_plan", { furnished: true }, "test");
    expect(result).toMatchObject({
      ok: true,
      plan: { title: "Typical Unit Plan - 2 BHK with Deck, Tower 1", units: "ft" },
      skipped: ["Deck (outdoor)"],
      openings: expect.any(Number),
    });
    const scene = hearthStore.getState().scene;
    expect(scene.rooms.map(({ id }) => id)).toEqual(["bed-1", "living", "bed-2", "dining", "kitchen", "bath", "bath-2"]);
    expect(scene.furniture.length).toBeGreaterThan(0);
    expect(scene.meta.mode).toBe("build");
    expect(scene.meta.template).toBeUndefined();
    expect(scene.meta.importedPlan?.title).toContain("2 BHK");
    expect(ui.focus).toHaveBeenCalledWith({ kind: "home", id: "home" });
    expect(hearthStore.getState().activity[0]?.summary).toBe("Imported floor plan · 7 rooms (furnished)");
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
  });

  it("passes a URL through and surfaces reader failures", async () => {
    hearthStore.getState().setMode("human", "build");
    const reader = vi.fn<PlanReader>(async (request) => {
      expect(request).toEqual({ url: "https://example.com/plan.png" });
      return { ok: false, error: "unavailable", detail: "The plan reader timed out." };
    });
    const result = await registry({ planReader: reader }).execute("import_floor_plan", { image_url: "https://example.com/plan.png" }, "test");
    expect(result).toMatchObject({ ok: false, error: "unavailable", detail: "The plan reader timed out." });
    expect(hearthStore.getState().scene.rooms.map(({ id }) => id)).toContain("living");
  });

  it("returns cancelled when the human keeps their furnished home", async () => {
    hearthStore.getState().setMode("human", "build");
    hearthStore.getState().setUi({ uploadedPlan: { name: "p.png", dataUrl: "data:image/png;base64,AAAA", width: 1, height: 1, at: 1 } });
    const reader = vi.fn<PlanReader>();
    const tools = registry({ ui: testUi(async () => ({ accepted: false, reason: "declined" })), planReader: reader });
    expect(await tools.execute("import_floor_plan", {}, "test")).toMatchObject({ ok: false, error: "cancelled" });
    expect(reader).not.toHaveBeenCalled();
  });

  it("is gated behind build mode", async () => {
    const result = await registry({ planReader: vi.fn() }).execute("import_floor_plan", {}, "agent");
    expect(result).toMatchObject({ ok: false, error: "blocked" });
  });
});
