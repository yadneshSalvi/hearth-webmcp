import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Studio chrome end-to-end. The WebMCP polyfill is injected before app code so the registry starts
 * in exactly the path a flagless browser takes, and the assertions read what an agent would find on
 * `document.modelContext` — not an internal mirror.
 */

const POLYFILL = "public/webmcp-polyfill.js";

test.use({ permissions: ["clipboard-read", "clipboard-write"] });

async function openStudio(page: Page): Promise<void> {
  await page.addInitScript({ path: POLYFILL });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("hearth.onboarding.v1", "dismissed");
    } catch {
      // A blocked localStorage only means the welcome card shows; the tests do not depend on it.
    }
  });
  await page.goto("/");
  await expect(page.locator('[data-studio="canvas"]')).toBeVisible();
  await expect(page.getByRole("button", { name: /Agent tools/ })).toBeVisible();
}

// `executeTool` ships in Chrome and in the polyfill but is not in `webmcp-types` yet, so each
// evaluate below describes the surface it calls.
async function toolNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const runtime = document.modelContext as unknown as {
      getTools(): Promise<{ name: string }[]>;
    };
    const tools = await runtime.getTools();
    return tools.map((tool) => tool.name).sort();
  });
}

/**
 * Native Chrome 151 rejects an object here with "Failed to parse input arguments" — `executeTool`
 * takes the arguments as a JSON string. The polyfill accepts both, so stringifying is what lets one
 * suite run against either runtime.
 */
async function runTool(page: Page, name: string, input: unknown): Promise<string> {
  return page.evaluate(async ([toolName, args]) => {
    const runtime = document.modelContext as unknown as {
      getTools(): Promise<{ name: string }[]>;
      executeTool(tool: unknown, args: unknown): Promise<unknown>;
    };
    const tools = await runtime.getTools();
    const tool = tools.find((candidate) => candidate.name === toolName);
    if (!tool) throw new Error(`Tool ${String(toolName)} is not registered`);
    const result = await runtime.executeTool(tool, args);
    return typeof result === "string" ? result : JSON.stringify(result);
  }, [name, JSON.stringify(input)] as const);
}

