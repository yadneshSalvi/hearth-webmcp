import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Shared end-to-end helpers for the studio's camera and layouts: opening the page with the dev
 * bridges on, driving real pointer/wheel/key/touch input, and reading the effective camera back.
 *
 * The bridges are described in src/scene/devBridge.ts. `__hearthStudio.camera()` reports the camera
 * the human is actually looking through; `__hearth.project()` turns room-local centimetres into the
 * client pixels a gesture aims at, which is what makes a 1:1 pan measurable.
 */

export interface Point { x: number; y: number }

export interface CameraSnapshot {
  azimuthDeg: number;
  pitchDeg: number;
  zoom: number;
  pan: Point;
  offHome: boolean;
  view: string;
  focus: string;
}

interface SceneMetaLike {
  yaw: string;
  view: string;
  template?: string;
  activeRoomId: string;
  mode: string;
  selection: { itemId?: string; roomId?: string; hoverItemId?: string };
}

export interface HearthWin {
  __hearth: {
    state: () => {
      scene: {
        rooms: { id: string; name: string; type: string; origin: Point; poly: Point[] }[];
        openings: { id: string; roomId: string; kind: string }[];
        furniture: { id: string; catalogId: string; pos: Point; roomId: string; status: string }[];
        meta: SceneMetaLike;
      };
      activity: { id: string; title: string; source: string; summary: string }[];
      ui: { pendingConfirm?: { id: string; message: string } };
      applyTemplate: (source: string, id: string, furnished: boolean) => void;
      setActiveRoom: (source: string, roomId: string) => void;
      placeItem: (source: string, input: Record<string, unknown>) => { id: string };
      setView: (source: string, patch: Record<string, unknown>) => void;
      setSelection: (source: string, patch: Record<string, unknown>) => void;
    };
    item: (id: string) => { id: string; pos: Point; roomId: string } | undefined;
    selection: () => { itemId?: string; roomId?: string };
    project: (roomId: string, pos: Point, heightCm?: number) => Point | undefined;
    pick: (clientX: number, clientY: number) => string | undefined;
    toasts: () => { id: string; title?: string; message?: string; tone?: string }[];
    hoveredRoom: () => string | undefined;
  };
  __hearthStudio: (() => { invalidate: () => void }) & { camera: () => CameraSnapshot };
}

/** The WebMCP polyfill, injected before app code so `document.modelContext` exists on any browser. */
export const POLYFILL = "public/webmcp-polyfill.js";

/** The camera the human is looking through. */
export function camera(page: Page): Promise<CameraSnapshot> {
  return page.evaluate(() => (window as unknown as HearthWin).__hearthStudio.camera());
}

export function meta(page: Page): Promise<SceneMetaLike> {
  return page.evaluate(() => (window as unknown as HearthWin).__hearth.state().scene.meta);
}

/** Two projected corners of the first room: the framing's position *and* its scale. */
async function frameKey(page: Page): Promise<string | undefined> {
  return page.evaluate(() => {
    const win = window as unknown as HearthWin;
    win.__hearthStudio().invalidate();
    const room = win.__hearth.state().scene.rooms[0];
    if (!room) return undefined;
    const near = win.__hearth.project(room.id, { x: 0, y: 0 });
    const far = win.__hearth.project(room.id, { x: 200, y: 200 });
    return near && far ? `${near.x},${near.y},${far.x},${far.y}` : undefined;
  });
}

/**
 * Waits until the camera is genuinely at rest. Each sample nudges the real mouse — headless Chrome
 * only produces a rendering opportunity when something asks for one, and the canvas is
 * `frameloop="demand"` — then compares two room corners so the scale is pinned as well as the centre.
 */
