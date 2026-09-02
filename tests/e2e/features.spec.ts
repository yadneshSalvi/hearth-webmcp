import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { meta, openStudio, runTool, settle } from "./studio-helpers";
import type { HearthWin } from "./studio-helpers";

/**
 * The Phase 8 features, driven both ways: the human through the chrome and the agent through the
 * registered WebMCP tools — resizing furniture, clearing and restoring the home, size-matched
 * shopping, anchored room resizes and building a home from a floor-plan image (the plan reader is
 * mocked at the network edge; the layout engine underneath is real).
 */

test.describe.configure({ timeout: 240_000 });

const PLAN_FIXTURE = resolve(process.cwd(), "tests/fixtures/floorplans/two-bed-deck.json");
const PLAN_IMAGE = resolve(process.cwd(), "public/home_plans/2-bed-residence-plan.jpg");

interface StoreWin extends HearthWin {
  __hearthStore: {
    getState(): {
      ui: { lastCleared?: { furniture: unknown[] }; uploadedPlan?: { name: string }; importSheetOpen?: boolean };
      scene: { furniture: Array<{ id: string; dims?: { w: number; d: number; h: number }; pos: { x: number; y: number } }>; rooms: Array<{ id: string; name: string; origin: { x: number; y: number }; poly: Array<{ x: number; y: number }> }>; openings: unknown[]; meta: { importedPlan?: { title: string } } };
      setUi(patch: Record<string, unknown>): void;
    };
  };
}

function item(page: Page, id: string) {
  return page.evaluate((itemId) => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.find((entry) => entry.id === itemId), id);
}

function roomBox(page: Page, id: string) {
  return page.evaluate((roomId) => {
    const room = (window as unknown as StoreWin).__hearthStore.getState().scene.rooms.find((entry) => entry.id === roomId);
    if (!room) return undefined;
    const xs = room.poly.map((point) => point.x);
    return { minX: room.origin.x + Math.min(...xs), maxX: room.origin.x + Math.max(...xs) };
  }, id);
}

/** Whether the camera is on the whole-home shot (a template apply leaves it there). */
async function framingHome(page: Page): Promise<boolean> {
  return (await page.evaluate(() => (window as unknown as HearthWin).__hearthStudio.camera().focus)) === "home";
}

/** Puts the inspector on the Entire home card (H toggles the whole-home shot). */
async function showHome(page: Page): Promise<void> {
  if (!(await framingHome(page))) await page.keyboard.press("h");
  await expect(page.getByRole("heading", { name: "Entire home" })).toBeVisible();
}

/** Puts the inspector on the active room's card. */
async function showRoom(page: Page, name: string): Promise<void> {
  if (await framingHome(page)) await page.keyboard.press("h");
  await expect(page.getByRole("heading", { name })).toBeVisible();
}

/** Answers the plan reader with a recorded reading, after a short delay so the sheet's reading state shows. */
async function mockPlanReader(page: Page): Promise<void> {
  const plan = JSON.parse(readFileSync(PLAN_FIXTURE, "utf8")) as unknown;
  await page.route("**/api/floorplan", async (route) => {
    await new Promise((done) => setTimeout(done, 400));
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, plan, ms: 400 }) });
  });
}

