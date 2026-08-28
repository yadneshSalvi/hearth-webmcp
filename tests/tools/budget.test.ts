import { describe, expect, it } from "vitest";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import { createRegistry } from "../../src/tools/registry";
import type { ToolError, ToolResult } from "../../src/tools/define";
import { allToolDefinitions, allTools } from "../../src/tools/handlers";
import { emptyHome, furnished2br, worstCase2br } from "../fixtures/scenes";
import { resetStore, testUi, toolContext } from "./helpers";

const allowedErrors = new Set<ToolError>([
  "blocked", "not_found", "invalid", "needs_confirmation", "cancelled", "unavailable",
]);

class EmptyModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;
  async registerTool(): Promise<void> {}
  async getTools(): Promise<WebMCP.RegisteredTool[]> { return []; }
}

function records(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function assertParamBudgets(schemaValue: unknown): void {
  const schema = records(schemaValue);
  if (!schema) return;
  const properties = records(schema.properties);
  if (properties) for (const [name, property] of Object.entries(properties)) {
    expect(name.length, name).toBeLessThanOrEqual(30);
    const propertySchema = records(property);
    if (typeof propertySchema?.description === "string") {
      expect(propertySchema.description.length, name).toBeLessThanOrEqual(150);
    }
    assertParamBudgets(property);
  }
  for (const value of Object.values(schema)) {
    if (Array.isArray(value)) value.forEach(assertParamBudgets);
  }
}

function representative(name: string): unknown {
  const state = hearthStore.getState();
  const firstItem = state.scene.furniture.find((item) => item.status === "placed");
  const firstOpening = state.scene.openings[0];
  switch (name) {
    case "get_scene_summary": return {};
    case "get_room_details": return { room: "living" };
    case "get_selection": return {};
    case "measure": return { subject: "north", room: "living" };
    case "get_conflicts": return { room: "all" };
    case "get_design_report": return { room: "living" };
    case "search_catalog": return { category: "sofa", max_price_usd: 800, fits_wall: "north", room: "living", limit: 6 };
    case "get_product": return { product: "sofa-endre", room: "living" };
    case "get_cart": return {};
    case "set_mode": return { mode: "design" };
    case "place_furniture": return { product: "chair-ida", room: "living", anchor: { wall: "north", along: "start" } };
    case "move_furniture": return { item: firstItem?.id ?? "sofa-1", delta_cm: { x: 5 } };
    case "remove_furniture": return { item: firstItem?.id ?? "sofa-1" };
    case "set_colorway": return { item: firstItem?.id ?? "sofa-1", colorway: "sage" };
    case "arrange_room": return { room: "living", style: "open", keep_locked: true };
    case "apply_palette": return { palette: "sage-linen", room: "living" };
    case "set_time_of_day": return { time: "evening" };
    case "set_view": return { view: "dollhouse", focus: "living", yaw: "sw" };
    case "set_accessibility_mode": return { enabled: true };
    case "undo": return { steps: 1 };
    case "save_variant": return { name: "Budget", room: "living" };
    case "load_variant": return { variant: "Missing", room: "living" };
    case "clear_room": return { room: "living" };
    case "preview_in_room": return { product: "chair-ida", room: "living", anchor: { wall: "north", along: "start" } };
    case "update_cart": return { action: "add", product: "sofa-liva", colorway: "sage", quantity: 1 };
    case "export_design_board": return { room: "living", title: "Budget board" };
    case "confirm_preview": {
      const product = state.catalog.find((candidate) => candidate.id === "chair-ida") ?? state.catalog[0];
      if (product) state.setGhost("agent", {
        id: "ghost-1", catalogId: product.id, roomId: state.scene.meta.activeRoomId,
        pos: { x: 200, y: 200 }, rotation: 0, colorway: product.colorways[0]?.id ?? "oak", status: "ghost",
      });
      hearthStore.setState({ activity: [] });
      return { add_to_cart: false };
    }
    case "cancel_preview": {
      const product = state.catalog[0];
      if (product) state.setGhost("agent", {
        id: "ghost-1", catalogId: product.id, roomId: state.scene.meta.activeRoomId,
        pos: { x: 200, y: 200 }, rotation: 0, colorway: product.colorways[0]?.id ?? "oak", status: "ghost",
      });
      hearthStore.setState({ activity: [] });
      return {};
    }
    case "compare_variants": {
      state.saveVariant("human", "living", "Budget A");
      const moved = state.scene.furniture.find((item) => item.roomId === "living" && item.status === "placed");
      if (moved) state.moveItem("human", moved.id, { pos: { x: moved.pos.x + 5, y: moved.pos.y } });
      state.saveVariant("human", "living", "Budget B");
      hearthStore.setState({ activity: [] });
      return { left: "Budget A", right: "Budget B", room: "living" };
    }
    case "get_checkout_link": return {};
    case "apply_template": return { template: "studio", furnished: true };
    case "create_room": return { name: "Budget Room", type: "office", width_cm: 300, depth_cm: 260 };
    case "update_room": return { room: "living", width_cm: 530 };
    case "add_opening": return { room: "living", wall: "south", kind: "window", width_cm: 40, offset_cm: "center" };
    case "move_opening": return { opening: firstOpening?.id ?? "door-1", offset_cm: "center" };
    case "remove_opening": return { opening: firstOpening?.id ?? "door-1" };
    default: return {};
  }
}

function assertEnvelope(result: ToolResult): void {
  expect(typeof result).toBe("object");
  expect(typeof result.ok).toBe("boolean");
  expect("content" in result).toBe(false);
  if (!result.ok) {
    expect(allowedErrors.has(result.error)).toBe(true);
    expect(result.detail.length).toBeGreaterThan(0);
  } else if (typeof result.hint === "string") {
    expect(result.hint.length).toBeLessThanOrEqual(120);
  }
}

describe("WebMCP budgets", () => {
  it("keeps every static definition inside Chrome metadata budgets", () => {
    const tools = allToolDefinitions(toolContext());
    for (const tool of tools) {
      expect(tool.name.length, tool.name).toBeLessThanOrEqual(30);
      expect(tool.description.length, tool.name).toBeLessThanOrEqual(500);
      expect(tool.inputSchema).toMatchObject({ type: "object", additionalProperties: false });
      expect(records(tool.inputSchema)?.$schema).toBeUndefined();
      assertParamBudgets(tool.inputSchema);
    }
  });

  it("keeps all 36 handler results within 1,500 characters on all three fixtures", async () => {
    for (const fixture of [emptyHome, furnished2br, worstCase2br]) {
      for (const definition of allTools(toolContext())) {
        const scene = fixture();
        if (fixture === worstCase2br && definition.name === "get_room_details") {
          scene.furniture = scene.furniture.map((item) => ({ ...item, roomId: "living" }));
        }
        resetStore(scene);
        const registry = createRegistry({
          modelContext: new EmptyModelContext(),
          store: hearthStore,
          ui: testUi(),
          shopify: createLocalShopify(hearthStore.getState().catalog),
        });
        const result = await registry.execute(definition.name, representative(definition.name), "test");
        assertEnvelope(result);
        expect(JSON.stringify(result).length, `${fixture.name}:${definition.name}`).toBeLessThanOrEqual(1500);
        expect(hearthStore.getState().activity).toHaveLength(1);
      }
    }
  });
});
