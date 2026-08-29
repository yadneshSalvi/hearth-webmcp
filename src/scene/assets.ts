"use client";
/**
 * GLB pipeline: DRACO + meshopt loading from /assets/glb, normalisation onto the catalog footprint
 * and palette re-tint. Assets are probed before they are requested, so a missing file falls back to
 * the designed procedural placeholder instead of throwing a suspense error.
 */
import { Component, useMemo, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { Box3, Color, Mesh, Vector3 } from "three";
import type { BufferGeometry, Group, Material, Object3D } from "three";
import type { CatalogItem } from "../engine/types";
import { palette } from "../tokens";
import { getMaterial, ghostSpec } from "./materials";
import { normalizeTransform } from "./math";
import { retintPlan } from "./retint";
import type { SourceMaterial } from "./retint";

/** Local decoder copied from three's examples so nothing is fetched from a CDN. */
export const DRACO_PATH = "/draco/";

export type GlbState = "unknown" | "present" | "missing";

const states = new Map<string, GlbState>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function probe(url: string): void {
  if (states.has(url) || typeof fetch === "undefined") return;
  states.set(url, "unknown");
  void fetch(url, { method: "HEAD" })
    .then((response) => {
      states.set(url, response.ok ? "present" : "missing");
    })
    .catch(() => {
      states.set(url, "missing");
    })
    .finally(emit);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Probes (once) and reports whether a GLB exists; "unknown" renders the placeholder meanwhile. */
export function useGlbState(url: string): GlbState {
  const state = useSyncExternalStore(
    subscribe,
    () => states.get(url) ?? "unknown",
    () => "unknown" as GlbState,
  );
  if (typeof window !== "undefined") probe(url);
  return state;
}

/** Probes a batch of GLB urls so the first render already knows which assets exist. */
export function probeGlbs(urls: string[]): void {
  for (const url of urls) probe(url);
}

/** Warms the loader cache for a set of catalog ids that are already on screen. */
export function preloadGlbs(urls: string[]): void {
  for (const url of urls) {
    if (states.get(url) === "present") useGLTF.preload(url, DRACO_PATH, true);
  }
}

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

/**
 * Clones, normalises and re-tints a loaded GLB. The clone is cached per catalog id + colorway +
 * colorway so switching colorways never re-parses the file.
 */
export function useNormalizedGlb(product: CatalogItem, colorwayHex: string, ghost = false): Group {
  const gltf = useGLTF(product.glb, DRACO_PATH, true);
  return useMemo(() => {
    const root = (gltf.scene as Group).clone(true);
    const groups: { source: SourceMaterial; meshes: Mesh[] }[] = [];
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
        groups.push({ source: { name, hex, area }, meshes: [node] });
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
      const spec = { hex: entry.hex, roughness: entry.roughness, ...(entry.emissive ? { emissive: entry.emissive } : {}) };
      const material = getMaterial(ghost ? ghostSpec(spec) : spec);
      for (const mesh of group.meshes) mesh.material = material;
    });
    const box = new Box3().setFromObject(root);
    const { scale, offset } = normalizeTransform({ min: box.min.toArray(), max: box.max.toArray() }, product.dims);
    root.scale.setScalar(scale);
    root.position.set(offset[0], offset[1], offset[2]);
    return root;
  }, [gltf, product, colorwayHex, ghost]);
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/** Falls back to the procedural placeholder when a GLB decodes badly. */
export class GlbBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Swallowed on purpose: a missing asset is a designed state, not a page error.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
