/**
 * Generates evals/mocks.json: realistic tool outputs for the furnished 2BR, produced by the real
 * handlers through the registry, so eval prompts can feed models believable context results.
 * Run: pnpm exec tsx scripts/evals/mocks.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";

class StaticModelContext extends EventTarget {
  async registerTool(): Promise<void> {}
  async getTools(): Promise<never[]> { return []; }
  async executeTool(): Promise<null> { return null; }
  ontoolchange = null;
}

const ui: ToolUi = {
  async confirm() { return { accepted: true, reason: "accepted" }; },
  focus() {},
  pulse() {},
  exportBoard() { return { items: 0, total_usd: 0, size_px: "1600x1000" }; },
};

const CALLS: Array<[string, string, unknown]> = [
  ["scene_summary", "get_scene_summary", {}],
  ["room_living", "get_room_details", { room: "living" }],
  ["room_bed1", "get_room_details", { room: "bed-1" }],
  ["room_bed2", "get_room_details", { room: "bed-2" }],
  ["room_kitchen", "get_room_details", { room: "kitchen" }],
  ["selection_none", "get_selection", {}],
  ["selection_sofa", "get_selection", { __select: "sofa-1" }],
  ["conflicts_bed1", "get_conflicts", { room: "bed-1" }],
  ["conflicts_living", "get_conflicts", { room: "living" }],
  ["measure_south", "measure", { subject: "south", room: "living" }],
  ["search_sofa_800", "search_catalog", { category: "sofa", max_price_usd: 800, room: "living" }],
  ["search_desk", "search_catalog", { category: "desk", style: "japandi", room: "bed-2" }],
  ["search_chair", "search_catalog", { category: "chair", style: "japandi", room: "bed-2" }],
  ["search_nook", "search_catalog", { query: "nook armchair" }],
  ["product_endre", "get_product", { product: "sofa-endre", room: "living" }],
  ["cart_empty", "get_cart", {}],
  ["report_living", "get_design_report", { room: "living" }],
];

async function main(): Promise<void> {
  const registry = createRegistry({
    modelContext: new StaticModelContext() as never,
    store: hearthStore,
    ui,
    shopify: createLocalShopify(hearthStore.getState().catalog),
  });
  const out: Record<string, unknown> = {};
  for (const [key, name, input] of CALLS) {
    const sel = (input as { __select?: string }).__select;
    if (sel) {
      hearthStore.getState().setSelection("human", { itemId: sel, roomId: "living" });
      out[key] = await registry.execute(name, {}, "test");
      hearthStore.getState().setSelection("human", { itemId: undefined, roomId: undefined });
      continue;
    }
    out[key] = await registry.execute(name, input, "test");
  }
  await mkdir(resolve("evals"), { recursive: true });
  await writeFile(resolve("evals/mocks.json"), `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(`wrote evals/mocks.json (${Object.keys(out).length} mocks)`);
}
main().catch((error) => { console.error(error); process.exit(1); });