export async function settle(page: Page): Promise<void> {
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

export interface OpenOptions {
  template?: string;
  furnished?: boolean;
  polyfill?: boolean;
  /** Skip the template apply, so the page opens on the shipped furnished 2BR. */
  asShipped?: boolean;
}

/** Opens the studio with the dev bridges on and waits for the camera to come to rest. */
export async function openStudio(page: Page, options: OpenOptions = {}): Promise<void> {
  if (options.polyfill) await page.addInitScript({ path: POLYFILL });
  await page.addInitScript(() => {
    try {
      window.localStorage.setItem("hearth.onboarding.v1", "dismissed");
    } catch {
      // A blocked localStorage only means the welcome card shows; nothing here depends on it.
    }
  });
  await page.goto("/?e2e=1");
  await page.waitForFunction(
    () => {
      const win = window as unknown as Partial<HearthWin>;
      return win.__hearth?.project("living", { x: 0, y: 0 }) !== undefined && win.__hearthStudio?.camera !== undefined;
    },
    undefined,
    { timeout: 30_000 },
  );
  if (!options.asShipped) {
    await page.evaluate(
      ([id, furnished]) => {
        (window as unknown as HearthWin).__hearth.state().applyTemplate("human", id as string, furnished === "1");
      },
      [options.template ?? "2br", options.furnished ? "1" : "0"],
    );
  }
  await settle(page);
}

/** Runs a registered WebMCP tool the way an agent would (needs `polyfill: true`). */
export async function runTool(page: Page, name: string, input: unknown): Promise<string> {
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

/** A client point over the canvas with nothing pickable under it and no floating chrome over it. */
export async function background(page: Page): Promise<Point> {
  const point = await page.evaluate(() => {
    const handle = (window as unknown as HearthWin).__hearth;
    const canvas = document.querySelector("canvas");
    if (!canvas) return undefined;
    const rect = canvas.getBoundingClientRect();
    // Fractions of the canvas, so the same search works at 1440 x 900 and on a 390 px phone.
    for (const fy of [0.5, 0.58, 0.66, 0.74, 0.42, 0.34]) {
      for (const fx of [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74]) {
        const x = Math.round(rect.left + rect.width * fx);
        const y = Math.round(rect.top + rect.height * fy);
        if (handle.pick(x, y)) continue;
        if (!(document.elementFromPoint(x, y) instanceof HTMLCanvasElement)) continue;
        return { x, y };
      }
    }
    return undefined;
  });
  expect(point, "a background point over the canvas").toBeTruthy();
  return point as Point;
}

/** A client point over `roomId`'s own floor with nothing pickable under it and no chrome over it. */
export async function emptyFloor(page: Page, roomId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const win = window as unknown as HearthWin;
    const room = win.__hearth.state().scene.rooms.find((entry) => entry.id === id);
    if (!room) return undefined;
    const xs = room.poly.map((corner) => corner.x);
    const ys = room.poly.map((corner) => corner.y);
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    for (let fy = 0.15; fy < 0.9; fy += 0.05) {
      for (let fx = 0.15; fx < 0.9; fx += 0.05) {
        const local = { x: minX + (maxX - minX) * fx, y: minY + (maxY - minY) * fy };
        const projected = win.__hearth.project(id, local);
        if (!projected) continue;
        if (win.__hearth.pick(projected.x, projected.y)) continue;
        if (!(document.elementFromPoint(projected.x, projected.y) instanceof HTMLCanvasElement)) continue;
        return projected;
      }
    }
    return undefined;
  }, roomId);
  expect(point, `an empty floor point in ${roomId}`).toBeTruthy();
  return point as Point;
}

/** A client point on an item's body that the studio's own pick agrees is that item. */
export async function itemPoint(page: Page, itemId: string): Promise<Point> {
  const point = await page.evaluate((id) => {
    const handle = (window as unknown as HearthWin).__hearth;
    const item = handle.item(id);
    if (!item) return undefined;
    for (const height of [30, 45, 20, 60, 10, 0]) {
      const candidate = handle.project(item.roomId, item.pos, height);
      if (candidate && handle.pick(candidate.x, candidate.y) === id) return candidate;
    }
    return undefined;
  }, itemId);
  expect(point, `a pickable point on ${itemId}`).toBeTruthy();
  return point as Point;
}

export interface DragOptions {
  button?: "left" | "right" | "middle";
  shift?: boolean;
  steps?: number;
  /** Release the modifier before pointer-up, to prove the gesture stays what it started as. */
  releaseModifierMidDrag?: boolean;
}

/** Presses at `from`, walks the pointer to `to` in small steps, releases. */
export async function drag(page: Page, from: Point, to: Point, options: DragOptions = {}): Promise<void> {
  const steps = options.steps ?? 6;
  const button = options.button ?? "left";
  if (options.shift) await page.keyboard.down("Shift");
  await page.mouse.move(from.x, from.y);
  await page.mouse.down({ button });
  for (let step = 1; step <= steps; step += 1) {
    if (options.releaseModifierMidDrag && options.shift && step === Math.ceil(steps / 2)) await page.keyboard.up("Shift");
    await page.mouse.move(from.x + ((to.x - from.x) * step) / steps, from.y + ((to.y - from.y) * step) / steps);
    await page.waitForTimeout(24);
  }
  await page.waitForTimeout(120);
  await page.mouse.up({ button });
  if (options.shift && !options.releaseModifierMidDrag) await page.keyboard.up("Shift");
  await page.waitForTimeout(160);
}

/** True while every room centre projects inside the canvas — what "entire home" has to mean. */
export async function roomsOffScreen(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const win = window as unknown as HearthWin;
    const canvas = document.querySelector("canvas");
    if (!canvas) return ["no canvas"];
    const rect = canvas.getBoundingClientRect();
    return win.__hearth.state().scene.rooms
      .map((room) => {
        const xs = room.poly.map((corner) => corner.x);
        const ys = room.poly.map((corner) => corner.y);
        const centre = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
        const projected = win.__hearth.project(room.id, centre);
        const inside = projected !== undefined
          && projected.x > rect.left && projected.x < rect.right
          && projected.y > rect.top && projected.y < rect.bottom;
        return inside ? undefined : room.id;
      })
      .filter((id): id is string => id !== undefined);
  });
}
