import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { TEMPLATE_IDS } from "@/src/engine/types";
import type { TemplateId } from "@/src/engine/types";
import { templateLabel } from "@/src/engine";

/** The biggest bedroom plan the engine ships: 2br today, 5br once the new templates land. */
const BIGGEST: TemplateId = [...TEMPLATE_IDS]
  .filter((id) => /^\d+br$/.test(id))
  .sort((a, b) => Number(a.replace("br", "")) - Number(b.replace("br", "")))
  .at(-1) ?? "2br";

/**
 * The camera, driven the way a person drives it: real pointer, wheel and key input over the canvas,
 * with the effective azimuth, pitch, zoom and pan read back through `window.__hearthStudio.camera()`
 * and `window.__hearth.project()` turning room centimetres into the client pixels the drags aim at.
 */

interface Point {
  x: number;
  y: number;
}

interface CameraSnapshot {
  azimuthDeg: number;
  pitchDeg: number;
  zoom: number;
  pan: Point;
  offHome: boolean;
  view: string;
  focus: string;
}

/**
 * The dev-only handles (src/scene/devBridge.ts). Declared as a cast target rather than on `Window`:
 * tests/e2e/interaction.spec.ts already augments the global `Window`, and two augmentations of the
 * same property do not merge.
 */
interface HearthWin {
  __hearth: {
    state: () => {
      scene: {
        rooms: { id: string; origin: Point; poly: Point[] }[];
        furniture: { id: string; pos: Point }[];
        meta: { yaw: string; view: string; template?: string; activeRoomId: string; selection: { itemId?: string; roomId?: string } };
      };
      applyTemplate: (source: string, id: string, furnished: boolean) => void;
      setActiveRoom: (source: string, roomId: string) => void;
      placeItem: (source: string, input: Record<string, unknown>) => { id: string };
      setView: (source: string, patch: Record<string, unknown>) => void;
    };
    item: (id: string) => { id: string; pos: Point } | undefined;
    selection: () => { itemId?: string; roomId?: string };
    project: (roomId: string, pos: Point, heightCm?: number) => Point | undefined;
    pick: (clientX: number, clientY: number) => string | undefined;
  };
  /** R3F's own state getter, with the camera snapshot hung off it (src/scene/Studio.tsx). */
  __hearthStudio: (() => { invalidate: () => void }) & { camera: () => CameraSnapshot };
}

/** A fixed point in the living room, off-centre so a turn of the camera actually moves it. */
const PROBE = { x: 260, y: 220 };
const SOFA = "sofa-endre";

// Software GL renders every frame on the CPU here, so one gesture costs far more wall clock than on
// a GPU (see tests/e2e/interaction.spec.ts). Correctness is the point; the waits are sized for that.
test.describe.configure({ timeout: 180_000 });

/** The projected near and far corners of the living room: the framing's position *and* its scale. */
async function frameKey(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const win = window as unknown as HearthWin;
    win.__hearthStudio().invalidate();
    const near = win.__hearth.project("living", { x: 0, y: 0 });
    const far = win.__hearth.project("living", { x: 520, y: 440 });
    return near && far ? `${near.x},${near.y},${far.x},${far.y}` : undefined;
  });
}

/**
 * Waits until the camera is genuinely at rest — position *and* framed scale.
 *
 * Sampling on a timer is not enough here. The canvas is `frameloop="demand"` and the three camera is
 * only written inside `useFrame`, so a projection that does not move can simply be one nobody has
 * redrawn. Worse, headless Chrome only produces a rendering opportunity when something asks for one:
 * with the page idle, `requestAnimationFrame` and the ResizeObserver that measures the floating
 * panels (src/scene/insets.ts) both stall, and the 600 ms reframe they trigger lands on the first
 * pointer event instead — in the middle of whatever gesture the test drives next.
 *
 * So each sample nudges the real mouse (an input event guarantees a frame), asks the root to draw,
 * and compares two room corners, which pins the framed half-height as well as the centre.
 */
async function settle(page: Page): Promise<void> {
  let last: string | undefined;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await page.mouse.move(700 + (attempt % 2), 460);
    await page.waitForTimeout(300);
    const key = await frameKey(page);
    if (key !== undefined && key === last) return;
    last = key;
  }
  throw new Error("the camera never settled");
}

