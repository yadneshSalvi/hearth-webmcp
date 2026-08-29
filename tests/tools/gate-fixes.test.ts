import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCatalog } from "../../src/engine/catalog";
import { evaluateRoom } from "../../src/engine/conflicts";
import { createLocalShopify } from "../../src/shopify/local";
import { snapshotProducts } from "../../src/shopify/snapshot";
import type { Result, ShopifyCart, ShopifyClient } from "../../src/shopify/types";
import { hearthStore } from "../../src/state/store";
import { createRegistry } from "../../src/tools/registry";
import { furnished2br, worstCase2br } from "../fixtures/scenes";
import { resetStore, testUi } from "./helpers";

class EmptyModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

function registry(shopify: ShopifyClient = createLocalShopify(hearthStore.getState().catalog)) {
  return createRegistry({ modelContext: new EmptyModelContext(), store: hearthStore, ui: testUi(), shopify });
}

beforeEach(() => resetStore(furnished2br()));

describe("phase-gate regressions", () => {
  it("keeps undo labels aligned across read receipts and consecutive undo calls", async () => {
    const tools = registry();
    const original = structuredClone(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")!.pos);
    expect(await tools.execute("move_furniture", { item: "sofa-1", delta_cm: { y: 60 } }, "agent")).toMatchObject({ ok: true });
    expect(await tools.execute("get_scene_summary", {}, "agent")).toMatchObject({ ok: true });
    const first = await tools.execute("undo", { steps: 1 }, "agent");
    expect(first).toMatchObject({ ok: true, undone: [{ action: "move_furniture" }] });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.pos).toEqual(original);

    await tools.execute("set_time_of_day", { time: "evening" }, "agent");
    await tools.execute("set_time_of_day", { time: "morning" }, "agent");
    const second = await tools.execute("undo", { steps: 1 }, "agent");
    const third = await tools.execute("undo", { steps: 1 }, "agent");
    expect(second).toMatchObject({ ok: true, undone: [{ action: "set_lighting" }] });
    expect(third).toMatchObject({ ok: true, undone: [{ action: "set_lighting" }] });
    expect(second.ok && second.undone).not.toEqual(expect.arrayContaining([expect.objectContaining({ action: "undo" })]));
    expect(third.ok && third.undone).not.toEqual(expect.arrayContaining([expect.objectContaining({ action: "undo" })]));
  });

  it("does not create scene history when linking an added cart line", async () => {
    const tools = registry();
    const original = structuredClone(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")!.pos);
    expect(await tools.execute("move_furniture", { item: "sofa-1", delta_cm: { y: 60 } }, "agent")).toMatchObject({ ok: true });
    const before = hearthStore.temporal.getState().pastStates.length;
    const result = await tools.execute("update_cart", { action: "add", item: "sofa-1" }, "agent");
    expect(result).toMatchObject({ ok: true, line: { item: "sofa-1" } });
    expect(hearthStore.temporal.getState().pastStates).toHaveLength(before);
    const linkedLine = hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.cartLineId;
    expect(linkedLine).toBeTruthy();
    expect(await tools.execute("undo", { steps: 1 }, "agent")).toMatchObject({ ok: true, undone: [{ action: "move_furniture" }] });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")).toMatchObject({ pos: original, cartLineId: linkedLine });
  });

  it("updates a linked colorway with the real snapshot variant and never removes first", async () => {
    const product = snapshotProducts().find((candidate) => candidate.id === "sofa-endre");
    if (!product) throw new Error("Snapshot Endre product is missing");
    const oak = product.variants.find((variant) => variant.colorway === "oak")!;
    const sage = product.variants.find((variant) => variant.colorway === "sage")!;
    let remoteCart: ShopifyCart = {
      id: "gid://shopify/Cart/live",
      lines: [{ id: "gid://shopify/CartLine/1", variantId: oak.id, handle: product.id, title: product.name, colorway: "oak", quantity: 1, unitUsd: 790, lineUsd: 790, itemId: "sofa-1" }],
      subtotalUsd: 790,
      count: 1,
    };
    hearthStore.getState().setCart({ ...structuredClone(remoteCart), status: "idle" });
    hearthStore.getState().linkCartLine("human", "sofa-1", oak.id, remoteCart.lines[0]!.id);
    const cartAdd = vi.fn(async (): Promise<Result<ShopifyCart>> => ({ ok: true, value: structuredClone(remoteCart) }));
    const cartRemove = vi.fn(async (): Promise<Result<ShopifyCart>> => ({ ok: true, value: structuredClone(remoteCart) }));
    const cartUpdateLine = vi.fn(async (lineId: string, variantId: string, quantity: number): Promise<Result<ShopifyCart>> => {
      const variant = product.variants.find((candidate) => candidate.id === variantId);
      if (!variant) return { ok: false, error: "not_found", detail: `Variant ${variantId} was not found` };
      remoteCart = {
        ...remoteCart,
        lines: remoteCart.lines.map((line) => line.id === lineId ? {
          ...line,
          id: "gid://shopify/CartLine/2",
          variantId,
          colorway: variant.colorway,
          quantity,
          lineUsd: variant.price * quantity,
        } : line),
      };
      return { ok: true, value: structuredClone(remoteCart) };
    });
    const shopify: ShopifyClient = {
      unavailable: false,
      async search() { return { ok: true, value: [structuredClone(product)] }; },
      async product() { return { ok: true, value: structuredClone(product) }; },
      async cartGet() { return { ok: true, value: structuredClone(remoteCart) }; },
      cartAdd,
      cartRemove,
      async cartSetQuantity() { return { ok: true, value: structuredClone(remoteCart) }; },
      cartUpdateLine,
      async checkoutLink() { return { ok: true, value: { checkoutUrl: "https://example.test", storePassword: "test" } }; },
    };
    const tools = registry(shopify);
    expect(await tools.execute("set_colorway", { item: "sofa-1", colorway: "sage" }, "agent")).toMatchObject({
      ok: true,
      item: { id: "sofa-1", colorway: "sage" },
      cart_line_updated: true,
    });
    expect(cartUpdateLine).toHaveBeenCalledWith("gid://shopify/CartLine/1", sage.id, 1);
    expect(cartRemove).not.toHaveBeenCalled();
    expect(cartAdd).not.toHaveBeenCalled();
    expect(hearthStore.getState().cart.lines[0]).toMatchObject({ variantId: sage.id, colorway: "sage" });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")).toMatchObject({
      colorway: "sage",
      shopifyVariantId: sage.id,
      cartLineId: "gid://shopify/CartLine/2",
    });

    cartUpdateLine.mockResolvedValueOnce({ ok: false, error: "unavailable", detail: "Shopify offline" });
    const failed = await tools.execute("set_colorway", { item: "sofa-1", colorway: "terracotta" }, "agent");
    expect(failed).toEqual({ ok: false, error: "unavailable", detail: "Shopify offline" });
    expect(hearthStore.getState().cart.lines[0]).toMatchObject({ variantId: sage.id, colorway: "sage" });
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.colorway).toBe("sage");
  });

  it("returns invalid from update_room when a shrink would strand openings", async () => {
    hearthStore.getState().setMode("human", "build");
    const result = await registry().execute("update_room", { room: "living", width_cm: 200 }, "agent");
    expect(result).toMatchObject({ ok: false, error: "invalid", detail: expect.stringContaining("window-living-north") });
    expect(hearthStore.getState().scene.rooms.find((room) => room.id === "living")?.poly[1]?.x).toBe(520);
  });

  it("returns the real active-room conflict count from accessibility mode", async () => {
    resetStore(worstCase2br());
    const tools = registry();
    const result = await tools.execute("set_accessibility_mode", { enabled: true }, "agent");
    const state = hearthStore.getState();
    const expected = evaluateRoom(state.scene, state.scene.meta.activeRoomId, createCatalog(state.catalog)).length;
    expect(result).toMatchObject({ ok: true, accessibility_mode: true, conflicts: expected });
    expect(result.ok && result.hint).toContain(String(expected));
    expect(hearthStore.getState().activity[0]?.summary).toBe(`Accessibility mode on (${expected} conflicts)`);
  });

  it("surfaces failed arrangement notes as actionable blocked results", async () => {
    const impossible = furnished2br();
    const living = impossible.rooms.find((room) => room.id === "living")!;
    living.poly = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    impossible.openings = impossible.openings.filter((opening) => opening.roomId !== living.id);
    impossible.furniture = impossible.furniture.filter((item) => item.id === "sofa-1");
    resetStore(impossible);
    const result = await registry().execute("arrange_room", { room: "living", style: "work" }, "agent");
    expect(result).toMatchObject({ ok: false, error: "blocked", detail: expect.stringContaining("no complete work fit") });
  });
});
