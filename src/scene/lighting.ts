/**
 * The lighting profiles and the two adjustments made to them: the plan-view softening and the bloom
 * threshold. Pure — no three, no React — so the numbers behind "golden hour" are unit tested
 * (`tests/scene/lighting.test.ts`) and `LightingRig.tsx` stays the file that only wires them up.
 *
 * Sun elevations are stylised, not astronomical: a physically low golden sun leaves an interior
 * floor at a fifth of noon's illumination, so each profile trades a little elevation for enough key
 * to keep the floor readable while still throwing shadows two to three times an object's height.
 */
import type { TimeOfDay } from "../engine/types";
import { mix, palette } from "../tokens";
import { lampEmissiveIntensity } from "./retint";

export interface Profile {
  /** Sun compass azimuth in degrees: 0 = south, 90 = east, 180 = north, 270 = west. */
  azimuth: number;
  /** Sun elevation above the horizon in degrees. */
  elevation: number;
  keyHex: string;
  keyIntensity: number;
  skyHex: string;
  groundHex: string;
  fillIntensity: number;
  envIntensity: number;
  glow: number;
  /**
   * Bloom's luminance threshold for this hour (`src/scene/Post.tsx`). STYLE.md §2 allows bloom on
   * emissive lamps only, so the threshold sits above the brightest the sun can drive plaster and
   * below the lamp emissive of the hour: at golden the key is 5.4 and nothing may bloom; in the
   * evening it is 2.2 and every shade does.
   */
  bloom: number;
  bgTop: string;
  bgBottom: string;
}

export const PROFILES: Record<TimeOfDay, Profile> = {
  morning: {
    azimuth: 82,
    elevation: 26,
    keyHex: mix(palette.plaster, palette.dustyBlue, 0.16),
    keyIntensity: 3.9,
    skyHex: mix(palette.canvasTop, palette.dustyBlue, 0.3),
    groundHex: mix(palette.oak, palette.plaster, 0.4),
    fillIntensity: 0.95,
    envIntensity: 0.38,
    glow: lampEmissiveIntensity("morning"),
    bloom: 1.3,
    bgTop: mix(palette.canvasTop, palette.dustyBlue, 0.07),
    bgBottom: mix(palette.canvasBottom, palette.dustyBlue, 0.11),
  },
  noon: {
    azimuth: 8,
    elevation: 62,
    keyHex: mix(palette.plaster, palette.ochre, 0.08),
    keyIntensity: 2.95,
    skyHex: mix(palette.canvasTop, palette.plaster, 0.3),
    groundHex: mix(palette.oak, palette.plaster, 0.35),
    fillIntensity: 0.95,
    envIntensity: 0.4,
    glow: lampEmissiveIntensity("noon"),
    bloom: 1.3,
    bgTop: palette.canvasTop,
    bgBottom: palette.canvasBottom,
  },
  golden: {
    azimuth: 288,
    elevation: 21,
    keyHex: mix(palette.ochre, palette.terracotta, 0.3),
    keyIntensity: 5.4,
    skyHex: mix(palette.canvasTop, palette.ochre, 0.24),
    groundHex: mix(palette.oak, palette.terracotta, 0.18),
    fillIntensity: 1.0,
    envIntensity: 0.38,
    glow: lampEmissiveIntensity("golden"),
    // The strongest key of the four, aimed almost level at a plaster wall: the threshold has to
    // clear it, and the golden lamp glow (0.5) is deliberately below bloom anyway.
    bloom: 1.55,
    bgTop: mix(palette.canvasTop, palette.ochre, 0.11),
    bgBottom: mix(palette.canvasBottom, palette.terracotta, 0.12),
  },
  evening: {
    azimuth: 302,
    elevation: 13,
    keyHex: mix(palette.dustyBlue, palette.plum, 0.3),
    keyIntensity: 2.2,
    skyHex: mix(palette.dustyBlue, palette.plum, 0.42),
    groundHex: mix(palette.oak, palette.terracotta, 0.34),
    fillIntensity: 0.72,
    envIntensity: 0.24,
    glow: lampEmissiveIntensity("evening"),
    // "In evening every lamp blooms" (STYLE.md §2): an ochre shade at 3.2 emissive sits at ~1.27
    // linear luminance, and the dusk key cannot lift plaster anywhere near that.
    bloom: 1.05,
    bgTop: mix(palette.canvasTop, palette.plum, 0.2),
    bgBottom: mix(palette.canvasBottom, palette.terracotta, 0.16),
  },
};

const NUMERIC = ["azimuth", "elevation", "keyIntensity", "fillIntensity", "envIntensity", "glow", "bloom"] as const;
const COLOURS = ["keyHex", "skyHex", "groundHex", "bgTop", "bgBottom"] as const;

/** Blends two profiles; `t` is the eased progress of the 2 s time-of-day tween. */
export function lerpProfile(from: Profile, to: Profile, t: number): Profile {
  const result = { ...to } as Profile;
  for (const key of NUMERIC) result[key] = from[key] + (to[key] - from[key]) * t;
  for (const key of COLOURS) result[key] = mix(from[key], to[key], t);
  return result;
}

/** Where the plan-view sun stands, in degrees: almost overhead, so walls barely cast. */
export const PLAN_ELEVATION = 74;
/** Plan view keeps a hint of the hour's warmth but not its contrast. */
const PLAN_KEY = 0.72;
const PLAN_FILL = 1.28;

/**
 * Plan view is a drawing, not a photograph: at golden hour a 21° sun throws each 2.6 m wall almost
 * seven metres across the floor, which reads as a stain over the furniture rather than as light. The
 * sun is lifted to nearly overhead and the key traded for fill, so the plan stays blueprint-elegant
 * while the hour still tints it. Dollhouse view is untouched (`t` = 0).
 */
export function planSoften(profile: Profile, t: number): Profile {
  if (t <= 0) return profile;
  const to = (from: number, target: number): number => from + (target - from) * t;
  return {
    ...profile,
    elevation: to(profile.elevation, Math.max(profile.elevation, PLAN_ELEVATION)),
    keyIntensity: to(profile.keyIntensity, profile.keyIntensity * PLAN_KEY),
    fillIntensity: to(profile.fillIntensity, profile.fillIntensity * PLAN_FILL),
  };
}

/** Shadow length on the floor, in metres, for a wall of `heightM` under a sun at `elevationDeg`. */
export function shadowLengthM(heightM: number, elevationDeg: number): number {
  return heightM / Math.tan((elevationDeg * Math.PI) / 180);
}