async function openStudio(page: Page, furnished = false): Promise<void> {
  await page.goto("/?e2e=1");
  await page.waitForFunction(
    () => {
      const win = window as unknown as Partial<HearthWin>;
      return win.__hearth?.project("living", { x: 0, y: 0 }) !== undefined && win.__hearthStudio?.camera !== undefined;
    },
    undefined,
    { timeout: 30_000 },
  );
  await page.evaluate((withFurniture) => {
    (window as unknown as HearthWin).__hearth.state().applyTemplate("human", "2br", withFurniture);
  }, furnished);
  await settle(page);
}

function camera(page: Page): Promise<CameraSnapshot> {
  return page.evaluate(() => (window as unknown as HearthWin).__hearthStudio.camera());
}

function at(page: Page, pos: Point = PROBE): Promise<Point | undefined> {
  return page.evaluate((probe) => (window as unknown as HearthWin).__hearth.project("living", probe), pos);
}

/** A client point on an item's body that the studio's own pick agrees is that item. */
async function itemPoint(page: Page, itemId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const handle = (window as unknown as HearthWin).__hearth;
    const item = handle.item(id);
    if (!item) return undefined;
    for (const height of [30, 45, 20, 60, 10, 0]) {
      const candidate = handle.project("living", item.pos, height);
      if (candidate && handle.pick(candidate.x, candidate.y) === id) return candidate;
    }
    return undefined;
  }, itemId);
  expect(point, `a pickable point on ${itemId}`).toBeTruthy();
  return point as Point;
}

/** A client point over the canvas with no furniture under it and no floating chrome over it. */
async function background(page: Page): Promise<Point> {
  const point = await page.evaluate(() => {
    const handle = (window as unknown as HearthWin).__hearth;
    for (const y of [420, 500, 560, 640, 360]) {
      for (const x of [700, 620, 780, 540, 860]) {
        if (!handle.pick(x, y)) return { x, y };
      }
    }
    return undefined;
  });
  expect(point, "a background point over the canvas").toBeTruthy();
  return point as Point;
}

interface DragOptions {
  button?: "left" | "right" | "middle";
  shift?: boolean;
  steps?: number;
}

/** Presses at `from`, walks the pointer to `to` in small steps, releases. */
async function drag(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const steps = options.steps ?? 6;
  const button = options.button ?? "left";
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let step = 1; step <= steps; step += 1) {
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await page.waitForTimeout(24);
  }
  await page.waitForTimeout(120);
  await page.mouse.up({ button });
  if (options.shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(160);
}

