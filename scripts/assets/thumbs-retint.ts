/**
 * Re-renders every catalog thumbnail through the **real** studio materials.
 *
 * `scripts/assets/thumbs.ts` renders the raw GLBs on a standalone page, which is honest about the
 * asset but not about the product: it misses the palette re-tint, the lighting rig and the tone
 * mapping, so a catalog card and the dollhouse disagreed. This script drives the dev-only
 * `/render?id=<catalogId>&colorway=<id>` route instead — one Next page, one Canvas, the same
 * `LightingRig` at noon, the same loader, the same re-tint — and screenshots the 512×384 stage.
 *
 * Writes `public/assets/thumbs/<id>.png` (overwriting) and one contact sheet at
 * `plans/harness/logs/thumbs-contact.png` — or `thumbs-contact-subset.png` when only some ids were
 * asked for, so a three-item run cannot replace the full set's sheet. It never touches Shopify: the
 * lead re-uploads the images with `pnpm seed`.
 *
 * Usage:
 *   pnpm assets:thumbs-retint                       # spawns its own dev server on port 3113
 *   HEARTH_RENDER_ORIGIN=http://localhost:3103 pnpm assets:thumbs-retint   # reuse a running one
 *   pnpm assets:thumbs-retint sofa-endre rug-loop   # just these ids
 */
import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { catalogSource } from "../../data/catalog.source";
import { thumbnailColorway } from "../../src/scene/thumbnail";
import { atomicWrite } from "./fs";
import { outputThumbDir, repoRoot } from "./paths";

const SHOT_WIDTH = 512;
const SHOT_HEIGHT = 384;
const DEV_PORT = Number(process.env.HEARTH_RENDER_PORT ?? 3113);
const SERVER_TIMEOUT_MS = 120_000;
const READY_TIMEOUT_MS = 60_000;
const CONTACT_COLUMNS = 8;
const CONTACT_TILE = 168;
const contactSheetDir = path.join(repoRoot, "plans/harness/logs");
/** The full-set sheet reviewers cite. A partial run writes its own file rather than replacing it. */
const FULL_SHEET = "thumbs-contact.png";
const SUBSET_SHEET = "thumbs-contact-subset.png";

interface Target {
  id: string;
  name: string;
  colorway: string;
}

/**
 * Every catalog product in its thumbnail colourway (`src/scene/thumbnail.ts` — the first colourway
 * unless a flat item would vanish into the backdrop), or just the ids named on the command line.
 */
function targets(): Target[] {
  const wanted = new Set(process.argv.slice(2).filter((argument) => !argument.startsWith("-")));
  return catalogSource
    .filter((product) => wanted.size === 0 || wanted.has(product.id))
    .map((product) => ({
      id: product.id,
      name: product.name,
      colorway: thumbnailColorway(product),
    }));
}

async function reachable(origin: string): Promise<boolean> {
  try {
    const response = await fetch(`${origin}/render?id=${catalogSource[0]?.id ?? ""}`, { redirect: "manual" });
    return response.status < 500;
  } catch {
    return false;
  }
}

async function waitForServer(origin: string, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`The dev server exited with code ${child.exitCode} before it was reachable.`);
    }
    if (await reachable(origin)) return;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`No dev server answered on ${origin} within ${SERVER_TIMEOUT_MS / 1000} s.`);
}

/** Uses a dev server if one is already listening, otherwise starts (and later stops) its own. */
async function startServer(): Promise<{ origin: string; stop(): Promise<void> }> {
  const given = process.env.HEARTH_RENDER_ORIGIN;
  if (given) {
    await waitForServer(given);
    return { origin: given, stop: async () => undefined };
  }
  const origin = `http://127.0.0.1:${DEV_PORT}`;
  if (await reachable(origin)) return { origin, stop: async () => undefined };
  const child = spawn("pnpm", ["exec", "next", "dev", "--port", String(DEV_PORT)], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "inherit"],
    env: { ...process.env, NODE_ENV: "development" },
  });
  await waitForServer(origin, child);
  return {
    origin,
    stop: async () => {
      child.kill("SIGTERM");
      await new Promise((resolve) => setTimeout(resolve, 300));
    },
  };
}

async function renderOne(page: Page, origin: string, target: Target): Promise<Uint8Array> {
  const url = `${origin}/render?id=${encodeURIComponent(target.id)}&colorway=${encodeURIComponent(target.colorway)}`;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const stage = page.locator('#stage[data-render="ready"]');
  await stage.waitFor({ state: "visible", timeout: READY_TIMEOUT_MS });
  return stage.screenshot({ type: "png" });
}

/** One sheet of every thumbnail as written, so a reviewer can judge the set in a single glance. */
async function renderContactSheet(browser: Browser, ids: string[], full: boolean): Promise<void> {
  const contactSheetPath = path.join(contactSheetDir, full ? FULL_SHEET : SUBSET_SHEET);
  const tiles = await Promise.all(ids.map(async (id) => {
    const file = path.join(outputThumbDir, `${id}.png`);
    const base64 = (await readFile(file)).toString("base64");
    return `<figure><img src="data:image/png;base64,${base64}" alt=""><figcaption>${id}</figcaption></figure>`;
  }));
  const rows = Math.ceil(tiles.length / CONTACT_COLUMNS);
  const page = await browser.newPage({
    viewport: { width: CONTACT_COLUMNS * CONTACT_TILE + 48, height: rows * (CONTACT_TILE + 22) + 96 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #F7F3EC; font: 500 10px/1.2 -apple-system, system-ui, sans-serif; color: rgba(62,58,54,.62); }
    h1 { font: 500 15px/1 Georgia, serif; color: #3E3A36; margin: 0 0 14px; letter-spacing: .01em; }
    .grid { display: grid; grid-template-columns: repeat(${CONTACT_COLUMNS}, ${CONTACT_TILE - 8}px); gap: 8px; }
    figure { margin: 0; }
    img { display: block; width: ${CONTACT_TILE - 8}px; height: ${Math.round(((CONTACT_TILE - 8) * 3) / 4)}px; border-radius: 8px; background: #EFE7DB; border: 1px solid rgba(62,58,54,.14); }
    figcaption { margin-top: 4px; letter-spacing: .04em; text-transform: uppercase; }
  </style></head><body>
    <h1>Hearth — catalog thumbnails re-rendered through the studio materials (${tiles.length})</h1>
    <div class="grid">${tiles.join("")}</div>
  </body></html>`, { waitUntil: "load" });
  await mkdir(path.dirname(contactSheetPath), { recursive: true });
  await atomicWrite(contactSheetPath, await page.screenshot({ type: "png", fullPage: true }));
  await page.close();
}

export async function renderRetintedThumbnails(): Promise<void> {
  const list = targets();
  if (list.length === 0) throw new Error("No catalog products matched the ids given.");
  await mkdir(outputThumbDir, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: SHOT_WIDTH + 96, height: SHOT_HEIGHT + 140 },
      deviceScaleFactor: 1,
    });
    for (const [index, target] of list.entries()) {
      const png = await renderOne(page, server.origin, target);
      await atomicWrite(path.join(outputThumbDir, `${target.id}.png`), png);
      console.log(`[${index + 1}/${list.length}] ${target.id} · ${target.colorway}`);
    }
    await page.close();
    await renderContactSheet(browser, list.map((target) => target.id), list.length === catalogSource.length);
  } finally {
    await browser.close();
    await server.stop();
  }
  console.log(`Re-rendered ${list.length} thumbnails at ${SHOT_WIDTH}×${SHOT_HEIGHT} and one contact sheet.`);
}

void renderRetintedThumbnails().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
