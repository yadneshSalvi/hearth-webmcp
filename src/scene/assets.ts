"use client";
/**
 * GLB pipeline: normalisation onto the catalog footprint and the palette re-tint that makes 71 CC0
 * models from six sources read as one designed set. Which assets exist and when they are allowed to
 * load is `src/scene/glb.ts`; this file is what happens to one once it has arrived.
 */
import { useMemo } from "react";
import { useGLTF } from "@react-three/drei";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Box3, BufferAttribute, BufferGeometry, CanvasTexture, Color, Mesh, SRGBColorSpace, Vector3 } from "three";
import type { Group, InterleavedBufferAttribute, Material, Object3D, Texture } from "three";
import type { CatalogItem } from "../engine/types";
import { palette } from "../tokens";
import { DRACO_PATH } from "./glb";
import { getMaterial, ghostSpec } from "./materials";
import { normalizeTransform } from "./math";
import { POT_HEX, retintPlan } from "./retint";
import type { SourceMaterial } from "./retint";

function triangleArea(geometry: BufferGeometry): number {
  const position = geometry.getAttribute("position");
  if (!position) return 0;
  const index = geometry.getIndex();
  const count = index ? index.count : position.count;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let total = 0;
  for (let i = 0; i + 2 < count; i += 3) {
    const i0 = index ? index.getX(i) : i;
    const i1 = index ? index.getX(i + 1) : i + 1;
    const i2 = index ? index.getX(i + 2) : i + 2;
    a.fromBufferAttribute(position, i0);
    b.fromBufferAttribute(position, i1);
    c.fromBufferAttribute(position, i2);
    total += b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
  }
  return total;
}

function firstMaterial(material: Material | Material[]): Material {
  return Array.isArray(material) ? (material[0] as Material) : material;
}

function baseHex(material: Material): string {
  const colored = material as Material & { color?: Color };
  return `#${(colored.color ?? new Color(palette.oak)).getHexString().toUpperCase()}`;
}

function baseMap(material: Material): Texture | null {
  const mapped = material as Material & { map?: Texture | null };
  return mapped.map ?? null;
}

const neutralCache = new Map<string, Texture | null>();

/**
 * Turns a source atlas into a pure shading map: luminance only, re-centred so its mean is close to
 * white. Twenty-four of the shipped models paint their whole surface from one textured material, so
 * dropping the map would flatten them while keeping it would smuggle non-palette hues in. Multiplying
 * a palette colour by the neutralised atlas keeps the painted detail and the palette both.
 */
export function neutralTexture(source: Texture): Texture | null {
  if (typeof document === "undefined") return null;
  const key = source.source?.uuid ?? source.uuid;
  const cached = neutralCache.get(key);
  if (cached !== undefined) return cached;
  let result: Texture | null = null;
  try {
    const image = source.image as { width?: number; height?: number } | undefined;
    const width = image?.width ?? 0;
    const height = image?.height ?? 0;
    if (width > 0 && height > 0) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (context) {
        context.drawImage(source.image as CanvasImageSource, 0, 0);
        const pixels = context.getImageData(0, 0, width, height);
        const data = pixels.data;
        let total = 0;
        for (let i = 0; i < data.length; i += 4) {
          total += 0.2126 * (data[i] as number) + 0.7152 * (data[i + 1] as number) + 0.0722 * (data[i + 2] as number);
        }
        const mean = total / (data.length / 4);
        for (let i = 0; i < data.length; i += 4) {
          const luminance = 0.2126 * (data[i] as number) + 0.7152 * (data[i + 1] as number) + 0.0722 * (data[i + 2] as number);
          // Bounded to a 0.82–1.0 multiplier: a model only samples part of its atlas, so a wide
          // range would darken whole items whose region happens to be dark. This keeps the painted
          // detail while guaranteeing the palette colour still reads as itself.
          const value = Math.max(209, Math.min(255, 240 + (luminance - mean) * 0.5));
          data[i] = value;
          data[i + 1] = value;
          data[i + 2] = value;
        }
        context.putImageData(pixels, 0, 0);
        const texture = new CanvasTexture(canvas);
        texture.colorSpace = SRGBColorSpace;
        texture.flipY = source.flipY;
        texture.wrapS = source.wrapS;
        texture.wrapT = source.wrapT;
        texture.repeat.copy(source.repeat);
        texture.offset.copy(source.offset);
        texture.channel = source.channel;
        texture.anisotropy = 4;
        texture.needsUpdate = true;
        result = texture;
      }
    }
  } catch {
    result = null;
  }
  neutralCache.set(key, result);
  return result;
}

