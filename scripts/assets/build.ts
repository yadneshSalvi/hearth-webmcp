import { Logger, NodeIO } from "@gltf-transform/core";
import type { Document, Node, Scene } from "@gltf-transform/core";
import { clearNodeTransform, dedup, flatten, getBounds, normals, prune, weld } from "@gltf-transform/functions";
import { spawn } from "node:child_process";
import { access, mkdir, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { catalogSource } from "../../data/catalog.source";
import { writeCredits } from "./credits";
import { atomicWrite } from "./fs";
import { assetMappings, countBySource, sourceIdentity } from "./mapping";
import { manifestPath, outputGlbDir, repoRoot, sourceInputPath } from "./paths";
import { sourceCollections } from "./sources";
import type { AssetManifestRow, AssetMapping } from "./types";

const maxDimensionError = 0.15;
const maxFileBytes = 400 * 1024;

function sceneFor(document: Document, id: string): Scene {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (!scene) throw new Error(`${id}: source contains no scene`);
  return scene;
}

function removeNonFurniture(document: Document): void {
  const root = document.getRoot();
  for (const animation of root.listAnimations()) animation.dispose();
  for (const camera of root.listCameras()) camera.dispose();
}

function prepareMaterials(document: Document): string[] {
  const materials = document.getRoot().listMaterials();
  materials.forEach((material, index) => {
    if (!material.getName()) material.setName(`material-${index + 1}`);
    if (material.getName() === "White") material.setName("Light");
    material.setRoughnessFactor(0.9).setMetallicFactor(0);
  });
  return materials.map((material) => material.getName());
}

function normalizeScene(
  document: Document,
  scene: Scene,
  dimensions: { w: number; d: number; h: number },
  rotationY: number,
  fitToCatalog = false,
): number {
  const sourceNodes: Node[] = [];
  scene.traverse((node) => sourceNodes.push(node));
  const seenMeshes = new Set<NonNullable<ReturnType<Node["getMesh"]>>>();
  for (const node of sourceNodes) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    if (seenMeshes.has(mesh)) node.setMesh(mesh.clone());
    seenMeshes.add(node.getMesh() ?? mesh);
  }
  for (const node of sourceNodes) clearNodeTransform(node);

  const wrapper = document.createNode("hearth-normalize");
  const rotationWrapper = fitToCatalog ? document.createNode("hearth-rotate") : wrapper;
  const originalChildren = [...scene.listChildren()];
  scene.addChild(wrapper);
  if (fitToCatalog) wrapper.addChild(rotationWrapper);
  for (const child of originalChildren) rotationWrapper.addChild(child);

  const radians = rotationY * Math.PI / 180;
  rotationWrapper.setRotation([0, Math.sin(radians / 2), 0, Math.cos(radians / 2)]);
  const rotated = getBounds(scene);
  const rotatedDimensions = rotated.max.map((value, index) => value - rotated.min[index]);
  if (rotatedDimensions.some((value) => !(value > 0))) throw new Error("Source model has a zero-sized axis");
  const scale = dimensions.w / 100 / rotatedDimensions[0];
  wrapper.setScale(fitToCatalog
    ? [scale, dimensions.h / 100 / rotatedDimensions[1], dimensions.d / 100 / rotatedDimensions[2]]
    : [scale, scale, scale]);

  const scaled = getBounds(scene);
  wrapper.setTranslation([
    -(scaled.min[0] + scaled.max[0]) / 2,
    -scaled.min[1],
    -(scaled.min[2] + scaled.max[2]) / 2,
  ]);

  const nodes: Node[] = [];
  scene.traverse((node) => nodes.push(node));
  for (const node of nodes) clearNodeTransform(node);
  return scale;
}

function dimensionsCm(scene: Scene): AssetManifestRow["bbox_cm"] {
  const bounds = getBounds(scene);
  const round = (value: number): number => Math.round(value * 10_000) / 100;
  return {
    w: round(bounds.max[0] - bounds.min[0]),
    d: round(bounds.max[2] - bounds.min[2]),
    h: round(bounds.max[1] - bounds.min[1]),
  };
}

