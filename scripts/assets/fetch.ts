import { spawn } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assetMappings } from "./mapping";
import { archiveCacheDir, assetCacheRoot, polyPizzaCacheDir } from "./paths";
import { polyPizzaModels, sourceCollections } from "./sources";
import { atomicWrite, replaceDirectory, sha256, sha256File } from "./fs";
import type { PolyPizzaModel, SourceCollection } from "./types";

interface FetchResult {
  source: string;
  status: "cached" | "downloaded";
  bytes: number;
  sha256: string;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function download(url: string, targetPath: string, expectedHash?: string): Promise<FetchResult> {
  if (await exists(targetPath)) {
    const currentHash = await sha256File(targetPath);
    if (!expectedHash || currentHash === expectedHash) {
      return { source: path.basename(targetPath), status: "cached", bytes: (await stat(targetPath)).size, sha256: currentHash };
    }
  }

  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(45_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
      const body = new Uint8Array(await response.arrayBuffer());
      const digest = sha256(body);
      if (expectedHash && digest !== expectedHash) {
        throw new Error(`SHA-256 mismatch: expected ${expectedHash}, received ${digest}`);
      }
      await atomicWrite(targetPath, body);
      return { source: path.basename(targetPath), status: "downloaded", bytes: body.byteLength, sha256: digest };
    } catch (error) {
      lastError = error;
      if (attempt < 4) await delay(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(`Failed to download ${url}`, { cause: lastError });
}

async function run(command: string, args: readonly string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)));
  });
}

async function extractArchive(source: SourceCollection, archivePath: string): Promise<void> {
  if (!source.archive) return;
  const targetPath = path.join(assetCacheRoot, source.archive.extractDir);
  const markerPath = path.join(targetPath, ".complete.json");
  if (await exists(markerPath)) {
    const marker = JSON.parse(await readFile(markerPath, "utf8")) as { sha256?: string };
    const archiveHash = await sha256File(archivePath);
    if (marker.sha256 === archiveHash) return;
  }
  const temporaryParent = await mkdtemp(path.join(assetCacheRoot, `.extract-${source.key}-`));
  const temporaryTarget = path.join(temporaryParent, "content");
  await mkdir(temporaryTarget);
  await run("unzip", ["-q", archivePath, "-d", temporaryTarget]);
  await atomicWrite(path.join(temporaryTarget, ".complete.json"), `${JSON.stringify({ sha256: await sha256File(archivePath) })}\n`);
  await replaceDirectory(temporaryTarget, targetPath);
  await run("rmdir", [temporaryParent]);
}

async function fetchArchive(source: SourceCollection): Promise<FetchResult | undefined> {
  if (!source.archive) return undefined;
  const archivePath = path.join(archiveCacheDir, source.archive.fileName);
  const result = await download(source.archive.url, archivePath, source.archive.sha256);
  await extractArchive(source, archivePath);
  return { ...result, source: source.label };
}

async function fetchPolyModel(model: PolyPizzaModel): Promise<FetchResult> {
  const result = await download(model.downloadUrl, path.join(polyPizzaCacheDir, `${model.id}.glb`), model.sha256);
  if (result.bytes !== model.bytes) {
    throw new Error(`${model.id} byte count changed: expected ${model.bytes}, received ${result.bytes}`);
  }
  return { ...result, source: `${model.name} (${model.id})` };
}

async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let cursor = 0;
  async function worker(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

export async function fetchAssets(): Promise<void> {
  await Promise.all([mkdir(archiveCacheDir, { recursive: true }), mkdir(polyPizzaCacheDir, { recursive: true })]);
  const archiveResults = (await Promise.all(Object.values(sourceCollections).map(fetchArchive))).filter(
    (result): result is FetchResult => result !== undefined,
  );
  const ids = [...new Set(assetMappings.flatMap((mapping) => mapping.polyPizzaId ?? []))].sort();
  const models = ids.map((id) => {
    const model = polyPizzaModels[id];
    if (!model) throw new Error(`Missing poly.pizza source ${id}`);
    return model;
  });
  const modelResults = await mapLimit(models, 2, fetchPolyModel);
  console.table([...archiveResults, ...modelResults].map((result) => ({
    source: result.source,
    status: result.status,
    bytes: result.bytes,
    sha256: result.sha256,
  })));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  void fetchAssets().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