const MERGE_ATTRIBUTES = new Set(["position", "normal", "uv"]);

/**
 * Copies an attribute into plain Float32. The shipped models are meshopt-quantised (`POSITION:i16`,
 * `NORMAL:i8`), and `applyMatrix4` writes float results straight back into those integer arrays,
 * which clamps normals to nothing and wrecks the shading. Dequantise first, transform after.
 */
function toFloatAttribute(attribute: BufferAttribute | InterleavedBufferAttribute): BufferAttribute {
  const size = attribute.itemSize;
  const values = new Float32Array(attribute.count * size);
  for (let i = 0; i < attribute.count; i += 1) {
    values[i * size] = attribute.getX(i);
    if (size > 1) values[i * size + 1] = attribute.getY(i);
    if (size > 2) values[i * size + 2] = attribute.getZ(i);
    if (size > 3) values[i * size + 3] = attribute.getW(i);
  }
  return new BufferAttribute(values, size);
}

/**
 * Collapses every mesh that ends up sharing one material into a single draw. The source models are
 * authored per part — one bookcase ships a mesh per book — which put 255 meshes on screen for the
 * furnished 2BR and cost roughly a fifth of the frame in draw-call overhead alone.
 */
function mergeByMaterial(root: Group, meshes: Mesh[], material: Material, castShadow: boolean): Mesh | null {
  if (meshes.length < 2) {
    for (const mesh of meshes) mesh.material = material;
    return meshes[0] ?? null;
  }
  const parts: BufferGeometry[] = [];
  try {
    root.updateMatrixWorld(true);
    for (const mesh of meshes) {
      const source = mesh.geometry as BufferGeometry;
      const geometry = new BufferGeometry();
      for (const name of MERGE_ATTRIBUTES) {
        const attribute = source.getAttribute(name);
        if (attribute) geometry.setAttribute(name, toFloatAttribute(attribute));
      }
      if (!geometry.getAttribute("position")) throw new Error("geometry has no position");
      if (!geometry.getAttribute("uv")) {
        const count = geometry.getAttribute("position").count;
        geometry.setAttribute("uv", new BufferAttribute(new Float32Array(count * 2), 2));
      }
      const index = source.getIndex();
      if (index) geometry.setIndex(Array.from({ length: index.count }, (_, i) => index.getX(i)));
      geometry.applyMatrix4(mesh.matrixWorld);
      parts.push(geometry);
    }
    const merged = mergeGeometries(parts, false);
    for (const part of parts) part.dispose();
    if (!merged) throw new Error("merge produced no geometry");
    const combined = new Mesh(merged, material);
    combined.castShadow = castShadow;
    combined.receiveShadow = true;
    root.add(combined);
    for (const mesh of meshes) mesh.removeFromParent();
    return combined;
  } catch {
    for (const part of parts) part.dispose();
    for (const mesh of meshes) mesh.material = material;
    return meshes[0] ?? null;
  }
}

/** Fraction of a plant's height that reads as pot rather than foliage. */
const POT_FRACTION = 0.3;

/**
 * Splits a single-material plant into pot and foliage by triangle height. Four of the five shipped
 * plants paint the whole model from one atlas material, so tinting all of it sage loses the pot; this
 * reorders the index into two groups so the bottom third can take clay and the rest sage.
 */