function assertDimensions(id: string, actual: AssetManifestRow["bbox_cm"], expected: { w: number; d: number; h: number }): void {
  for (const axis of ["w", "d", "h"] as const) {
    const difference = Math.abs(actual[axis] - expected[axis]);
    const error = difference / expected[axis];
    if (difference > Math.max(expected[axis] * maxDimensionError + 0.0001, 0.5)) {
      throw new Error(`${id}: baked ${axis} ${actual[axis]} cm differs from catalog ${expected[axis]} cm by ${(error * 100).toFixed(1)}%`);
    }
  }
}

async function runMeshopt(inputPath: string, outputPath: string): Promise<void> {
  const executable = path.join(repoRoot, "node_modules/.bin/gltf-transform");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, ["meshopt", inputPath, outputPath, "--level", "high"], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`gltf-transform meshopt exited with ${code}`)));
  });
}

async function buildOne(io: NodeIO, mapping: AssetMapping): Promise<AssetManifestRow> {
  const item = catalogSource.find((candidate) => candidate.id === mapping.id);
  if (!item) throw new Error(`${mapping.id}: mapping has no catalog item`);
  const inputPath = sourceInputPath(mapping);
  await access(inputPath);
  const document = await io.read(inputPath);
  removeNonFurniture(document);
  await document.transform(flatten({ cleanup: false }));
  const scene = sceneFor(document, mapping.id);
  const scale = normalizeScene(document, scene, item.dims, mapping.rotationY, mapping.fitToCatalog);
  const materials = prepareMaterials(document);
  await document.transform(flatten({ cleanup: false }), dedup(), normals({ overwrite: true }), weld(), prune());
  const bbox = dimensionsCm(scene);
  assertDimensions(mapping.id, bbox, item.dims);

  const normalizedPath = path.join(outputGlbDir, `.${mapping.id}.${process.pid}.normalized.glb`);
  const compressedPath = path.join(outputGlbDir, `.${mapping.id}.${process.pid}.compressed.glb`);
  const outputPath = path.join(outputGlbDir, `${mapping.id}.glb`);
  try {
    await io.write(normalizedPath, document);
    await runMeshopt(normalizedPath, compressedPath);
    const bytes = (await stat(compressedPath)).size;
    if (bytes >= maxFileBytes) throw new Error(`${mapping.id}: ${bytes} bytes exceeds the 400 KB budget`);
    await rename(compressedPath, outputPath);
    const source = sourceCollections[mapping.sourceKey];
    return {
      id: mapping.id,
      source: source.label,
      sourceFile: mapping.sourceFile,
      license: source.license,
      scale: Math.round(scale * 100_000_000) / 100_000_000,
      rotationY: mapping.rotationY,
      bbox_cm: bbox,
      materials,
      bytes,
    };
  } finally {
    await Promise.all([unlink(normalizedPath).catch(() => undefined), unlink(compressedPath).catch(() => undefined)]);
  }
}

function validateCoverage(): void {
  const catalogIds = new Set(catalogSource.map((item) => item.id));
  const mappingIds = new Set(assetMappings.map((mapping) => mapping.id));
  if (mappingIds.size !== assetMappings.length) throw new Error("Duplicate catalog ids in asset mapping");
  const missing = [...catalogIds].filter((id) => !mappingIds.has(id));
  const extra = [...mappingIds].filter((id) => !catalogIds.has(id));
  if (missing.length || extra.length) throw new Error(`Mapping mismatch; missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}`);
  const identities = new Map<string, string[]>();
  for (const mapping of assetMappings) {
    const identity = sourceIdentity(mapping);
    identities.set(identity, [...(identities.get(identity) ?? []), mapping.id]);
  }
}

export async function buildAssets(): Promise<void> {
  validateCoverage();
  await mkdir(outputGlbDir, { recursive: true });
  const io = new NodeIO().setLogger(new Logger(Logger.Verbosity.SILENT));
  const rows: AssetManifestRow[] = [];
  for (const mapping of assetMappings) {
    rows.push(await buildOne(io, mapping));
    console.log(`built ${mapping.id} (${rows.at(-1)?.bytes ?? 0} bytes)`);
  }
  await atomicWrite(manifestPath, `${JSON.stringify(rows, null, 2)}\n`);
  await writeCredits();
  const total = rows.reduce((sum, row) => sum + row.bytes, 0);
  console.table(Object.entries(countBySource()).map(([source, count]) => ({ source, count })));
  console.log(`Built ${rows.length} GLBs, ${total} bytes total.`);
}

void buildAssets().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
