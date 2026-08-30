import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { TEMPLATE_IDS } from "@/src/engine/types";
import { templateLabel } from "@/src/engine";
import { background, camera, drag, emptyFloor, meta, openStudio, roomsOffScreen, runTool, settle } from "./studio-helpers";
import type { HearthWin } from "./studio-helpers";

/**
 * The Layouts chooser and the floor-plan templates behind it, driven the way a person drives them:
 * the top-bar sheet, the confirmation gate, the undo, and — the part a screenshot cannot promise —
 * that every item in the chosen plan is *rendered where the scene says it is*.
 */

// Software GL renders every frame on the CPU here, so one gesture costs far more wall clock than on
// a GPU. Correctness is the point; the waits are sized for that.
test.describe.configure({ timeout: 240_000 });

/** Every item's rendered footprint centre against the scene position it is supposed to hold. */
async function renderAudit(page: Page): Promise<{ displaced: string[]; missing: string[] }> {
  return page.evaluate(() => {
    const win = window as unknown as HearthWin;
    const three = (window as unknown as { __hearthStudio: () => { scene: { getObjectByName(name: string): unknown } } }).__hearthStudio();
    interface Node {
      name: string;
      type: string;
      children: Node[];
      geometry?: { boundingBox: { min: Vec; max: Vec } | null; computeBoundingBox(): void };
      matrixWorld: { elements: number[] };
      updateWorldMatrix(parents: boolean, children: boolean): void;
    }
    interface Vec { x: number; y: number; z: number }
    const group = three.scene.getObjectByName("furniture") as unknown as { children: Node[] } | undefined;
    const state = win.__hearth.state();
    const displaced: string[] = [];
    const missing: string[] = [];
    for (const item of state.scene.furniture) {
      const node = group?.children.find((child) => child.name === `item-${item.id}`);
      if (!node) {
        missing.push(item.id);
        continue;
      }
      node.updateWorldMatrix(true, true);
      let min = [Infinity, Infinity];
      let max = [-Infinity, -Infinity];
      let meshes = 0;
      const walk = (entry: Node): void => {
        if (entry.type === "Mesh" && entry.geometry) {
          meshes += 1;
          entry.geometry.computeBoundingBox();
          const box = entry.geometry.boundingBox;
          if (box) {
            const m = entry.matrixWorld.elements;
            for (const x of [box.min.x, box.max.x]) {
              for (const y of [box.min.y, box.max.y]) {
                for (const z of [box.min.z, box.max.z]) {
                  const px = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
                  const pz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
                  min = [Math.min(min[0]!, px), Math.min(min[1]!, pz)];
                  max = [Math.max(max[0]!, px), Math.max(max[1]!, pz)];
                }
              }
            }
          }
        }
        for (const kid of entry.children) walk(kid);
      };
      walk(node);
      if (meshes === 0) {
        missing.push(item.id);
        continue;
      }
      const room = state.scene.rooms.find((entry) => entry.id === item.roomId)!;
      const off = Math.hypot(
        (min[0]! + max[0]!) / 2 - (room.origin.x + item.pos.x) / 100,
        (min[1]! + max[1]!) / 2 - (room.origin.y + item.pos.y) / 100,
      );
      if (off > 0.25) displaced.push(`${item.id} ${off.toFixed(2)} m`);
    }
    return { displaced, missing };
  });
}

