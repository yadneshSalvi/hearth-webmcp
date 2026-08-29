import { describe, expect, it } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolResult } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";
import { furnished2br } from "../fixtures/scenes";
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

function registry() {
  return createRegistry({
    modelContext: new EmptyModelContext(),
    store: hearthStore,
    ui: testUi(),
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
  { name: "apply_template", input: () => ({ template: "studio", furnished: false }), summary: "Applied Studio template", verify: (result) => expect(result).toMatchObject({ ok: true, template: "studio", rooms: ["studio", "bath"] }) },
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
