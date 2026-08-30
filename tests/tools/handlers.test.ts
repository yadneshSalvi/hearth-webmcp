import { describe, expect, it } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { humanizeConfirmMessage, templateConfirmMessage } from "../../src/ui/templates";
import { hearthStore } from "../../src/state/store";
import type { ToolResult, ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import { emptyHome, furnished2br } from "../fixtures/scenes";
import { resetStore, testUi } from "./helpers";

class EmptyModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

interface HappyCase {
  name: string;
  input: () => unknown;
  prepare?: () => void;
  summary: string | RegExp;
  verify(result: ToolResult): void;
}

function registry(ui: ToolUi = testUi()) {
  return createRegistry({
    modelContext: new EmptyModelContext(),
    store: hearthStore,
    ui,
    shopify: createLocalShopify(hearthStore.getState().catalog),
  });
}

const happyCases: HappyCase[] = [
  { name: "set_mode", input: () => ({ mode: "build" }), summary: "Switched to Build mode", verify: (result) => expect(result).toMatchObject({ ok: true, mode: "build" }) },
  { name: "remove_furniture", input: () => ({ item: "armchair-1" }), summary: "Removed Nook Armchair", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", removed: { id: "armchair-1" } }) },
  { name: "set_colorway", input: () => ({ item: "sofa-1", colorway: "terracotta" }), summary: "Endre Sofa → terracotta", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", item: { id: "sofa-1", colorway: "terracotta" } }) },
  { name: "apply_palette", input: () => ({ palette: "sage-linen", room: "living" }), summary: "Applied Sage linen to Living Room", verify: (result) => expect(result).toMatchObject({ ok: true, rooms: ["living"], palette: { id: "sage-linen" } }) },
  { name: "set_time_of_day", input: () => ({ time: "evening" }), summary: "Time of day → evening", verify: (result) => expect(result).toMatchObject({ ok: true, time_of_day: "evening", lamps_on: true }) },
  { name: "set_view", input: () => ({ view: "plan", focus: "sofa-1", yaw: "ne" }), summary: "View → plan, focus Endre Sofa", verify: (result) => expect(result).toMatchObject({ ok: true, view: "plan", focus: { kind: "item", id: "sofa-1" } }) },
  { name: "set_accessibility_mode", input: () => ({ enabled: true }), summary: /Accessibility mode on \(\d+ conflicts\)/, verify: (result) => expect(result).toMatchObject({ ok: true, accessibility_mode: true }) },
  {
    name: "undo", input: () => ({ steps: 1 }), summary: "Undid 1 change",
    prepare: () => { hearthStore.getState().setMode("human", "shop"); },
    verify: (result) => expect(result).toMatchObject({ ok: true, remaining: expect.any(Number) }),
  },
  { name: "save_variant", input: () => ({ name: "Cosy", room: "living" }), summary: "Saved variant “Cosy”", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", variant: { name: "Cosy", items: 7 } }) },
  {
    name: "load_variant", input: () => ({ variant: "Cos", room: "living" }), summary: "Loaded variant “Cosy”",
    prepare: () => { hearthStore.getState().saveVariant("human", "living", "Cosy"); hearthStore.setState({ activity: [] }); },
    verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", variant: "Cosy", items: 7 }),
  },
  { name: "clear_room", input: () => ({ room: "living" }), summary: "Cleared Living Room (7 items)", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", removed: 7 }) },
  {
    name: "cancel_preview", input: () => ({}), summary: /^Discarded preview of /,
    prepare: () => {
      const item = hearthStore.getState().scene.furniture[0];
      if (!item) throw new Error("Fixture has no furniture");
      hearthStore.getState().setGhost("agent", { ...item, id: "ghost-1", status: "ghost" });
      hearthStore.setState({ activity: [] });
    },
    verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", discarded: { product: "sofa-endre" } }),
  },
  { name: "apply_template", input: () => ({ template: "studio", furnished: false }), summary: "Applied Studio layout", verify: (result) => expect(result).toMatchObject({ ok: true, template: "studio", rooms: ["studio", "bath"] }) },
  { name: "create_room", input: () => ({ name: "Office", type: "office", width_cm: 360, depth_cm: 320 }), summary: "Created Office · 360×320 cm", verify: (result) => expect(result).toMatchObject({ ok: true, room: { id: "office", size_cm: "360x320" } }) },
  { name: "update_room", input: () => ({ room: "living", width_cm: 530 }), summary: "Updated Living Room · 530x440 cm", verify: (result) => expect(result).toMatchObject({ ok: true, room: { id: "living", size_cm: "530x440" } }) },
  { name: "add_opening", input: () => ({ room: "living", wall: "north", kind: "window", offset_cm: 0, width_cm: 40 }), summary: "Added window on the north wall", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", opening: { kind: "window", wall: "w0", width_cm: 40 } }) },
  { name: "move_opening", input: () => ({ opening: "door-living-hall", offset_cm: "center" }), summary: "Moved door-living-hall to 215 cm on the south wall", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", opening: { id: "door-living-hall", offset_cm: 215 } }) },
  { name: "remove_opening", input: () => ({ opening: "window-living-north" }), summary: "Removed window-living-north", verify: (result) => expect(result).toMatchObject({ ok: true, room: "living", removed: { id: "window-living-north", kind: "window" } }) },
];

describe("first-round handlers", () => {
  it.each(happyCases)("$name happy path and receipt", async (testCase) => {
    resetStore(furnished2br());
    testCase.prepare?.();
    const before = hearthStore.getState().activity.length;
    const result = await registry().execute(testCase.name, testCase.input(), "test");
    testCase.verify(result);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
    expect(hearthStore.getState().activity).toHaveLength(before + 1);
    const receipt = hearthStore.getState().activity[0];
    expect(receipt?.tool).toBe(testCase.name);
    expect(receipt?.source).toBe("system");
    expect(receipt?.summary).toMatch(testCase.summary);
  });

  it.each(happyCases)("$name rejects invalid input with a receipt", async (testCase) => {
    resetStore(furnished2br());
    const result = await registry().execute(testCase.name, { unexpected: true }, "test");
    expect(result).toMatchObject({ ok: false, error: "invalid" });
    expect(!result.ok && result.detail.length).toBeGreaterThan(0);
    expect(hearthStore.getState().activity).toHaveLength(1);
    expect(hearthStore.getState().activity[0]?.tool).toBe(testCase.name);
  });

  it.each([
    ["3br", 7, 30, 3],
    ["4br", 10, 34, 4],
    ["5br", 11, 40, 5],
  ] as const)("applies a furnished %s within the result budget", async (template, rooms, items, bedrooms) => {
    resetStore(emptyHome());
    const result = await registry().execute("apply_template", { template, furnished: true }, "test");
    expect(result).toMatchObject({ ok: true, template, items });
    expect(result.ok && Array.isArray(result.rooms) ? result.rooms : []).toHaveLength(rooms);
    expect(result.ok && Array.isArray(result.item_ids) ? result.item_ids : []).toHaveLength(items);
    expect(hearthStore.getState().scene.rooms.filter((room) => room.type === "bedroom")).toHaveLength(bedrooms);
    expect(JSON.stringify(result).length).toBeLessThanOrEqual(1500);
    expect(hearthStore.getState().activity[0]?.summary).toBe(`Applied ${template.toUpperCase()} layout (furnished)`);
  });

  it("uses engine-owned template labels in confirmation and cancellation copy", async () => {
    resetStore(furnished2br());
    const messages: string[] = [];
    const ui = testUi(async (message) => {
      messages.push(message);
      return { accepted: false, reason: "declined" as const };
    });
    const result = await registry(ui).execute("apply_template", { template: "1br", furnished: false }, "test");
    expect(messages).toEqual(["Replace this home and its 23 placed items with the 1 bedroom layout?"]);
    expect(result).toEqual({ ok: false, error: "cancelled", detail: "The human declined the 1 bedroom layout." });
  });

  /**
   * The tool owns the question; the chrome owns how it is worded for a human (src/ui/templates.ts).
   * A gate review caught those two apart — the humanizer still matched the tool's *previous* string,
   * so an agent's confirmation went out with the item count said twice. This feeds the humanizer the
   * message the live tool actually produces, so the pair cannot drift again without a red test.
   */
  it("the chrome rewrites the confirmation the live tool asks, whatever the tool asks", async () => {
    resetStore(furnished2br());
    // The agent's own path: apply_template is build-gated, so an agent reaches it via set_mode.
    hearthStore.getState().setMode("agent", "build");
    const messages: string[] = [];
    const ui = testUi(async (message) => {
      messages.push(message);
      return { accepted: false, reason: "declined" as const };
    });
    await registry(ui).execute("apply_template", { template: "5br", furnished: true }, "agent");
    const asked = messages[0];
    expect(asked).toBeDefined();
    // Rewritten, not passed through: the count belongs in the subtitle, not in the question.
    expect(humanizeConfirmMessage(asked ?? "")).toBe(templateConfirmMessage("5br"));
    expect(humanizeConfirmMessage(asked ?? "")).not.toBe(asked);
  });

  it.each(["home", "Entire home"])("set_view frames the home for %s without changing selection", async (focus) => {
    resetStore(furnished2br());
    const ui = testUi();
    const selection = structuredClone(hearthStore.getState().scene.meta.selection);
    const result = await registry(ui).execute("set_view", { view: "dollhouse", focus }, "test");
    expect(result).toMatchObject({
      ok: true,
      room: "living",
      view: "dollhouse",
      focus: { kind: "home", id: "home" },
      focus_name: "Entire home",
      hint: "Framing all 6 rooms; pass a room id to zoom back in.",
    });
    expect(ui.focus).toHaveBeenCalledWith({ kind: "home", id: "home" });
    expect(hearthStore.getState().scene.meta.selection).toEqual(selection);
    expect(hearthStore.getState().activity[0]?.summary).toBe("View → dollhouse, focus Entire home");
  });

  it.each([
    ["remove_furniture", { item: "missing-chair" }],
    ["set_colorway", { item: "missing-chair", colorway: "sage" }],
    ["apply_palette", { palette: "dusk", room: "missing-room" }],
    ["set_view", { focus: "missing-focus" }],
    ["load_variant", { variant: "missing", room: "living" }],
    ["clear_room", { room: "missing-room" }],
    ["cancel_preview", {}],
    ["create_room", { name: "Office", type: "office", width_cm: 300, depth_cm: 300, place: "east_of", relative_to: "missing-room" }],
    ["update_room", { room: "missing-room", width_cm: 300 }],
    ["add_opening", { room: "living", wall: "missing-wall", kind: "door" }],
    ["move_opening", { opening: "missing-opening", offset_cm: 10 }],
    ["remove_opening", { opening: "missing-opening" }],
  ] as const)("%s returns not_found with alternatives", async (name, input) => {
    resetStore(furnished2br());
    const result = await registry().execute(name, input, "test");
    expect(result).toMatchObject({ ok: false, error: "not_found" });
    expect(!result.ok && result.alternatives).toBeInstanceOf(Array);
    expect(!result.ok && (result.alternatives?.length ?? 0)).toBeLessThanOrEqual(3);
    expect(hearthStore.getState().activity).toHaveLength(1);
  });
});
