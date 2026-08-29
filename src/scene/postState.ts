"use client";
/**
 * One number shared between the lighting rig and the post chain: bloom's luminance threshold.
 *
 * It belongs to the time of day (`src/scene/lighting.ts`), and the time of day tweens over two
 * seconds — so the rig, which already interpolates every other value in the profile, publishes the
 * threshold here each frame and `Post.tsx` writes it onto the effect. A React prop would step it in
 * one jump halfway through the tween, which is exactly when plaster is brightest.
 */
import { PROFILES } from "./lighting";

let threshold = PROFILES.noon.bloom;

/** Sets the bloom luminance threshold; called once per frame by the lighting rig. */
export function setBloomThreshold(value: number): void {
  threshold = value;
}

/** The bloom luminance threshold the studio should be using right now. */
export function bloomThreshold(): number {
  return threshold;
}
