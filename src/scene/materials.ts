"use client";
/**
 * Shared matte-clay materials (STYLE.md §2: meshStandardMaterial, roughness 0.85–0.95, metalness 0),
 * cached by spec so 25 items × 8 parts still upload a handful of materials. Lamp emissives are
 * registered here so LightingRig can drive them all from one time-of-day tween.
 */
import { MeshStandardMaterial } from "three";
import type { Texture } from "three";
import { mix, palette } from "../tokens";

/** Material roles used by the procedural placeholders and the GLB re-tint. */
export type Tone = "primary" | "light" | "linen" | "shade" | "timber" | "foliage" | "glow" | "metal";

export interface ToneSpec {
  hex: string;
  roughness: number;
  emissive?: string;
}

/** Resolves a tone against an item's colorway hex. Every result stays inside the palette. */
export function toneSpec(tone: Tone, colorwayHex: string): ToneSpec {
  switch (tone) {
    case "primary":
      return { hex: colorwayHex, roughness: 0.9 };
    case "light":
      return { hex: mix(colorwayHex, palette.plaster, 0.32), roughness: 0.93 };
    case "linen":
      return { hex: mix(colorwayHex, palette.plaster, 0.62), roughness: 0.95 };
    case "shade":
      return { hex: mix(colorwayHex, palette.charcoal, 0.16), roughness: 0.88 };
    case "timber":
      // Deliberately a shade darker than raw oak: an oak-colorway item must still read as a frame
      // and legs distinct from its own upholstery.
      return { hex: mix(mix(palette.oak, palette.charcoal, 0.16), colorwayHex, 0.18), roughness: 0.85 };
    case "foliage":
      return { hex: palette.sage, roughness: 0.9 };
    case "metal":
      return { hex: mix(palette.charcoal, colorwayHex, 0.3), roughness: 0.86 };
    case "glow":
      return { hex: mix(palette.plaster, palette.ochre, 0.3), roughness: 0.55, emissive: palette.ochre };
  }
}

export interface MaterialRequest extends ToneSpec {
  /** Neutralised source atlas used as a pure shading multiplier (see assets.ts neutralTexture). */
  map?: Texture;
  /** Ghost previews render at 0.45 with a dusty-blue tint and cast no shadow (STYLE.md §2). */
  opacity?: number;
  /** 0..1 blend toward plaster for rooms the camera is not framing, so the hero room reads first. */
  recede?: number;
}

const cache = new Map<string, MeshStandardMaterial>();
const glowing = new Set<MeshStandardMaterial>();
let glowIntensity = 0;

/** Sets the lamp emissive intensity on every glowing material; driven by the time-of-day tween. */
export function setGlowIntensity(value: number): void {
  glowIntensity = value;
  for (const material of glowing) material.emissiveIntensity = value;
}

/** The current lamp emissive intensity. */
export function currentGlowIntensity(): number {
  return glowIntensity;
}

/** Returns the cached matte material for a spec, creating it on first use. */
export function getMaterial(request: MaterialRequest): MeshStandardMaterial {
  const opacity = request.opacity ?? 1;
  const recede = request.recede ?? 0;
  const hex = recede > 0 ? mix(request.hex, palette.plaster, recede) : request.hex;
  const key = `${hex}|${request.roughness}|${request.emissive ?? ""}|${opacity}|${request.map?.uuid ?? ""}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const material = new MeshStandardMaterial({
    color: hex,
    roughness: request.roughness,
    metalness: 0,
    transparent: opacity < 1,
    opacity,
    depthWrite: opacity >= 1,
    ...(request.map ? { map: request.map } : {}),
  });
  if (request.emissive) {
    material.emissive.set(request.emissive);
    material.emissiveIntensity = glowIntensity;
    glowing.add(material);
  }
  cache.set(key, material);
  return material;
}

/** Ghost tint: the same material family pushed toward dusty blue at 0.45 opacity. */
export function ghostSpec(spec: ToneSpec): MaterialRequest {
  return { hex: mix(spec.hex, palette.dustyBlue, 0.82), roughness: 0.95, opacity: 0.45 };
}
