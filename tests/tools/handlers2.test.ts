import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import type { Registry } from "../../src/tools/registry";
import { emptyHome, furnished2br, worstCase2br } from "../fixtures/scenes";
import { resetStore, testUi } from "./helpers";

class EmptyModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

interface Harness {
  registry: Registry;
  ui: ToolUi;
}

function harness(ui = testUi()): Harness {
  return {
    registry: createRegistry({
      modelContext: new EmptyModelContext(),
      store: hearthStore,
      ui,
      shopify: createLocalShopify(hearthStore.getState().catalog),
    }),
    ui,
  };
}

interface HappyCase {
  name: string;
  input: unknown;
  empty?: boolean;
  prepare?: (registry: Registry) => Promise<void> | void;
  expected: object;
  summary: string | RegExp;
}

const happyCases: HappyCase[] = [
  { name: "get_scene_summary", input: {}, expected: { ok: true, home: { template: "2br", rooms: 6, items: 23 }, active_room: "living" }, summary: "Read scene summary" },
  { name: "get_room_details", input: { room: "Living" }, expected: { ok: true, room: { id: "living", name: "Living Room" }, items: expect.any(Array) }, summary: "Read Living Room details" },
  { name: "get_selection", input: {}, expected: { ok: true, selected_room: "living", camera: { view: "dollhouse", focus: "living" } }, summary: "Read selection" },
  { name: "measure", input: { subject: "north", room: "living" }, expected: { ok: true, subject: { kind: "wall", id: "w0" }, length_cm: 520 }, summary: "Measured north wall" },
  { name: "get_conflicts", input: { room: "living" }, expected: { ok: true, room: "living", count: expect.any(Number), conflicts: expect.any(Array) }, summary: /^Checked conflicts in Living Room \(\d+\)$/ },
  { name: "get_design_report", input: { room: "living" }, expected: { ok: true, room: "living", score: expect.any(Number), suggestions: expect.any(Array) }, summary: /^Design report for Living Room · \d+\/100$/ },
  { name: "search_catalog", input: { category: "sofa", max_price_usd: 800 }, expected: { ok: true, count: 2, results: expect.arrayContaining([expect.objectContaining({ id: "sofa-liva" })]) }, summary: "Searched catalog: sofas under $800 (2)" },
  { name: "get_product", input: { product: "Endre", room: "living" }, expected: { ok: true, product: { id: "sofa-endre", price_usd: 790 }, fits: { room: "living" } }, summary: "Read product Endre Sofa" },
  {
    name: "get_cart", input: {},
    prepare: async (registry) => { await registry.execute("update_cart", { action: "add", product: "sofa-liva", colorway: "sage" }, "agent"); },
    expected: { ok: true, count: 1, subtotal_usd: 690, checkout_available: true }, summary: "Read cart · $690",
  },
  { name: "place_furniture", input: { product: "sofa-endre", room: "living", anchor: { wall: "north" } }, empty: true, expected: { ok: true, room: "living", item: { id: "sofa-1", rotation: 0 }, nudged_cm: 0 }, summary: "Placed Endre Sofa on the north wall" },
  { name: "move_furniture", input: { item: "sofa-1", anchor: { wall: "north" } }, expected: { ok: true, room: "living", item: { id: "sofa-1", rotation: 0 } }, summary: "Moved Endre Sofa to the north wall" },
  { name: "arrange_room", input: { room: "living", style: "media" }, expected: { ok: true, room: "living", style: "media", moved: expect.any(Array), report_delta: { before: expect.any(Number), after: expect.any(Number) }, note: expect.stringContaining("media") }, summary: /^Arranged Living Room · media \(\d+ moved\)$/ },
  { name: "preview_in_room", input: { product: "sofa-liva", room: "living", anchor: { wall: "north" } }, empty: true, expected: { ok: true, room: "living", preview: { id: "ghost-1", product: "sofa-liva", rotation: 0 }, fit: expect.stringContaining("fits north wall") }, summary: "Previewing Liva Sofa on the north wall" },
  { name: "update_cart", input: { action: "add", product: "sofa-liva", colorway: "sage" }, expected: { ok: true, action: "add", line: { product: "sofa-liva", colorway: "sage" }, subtotal_usd: 690 }, summary: "Added Liva Sofa (sage) to cart · $690" },
  { name: "export_design_board", input: { room: "living" }, expected: { ok: true, room: "living", board: { title: "Living Room", items: 7, total_usd: 2140, size_px: "1600x1000" }, download: "started" }, summary: "Exported design board · Living Room" },
  {
    name: "confirm_preview", input: { add_to_cart: true }, empty: true,
    prepare: async (registry) => { await registry.execute("preview_in_room", { product: "sofa-liva", room: "living", anchor: { wall: "north" }, colorway: "sage" }, "agent"); },
    expected: { ok: true, room: "living", item: { id: "sofa-1", colorway: "sage" }, cart: { added: true, subtotal_usd: 690 } },
    summary: "Kept Liva Sofa (added to cart)",
  },
  {
    name: "compare_variants", input: { left: "Cos", right: "Media" },
    prepare: () => {
      hearthStore.getState().saveVariant("human", "kitchen", "Cosy");
      hearthStore.getState().moveItem("human", "table-1", { pos: { x: 230, y: 240 } });
      hearthStore.getState().saveVariant("human", "kitchen", "Media wall");
    },
    expected: { ok: true, room: "kitchen", left: "Cosy", right: "Media wall", diff: { moved: ["Ake Table"] } },
    summary: "Comparing “Cosy” vs “Media wall”",
  },
  {
    name: "get_checkout_link", input: {},
    prepare: async (registry) => { await registry.execute("update_cart", { action: "add", product: "sofa-liva", colorway: "sage" }, "agent"); },
    expected: { ok: true, checkout_url: "https://hearth-studio.myshopify.com/cart", count: 1, subtotal_usd: 690 },
    summary: "Prepared checkout link · $690",
  },
];

