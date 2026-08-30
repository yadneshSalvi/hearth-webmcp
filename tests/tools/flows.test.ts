// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolResult } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import { emptyHome, furnished2br } from "../fixtures/scenes";
import { clearRealPolyfill, loadRealPolyfill, resetStore, testUi } from "./helpers";

interface ExecutableModelContext extends WebMCP.ModelContext {
  executeTool(tool: WebMCP.RegisteredTool, input: unknown): Promise<unknown>;
}

async function execute(modelContext: WebMCP.ModelContext, name: string, input: unknown): Promise<ToolResult> {
  const tool = (await modelContext.getTools()).find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`${name} is not currently registered`);
  const result = await (modelContext as ExecutableModelContext).executeTool(tool, input);
  if (typeof result !== "object" || result === null || !("ok" in result)) throw new Error(`${name} returned an invalid envelope`);
  return result as ToolResult;
}

beforeEach(() => resetStore(emptyHome()));

afterEach(() => clearRealPolyfill());

describe("native WebMCP evaluation flows", () => {
  it("runs search → place → conflicts → move → cart → checkout through the polyfill", async () => {
    const modelContext = loadRealPolyfill();
    const registry = createRegistry({
      modelContext,
      store: hearthStore,
      ui: testUi(),
      shopify: createLocalShopify(hearthStore.getState().catalog),
    });
    registry.start();

    const searched = await execute(modelContext, "search_catalog", {
      category: "sofa",
      max_price_usd: 800,
      fits_wall: "north",
      room: "living",
    });
    expect(searched).toMatchObject({ ok: true, results: expect.arrayContaining([expect.objectContaining({ id: "sofa-liva" })]) });
    expect(hearthStore.getState().scene.furniture).toHaveLength(0);

    const placed = await execute(modelContext, "place_furniture", {
      product: "sofa-liva",
      room: "living",
      colorway: "sage",
      anchor: { wall: "north", along: "start" },
    });
    expect(placed).toMatchObject({ ok: true, room: "living", item: { id: "sofa-1", product: "sofa-liva", rotation: 0 } });
    expect(hearthStore.getState().scene.furniture[0]).toMatchObject({ id: "sofa-1", catalogId: "sofa-liva", colorway: "sage" });

    const checked = await execute(modelContext, "get_conflicts", { room: "living" });
    expect(checked).toMatchObject({ ok: true, room: "living", count: expect.any(Number) });
    expect(checked.ok && Array.isArray(checked.conflicts)).toBe(true);

    const moved = await execute(modelContext, "move_furniture", { item: "sofa-1", delta_cm: { y: 60 } });
    expect(moved).toMatchObject({ ok: true, room: "living", item: { id: "sofa-1", pos: [90, 104] }, moved_cm: 60 });
    expect(hearthStore.getState().scene.furniture[0]?.pos.y).toBe(104);

    const cart = await execute(modelContext, "update_cart", { action: "add", item: "sofa-1", quantity: 1 });
    expect(cart).toMatchObject({ ok: true, action: "add", line: { item: "sofa-1" }, subtotal_usd: 690 });
    expect(hearthStore.getState().cart.lines).toHaveLength(1);
    expect(hearthStore.getState().scene.furniture[0]?.cartLineId).toBe(hearthStore.getState().cart.lines[0]?.id);

    expect((await modelContext.getTools()).map((tool) => tool.name)).toContain("get_checkout_link");
    const checkout = await execute(modelContext, "get_checkout_link", {});
    expect(checkout).toMatchObject({
      ok: true,
      checkout_url: "https://hearth-studio.myshopify.com/cart",
      store_password: "",
      count: 1,
      subtotal_usd: 690,
    });
    expect(hearthStore.getState().activity).toHaveLength(6);
    expect(hearthStore.getState().activity.map((entry) => entry.tool)).toEqual([
      "get_checkout_link", "update_cart", "move_furniture", "get_conflicts", "place_furniture", "search_catalog",
    ]);
    registry.stop();
  });

  it("runs preview → confirm with cart linkage and flips both dynamic gates", async () => {
    const modelContext = loadRealPolyfill();
    const registry = createRegistry({
      modelContext,
      store: hearthStore,
      ui: testUi(),
      shopify: createLocalShopify(hearthStore.getState().catalog),
    });
    registry.start();
    expect((await modelContext.getTools()).map((tool) => tool.name)).not.toContain("confirm_preview");

    const preview = await execute(modelContext, "preview_in_room", {
      product: "sofa-liva",
      room: "living",
      colorway: "sage",
      anchor: { wall: "north" },
    });
    expect(preview).toMatchObject({ ok: true, preview: { id: "ghost-1", product: "sofa-liva" } });
    expect(hearthStore.getState().scene.furniture[0]?.status).toBe("ghost");
    expect((await modelContext.getTools()).map((tool) => tool.name)).toEqual(expect.arrayContaining(["confirm_preview", "cancel_preview"]));

    const confirmed = await execute(modelContext, "confirm_preview", { add_to_cart: true });
    expect(confirmed).toMatchObject({ ok: true, item: { id: "sofa-1" }, cart: { added: true, subtotal_usd: 690 } });
    expect(hearthStore.getState().scene.furniture[0]).toMatchObject({ id: "sofa-1", status: "placed", cartLineId: "local-line-1" });
    expect(hearthStore.getState().cart.lines[0]).toMatchObject({ id: "local-line-1", itemId: "sofa-1" });
    const names = (await modelContext.getTools()).map((tool) => tool.name);
    expect(names).not.toContain("confirm_preview");
    expect(names).toContain("get_checkout_link");
    registry.stop();
  });

  it("registers compare_variants only after two tool-created variants", async () => {
    resetStore(furnished2br());
    const modelContext = loadRealPolyfill();
    const registry = createRegistry({
      modelContext,
      store: hearthStore,
      ui: testUi(),
      shopify: createLocalShopify(hearthStore.getState().catalog),
    });
    registry.start();
    expect((await modelContext.getTools()).map((tool) => tool.name)).not.toContain("compare_variants");
    expect(await execute(modelContext, "save_variant", { name: "Cosy", room: "living" })).toMatchObject({ ok: true });
    expect((await modelContext.getTools()).map((tool) => tool.name)).not.toContain("compare_variants");
    expect(await execute(modelContext, "move_furniture", { item: "sofa-1", delta_cm: { y: 10 } })).toMatchObject({ ok: true });
    expect(await execute(modelContext, "save_variant", { name: "Media wall", room: "living" })).toMatchObject({ ok: true });
    expect((await modelContext.getTools()).map((tool) => tool.name)).toContain("compare_variants");
    const compared = await execute(modelContext, "compare_variants", { left: "Cosy", right: "Media", room: "living" });
    expect(compared).toMatchObject({ ok: true, diff: { moved: ["Endre Sofa"] } });
    expect(hearthStore.getState().ui.compare).toEqual({ left: "Cosy", right: "Media wall", roomId: "living" });
    registry.stop();
  });
});
