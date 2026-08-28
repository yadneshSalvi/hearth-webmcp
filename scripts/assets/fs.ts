import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export async function atomicWrite(filePath: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, data);
  await rename(temporaryPath, filePath);
}

export function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export async function sha256File(filePath: string): Promise<string> {
  return sha256(await readFile(filePath));
}

export async function replaceDirectory(temporaryPath: string, targetPath: string): Promise<void> {
  await rm(targetPath, { force: true, recursive: true });
  await rename(temporaryPath, targetPath);
}