function splitPlantPot(mesh: Mesh, potMaterial: Material, leafMaterial: Material): boolean {
  const geometry = mesh.geometry as BufferGeometry;
  const position = geometry.getAttribute("position");
  if (!position) return false;
  const source = geometry.getIndex();
  const count = source ? source.count : position.count;
  if (count < 3) return false;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < position.count; i += 1) {
    const y = position.getY(i);
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  if (!(maxY > minY)) return false;
  const threshold = minY + (maxY - minY) * POT_FRACTION;
  const below: number[] = [];
  const above: number[] = [];
  for (let i = 0; i + 2 < count; i += 3) {
    const a = source ? source.getX(i) : i;
    const b = source ? source.getX(i + 1) : i + 1;
    const c = source ? source.getX(i + 2) : i + 2;
    const centre = (position.getY(a) + position.getY(b) + position.getY(c)) / 3;
    (centre <= threshold ? below : above).push(a, b, c);
  }
  if (below.length === 0 || above.length === 0) return false;
  const merged = geometry.clone();
  merged.setIndex([...below, ...above]);
  merged.clearGroups();
  merged.addGroup(0, below.length, 0);
  merged.addGroup(below.length, above.length, 1);
  mesh.geometry = merged;
  mesh.material = [potMaterial, leafMaterial];
  return true;
}

/**
 * Clones, normalises and re-tints a loaded GLB. The clone is cached per catalog id + colorway +
 * colorway so switching colorways never re-parses the file.
 */
export function useNormalizedGlb(product: CatalogItem, colorwayHex: string, ghost = false, recede = 0): Group {
  const gltf = useGLTF(product.glb, DRACO_PATH, true);
  return useMemo(() => {
    const root = (gltf.scene as Group).clone(true);
    const groups: { source: SourceMaterial; meshes: Mesh[]; map: Texture | null }[] = [];
    root.traverse((node: Object3D) => {
      if (!(node instanceof Mesh)) return;
      node.castShadow = !ghost;
      node.receiveShadow = true;
      const material = firstMaterial(node.material as Material | Material[]);
      const name = material.name ?? "";
      const hex = baseHex(material);
      const area = triangleArea(node.geometry as BufferGeometry);
      const existing = groups.find((group) => group.source.name === name && group.source.hex === hex);
      if (existing) {
        existing.source.area += area;
        existing.meshes.push(node);
      } else {
        groups.push({ source: { name, hex, area }, meshes: [node], map: baseMap(material) });
      }
    });
    const plan = retintPlan(
      groups.map((group) => group.source),
      colorwayHex,
      product.category,
    );
    plan.forEach((entry, index) => {
      const group = groups[index];
      if (!group) return;
      const shading = group.map ? neutralTexture(group.map) : null;
      const spec = {
        hex: entry.hex,
        roughness: entry.roughness,
        ...(entry.emissive ? { emissive: entry.emissive } : {}),
        ...(shading && !ghost ? { map: shading } : {}),
        ...(recede > 0 ? { recede } : {}),
      };
      const material = getMaterial(ghost ? ghostSpec(spec) : spec);
      const combined = mergeByMaterial(root, group.meshes, material, !ghost);
      const potSplit = product.category === "plant" && plan.length === 1 && !ghost;
      if (potSplit && combined) {
        const pot = getMaterial({ hex: POT_HEX, roughness: 0.9, ...(shading ? { map: shading } : {}), ...(recede > 0 ? { recede } : {}) });
        splitPlantPot(combined, pot, material);
      }
    });
    const box = new Box3().setFromObject(root);
    const { scale, offset } = normalizeTransform({ min: box.min.toArray(), max: box.max.toArray() }, product.dims);
    root.scale.setScalar(scale);
    root.position.set(offset[0], offset[1], offset[2]);
    return root;
  }, [gltf, product, colorwayHex, ghost, recede]);
}