beforeEach(() => resetStore(furnished2br()));

describe("second-round handlers", () => {
  it("reports only tool groups whose gates are closed", async () => {
    const { registry } = harness();
    const result = await registry.execute("get_scene_summary", {}, "test");
    expect(result).toMatchObject({
      ok: true,
      gated_tools: {
        preview: "preview_in_room → confirm_preview, cancel_preview",
        variants: "save 2 variants in one room → compare_variants",
        checkout: "add an item to the cart → get_checkout_link",
        build: "set_mode build → apply_template, create_room, update_room, add_opening, move_opening, remove_opening",
      },
    });

    hearthStore.getState().setMode("human", "build");
    const product = hearthStore.getState().catalog[0];
    if (!product) throw new Error("Fixture catalog is empty");
    hearthStore.getState().setGhost("agent", {
      id: "ghost", catalogId: product.id, roomId: "living", pos: { x: 200, y: 200 },
      rotation: 0, colorway: product.colorways[0]?.id ?? "oak", status: "ghost",
    });
    hearthStore.getState().saveVariant("human", "kitchen", "A");
    hearthStore.getState().saveVariant("human", "kitchen", "B");
    hearthStore.getState().setCart({
      lines: [{
        id: "line", variantId: "variant", handle: product.id, title: product.name,
        colorway: product.colorways[0]?.id ?? "oak", quantity: 1, unitUsd: 1, lineUsd: 1,
      }],
      subtotalUsd: 1,
      status: "idle",
    });
    expect(await registry.execute("get_scene_summary", {}, "test")).toMatchObject({ ok: true, gated_tools: {} });
  });

  it.each(happyCases)("$name happy path and contracted receipt", async (testCase) => {
    if (testCase.empty) resetStore(emptyHome());
    const { registry } = harness();
    await testCase.prepare?.(registry);
    hearthStore.setState({ activity: [] });
    const result = await registry.execute(testCase.name, testCase.input, "agent");
    expect(result).toMatchObject(testCase.expected);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1_500);
    expect(result.ok && typeof result.hint === "string" ? result.hint.length : 0).toBeLessThanOrEqual(120);
    expect(hearthStore.getState().activity).toHaveLength(1);
    expect(hearthStore.getState().activity[0]).toMatchObject({ tool: testCase.name, source: "agent" });
    expect(hearthStore.getState().activity[0]?.summary).toMatch(testCase.summary);
  });

  it.each(happyCases)("$name rejects malformed input", async (testCase) => {
    const result = await harness().registry.execute(testCase.name, { unexpected: true }, "test");
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(!result.ok && result.detail.length).toBeGreaterThan(0);
    expect(hearthStore.getState().activity).toHaveLength(1);
    expect(hearthStore.getState().activity[0]?.tool).toBe(testCase.name);
  });

  it.each([
    ["get_room_details", { room: "missing-room" }],
    ["measure", { subject: "missing-subject", room: "living" }],
    ["get_conflicts", { room: "missing-room" }],
    ["get_design_report", { room: "missing-room" }],
    ["search_catalog", { fits_wall: "missing-wall", room: "living" }],
    ["get_product", { product: "missing-product" }],
    ["place_furniture", { product: "missing-product", room: "living" }],
    ["move_furniture", { item: "missing-item", delta_cm: { x: 10 } }],
    ["arrange_room", { room: "missing-room", style: "open" }],
    ["preview_in_room", { product: "missing-product", room: "living" }],
    ["update_cart", { action: "add", product: "missing-product" }],
    ["export_design_board", { room: "missing-room" }],
    ["confirm_preview", {}],
    ["compare_variants", { left: "missing-a", right: "missing-b", room: "living" }],
  ] as const)("%s returns not_found with at most three alternatives", async (name, input) => {
    const result = await harness().registry.execute(name, input, "test");
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(!result.ok && result.alternatives).toBeInstanceOf(Array);
    expect(!result.ok && (result.alternatives?.length ?? 0)).toBeLessThanOrEqual(3);
    expect(hearthStore.getState().activity).toHaveLength(1);
  });

  it("places a north-wall anchor flush with rotation zero", async () => {
    resetStore(emptyHome());
    const result = await harness().registry.execute("place_furniture", {
      product: "sofa-endre",
      room: "living",
      anchor: { wall: "north" },
    }, "agent");
    expect(result).toMatchObject({ ok: true, item: { pos: [260, 48], rotation: 0 } });
    const item = hearthStore.getState().scene.furniture.find((candidate) => candidate.id === "sofa-1");
    expect(item?.pos.x).toBe(260);
    expect(item?.pos.y).toBe(47.5);
    expect(item?.rotation).toBe(0);
  });

  it("returns actionable blocked placement data", async () => {
    const result = await harness().registry.execute("place_furniture", {
      product: "sofa-endre",
      room: "living",
      pos: { x: 260, y: 47.5 },
      rotation: 0,
    }, "agent");
    expect(result).toMatchObject({ ok: false, error: "blocked", free_spans: expect.any(Array), suggestion: expect.any(String) });
    expect(!result.ok && Array.isArray(result.free_spans)).toBe(true);
  });

  it("applies arrange_room in exactly one undo step", async () => {
    const before = hearthStore.temporal.getState().pastStates.length;
    const result = await harness().registry.execute("arrange_room", { room: "living", style: "open" }, "agent");
    expect(result.ok).toBe(true);
    expect(hearthStore.temporal.getState().pastStates.length - before).toBe(1);
    const arranged = structuredClone(hearthStore.getState().scene.furniture);
    hearthStore.getState().undo();
    expect(hearthStore.getState().scene.furniture).not.toEqual(arranged);
  });

  it("replaces a preview, confirms it, and links its cart line", async () => {
    resetStore(emptyHome());
    const { registry } = harness();
    await registry.execute("preview_in_room", { product: "chair-ida", room: "living", anchor: { wall: "west" } }, "agent");
    await registry.execute("preview_in_room", { product: "sofa-liva", room: "living", anchor: { wall: "north" }, colorway: "sage" }, "agent");
    expect(hearthStore.getState().scene.furniture.filter((item) => item.status === "ghost")).toHaveLength(1);
    const result = await registry.execute("confirm_preview", { add_to_cart: true }, "agent");
    expect(result).toMatchObject({ ok: true, item: { id: "sofa-1" }, cart: { added: true } });
    const item = hearthStore.getState().scene.furniture.find((candidate) => candidate.id === "sofa-1");
    const line = hearthStore.getState().cart.lines[0];
    expect(item?.cartLineId).toBe(line?.id);
    expect(item?.shopifyVariantId).toBe(line?.variantId);
    expect(line?.itemId).toBe(item?.id);
    expect(hearthStore.getState().scene.furniture.some((candidate) => candidate.status === "ghost")).toBe(false);
  });

  it("adds, updates, and removes an item-linked cart line", async () => {
    const { registry } = harness();
    const added = await registry.execute("update_cart", { action: "add", item: "sofa-1" }, "agent");
    expect(added).toMatchObject({ ok: true, line: { item: "sofa-1", qty: 1 }, count: 1 });
    const changed = await registry.execute("update_cart", { action: "set_quantity", item: "sofa-1", quantity: 2 }, "agent");
    expect(changed).toMatchObject({ ok: true, line: { item: "sofa-1", qty: 2 }, count: 2, subtotal_usd: 1_580 });
    expect(hearthStore.getState().cart.lines[0]?.quantity).toBe(2);
    const removed = await registry.execute("update_cart", { action: "remove", item: "sofa-1" }, "agent");
    expect(removed).toMatchObject({ ok: true, line: { item: "sofa-1" }, count: 0, checkout_available: false });
    expect(hearthStore.getState().cart.lines).toEqual([]);
    expect(hearthStore.getState().scene.furniture.find((item) => item.id === "sofa-1")?.cartLineId).toBeUndefined();
  });

  it("caps whole-home conflicts at six with errors before warnings", async () => {
    resetStore(worstCase2br());
    const result = await harness().registry.execute("get_conflicts", { room: "all" }, "agent");
    expect(result).toMatchObject({ ok: true, room: "all", conflicts: expect.any(Array), more: expect.any(Number) });
    if (!result.ok || !Array.isArray(result.conflicts)) throw new Error("Expected conflict rows");
    expect(result.conflicts.length).toBeLessThanOrEqual(6);
    const severities = result.conflicts.map((conflict) => conflict.severity);
    expect(severities).toEqual([...severities].sort((left, right) => Number(left === "warn") - Number(right === "warn")));
    expect(typeof result.more === "number" && result.more).toBeGreaterThan(0);
  });

  it("returns unavailable when board export is not wired", async () => {
    const ui: ToolUi = { confirm: async () => ({ accepted: true, reason: "accepted" }), focus: vi.fn(), pulse: vi.fn() };
    const result = await harness(ui).registry.execute("export_design_board", { room: "living" }, "agent");
    expect(result).toEqual({ ok: false, error: "unavailable", detail: "Design-board export is not wired into this page yet." });
  });

  it("blocks checkout while the local cart is empty", async () => {
    const result = await harness().registry.execute("get_checkout_link", {}, "test");
    expect(result).toMatchObject({ ok: false, error: "blocked", suggestion: expect.any(String) });
  });
});