test.describe("resize furniture", () => {
  test("the agent stretches a sofa, the inspector shows and edits the new size, undo restores it", async ({ page }) => {
    await openStudio(page, { polyfill: true, furnished: true });
    const result = JSON.parse(await runTool(page, "resize_furniture", { item: "sofa-1", width_cm: 260, depth_cm: 100 })) as { ok: boolean; item: { dims: string; catalog_dims: string }; closest_product: { id: string } };
    expect(result.ok).toBe(true);
    expect(result.item).toMatchObject({ dims: "260x100x85", catalog_dims: "220x95x85" });
    expect(result.closest_product.id).toBeTruthy();
    expect((await item(page, "sofa-1"))?.dims).toEqual({ w: 260, d: 100, h: 85 });

    // The inspector reads the item's own size and offers the catalog size back.
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setSelection("human", { itemId: "sofa-1" }));
    const editor = page.locator("[data-size-editor]");
    await expect(editor).toBeVisible();
    await expect(editor.getByRole("spinbutton", { name: "Width" })).toHaveAttribute("aria-valuenow", "260");
    await expect(editor.getByText("Catalog size 220 × 95 × 85 cm")).toBeVisible();
    await editor.getByRole("button", { name: /Increase width by 5 cm/ }).click();
    await expect.poll(async () => (await item(page, "sofa-1"))?.dims?.w).toBe(265);
    await editor.getByRole("button", { name: "Reset to catalog size" }).click();
    await expect.poll(async () => (await item(page, "sofa-1"))?.dims).toBeUndefined();
    await expect(editor.getByText("As sold; nudge a side to stretch the model.")).toBeVisible();

    // A resized item is what the read tools describe.
    await runTool(page, "resize_furniture", { item: "sofa-1", scale_percent: 120 });
    const details = JSON.parse(await runTool(page, "get_room_details", { room: "living" })) as { items: string[] };
    expect(details.items.find((line) => line.startsWith("sofa-1"))).toMatch(/resized/);
    await runTool(page, "undo", { steps: 1 });
    expect((await item(page, "sofa-1"))?.dims).toBeUndefined();
  });

  test("the catalog ranks products by closeness to the selected item's size", async ({ page }) => {
    await openStudio(page, { polyfill: true, furnished: true });
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setSelection("human", { itemId: "sofa-1" }));
    await page.locator("[data-match-size]").click();
    const tags = page.locator("[data-size-match]");
    await expect(tags.first()).toBeVisible();
    await expect(tags.first()).toHaveAttribute("data-size-match", "exact");
    await expect(tags.first()).toHaveText("Same size");
    const search = JSON.parse(await runTool(page, "search_catalog", { like_item: "sofa-1", limit: 3 })) as { results: Array<{ id: string; dims_match: string }>; exact_match: boolean };
    expect(search.exact_match).toBe(true);
    expect(search.results[0]).toMatchObject({ id: "sofa-endre", dims_match: "exact" });
  });
});

test.describe("clear and restore", () => {
  test("clear_home asks first, empties every room, and the inspector restores the layout", async ({ page }) => {
    await openStudio(page, { polyfill: true, furnished: true });
    const before = await page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.length);
    expect(before).toBeGreaterThan(10);
    const pending = runTool(page, "clear_home", {});
    const dialog = page.getByRole("dialog", { name: /Clear the whole home and remove \d+ items\?/ });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("Your agent asked for this.")).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, clear it" }).click();
    const result = JSON.parse(await pending) as { ok: boolean; removed: number };
    expect(result).toMatchObject({ ok: true, removed: before });
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.length)).toBe(0);
    await expect(page.getByRole("button", { name: /Bring the furniture back/ })).toBeVisible();

    await showHome(page);
    const row = page.locator('[data-clear-restore="home"]');
    await expect(row.getByRole("button", { name: "Clear all furniture" })).toBeDisabled();
    await row.getByRole("button", { name: "Restore furniture" }).click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.length)).toBe(before);
    await expect(page.getByText(/^Restored \d+ items$/)).toBeVisible();
    const again = JSON.parse(await runTool(page, "restore_furniture", {})) as { ok: boolean; error?: string };
    expect(again).toMatchObject({ ok: false, error: "not_found" });
  });

  test("the human clears one room and the agent restores it", async ({ page }) => {
    await openStudio(page, { polyfill: true, furnished: true });
    const living = await page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.filter((entry) => (entry as { roomId?: string }).roomId === "living").length);
    await showRoom(page, "Living Room");
    await page.locator('[data-clear-restore="room"]').getByRole("button", { name: "Clear Living Room" }).click();
    const dialog = page.getByRole("dialog", { name: /Clear Living Room and remove \d+ items\?/ });
    await expect(dialog.getByText(/placed items will go/)).toBeVisible();
    await expect(dialog.getByText("Your agent asked for this.")).toHaveCount(0);
    await dialog.getByRole("button", { name: "Yes, clear it" }).click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.filter((entry) => (entry as { roomId?: string }).roomId === "living").length)).toBe(0);
    const restored = JSON.parse(await runTool(page, "restore_furniture", {})) as { ok: boolean; restored: number; rooms: string[] };
    expect(restored).toMatchObject({ ok: true, restored: living, rooms: ["living"] });
  });
});