test.describe("layouts", () => {
  test("every template renders every item where the scene says it is", async ({ page }) => {
    // The ids survive a template apply (`bed-1` exists in every bedroom plan), so React reuses the
    // component — and the move choreography used to glide the piece up to 7 m from its old home and
    // never arrive. A whole bedroom rendered empty.
    await openStudio(page, { furnished: true, asShipped: true });
    for (const id of TEMPLATE_IDS) {
      await page.evaluate((template) => (window as unknown as HearthWin).__hearth.state().applyTemplate("human", template, true), id);
      await settle(page);
      const audit = await renderAudit(page);
      expect(audit.missing, `${id}: items with no mesh`).toEqual([]);
      expect(audit.displaced, `${id}: items rendered away from their scene position`).toEqual([]);
    }
  });

  test("a neighbour room's furniture stops covering the framed room", async ({ page }) => {
    await openStudio(page, { template: "3br", furnished: true });
    // Activate a different room first: the whole-home shot a template apply lands on cuts no wall,
    // and no piece, merely for standing in front.
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "bed-1"));
    await settle(page);
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "living"));
    await settle(page);
    expect((await camera(page)).focus).toBe("room");

    const strangers = await page.evaluate(() => {
      const win = window as unknown as HearthWin;
      const state = win.__hearth.state();
      const mine = new Set(state.scene.furniture.filter((item) => item.roomId === "living").map((item) => item.id));
      const found: Record<string, number> = {};
      for (let fy = 0.1; fy < 0.95; fy += 0.1) {
        for (let fx = 0.1; fx < 0.95; fx += 0.1) {
          const projected = win.__hearth.project("living", { x: 520 * fx, y: 440 * fy });
          if (!projected) continue;
          const id = win.__hearth.pick(projected.x, projected.y);
          if (id && !mine.has(id)) found[id] = (found[id] ?? 0) + 1;
        }
      }
      return found;
    });
    // The walls in front of the framed room are cut away, so what stood behind them has to go too —
    // and a faded body must not keep swallowing the pointer either.
    expect(Object.keys(strangers)).toEqual([]);
  });

  test("the confirmation names the layout and says who asked", async ({ page }) => {
    await openStudio(page, { furnished: true, asShipped: true });
    await page.getByRole("button", { name: "Layouts", exact: true }).click();
    await page.getByRole("button", { name: `Apply the ${templateLabel("1br")} layout` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Replace this home with the 1 bedroom layout?");
    await expect(dialog).not.toContainText("Your agent asked for this");
    await expect(dialog).not.toContainText("1br");
    await expect(dialog).toContainText("placed items will go");

    // Escape declines: the chooser comes back and the home is untouched.
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
    await expect(page.getByRole("dialog")).toContainText("Start from a floor plan");
    expect((await meta(page)).template).toBe("2br");
  });

  test("undo and redo of an apply frame the whole home", async ({ page }) => {
    await openStudio(page, { furnished: true, asShipped: true });
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().applyTemplate("human", "3br", true));
    await settle(page);
    expect((await camera(page)).focus).toBe("home");

    // The human says "that room", and the whole-home shot lets go.
    const other = await page.evaluate(() => {
      const state = (window as unknown as HearthWin).__hearth.state();
      return state.scene.rooms.find((room) => room.id !== state.scene.meta.activeRoomId)!.id;
    });
    await page.evaluate((id) => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", id), other);
    await settle(page);
    expect((await camera(page)).focus).toBe("room");

    await page.locator("header").getByRole("button", { name: "Undo" }).click();
    await page.waitForTimeout(1400);
    expect((await camera(page)).focus, "undoing an apply replaces the home too").toBe("home");
    expect((await meta(page)).template).toBe("2br");

    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "bed-1"));
    await settle(page);
    await page.locator("header").getByRole("button", { name: "Redo" }).click();
    await page.waitForTimeout(1400);
    expect((await camera(page)).focus).toBe("home");
    expect((await meta(page)).template).toBe("3br");
  });

  test("the sheet traps focus, the toggle takes it, and Escape gives it back", async ({ page }) => {
    await openStudio(page, { furnished: true, asShipped: true });
    const trigger = page.getByRole("button", { name: "Layouts", exact: true });
    await trigger.click();
    const focused = (): Promise<string> => page.evaluate(() => {
      const node = document.activeElement as HTMLElement | null;
      return (node?.getAttribute("aria-label") ?? node?.textContent ?? "").trim().slice(0, 32);
    });
    // Tab order: the Furnished toggle, then the cards, and the close button last.
    expect(await focused()).toBe("Furnished");
    await page.keyboard.press("Tab");
    expect(await focused()).toContain(`Apply the ${templateLabel("studio")} layout`);

    for (let step = 0; step < 18; step += 1) await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => document.querySelector('[role="dialog"]')?.contains(document.activeElement) ?? false),
      "the trap holds",
    ).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();

    // The backdrop and the close button close it too.
    await trigger.click();
    await page.mouse.click(40, 520);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await trigger.click();
    await page.getByRole("button", { name: "Close Layouts" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(trigger).toBeFocused();
  });

  test("the cards read off the engine, and the Current chip follows the home", async ({ page }) => {
    await openStudio(page, { furnished: true, asShipped: true });
    await page.getByRole("button", { name: "Layouts", exact: true }).click();
    for (const id of TEMPLATE_IDS) {
      await expect(page.getByRole("button", { name: `Apply the ${templateLabel(id)} layout` })).toBeVisible();
    }
    await expect(page.locator('[aria-current="true"]').first()).toContainText(templateLabel("2br"));

    // Furnished off means empty rooms, and the apply lands on the living room and the whole home.
    await page.getByRole("button", { name: "Furnished", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("Arrives as empty rooms");
    await page.getByRole("button", { name: `Apply the ${templateLabel("5br")} layout` }).click();
    await page.getByRole("button", { name: /replace it/i }).click();
    await settle(page);

    const state = await meta(page);
    expect(state.template).toBe("5br");
    expect(state.activeRoomId).toBe("living");
    expect(state.selection.itemId).toBeFalsy();
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.furniture.length)).toBe(0);
    expect((await camera(page)).focus).toBe("home");
    expect(await roomsOffScreen(page), "every room of the plan you just chose is on screen").toEqual([]);
  });

  test("an agent's apply_template frames the whole home too", async ({ page }) => {
    // The store's own "Apply template" entry is suppressed while a tool batch is open (one tool
    // call, one row), so the only receipt an agent's apply leaves is the tool's — and that is the
    // one the camera rule has to recognise, or the studio the agent is driving never pulls back.
    await openStudio(page, { furnished: true, asShipped: true, polyfill: true });
    await runTool(page, "set_mode", { mode: "build" });
    await expect.poll(
      async () => page.evaluate(async () => {
        const runtime = document.modelContext as unknown as { getTools(): Promise<{ name: string }[]> };
        return (await runtime.getTools()).map((tool) => tool.name).includes("apply_template");
      }),
      { timeout: 30_000 },
    ).toBe(true);

    const applying = runTool(page, "apply_template", { template: "5br", furnished: true });
    // The agent asks; the dialog says so, and names the layout rather than the id.
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Replace this home with the 5 bedrooms layout?");
    await expect(dialog).toContainText("Your agent asked for this");
    await page.getByRole("button", { name: /replace it/i }).click();
    expect(await applying).toContain('"ok":true');
    await settle(page);

    expect((await meta(page)).template).toBe("5br");
    expect((await camera(page)).focus).toBe("home");
    expect(await roomsOffScreen(page)).toEqual([]);
  });

  test("exporting a design board gives the human's camera back", async ({ page }) => {
    // The board photographs the room's own framed shot, so it borrows the camera — and has to hand
    // back exactly the orbit, zoom and pan it found, whether the capture succeeded or timed out.
    await openStudio(page, { furnished: true, asShipped: true });
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "living"));
    await settle(page);

    const point = await background(page);
    await drag(page, point, { x: point.x - 130, y: point.y + 60 }, { button: "right" });
    const orbited = await camera(page);
    expect(orbited.offHome).toBe(true);

    await page.getByRole("button", { name: "Export design board" }).click();
    await expect
      .poll(async () => page.evaluate(() => (window as unknown as HearthWin).__hearth.toasts().length > 0), { timeout: 120_000 })
      .toBe(true);
    await page.waitForTimeout(1400);

    const after = await camera(page);
    expect(after.view).toBe("dollhouse");
    expect(after.pitchDeg).toBeCloseTo(orbited.pitchDeg, 1);
    expect(after.azimuthDeg).toBeCloseTo(orbited.azimuthDeg, 1);
    expect(after.zoom).toBeCloseTo(orbited.zoom, 2);
  });

  test("all seven cards are on screen without scrolling, and say which home they build", async ({ page }) => {
    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(size);
      await openStudio(page, { furnished: true, asShipped: true });
      await page.getByRole("button", { name: "Layouts", exact: true }).click();
      await page.waitForTimeout(400);

      const report = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        const body = dialog.querySelector(".panel-scroll") as HTMLElement;
        const cards = [...dialog.querySelectorAll('[aria-label^="Apply the"]')] as HTMLElement[];
        const bounds = dialog.getBoundingClientRect();
        return {
          cards: cards.length,
          columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().x))).size,
          scrolls: body.scrollHeight > body.clientHeight + 1,
          clipped: cards
            .filter((card) => card.getBoundingClientRect().bottom > bounds.bottom + 1)
            .map((card) => card.getAttribute("aria-label")),
          firstSpec: cards[0]?.innerText.replace(/\n/g, " · ") ?? "",
        };
      });
      expect(report.cards, `${size.width}: every layout`).toBe(7);
      expect(report.columns, `${size.width}: three columns`).toBe(3);
      expect(report.scrolls, `${size.width}: nothing to scroll to`).toBe(false);
      expect(report.clipped).toEqual([]);
      // The Furnished choice applies to every card, so every card says which home it would build.
      expect(report.firstSpec).toContain("furnished");

      await page.getByRole("button", { name: "Furnished", exact: true }).click();
      await expect(page.locator('[aria-label^="Apply the"]').first()).toContainText("empty");
      await page.keyboard.press("Escape");
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  test("a click into the front room lets go of the whole-home shot", async ({ page }) => {
    // Empty rooms: the whole-home shot puts the front room behind the catalog panel's edge, and a
    // furnished living room has almost no floor left to aim at (round 1, P2). The click under test
    // is a click on a *floor*, which is the same click either way.
    await openStudio(page, { template: "5br", furnished: false });
    expect((await camera(page)).focus).toBe("home");
    const active = (await meta(page)).activeRoomId;

    // Two metres of that room's floor, in pixels: how big the camera is drawing it.
    const span = async (): Promise<number> => page.evaluate((id) => {
      const win = window as unknown as HearthWin;
      const near = win.__hearth.project(id, { x: 0, y: 0 });
      const far = win.__hearth.project(id, { x: 200, y: 200 });
      return near && far ? Math.hypot(far.x - near.x, far.y - near.y) : 0;
    }, active);
    const framedHome = await span();

    // The most natural first click after an apply is into the room the store *already* calls active,
    // so no id changes — and that is exactly the click that used to do nothing at all.
    const point = await emptyFloor(page, active);
    await page.mouse.click(point.x, point.y);
    await settle(page);

    expect((await camera(page)).focus).toBe("room");
    expect((await meta(page)).activeRoomId).toBe(active);
    expect(await page.evaluate(() => (window as unknown as HearthWin).__hearth.selection().roomId)).toBe(active);
    // The camera really moved in, rather than merely dropping the override.
    expect(await span()).toBeGreaterThan(framedHome * 1.5);
  });

  test("the inspector names the whole home while the camera frames it", async ({ page }) => {
    await openStudio(page, { template: "5br", furnished: true });
    expect((await camera(page)).focus).toBe("home");
    const card = page.locator("section").filter({ hasText: "Entire home" }).first();
    await expect(card).toContainText("11 rooms");

    // The card is a description list, and its money says what the tools say: a budget is spent by
    // buying, so a home full of unbought furniture leaves the budget whole.
    const money = await card.evaluate((node) => {
      const rows: Record<string, string> = {};
      for (const term of node.querySelectorAll("dt")) {
        rows[term.textContent?.trim() ?? ""] = term.nextElementSibling?.textContent?.trim() ?? "";
      }
      return rows;
    });
    expect(Object.keys(money)).toEqual(["Bedrooms", "Bathrooms", "Furniture value", "Budget", "Cart", "Remaining", "Conflicts"]);
    expect(money.Cart).toBe("$0");
    expect(money.Remaining).toBe(money.Budget);
    expect(Object.values(money).filter((value) => value.startsWith("-"))).toEqual([]);

    // …and the room card comes back the moment a room is activated.
    await page.evaluate(() => (window as unknown as HearthWin).__hearth.state().setActiveRoom("human", "bed-3"));
    await settle(page);
    await expect(page.locator("section").filter({ hasText: "/ 100" }).first()).not.toContainText("Entire home");
  });

  test("the 5BR plan keeps eleven labels legible, and a pan still starts on the floor", async ({ page }) => {
    await openStudio(page, { template: "5br", furnished: true });
    await page.getByRole("radio", { name: "Plan", exact: true }).click();
    await settle(page);
    expect(await roomsOffScreen(page)).toEqual([]);

    // Each label sizes itself to the room it names, never below 9 px, and the area never breaks.
    const labels = await page.evaluate(() => {
      const names = new Set((window as unknown as HearthWin).__hearth.state().scene.rooms.map((room) => room.name));
      return [...document.querySelectorAll("span.label-caps")]
        .filter((node) => names.has((node.textContent ?? "").trim()))
        .map((node) => {
          const area = node.parentElement?.querySelector(".numerals") as HTMLElement | null;
          const areaStyle = area ? getComputedStyle(area) : undefined;
          return {
            text: (node.textContent ?? "").trim(),
            px: Number.parseFloat(getComputedStyle(node).fontSize),
            areaLines: area && areaStyle
              ? Math.round(area.getBoundingClientRect().height / Number.parseFloat(areaStyle.lineHeight || "18"))
              : 0,
          };
        });
    });
    expect(labels.length, "one label per room").toBe(11);
    expect(labels.filter((label) => label.px < 9), "never below the legible floor").toEqual([]);
    expect(labels.filter((label) => label.px > 11), "never above the resting size").toEqual([]);
    expect(labels.filter((label) => label.areaLines > 1), "the area never wraps").toEqual([]);

    const overlaps = await page.evaluate(() => {
      const labels = [...document.querySelectorAll("span.label-caps")].filter((node) => (node.textContent ?? "").trim().length > 0);
      const boxes = labels.map((node) => ({ text: (node.textContent ?? "").trim(), rect: node.getBoundingClientRect() }));
      const hits: string[] = [];
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          const a = boxes[i]!.rect;
          const b = boxes[j]!.rect;
          if (a.width === 0 || b.width === 0) continue;
          if (a.right > b.left && b.right > a.left && a.bottom > b.top && b.bottom > a.top) hits.push(`${boxes[i]!.text}×${boxes[j]!.text}`);
        }
      }
      return hits;
    });
    expect(overlaps).toEqual([]);

    const floor = await emptyFloor(page, "hall");
    const before = await camera(page);
    await drag(page, floor, { x: floor.x + 80, y: floor.y - 30 });
    const after = await camera(page);
    expect(Math.hypot(after.pan.x - before.pan.x, after.pan.y - before.pan.y)).toBeGreaterThan(0.5);
  });
});
