import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * The wow pass: the compare split view, the composed design board and the build-mode Rooms &
 * openings panel. Every tool call goes through `document.modelContext` exactly as an agent's would,
 * with the WebMCP polyfill injected before app code so the registry starts on the flagless path.
 */

const POLYFILL = "public/webmcp-polyfill.js";

async function openStudio(page: Page): Promise<void> {
  await page.addInitScript({ path: POLYFILL });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("hearth.onboarding.v1", "dismissed");
    } catch {
      // A blocked localStorage only means the welcome card shows; these tests do not depend on it.
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
    const runtime = document.modelContext as unknown as { getTools(): Promise<{ name: string }[]> };
    return (await runtime.getTools()).map((tool) => tool.name).sort();
  });
}

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
  }, [name, input] as const);
}

/** Saves two different layouts of the living room, so the variants group gates open. */
async function saveTwoVariants(page: Page): Promise<void> {
  expect(await runTool(page, "save_variant", { name: "Cosy" })).toContain('"ok":true');
  expect(await runTool(page, "move_furniture", { item: "sofa-1", delta_cm: { y: 120 } })).toContain('"ok":true');
  expect(await runTool(page, "remove_furniture", { item: "plant-1" })).toContain('"ok":true');
  expect(await runTool(page, "save_variant", { name: "Media wall" })).toContain('"ok":true');
  await expect.poll(async () => (await toolNames(page)).includes("compare_variants")).toBe(true);
}

test.describe("wow pass", () => {
  test("compare_variants opens the split view, Escape closes it, a layout change closes it", async ({ page }) => {
    await openStudio(page);
    await saveTwoVariants(page);

    const result = await runTool(page, "compare_variants", { left: "Cosy", right: "Media wall" });
    expect(result).toContain('"ok":true');
    expect(result).toContain('"left":"Cosy"');
    expect(result).toContain('"right":"Media wall"');
    expect(result).toContain('"moved"');

    const overlay = page.getByRole("dialog", { name: /Comparing Cosy with Media wall/ });
    await expect(overlay).toBeVisible();
    // Both variants are photographed before the split appears; the diff card names what changed.
    const slider = overlay.getByRole("slider", { name: /Split between Cosy and Media wall/ });
    await expect(slider).toBeVisible({ timeout: 45_000 });
    await expect(overlay.getByText("Only in Cosy")).toBeVisible();
    await expect(overlay.getByText("Only in Media wall")).toBeVisible();
    await expect(overlay.getByText("Moved", { exact: true })).toBeVisible();
    await expect(overlay.getByText("Cosy", { exact: true })).toBeVisible();

    // The slider takes the keyboard.
    await expect(slider).toHaveAttribute("aria-valuenow", "50");
    await slider.press("ArrowLeft");
    await expect(slider).toHaveAttribute("aria-valuenow", "48");
    await slider.press("Home");
    await expect(slider).toHaveAttribute("aria-valuenow", "0");

    // Escape closes it, and so does any layout change — even one made while it is still composing.
    await page.keyboard.press("Escape");
    await expect(overlay).toBeHidden();

    expect(await runTool(page, "compare_variants", { left: "Cosy", right: "Media wall" })).toContain('"ok":true');
    await expect(overlay).toBeVisible();
    const moved = await runTool(page, "move_furniture", { item: "sofa-1", delta_cm: { x: 20 } });
    expect(moved).toContain('"ok":true');
    await expect(overlay).toBeHidden();
    await expect(page.getByText("Comparing “Cosy” vs “Media wall”").first()).toBeVisible();

    // The move wins: putting the room back after a comparison must not undo it.
    const pos = (JSON.parse(moved) as { item: { pos: [number, number] } }).item.pos;
    const details = await runTool(page, "get_room_details", { room: "living" });
    expect(details).toContain(`@${pos[0]},${pos[1]}`);
  });

  test("export_design_board composes a 1600 × 1000 board and previews it", async ({ page }) => {
    await openStudio(page);

    const download = page.waitForEvent("download");
    const result = await runTool(page, "export_design_board", { room: "living" });
    expect(result).toContain('"ok":true');
    expect(result).toContain('"size_px":"1600x1000"');
    expect(result).toContain('"download":"started"');

    const board = JSON.parse(result) as { board: { title: string; items: number; total_usd: number } };
    expect(board.board.title).toBe("Living Room");
    expect(board.board.items).toBeGreaterThan(0);
    expect(board.board.total_usd).toBeGreaterThan(0);
    expect((await download).suggestedFilename()).toBe("hearth-living-room.png");

    // The same PNG opens in the preview modal, at the size the tool reported.
    const modal = page.getByRole("dialog", { name: "Living Room" });
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("1600 × 1000 px");
    const image = modal.getByRole("img", { name: /Design board for Living Room/ });
    await expect(image).toBeVisible();
    expect(await image.evaluate((node: HTMLImageElement) => [node.naturalWidth, node.naturalHeight])).toEqual([1600, 1000]);
    await expect(modal.getByRole("button", { name: "Download PNG" })).toBeVisible();

    // The board's own view switch left the studio where it found it, without a receipt.
    await expect(page.getByRole("radio", { name: "Dollhouse" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("You exported a design board")).toBeHidden();
    await expect(page.getByText("Exported design board · Living Room")).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(modal).toBeHidden();
  });

  test("the build panel adds a window on the north wall, with 32 tools registered", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("radio", { name: "Build" }).click();

    // Build mode registers the six build tools on top of the 26 defaults.
    await expect.poll(async () => (await toolNames(page)).length).toBe(32);
    await page.getByRole("button", { name: /Agent tools/ }).click();
    const tools = page.getByRole("complementary", { name: "Agent tools registered on this page" });
    await expect(tools.getByRole("button", { name: /^Copy the tool name/ })).toHaveCount(32);
    await expect(tools.getByRole("heading", { name: "Build" })).toBeVisible();
    await page.keyboard.press("Escape");

    await expect(page.getByRole("heading", { name: "ROOMS & OPENINGS" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "4 OPENINGS IN LIVING ROOM" })).toBeVisible();

    // The add form defaults to a window; put it on the north wall and commit it.
    await page.getByRole("radio", { name: "Window" }).click();
    await page.getByRole("group", { name: "Wall" }).last().getByRole("button", { name: /^North/ }).click();
    await page.getByRole("button", { name: /Add window on the north wall/ }).click();

    // The row, the section heading and the receipt are durable; the toast is not (it self-dismisses).
    await expect(page.getByRole("heading", { name: "5 OPENINGS IN LIVING ROOM" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Window · north wall 200 cm from start · 120 cm wide/ })).toBeVisible();
    await expect(page.getByText("You added window to Living Room")).toBeVisible();

    // The agent sees the same opening the human just made.
    const openings = await runTool(page, "get_room_details", { room: "living" });
    expect(openings).toContain("window-1");
  });

  test("the build panel renames and resizes a room through the store", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("radio", { name: "Build" }).click();
    await expect(page.getByRole("heading", { name: "ROOMS & OPENINGS" })).toBeVisible();

    const width = page.getByRole("spinbutton", { name: "Width" }).first();
    await expect(width).toHaveAttribute("aria-valuenow", "520");
    await width.press("ArrowUp");
    await expect(width).toHaveAttribute("aria-valuenow", "540");

    const name = page.getByLabel("Name").first();
    await name.fill("Front Room");
    await name.press("Enter");
    await expect(page.getByRole("button", { name: /Front Room/ }).first()).toBeVisible();
    await expect(page.getByText("You updated Front Room")).toBeVisible();
  });
});