test.describe("camera", () => {
  test("drags the background: the scene follows the pointer and the selection is untouched", async ({ page }) => {
    await openStudio(page);
    const start = await background(page);
    const before = await at(page);
    expect(before).toBeTruthy();

    await drag(page, start, { x: start.x + 120, y: start.y - 60 });

    const after = await at(page);
    expect(after).toBeTruthy();
    expect(Math.abs((after as Point).x - (before as Point).x - 120)).toBeLessThanOrEqual(3);
    expect(Math.abs((after as Point).y - (before as Point).y + 60)).toBeLessThanOrEqual(3);
    // A pan is not a selection: nothing was picked, and the room was not re-activated either.
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.selection().itemId)).toBeFalsy();
    const panned = await camera(page);
    expect(panned.offHome).toBe(true);
    expect(panned.azimuthDeg).toBeCloseTo(-45, 5);

    // A press that does not travel is still a click: it activates the room under it.
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setView("human", { focusRoomId: "bed-1" }));
    const click = await at(page);
    expect(click).toBeTruthy();
    await page.mouse.click((click as Point).x, (click as Point).y);
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.selection().roomId)).toBe("living");
  });

  test("orbits with the right button and with shift-drag, inside the pitch clamp", async ({ page }) => {
    await openStudio(page);
    const start = await background(page);

    await drag(page, start, { x: start.x - 100, y: start.y }, { button: "right" });
    const turned = await camera(page);
    // 100 px left ≈ 35° clockwise at 0.35°/px, and the pitch is untouched by a horizontal drag.
    expect(turned.azimuthDeg).toBeCloseTo(-10, 0);
    expect(turned.pitchDeg).toBeCloseTo(35.26, 1);

    await drag(page, start, { x: start.x, y: start.y + 80 }, { button: "right" });
    const tilted = await camera(page);
    expect(tilted.pitchDeg).toBeGreaterThan(turned.pitchDeg + 15);
    expect(tilted.azimuthDeg).toBeCloseTo(turned.azimuthDeg, 1);

    // The clamp holds at both ends whatever the drag asks for. Both drags stay inside the canvas:
    // the top bar, the welcome card and the prompt bar all take pointer events of their own.
    const top = { x: start.x, y: 320 };
    const bottom = { x: start.x, y: 780 };
    await drag(page, top, bottom, { button: "right", steps: 10 });
    expect((await camera(page)).pitchDeg).toBeCloseTo(75, 5);
    await drag(page, bottom, top, { button: "right", steps: 10 });
    expect((await camera(page)).pitchDeg).toBeCloseTo(15, 5);

    // Shift + left button is the same gesture for anyone without a right button.
    const before = (await camera(page)).azimuthDeg;
    await drag(page, start, { x: start.x + 90, y: start.y }, { shift: true });
    const shifted = await camera(page);
    expect(shifted.azimuthDeg).toBeLessThan(before - 20);
  });

  test("zooms with the wheel and re-homes on double-click and on 0", async ({ page }) => {
    await openStudio(page);
    const point = await background(page);

    await page.mouse.move(point.x, point.y);
    await page.mouse.wheel(0, -240);
    await page.waitForTimeout(200);
    const zoomed = await camera(page);
    expect(zoomed.zoom).toBeGreaterThan(1.1);
    expect(zoomed.offHome).toBe(true);

    await page.mouse.dblclick(point.x, point.y);
    await page.waitForTimeout(900);
    const rehomed = await camera(page);
    expect(rehomed.zoom).toBe(1);
    expect(rehomed.offHome).toBe(false);

    await drag(page, point, { x: point.x + 80, y: point.y - 40 }, { button: "right" });
    expect((await camera(page)).offHome).toBe(true);
    await page.keyboard.press("0");
    await page.waitForTimeout(900);
    const reset = await camera(page);
    expect(reset.offHome).toBe(false);
    expect(reset.azimuthDeg).toBeCloseTo(-45, 5);
    expect(reset.pitchDeg).toBeCloseTo(35.26, 1);
  });

  test("steps the 45° stops: the south elevation, then the next corner", async ({ page }) => {
    await openStudio(page);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.yaw)).toBe("sw");

    await page.keyboard.press("]");
    await page.waitForTimeout(900);
    // The face-on elevation is not a corner: the scene keeps its yaw and the camera holds the offset.
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.yaw)).toBe("sw");
    expect((await camera(page)).azimuthDeg).toBeCloseTo(0, 5);

    await page.keyboard.press("]");
    await page.waitForTimeout(900);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.yaw)).toBe("se");
    const corner = await camera(page);
    expect(corner.azimuthDeg).toBeCloseTo(45, 5);
    expect(corner.offHome).toBe(false);

    // The top bar's buttons are the same command, and they step back the other way.
    await page.getByRole("button", { name: "Rotate the view 45° counter-clockwise" }).click();
    await page.waitForTimeout(900);
    expect((await camera(page)).azimuthDeg).toBeCloseTo(0, 5);
  });

  test("re-homes an orbited camera when the agent sets the view", async ({ page }) => {
    await openStudio(page);
    const point = await background(page);
    await drag(page, point, { x: point.x - 120, y: point.y + 60 }, { button: "right" });
    await page.mouse.wheel(0, -180);
    await page.waitForTimeout(200);
    expect((await camera(page)).offHome).toBe(true);

    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setView("human", { yaw: "ne" }));
    await page.waitForTimeout(900);
    const framed = await camera(page);
    expect(framed.offHome).toBe(false);
    expect(framed.azimuthDeg).toBeCloseTo(135, 5);
    expect(framed.zoom).toBe(1);
  });

  test("plan view stays north-up: no orbit, and the rotate buttons say why", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("radio", { name: "Plan", exact: true }).click();
    await settle(page);
    expect((await camera(page)).view).toBe("plan");

    const rotate = page.getByRole("button", { name: "Rotate the view 45° clockwise" });
    await expect(rotate).toBeDisabled();
    await expect(rotate).toHaveAttribute("title", "Plan view is always north-up");

    const point = await background(page);
    await drag(page, point, { x: point.x - 100, y: point.y + 60 }, { button: "right" });
    const planned = await camera(page);
    // An orbit gesture pans instead: plan view is north-up by definition.
    expect(planned.azimuthDeg).toBe(0);
    expect(planned.pitchDeg).toBeCloseTo(90, 5);
    expect(Math.hypot(planned.pan.x, planned.pan.y)).toBeGreaterThan(0);

    await page.keyboard.press("]");
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.yaw)).toBe("sw");
  });

  test("still drags furniture (regression)", async ({ page }) => {
    await openStudio(page);
    await page.evaluate((catalogId) => {
      (window as unknown as HearthWin).__hearth.state().placeItem("human", {
        catalogId, roomId: "living", pos: { x: 260, y: 220 }, rotation: 0, colorway: "sage",
      });
    }, SOFA);
    await page.waitForFunction(() => (window as unknown as HearthWin).__hearth.item("sofa-1") !== undefined);
    await settle(page);

    const grab = await page.evaluate(() => {
      const handle = (window as unknown as HearthWin).__hearth;
      const item = handle.item("sofa-1");
      if (!item) return undefined;
      for (const height of [0, 15, 30, 45, 60]) {
        const candidate = handle.project("living", item.pos, height);
        if (candidate && handle.pick(candidate.x, candidate.y) === "sofa-1") return candidate;
      }
      return undefined;
    });
    expect(grab, "a pickable point on the sofa").toBeTruthy();
    const target = await at(page, { x: 262, y: 60 });
    await drag(page, grab as Point, target as Point, { steps: 8 });
    await page.waitForTimeout(400);

    const moved = await page.evaluate(() => (window as unknown as HearthWin).__hearth.item("sofa-1"));
    expect(moved?.pos.y).toBeLessThan(160);
    // The camera never moved: a press on furniture belongs to the furniture.
    expect((await camera(page)).offHome).toBe(false);
  });

  test("layouts: every template, the confirmation, the swap and the undo", async ({ page }) => {
    await openStudio(page, true);
    await page.getByRole("button", { name: "Layouts", exact: true }).click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toContainText("Start from a floor plan");
    for (const id of TEMPLATE_IDS) {
      await expect(page.getByRole("button", { name: `Apply the ${templateLabel(id)} layout` })).toBeVisible();
    }
    await expect(sheet).toContainText("Current");

    await page.getByRole("button", { name: "Apply the 1 bedroom layout" }).click();
    // The chooser steps aside so the confirmation gate owns the page.
    await expect(page.getByRole("dialog")).toContainText("Replace this home");
    await page.getByRole("button", { name: /replace it/i }).click();
    await page.waitForTimeout(600);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.template)).toBe("1br");

    // The receipt offers the undo; the toast auto-dismisses after 5 s, so the assertion is that it
    // is there and the click goes to the top bar's Undo, which unwinds the same single step.
    const notifications = page.getByLabel("Studio notifications");
    await expect(notifications.getByText("1BR template applied")).toBeVisible();
    await expect(notifications.getByRole("button", { name: "Undo" })).toBeVisible();
    await page.locator("header").getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(600);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.template)).toBe("2br");
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.furniture.length)).toBeGreaterThan(0);
  });

  test("frames the entire home when a layout is applied, then follows the human back into a room", async ({ page }) => {
    await openStudio(page);
    // The agent's `apply_template` and the Layouts sheet both land here: one receipt, one rule.
    await page.evaluate((id) => (window as unknown as HearthWin).__hearth.state().applyTemplate("human", id, true), BIGGEST);
    await settle(page);

    expect((await camera(page)).focus).toBe("home");
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.template)).toBe(BIGGEST);

    // Every room in the plan the human just chose is on screen — that is what "entire home" means.
    const missed = await page.evaluate(() => {
      const win = window as unknown as HearthWin;
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return win.__hearth.state().scene.rooms
        .map((room) => {
          const xs = room.poly.map((point) => point.x);
          const ys = room.poly.map((point) => point.y);
          const centre = {
            x: (Math.min(...xs) + Math.max(...xs)) / 2,
            y: (Math.min(...ys) + Math.max(...ys)) / 2,
          };
          const projected = win.__hearth.project(room.id, centre);
          const inside = projected !== undefined
            && projected.x > rect.left && projected.x < rect.right
            && projected.y > rect.top && projected.y < rect.bottom;
          return inside ? undefined : room.id;
        })
        .filter((id): id is string => id !== undefined);
    });
    expect(missed).toEqual([]);

    // Activating a room is the human saying "that one": the whole-home shot lets go.
    const last = await page.evaluate(() => {
      const rooms = (window as unknown as HearthWin).__hearth.state().scene.rooms;
      return rooms[rooms.length - 1]!.id;
    });
    await page.evaluate((id) => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", id), last);
    await settle(page);
    const framed = await camera(page);
    expect(framed.focus).toBe("room");
    expect(framed.offHome).toBe(false);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta.activeRoomId)).toBe(last);

    // H is the way back, and out again.
    await page.keyboard.press("h");
    await settle(page);
    expect((await camera(page)).focus).toBe("home");
    await page.keyboard.press("h");
    await page.waitForTimeout(300);
    expect((await camera(page)).focus).toBe("room");
  });

  test("the room switcher offers the entire home, and lets go of it", async ({ page }) => {
    // `openStudio` applies a template, so the studio opens on the whole-home shot — the point of
    // the feature: you see the plan you just chose.
    await openStudio(page);
    const trigger = page.locator("header button[aria-haspopup]");
    await expect(trigger).toContainText("Entire home");
    expect((await camera(page)).focus).toBe("home");

    const rows = (): ReturnType<Page["getByRole"]> => page.getByRole("group", { name: "Rooms in this home" });
    await trigger.click();
    await rows().getByRole("button", { name: /^Living Room/ }).click();
    await settle(page);
    expect((await camera(page)).focus).toBe("room");
    await expect(trigger).toContainText("Living Room");

    // The Entire home row selects...
    await trigger.click();
    await rows().getByRole("button", { name: /Entire home/ }).click();
    await settle(page);
    expect((await camera(page)).focus).toBe("home");
    await expect(trigger).toContainText("Entire home");

    // ...and the same row deselects, back to the room the human was in.
    await trigger.click();
    await rows().getByRole("button", { name: /Entire home/ }).click();
    await settle(page);
    expect((await camera(page)).focus).toBe("room");
    await expect(trigger).toContainText("Living Room");
  });

  test("a click on furniture after a background pan still selects", async ({ page }) => {
    // The camera store remembers the last gesture per pointer id so a pan is never also a click, and
    // a mouse reuses pointer id 1 for ever: a press on furniture must not inherit that veto.
    await openStudio(page, true);
    const point = await background(page);
    await drag(page, point, { x: point.x + 110, y: point.y - 40 });
    expect((await camera(page)).offHome).toBe(true);

    const sofa = await itemPoint(page, "sofa-1");
    await page.mouse.click(sofa.x, sofa.y);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.selection().itemId)).toBe("sofa-1");
  });

  test("shift-drag that starts on furniture orbits and leaves the item alone", async ({ page }) => {
    await openStudio(page, true);
    const before = await camera(page);
    const sofa = await itemPoint(page, "sofa-1");
    const at = () => page.evaluate(() => (window as unknown as HearthWin).__hearth.item("sofa-1")?.pos);
    const posBefore = await at();

    await drag(page, sofa, { x: sofa.x + 120, y: sofa.y - 10 }, { shift: true, steps: 10 });

    expect(await at(), "shift is the orbit gesture, wherever it starts").toEqual(posBefore);
    expect(Math.abs((await camera(page)).azimuthDeg - before.azimuthDeg)).toBeGreaterThan(20);
  });

  test("a plan-view room label does not eat the pan", async ({ page }) => {
    await openStudio(page);
    await page.getByRole("radio", { name: "Plan", exact: true }).click();
    await settle(page);
    const label = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("span")].filter((node) => /m²/.test(node.textContent ?? ""));
      const node = nodes[0];
      if (!node) return undefined;
      const rect = node.getBoundingClientRect();
      const point = { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
      return { point, tag: document.elementFromPoint(point.x, point.y)?.tagName };
    });
    expect(label, "a plan-view room label").toBeTruthy();
    // drei only forwards `pointerEvents` to its inner div in `transform` mode, so the wrapper has to
    // be told as well — otherwise the canvas never sees the press.
    expect(label?.tag).toBe("CANVAS");

    const before = await camera(page);
    await drag(page, label!.point, { x: label!.point.x + 70, y: label!.point.y + 30 });
    const after = await camera(page);
    expect(Math.hypot(after.pan.x - before.pan.x, after.pan.y - before.pan.y)).toBeGreaterThan(0.5);
  });

  test("re-picking the active room re-homes an orbited camera", async ({ page }) => {
    await openStudio(page);
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "bed-1"));
    await settle(page);
    expect((await camera(page)).focus).toBe("room");

    const point = await background(page);
    await drag(page, point, { x: point.x - 100, y: point.y + 40 }, { button: "right" });
    expect((await camera(page)).offHome).toBe(true);

    // Asking for the shot you already have is still asking for it (`focusToken` in scene/focus.ts).
    const trigger = page.locator("header button[aria-haspopup]");
    await trigger.click();
    await page.getByRole("group", { name: "Rooms in this home" }).getByRole("button", { name: /^Main Bedroom/ }).click();
    await page.waitForTimeout(1200);
    expect((await camera(page)).offHome).toBe(false);
  });

  test("Space and drag pans from anywhere, furniture included", async ({ page }) => {
    // The hand tool: a furnished room leaves almost no bare floor to start a pan on, so holding
    // Space makes every pixel of the canvas draggable — and the sofa under the pointer stays put.
    await openStudio(page, true);
    expect(await page.evaluate(() => (document.querySelector("canvas") as HTMLCanvasElement).style.cursor)).toBe("grab");

    const sofa = await itemPoint(page, "sofa-1");
    const at = () => page.evaluate(() => (window as unknown as HearthWin).__hearth.item("sofa-1")?.pos);
    const posBefore = await at();
    const before = await camera(page);

    await page.keyboard.down("Space");
    await page.waitForTimeout(120);
    await page.mouse.move(sofa.x, sofa.y);
    await page.mouse.down();
    for (let step = 1; step <= 8; step += 1) {
      // Space is let go halfway: a gesture finishes as the one it started as.
      if (step === 4) await page.keyboard.up("Space");
      await page.mouse.move(sofa.x + step * 14, sofa.y - step * 6);
      await page.waitForTimeout(24);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);

    const after = await camera(page);
    expect(await at(), "the hand tool never moves furniture").toEqual(posBefore);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.selection().itemId)).toBeFalsy();
    expect(Math.hypot(after.pan.x - before.pan.x, after.pan.y - before.pan.y)).toBeGreaterThan(0.5);
    expect(after.azimuthDeg, "Space pans, it does not orbit").toBeCloseTo(before.azimuthDeg, 3);
  });

  test("Space on a focused control still activates it", async ({ page }) => {
    // The hand tool must never swallow the key a keyboard uses to press a button.
    await openStudio(page);
    await page.getByRole("button", { name: "Layouts", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog")).toContainText("Start from a floor plan");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the first pan of a browser explains the camera, once", async ({ page }) => {
    // Deliberately *not* `?e2e=1`: the hint suppresses itself for the suite, so the only honest way
    // to check that it appears at all is a plain visit — which is how it went unseen for a round.
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("hearth.onboarding.v1", "dismissed");
        window.localStorage.removeItem("hearth.camera.hint");
      } catch {
        // A blocked localStorage only means the welcome card shows; nothing here depends on it.
      }
    });
    await page.goto("/");
    await expect(page.locator('[data-studio="canvas"]')).toBeVisible({ timeout: 60_000 });
    await page.waitForTimeout(6000);

    const notifications = page.getByLabel("Studio notifications");
    await expect(notifications).toHaveText("");

    const spot = await page.evaluate(() => {
      const rect = document.querySelector("canvas")!.getBoundingClientRect();
      return { x: Math.round(rect.width * 0.5), y: Math.round(rect.height * 0.78) };
    });
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(spot.x + step * 15, spot.y - step * 7);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();

    await expect(notifications).toContainText("Hold Space and drag to pan from anywhere");
    await expect(notifications).toContainText("Shift-drag to orbit");
    // Once per browser: a second pan says nothing.
    await page.waitForTimeout(6000);
    await page.mouse.move(spot.x, spot.y);
    await page.mouse.down();
    for (let step = 1; step <= 6; step += 1) {
      await page.mouse.move(spot.x - step * 15, spot.y + step * 7);
      await page.waitForTimeout(40);
    }
    await page.mouse.up();
    await page.waitForTimeout(700);
    await expect(notifications).toHaveText("");
  });

  test("keeps the console clean through a pan, an orbit and a zoom", async ({ page }) => {
    const problems: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    await openStudio(page);
    const point = await background(page);
    await drag(page, point, { x: point.x + 90, y: point.y - 40 });
    await drag(page, point, { x: point.x - 90, y: point.y + 40 }, { button: "right" });
    await page.mouse.wheel(0, -160);
    await page.keyboard.press("0");
    await page.waitForTimeout(900);

    // Swiftshader's software GL emits performance notices; they are the harness, not the page.
    const unexpected = problems.filter(
      (entry) => !/THREE\.Clock|Hearth WebMCP|Download the React DevTools|modelContext|GL Driver Message|WebGL-0x/.test(entry),
    );
    expect(unexpected).toEqual([]);
  });
});
