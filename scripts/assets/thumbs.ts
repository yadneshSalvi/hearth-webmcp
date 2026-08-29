import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { assetMappings } from "./mapping";
import { atomicWrite } from "./fs";
import { outputThumbDir, repoRoot } from "./paths";

const mimeTypes: Readonly<Record<string, string>> = {
  ".glb": "model/gltf-binary",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".png": "image/png",
};

const swappedIds = [
  "lamp-glow",
  "floor-lamp-arc",
  "floor-lamp-sol",
  "floor-lamp-lyst",
  "wardrobe-nord",
  "wardrobe-eira",
  "wardrobe-tor",
  "table-ake",
] as const;

function resolveRequest(pathname: string): string | undefined {
  const routes: readonly [string, string][] = [
    ["/node_modules/", path.join(repoRoot, "node_modules")],
    ["/assets/", path.join(repoRoot, "public/assets")],
  ];
  if (pathname === "/thumb-page.html") return path.join(repoRoot, "scripts/assets/thumb-page.html");
  for (const [prefix, root] of routes) {
    if (!pathname.startsWith(prefix)) continue;
    const resolved = path.resolve(root, pathname.slice(prefix.length));
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) return resolved;
  }
  return undefined;
}

async function startServer(): Promise<{ server: Server; origin: string }> {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const filePath = resolveRequest(pathname);
    if (!filePath) {
      response.writeHead(404).end("Not found");
      return;
    }
    void readFile(filePath).then((body) => {
      response.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath)] ?? "application/octet-stream" });
      response.end(body);
    }).catch(() => response.writeHead(404).end("Not found"));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Thumbnail server did not bind to a TCP port");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

export async function renderThumbnails(): Promise<void> {
  await mkdir(outputThumbDir, { recursive: true });
  const contactDir = path.join(repoRoot, "plans/harness/logs");
  await mkdir(contactDir, { recursive: true });
  const { server, origin } = await startServer();
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1320, height: 920 }, deviceScaleFactor: 1 });
    await page.goto(`${origin}/thumb-page.html`, { waitUntil: "networkidle" });
    for (const mapping of assetMappings) {
      await page.evaluate(async (id) => {
        const host = window as typeof window & { renderAsset: (assetId: string) => Promise<unknown> };
        await host.renderAsset(id);
      }, mapping.id);
      const png = await page.locator("#stage").screenshot({ type: "png" });
      await atomicWrite(path.join(outputThumbDir, `${mapping.id}.png`), png);
      console.log(`rendered ${mapping.id}`);
    }

    const ids = assetMappings.map((mapping) => mapping.id);
    for (let offset = 0; offset < ids.length; offset += 20) {
      const pageIds = ids.slice(offset, offset + 20);
      await page.evaluate(async (contactIds) => {
        const host = window as typeof window & { renderContactSheet: (assetIds: string[]) => Promise<unknown> };
        await host.renderContactSheet(contactIds);
      }, pageIds);
      const png = await page.locator("#contact-sheet").screenshot({ type: "png" });
      const sheetNumber = Math.floor(offset / 20) + 1;
      await atomicWrite(path.join(contactDir, `assets-contact-${sheetNumber}.png`), png);
    }

    await page.evaluate(async (contactIds) => {
      const host = window as typeof window & { renderContactSheet: (assetIds: readonly string[]) => Promise<unknown> };
      await host.renderContactSheet(contactIds);
    }, swappedIds);
    const swaps = await page.locator("#contact-sheet").screenshot({ type: "png" });
    await atomicWrite(path.join(contactDir, "assets-r2-swaps.png"), swaps);
  } finally {
    await browser.close();
    await closeServer(server);
  }
  console.log(`Rendered ${assetMappings.length} thumbnails and ${Math.ceil(assetMappings.length / 20)} contact sheets.`);
}

void renderThumbnails().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
