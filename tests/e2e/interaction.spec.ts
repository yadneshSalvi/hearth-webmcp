import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Direct-manipulation end-to-end checks. Every gesture is driven with real pointer and keyboard
 * input over the canvas; state is read back through the dev-only `window.__hearth` handle, which
 * also projects room-local centimetres to client pixels so the drags aim at exact targets.
 */

interface Point {
  x: number;
  y: number;
}

interface ItemSnapshot {
  id: string;
  pos: Point;
  rotation: number;
  roomId: string;
}

declare global {
  interface Window {
    __hearth?: {
      state: () => {
        scene: { furniture: ItemSnapshot[]; meta: { selection: { itemId?: string } } };
        ui: { dragging?: { valid: boolean; reason?: string } };
        applyTemplate: (source: string, id: string, furnished: boolean) => void;
        placeItem: (source: string, input: Record<string, unknown>) => ItemSnapshot;
        setSelection: (source: string, selection: Record<string, unknown>) => void;
      };
      item: (id: string) => ItemSnapshot | undefined;
      selection: () => { itemId?: string };
      toasts: () => { tone: string; title: string }[];
      pose: () => { pos: Point; rotation: number; valid: boolean; reason?: string; dims: unknown[]; guides: unknown[] } | undefined;
      project: (roomId: string, pos: Point, heightCm?: number) => Point | undefined;
      hoveredRoom: () => string | undefined;
      draggingItem: () => string | undefined;
      pick: (clientX: number, clientY: number) => string | undefined;
    };
  }
}

const SOFA = { catalogId: "sofa-endre", height: 85 };

/**
 * The camera tweens for 600 ms after a view or room change, so a projection taken mid-tween points
 * somewhere else by the time the pointer arrives. Waits until two samples 250 ms apart agree.
 */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    async () => {
      const first = window.__hearth?.project("living", { x: 260, y: 220 });
      if (!first) return false;
      await new Promise((resolve) => setTimeout(resolve, 250));
      const second = window.__hearth?.project("living", { x: 260, y: 220 });
      return second !== undefined && second.x === first.x && second.y === first.y;
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Loads the studio, waits for the canvas handle and leaves one sofa alone in an empty 2BR. */
async function openStudio(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => window.__hearth !== undefined && window.__hearth.project("living", { x: 0, y: 0 }) !== undefined, undefined, { timeout: 30_000 });
  await page.evaluate((catalogId) => {
    const store = window.__hearth!.state();
    store.applyTemplate("human", "2br", false);
    store.placeItem("human", { catalogId, roomId: "living", pos: { x: 260, y: 220 }, rotation: 0, colorway: "sage" });
  }, SOFA.catalogId);
  await page.waitForFunction(() => window.__hearth?.item("sofa-1") !== undefined);
  await settle(page);
}

async function at(page: Page, pos: Point, heightCm = 0): Promise<Point> {
  const point = await page.evaluate(
    ([x, y, h]) => window.__hearth!.project("living", { x: x as number, y: y as number }, h as number),
    [pos.x, pos.y, heightCm],
  );
  expect(point, `projection of ${pos.x},${pos.y}`).toBeTruthy();
  return point as Point;
}

/**
 * A client point the canvas's own picker agrees is over this item. Probing heights up the item's
 * body rather than assuming one keeps the drags aiming true whichever body the renderer chose
 * (GLB or the procedural stand-in) and whatever the camera is doing.
 */
async function grabPoint(page: Page, id = "sofa-1"): Promise<Point> {
  const found = await item(page, id);
  const point = await page.evaluate(
    ([entryId, x, y]) => {
      const handle = window.__hearth!;
      for (const height of [0, 15, 30, 45, 60]) {
        const candidate = handle.project("living", { x: x as number, y: y as number }, height);
        if (candidate && handle.pick(candidate.x, candidate.y) === entryId) return candidate;
      }
      return undefined;
    },
    [id, found.pos.x, found.pos.y] as [string, number, number],
  );
  expect(point, `a pickable point on ${id}`).toBeTruthy();
  return point as Point;
}

/** Presses on `from`, walks the pointer to `to` in small steps, and optionally releases. */
async function drag(page: Page, from: Point, to: Point, opts: { release?: boolean; steps?: number } = {}): Promise<void> {
  const steps = opts.steps ?? 6;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(120);
  if (opts.release !== false) {
    await page.mouse.up();
    await page.waitForTimeout(220);
  }
}