test.describe("studio chrome", () => {
  test("loads a furnished home with every panel and an honest status chip", async ({ page }) => {
    await openStudio(page);

    await expect(page.getByText("Hearth", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CATALOG" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "INSPECTOR" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "ACTIVITY" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "CART" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "Design" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();
    // The polyfill is in play, so the chip must say so rather than claiming native support — and it
    // still owes the human the number of tools an agent would find.
    await expect(page.getByRole("button", { name: /Agent tools · 26 ready · polyfill/ })).toBeVisible();
  });

  test("registers the 26 default tools and lists them with schemas", async ({ page }) => {
    await openStudio(page);

    await expect.poll(async () => (await toolNames(page)).length).toBe(26);
    const names = await toolNames(page);
    expect(names).toContain("get_scene_summary");
    expect(names).toContain("place_furniture");
    expect(names).toContain("export_design_board");
    expect(names).not.toContain("create_room");

    await page.getByRole("button", { name: /Agent tools/ }).click();
    const panel = page.getByRole("complementary", { name: "Agent tools registered on this page" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("button", { name: /^Copy the tool name/ })).toHaveCount(26);
    await expect(panel.getByRole("heading", { name: "Core" })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Design" })).toBeVisible();

    const schema = panel.locator("details").first();
    await schema.locator("summary").click();
    await expect(schema.locator("pre")).toContainText('"type": "object"');
  });

  test("switching to build mode registers the build tools", async ({ page }) => {
    await openStudio(page);
    await expect.poll(async () => (await toolNames(page)).length).toBe(26);

    await page.getByRole("radio", { name: "Build" }).click();
    await expect(page.getByText("editing walls")).toBeVisible();
    await expect.poll(async () => (await toolNames(page)).length).toBe(32);
    expect(await toolNames(page)).toContain("create_room");

    await page.getByRole("radio", { name: "Design" }).click();
    await expect.poll(async () => (await toolNames(page)).length).toBe(26);
  });

  test("clear_room round-trips through the in-page confirmation dialog", async ({ page }) => {
    await openStudio(page);
    await expect.poll(async () => (await toolNames(page)).length).toBe(26);

    // Declined: the dialog closes and the tool reports cancelled.
    const declined = runTool(page, "clear_room", { room: "living" });
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Clear Living Room and remove 7 items?");
    await dialog.getByRole("button", { name: "Keep" }).click();
    expect(await declined).toContain('"error":"cancelled"');
    await expect(dialog).toBeHidden();

    // Accepted: the room empties and the receipt log says who did it.
    const accepted = runTool(page, "clear_room", { room: "living" });
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Yes, clear it" }).click();
    const result = await accepted;
    expect(result).toContain('"ok":true');
    expect(result).toContain('"removed":7');
    await expect(page.getByText("Cleared Living Room")).toBeVisible();
  });

  test("Escape closes an overlay and the keyboard drives the camera", async ({ page }) => {
    await openStudio(page);

    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog")).toContainText("Keyboard");
    // A second ? must not stack a sheet on the one already at z-[60].
    await page.keyboard.press("Shift+Slash");
    await expect(page.getByRole("dialog")).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();

    await page.keyboard.press("1");
    await expect(page.getByRole("radio", { name: "Plan" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("2");
    await expect(page.getByRole("radio", { name: "Dollhouse" })).toHaveAttribute("aria-checked", "true");
  });

  test("a prompt chip copies its text for pasting into an agent", async ({ page }) => {
    await openStudio(page);

    const chip = page.locator("[data-prompt-chip]").first();
    const prompt = (await chip.innerText()).replace(/[“”]/g, "").trim();
    expect(prompt.length).toBeGreaterThan(10);

    await chip.click();
    await expect(chip).toContainText("Copied — paste into ChatGPT");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);
  });

  test("a stray native drag leaves the agent's preview and its tools alone", async ({ page }) => {
    await openStudio(page);
    await expect.poll(async () => (await toolNames(page)).length).toBe(26);

    const preview = await runTool(page, "preview_in_room", { product: "armchair-kyst", anchor: { centered: true } });
    expect(preview).toContain('"ok":true');
    // The preview gate opens confirm_preview and cancel_preview (TOOLS.md §2).
    await expect.poll(async () => (await toolNames(page)).length).toBe(28);

    // Dragging a text selection, an image or a file anywhere on the page fires these on window.
    await page.evaluate(() => {
      window.dispatchEvent(new DragEvent("dragleave", { bubbles: true, clientX: 0, clientY: 0 }));
      window.dispatchEvent(new DragEvent("dragend", { bubbles: true }));
    });
    await page.waitForTimeout(600);

    expect(await toolNames(page)).toContain("cancel_preview");
    await expect.poll(async () => (await toolNames(page)).length).toBe(28);
    expect(await page.evaluate(() => (window as unknown as { __hearthStore?: { getState(): { scene: { furniture: { status: string }[] } } } })
      .__hearthStore?.getState().scene.furniture.some((item) => item.status === "ghost"))).toBe(true);
  });

  test("gives the compact tier a readable prompt sheet", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openStudio(page);
    // Four chips in ~150 px rendered as four empty outlines; one button and a sheet do not.
    await expect(page.locator("[data-prompt-chip]")).toHaveCount(0);

    const trigger = page.getByRole("button", { name: "Prompts" });
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Ask your agent");

    const second = sheet.locator("[data-prompt-chip]").nth(1);
    const prompt = (await second.innerText()).replace(/[“”]/g, "").trim();
    expect(prompt.length).toBeGreaterThan(10);
    await second.click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(prompt);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    // Focus goes home to whatever opened the sheet, once, on close.
    await expect(trigger).toBeFocused();
  });

  test("keeps focus inside a sheet when something in it changes state", async ({ page }) => {
    // No polyfill: WebMCP is genuinely unavailable, which is what opens the enable sheet — the one
    // sheet whose own component re-renders on a state flip (its "copied" flash).
    await page.addInitScript(() => {
      try { window.localStorage.setItem("hearth.onboarding.v1", "dismissed"); } catch { /* noop */ }
    });
    await page.goto("/");
    await expect(page.locator('[data-studio="canvas"]')).toBeVisible();

    const trigger = page.getByRole("button", { name: /Agent tools/ });
    await expect(trigger).toHaveAccessibleName(/unavailable/);
    await trigger.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Let your agent see this room");

    const copy = sheet.getByRole("button", { name: /Copy the Chrome flag/ });
    await copy.click();
    // The flash re-renders the sheet's owner, so `onClose` is a new closure. If that tears the focus
    // trap down and rebuilds it, focus lands back on the chip and then on the sheet's first control.
    await expect(sheet.getByRole("button", { name: /Copied the flag URL/ })).toBeVisible();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toContain("Copied the flag URL");
    await expect(sheet).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("placing from the catalog writes a receipt and offers undo", async ({ page }) => {
    await openStudio(page);

    const card = page.getByRole("button", { name: /Endre Sofa/ }).first();
    await card.click();
    await page.getByRole("button", { name: "Place in Living Room" }).click();

    await expect(page.getByText("Endre Sofa placed")).toBeVisible();
    await expect(page.getByText("You placed Endre Sofa")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Endre Sofa" })).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).first().click();
    await expect(page.getByRole("heading", { name: "Living Room" })).toBeVisible();
    // A human undo is an action too, so it leaves a receipt of its own — the agent's undo tool did.
    await expect(page.getByText("You undid: placed Endre Sofa")).toBeVisible();
  });
});
