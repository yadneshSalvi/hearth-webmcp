import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { createLocalShopify } from "../../src/shopify/local";
import { hearthStore } from "../../src/state/store";
import type { ToolUi } from "../../src/tools/define";
import { createRegistry } from "../../src/tools/registry";

class StaticModelContext extends EventTarget implements WebMCP.ModelContext {
  ontoolchange: ((this: WebMCP.ModelContext, ev: Event) => unknown) | null = null;

  async registerTool(): Promise<void> {}

  async getTools(): Promise<WebMCP.RegisteredTool[]> {
    return [];
  }
}

const ui: ToolUi = {
  async confirm() {
    return { accepted: true, reason: "accepted" };
  },
  focus() {},
  pulse() {},
  exportBoard() {
    return { items: 0, total_usd: 0, size_px: "1600x1000" };
  },
};

async function exportTools(): Promise<void> {
  const registry = createRegistry({
    modelContext: new StaticModelContext(),
    store: hearthStore,
    ui,
    shopify: createLocalShopify(hearthStore.getState().catalog),
  });
  const tools = registry.list()
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema ?? {},
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  if (tools.length !== 40) throw new Error(`Expected 40 Hearth tools, found ${tools.length}.`);

  const output = resolve(process.cwd(), "evals/tools.json");
  const temporary = join(dirname(output), `.tools-${process.pid}.tmp`);
  await mkdir(dirname(output), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify({ tools }, null, 2)}\n`, "utf8");
    await rename(temporary, output);
  } finally {
    await unlink(temporary).catch(() => undefined);
  }
  console.log(`Exported ${tools.length} tools to ${output}`);
}

void exportTools().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Tool export failed.");
  process.exitCode = 1;
});