async function item(page: Page, id = "sofa-1"): Promise<ItemSnapshot> {
  const found = await page.evaluate((entryId) => window.__hearth!.item(entryId), id);
  expect(found, `item ${id}`).toBeTruthy();
  return found as ItemSnapshot;
}

// Software GL (swiftshader) renders every frame on the CPU, so a real drag over the canvas costs
// far more wall clock here than on a GPU: measured at ~630 ms per frame at 1440 × 900, where one
// drag needs several frames to walk the pointer path and settle on its snapped pose. Correctness is
// the point; every wait below is sized for that, not for a GPU.
test.describe.configure({ timeout: 180_000 });

/** One gesture's worth of frames on a CPU renderer. */
const GESTURE_TIMEOUT = 45_000;

test.describe("direct manipulation", () => {
  test("drags the sofa flush to the west wall and turns it to face the room", async ({ page }) => {
    await openStudio(page);
    const grab = await grabPoint(page);
    const target = await at(page, { x: 10, y: 220 });

    await drag(page, grab, target, { release: false });
    await page.waitForFunction(() => window.__hearth!.pose()?.rotation === 270, undefined, { timeout: GESTURE_TIMEOUT });
    const mid = await page.evaluate(() => window.__hearth!.pose());
    expect(mid?.valid).toBe(true);
    expect(mid?.dims.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => window.__hearth!.draggingItem())).toBe("sofa-1");

    await page.mouse.up();
    await page.waitForTimeout(300);

    const moved = await item(page);
    // sofa-endre is 220 × 95; turned to 270 its back sits flush on x = 0, so the centre is 47.5.
    expect(moved.pos.x).toBeCloseTo(47.5, 1);
    expect(moved.rotation).toBe(270);
    expect(moved.roomId).toBe("living");
    const activity = await page.evaluate(() => window.__hearth!.state().scene.furniture.length);
    expect(activity).toBe(1);
  });

  test("records exactly one undoable move per drag", async ({ page }) => {
    await openStudio(page);
    const before = await page.evaluate(() => window.__hearth!.state() as unknown as { activity: { title: string }[] });
    await drag(page, await grabPoint(page), await at(page, { x: 262, y: 60 }), { release: false });
    await page.waitForFunction(() => window.__hearth!.pose()?.valid === true, undefined, { timeout: GESTURE_TIMEOUT });
    await page.mouse.up();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__hearth!.state() as unknown as { activity: { title: string }[] });
    const moves = after.activity.filter((entry) => entry.title === "Move furniture").length
      - before.activity.filter((entry) => entry.title === "Move furniture").length;
    expect(moves).toBe(1);
  });

  test("springs an invalid position back and says why", async ({ page }) => {
    await openStudio(page);
    // The blocker goes north-east of the sofa: in dollhouse view anything to the south-west stands
    // between the camera and the sofa, and the pointer would grab the blocker instead.
    await page.evaluate(() => {
      window.__hearth!.state().placeItem("human", { catalogId: "wardrobe-hald", roomId: "living", pos: { x: 400, y: 80 }, rotation: 0, colorway: "oak" });
    });
    await settle(page);
    const start = await item(page);
    await drag(page, await grabPoint(page), await at(page, { x: 400, y: 80 }), { release: false });

    await page.waitForFunction(() => window.__hearth!.pose()?.valid === false, undefined, { timeout: GESTURE_TIMEOUT });
    const refused = await page.evaluate(() => window.__hearth!.pose());
    expect(refused?.reason).toBeTruthy();

    await page.mouse.up();
    await page.waitForTimeout(500);
    const after = await item(page);
    expect(after.pos).toEqual(start.pos);
    expect(after.rotation).toBe(start.rotation);
    // The reason has to reach the human, not just the queue: the studio had two toast systems and
    // only the one nothing rendered was being asserted here.
    const notifications = page.getByLabel("Studio notifications");
    await expect(notifications.getByText(/Cannot go there/)).toBeVisible();
  });

  test("announces removals in the live region the screen reader is already watching", async ({ page }) => {
    await openStudio(page);
    // The region exists before the first toast; a region created with its content is not announced.
    const notifications = page.getByLabel("Studio notifications");
    await expect(notifications).toBeAttached();

    await page.mouse.click((await grabPoint(page)).x, (await grabPoint(page)).y);
    await page.waitForTimeout(200);
    await page.keyboard.press("Delete");
    await expect(notifications.getByText(/Removed Endre Sofa/)).toBeVisible();
    expect(await page.evaluate(() => window.__hearth!.item("sofa-1"))).toBeFalsy();

    // Escape unwinds the page a layer at a time; with no overlay open, the toasts are the layer.
    await page.keyboard.press("Escape");
    await expect(notifications.getByText(/Removed Endre Sofa/)).toBeHidden();
    await expect(notifications).toBeAttached();
  });

  test("selects on click, rotates with R, nudges with arrows and deletes", async ({ page }) => {
    await openStudio(page);
    const body = await grabPoint(page);

    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => window.__hearth!.selection().itemId)).toBe("sofa-1");

    await page.keyboard.press("r");
    await page.waitForTimeout(250);
    expect((await item(page)).rotation).toBe(90);
    await page.keyboard.press("Shift+R");
    await page.waitForTimeout(250);
    expect((await item(page)).rotation).toBe(0);

    const before = await item(page);
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(150);
    expect((await item(page)).pos.x).toBeCloseTo(before.pos.x + 1, 1);
    await page.keyboard.press("Shift+ArrowDown");
    await page.waitForTimeout(150);
    expect((await item(page)).pos.y).toBeCloseTo(before.pos.y + 10, 1);

    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.__hearth!.selection().itemId)).toBeFalsy();

    await page.mouse.click(body.x, body.y);
    await page.waitForTimeout(200);
    await page.keyboard.press("Delete");
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => window.__hearth!.item("sofa-1"))).toBeFalsy();
  });

  test("leaves the arrows and Backspace to whatever control has focus", async ({ page }) => {
    await openStudio(page);
    await page.mouse.click((await grabPoint(page)).x, (await grabPoint(page)).y);
    await page.waitForTimeout(200);
    const before = await item(page);
    expect(await page.evaluate(() => window.__hearth!.selection().itemId)).toBe("sofa-1");

    // Focus a chrome control: the studio's single-key gestures belong to the canvas, and a focused
    // button owes its own keys — a toolbar needs the arrows, and Backspace must never delete a sofa.
    await page.getByRole("button", { name: "Export design board" }).focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Backspace");
    await page.waitForTimeout(250);

    const after = await item(page);
    expect(after.pos).toEqual(before.pos);
    expect(await page.evaluate(() => window.__hearth!.item("sofa-1"))).toBeTruthy();
  });

  test("shows a ghost while a catalog card is dragged over the canvas, then places it", async ({ page }) => {
    await openStudio(page);
    const target = await at(page, { x: 400, y: 120 });

    await page.evaluate(([x, y]) => {
      const transfer = new DataTransfer();
      transfer.setData("application/x-hearth-catalog", JSON.stringify({ catalogId: "armchair-kyst", colorway: "ochre" }));
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer };
      const source = document.createElement("div");
      document.body.appendChild(source);
      source.dispatchEvent(new DragEvent("dragstart", init));
      document.querySelector("canvas")!.dispatchEvent(new DragEvent("dragover", init));
      (window as unknown as { __transfer: DataTransfer }).__transfer = transfer;
    }, [target.x, target.y]);

    await page.waitForFunction(() => window.__hearth!.state().scene.furniture.some((entry) => entry.id === "ghost-1"), undefined, { timeout: GESTURE_TIMEOUT });
    const ghost = await page.evaluate(() => window.__hearth!.state().scene.furniture.find((entry) => entry.id === "ghost-1"));
    expect(ghost?.roomId).toBe("living");
    expect(await page.evaluate(() => window.__hearth!.pose()?.dims.length)).toBeGreaterThan(0);

    await page.evaluate(([x, y]) => {
      const transfer = (window as unknown as { __transfer: DataTransfer }).__transfer;
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: transfer };
      document.querySelector("canvas")!.dispatchEvent(new DragEvent("drop", init));
    }, [target.x, target.y]);
    await page.waitForTimeout(400);

    const placed = await page.evaluate(() => window.__hearth!.state().scene.furniture.map((entry) => entry.id));
    expect(placed).toContain("armchair-1");
    expect(placed).not.toContain("ghost-1");
    expect(await page.evaluate(() => window.__hearth!.selection().itemId)).toBe("armchair-1");
  });

  test("keeps the console clean through a whole gesture", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await openStudio(page);
    await drag(page, await grabPoint(page), await at(page, { x: 262, y: 60 }));
    await page.keyboard.press("r");
    await page.waitForTimeout(300);

    // Swiftshader's software GL emits performance notices; they are the harness, not the page.
    const unexpected = problems.filter(
      (entry) => !/THREE\.Clock|Hearth WebMCP|Download the React DevTools|modelContext|GL Driver Message|WebGL-0x/.test(entry),
    );
    expect(unexpected).toEqual([]);
  });
});