test.describe("room resize", () => {
  test("update_room keeps the chosen corner and pushes the neighbours; the build panel does the same", async ({ page }) => {
    await openStudio(page, { polyfill: true, furnished: true });
    await runTool(page, "set_mode", { mode: "build" });
    const kitchenBefore = await roomBox(page, "kitchen");
    const result = JSON.parse(await runTool(page, "update_room", { room: "living", width_cm: 560 })) as { ok: boolean; room: { size_cm: string }; shifted_rooms: string[]; items_outside: string[] };
    expect(result).toMatchObject({ ok: true, room: { size_cm: "560x440" }, items_outside: [] });
    expect(result.shifted_rooms).toContain("kitchen");
    expect((await roomBox(page, "kitchen"))?.minX).toBe((kitchenBefore?.minX ?? 0) + 40);

    // The same change from the Rooms & openings panel, anchored on the north-east corner instead.
    await page.locator('[data-anchor-corner="ne"]').click();
    const width = page.getByRole("spinbutton", { name: "Width" }).first();
    await expect(width).toHaveAttribute("aria-valuenow", "560");
    await page.getByRole("button", { name: /Increase width by 20 cm/ }).first().click();
    await expect.poll(async () => (await roomBox(page, "living"))?.minX).toBe(-20);
    expect((await roomBox(page, "living"))?.maxX).toBe(560);
    await settle(page);
    expect((await meta(page)).mode).toBe("build");
  });
});

test.describe("floor-plan import", () => {
  test("the agent builds the home from the uploaded plan, furnished, and the studio frames it", async ({ page }) => {
    await mockPlanReader(page);
    await openStudio(page, { polyfill: true, furnished: true });
    await runTool(page, "set_mode", { mode: "build" });
    const missing = JSON.parse(await runTool(page, "import_floor_plan", {})) as { ok: boolean; error?: string };
    expect(missing).toMatchObject({ ok: false, error: "not_found" });

    await page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().setUi({
      uploadedPlan: { name: "2-bed-residence-plan.jpg", dataUrl: "data:image/jpeg;base64,/9j/4AAQ", width: 1000, height: 540, at: Date.now() },
    }));
    const pending = runTool(page, "import_floor_plan", { furnished: true });
    const dialog = page.getByRole("dialog", { name: /Replace this home and its \d+ placed items with the imported floor plan\?/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Yes, replace it" }).click();
    const result = JSON.parse(await pending) as { ok: boolean; rooms: Array<{ id: string }>; items: number; skipped: string[] };
    expect(result.ok).toBe(true);
    expect(result.rooms.map(({ id }) => id)).toEqual(["bed-1", "living", "bed-2", "dining", "kitchen", "bath", "bath-2"]);
    expect(result.items).toBeGreaterThan(0);
    expect(result.skipped).toEqual(["Deck (outdoor)"]);
    await settle(page);
    await expect.poll(() => framingHome(page)).toBe(true);
    await expect(page.getByRole("heading", { name: "Entire home" })).toBeVisible();
    const state = await page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene);
    expect(state.meta.importedPlan?.title).toContain("2 BHK");
    expect(state.openings.length).toBeGreaterThan(10);
  });

  test("the human imports through the sheet: drop, read, review, build", async ({ page }) => {
    await mockPlanReader(page);
    await openStudio(page, { polyfill: true, furnished: false });
    await page.getByRole("button", { name: "Layouts" }).click();
    await page.getByRole("button", { name: "Import your own plan" }).click();
    const sheet = page.getByRole("dialog", { name: "Import a floor plan" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Read the plan" })).toBeDisabled();
    await sheet.getByLabel("Choose a floor-plan image").setInputFiles(PLAN_IMAGE);
    await expect(sheet.getByAltText(/Your floor plan/)).toBeVisible();
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().ui.uploadedPlan?.name)).toBe("2-bed-residence-plan.jpg");
    await sheet.getByRole("button", { name: "Read the plan" }).click();
    await expect(sheet.getByText(/Reading room names/)).toBeVisible();
    const reading = sheet.locator("[data-plan-reading]");
    await expect(reading).toBeVisible();
    await expect(reading.getByText("M. Bedroom")).toBeVisible();
    await expect(reading.getByText("Left out: Deck (outdoor).")).toBeVisible();
    await sheet.getByRole("button", { name: "Build this home" }).click();
    await expect(sheet).toHaveCount(0);
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.rooms.length)).toBe(7);
    await expect(page.getByText(/Home built from 2-bed-residence-plan.jpg/)).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.furniture.length)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Undo" }).first().click();
    await expect.poll(async () => page.evaluate(() => (window as unknown as StoreWin).__hearthStore.getState().scene.rooms.length)).toBe(6);
  });
});
