import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { catalogSource } from "../../data/catalog.source";

/**
 * Wow pass B: the fallback Hearth Assistant, the first-run choreography and the re-rendered
 * thumbnails. The assistant is exercised through `?webmcp=polyfill`, so the tools it calls are the
 * ones an agent would find on `document.modelContext` — no internal shortcut.
 *
 * `/api/assistant` is stubbed with a canned stream in its own SSE contract: the panel, the real
 * client loop and the real tool execution all run, deterministically and without spending a model
 * call. The live round-trip is verified by hand (see the round-2 report).
 */

// Playwright runs from the repo root (playwright.config.ts lives there).
const REPO_ROOT = process.cwd();
const THUMB_DIR = path.join(REPO_ROOT, "public/assets/thumbs");
const ONBOARDING_KEY = "hearth.onboarding.v1";

async function openStudio(page: Page, opts: { dismissed?: boolean; query?: string } = {}): Promise<void> {
  if (opts.dismissed ?? true) {
    await page.addInitScript((key) => {
      try {
        window.localStorage.setItem(key, "dismissed");
      } catch {
        // A blocked localStorage only means the welcome card shows.
      }
    }, ONBOARDING_KEY);
  }
  await page.goto(`/${opts.query ?? ""}`);
  await expect(page.locator('[data-studio="canvas"]')).toBeVisible();
}

/**
 * A canned `/api/assistant` stream in the loop's own SSE contract (`src/assistant/loop.ts`): round
 * one says a sentence and asks for a tool, round two answers once the result is back.
 */
async function stubAssistant(page: Page, tool: { name: string; input: Record<string, unknown> }): Promise<void> {
  let round = 0;
  const block = (event: string, data: unknown): string => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  await page.route("**/api/assistant", async (route) => {
    round += 1;
    const body = round === 1
      ? block("text", { delta: "Arranging the room around the focal wall. " })
        + block("tool_call", { call_id: "call-1", name: tool.name, arguments: JSON.stringify(tool.input) })
        + block("done", { usage: null })
      : block("text", { delta: "That is the new layout." }) + block("done", { usage: null });
    await route.fulfill({ status: 200, headers: { "Content-Type": "text/event-stream" }, body });
  });
}

/** Opens the fallback assistant from the status chip's menu. */
async function openAssistant(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Agent options" }).click();
  await page.getByRole("button", { name: /Hearth Assistant \(fallback\)/ }).click();
  await expect(page.getByRole("heading", { name: "HEARTH ASSISTANT" })).toBeVisible();
}

/** Reads a PNG's pixel dimensions from its IHDR chunk. */
function pngSize(file: string): { width: number; height: number } {
  const header = readFileSync(file).subarray(16, 24);
  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

test.describe("the fallback Hearth Assistant", () => {
  test("runs a starter prompt through WebMCP and links the receipt it wrote", async ({ page }) => {
    await stubAssistant(page, { name: "arrange_room", input: { room: "living", style: "conversation" } });
    await openStudio(page, { query: "?webmcp=polyfill" });
    // The polyfill was asked for by the URL, so the chip must say polyfill rather than native.
    await expect(page.getByRole("button", { name: /Agent tools · \d+ ready · polyfill/ })).toBeVisible();

    await openAssistant(page);
    // Copy has to be honest about what this panel is, and about the guard the loop enforces.
    await expect(page.getByText(/this is the fallback/)).toBeVisible();
    await expect(page.getByText(/up to 60 tool calls per turn/)).toBeVisible();

    const starters = page.locator("[data-assistant-starter]");
    await expect(starters).toHaveCount(4);
    const prompt = (await starters.first().innerText()).replace(/[“”]/g, "").trim();
    await starters.first().click();

    // The human's own words, then a tool-call chip that names what happened and how long it took.
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    const chip = page.locator("[data-assistant-chip]").first();
    await expect(chip).toBeVisible({ timeout: 20_000 });
    await expect(chip).toContainText(/\d+ ms/);

    // Expanding shows the exact input and result, and points at the receipt row with the same id.
    await chip.click();
    await expect(page.getByText("Result", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: /Show receipt in the activity log/ }).click();

    // The activity log is back, focused on the row this call wrote — filed as the assistant's work,
    // not an agent's, because the loop executes through the registry with source "assistant".
    await expect(page.getByRole("heading", { name: "ACTIVITY" })).toBeVisible();
    const focused = page.locator("[data-receipt-id]:has(button:focus)");
    await expect(focused).toHaveCount(1);
    await expect(focused).toContainText("Assistant");
    await expect(focused).toContainText("arrange_room");
  });

  test("Escape closes the panel and ⌘↩ sends", async ({ page }) => {
    await stubAssistant(page, { name: "measure", input: { subject: "north" } });
    await openStudio(page, { query: "?webmcp=polyfill" });
    await openAssistant(page);

    const input = page.getByRole("textbox", { name: /Message the Hearth Assistant/ });
    await input.fill("Measure the north wall");
    await input.press("ControlOrMeta+Enter");
    await expect(page.getByText("Measure the north wall", { exact: true })).toBeVisible();
    await expect(page.locator("[data-assistant-chip]").first()).toBeVisible({ timeout: 20_000 });

    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "HEARTH ASSISTANT" })).toBeHidden();
    await expect(page.getByRole("heading", { name: "ACTIVITY" })).toBeVisible();
  });
});

test.describe("first run", () => {
  test("the welcome card lands after the settle and its dismissal persists", async ({ page }) => {
    await openStudio(page, { dismissed: false });

    const card = page.getByText("Your agent can see this room").or(page.getByText("No agent can see this room yet"));
    await expect(card).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Start designing" }).click();
    await expect(card).toBeHidden();

    await page.reload();
    await expect(page.locator('[data-studio="canvas"]')).toBeVisible();
    await expect(card).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_KEY)).toBe("dismissed");
  });

  test("Escape dismisses the welcome card, like every other overlay", async ({ page }) => {
    await openStudio(page, { dismissed: false });

    const card = page.getByText("Your agent can see this room").or(page.getByText("No agent can see this room yet"));
    await expect(card).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Escape");
    await expect(card).toBeHidden();
    expect(await page.evaluate((key) => window.localStorage.getItem(key), ONBOARDING_KEY)).toBe("dismissed");
  });

  test("hands the loading skeleton over to the canvas without a gap", async ({ page }) => {
    // Software rendering (swiftshader) blocks the main thread for several seconds compiling the
    // studio's first frame, and the curtain is meant to cover exactly that.
    test.slow();
    await openStudio(page);
    // The curtain is the loading plan held over the canvas until the first painted frame; the
    // hand-off is done once it has faded out (and it unmounts a beat later).
    const curtainOpacity = async (): Promise<number> => page.evaluate(() => {
      const node = document.querySelector('[data-studio="curtain"]');
      return node ? Number(window.getComputedStyle(node).opacity) : 0;
    });
    await expect.poll(curtainOpacity, { timeout: 45_000 }).toBe(0);
    await expect(page.locator('[data-studio="canvas"]')).toBeVisible();
  });
});

test.describe("catalog thumbnails", () => {
  test("every catalog product has a 512×384 thumbnail on disk", () => {
    expect(catalogSource).toHaveLength(71);
    const missing: string[] = [];
    const wrongSize: string[] = [];
    for (const product of catalogSource) {
      const file = path.join(THUMB_DIR, `${product.id}.png`);
      if (!existsSync(file)) {
        missing.push(product.id);
        continue;
      }
      const { width, height } = pngSize(file);
      if (width !== 512 || height !== 384) wrongSize.push(`${product.id} ${width}×${height}`);
    }
    expect(missing).toEqual([]);
    expect(wrongSize).toEqual([]);
  });

  test("the catalog renders them and the panel takes arrow keys", async ({ page }) => {
    await openStudio(page);
    const first = page.locator("[data-catalog-card]").first();
    await expect(first).toBeVisible();
    await expect(first.locator("img")).toHaveAttribute("src", /\/assets\/thumbs\/[a-z0-9-]+\.png/);

    const cards = page.locator("[data-catalog-select]");
    await cards.first().focus();
    await page.keyboard.press("ArrowDown");
    await expect(cards.nth(1)).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(cards.nth(0)).toBeFocused();

    // Enter places the focused card in the active room, which writes a receipt.
    await page.keyboard.press("Enter");
    await expect(page.getByText(/placed$/).first()).toBeVisible();
  });

  test("a search with no matches offers one filter to relax", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("searchbox", { name: "Search the catalog" }).fill("zzzzz");
    // Software rendering can hold the main thread through the studio's first frame, which delays
    // the search debounce; the assertion is about the state, not how fast it arrives.
    await expect(page.getByText("Nothing matches that yet.")).toBeVisible({ timeout: 30_000 });
    const suggestion = page.locator("[data-catalog-suggestion]");
    await expect(suggestion).toContainText("Clear");
    await suggestion.click();
    await expect(page.locator("[data-catalog-card]").first()).toBeVisible();
  });
});
