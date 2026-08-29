import { describe, expect, it } from "vitest";
import { PLAN_ELEVATION, PROFILES, lerpProfile, planSoften, shadowLengthM } from "@/src/scene/lighting";
import type { TimeOfDay } from "@/src/engine/types";
import { lampEmissiveIntensity } from "@/src/scene/retint";

const HOURS: TimeOfDay[] = ["morning", "noon", "golden", "evening"];
/** Wall height in metres (SCENE_SCHEMA.md: 260 cm). */
const WALL_M = 2.6;

/** Relative luminance of a linear RGB triple. */
function luminance(rgb: [number, number, number]): number {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function toLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function linearHex(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16);
  return [
    toLinear(((value >> 16) & 255) / 255),
    toLinear(((value >> 8) & 255) / 255),
    toLinear((value & 255) / 255),
  ];
}

/**
 * Radiance leaving a plaster surface facing the sun head-on, as three computes it: the Lambert BRDF
 * is albedo / π, and a directional light's irradiance is its colour times its intensity.
 */
function litPlaster(keyHex: string, keyIntensity: number, fillIntensity: number): number {
  const albedo = linearHex("#F4EFE6");
  const key = linearHex(keyHex);
  const direct = albedo.map((channel, index) => (channel / Math.PI) * keyIntensity * (key[index] ?? 0));
  // The hemisphere fill and the baked environment together never exceed the key; a generous 0.45 of
  // white-ish ambient stands in for both, so the assertion errs on the side of too bright.
  const ambient = albedo.map((channel) => (channel / Math.PI) * fillIntensity * 1.4);
  return luminance(direct.map((channel, index) => channel + (ambient[index] ?? 0)) as [number, number, number]);
}

describe("time-of-day profiles", () => {
  it("keeps the glow in step with retint's lamp emissive", () => {
    for (const hour of HOURS) expect(PROFILES[hour].glow).toBe(lampEmissiveIntensity(hour));
  });

  it("never lets the sun bloom plaster (STYLE.md §2: emissive lamps only)", () => {
    for (const hour of HOURS) {
      const profile = PROFILES[hour];
      const brightest = litPlaster(profile.keyHex, profile.keyIntensity, profile.fillIntensity);
      expect(brightest, `${hour} plaster ${brightest.toFixed(2)} vs threshold ${profile.bloom}`)
        .toBeLessThan(profile.bloom);
    }
  });

  it("still blooms every lamp in the evening", () => {
    // An ochre shade at the evening emissive intensity, which is what the bloom is for.
    const shade = linearHex("#C9A44C").map((channel) => channel * PROFILES.evening.glow) as [number, number, number];
    expect(luminance(shade)).toBeGreaterThan(PROFILES.evening.bloom);
  });

  it("leaves the golden lamp below bloom, so only dusk glows", () => {
    const shade = linearHex("#C9A44C").map((channel) => channel * PROFILES.golden.glow) as [number, number, number];
    expect(luminance(shade)).toBeLessThan(PROFILES.golden.bloom);
  });

  it("interpolates every number and colour of the profile, bloom included", () => {
    const middle = lerpProfile(PROFILES.golden, PROFILES.evening, 0.5);
    expect(middle.bloom).toBeCloseTo((PROFILES.golden.bloom + PROFILES.evening.bloom) / 2, 6);
    expect(middle.elevation).toBeCloseTo((21 + 13) / 2, 6);
    expect(middle.keyHex).toMatch(/^#[0-9A-F]{6}$/i);
    expect(lerpProfile(PROFILES.golden, PROFILES.evening, 0)).toMatchObject({ bloom: PROFILES.golden.bloom });
    expect(lerpProfile(PROFILES.golden, PROFILES.evening, 1)).toMatchObject({ bloom: PROFILES.evening.bloom });
  });
});

describe("plan-view softening", () => {
  it("leaves dollhouse view exactly as authored", () => {
    for (const hour of HOURS) expect(planSoften(PROFILES[hour], 0)).toBe(PROFILES[hour]);
  });

  it("lifts the sun to nearly overhead and trades key for fill", () => {
    const plan = planSoften(PROFILES.golden, 1);
    expect(plan.elevation).toBe(PLAN_ELEVATION);
    expect(plan.keyIntensity).toBeLessThan(PROFILES.golden.keyIntensity);
    expect(plan.fillIntensity).toBeGreaterThan(PROFILES.golden.fillIntensity);
    expect(plan.azimuth).toBe(PROFILES.golden.azimuth);
    expect(plan.bloom).toBe(PROFILES.golden.bloom);
  });

  it("never lowers a sun that is already high (noon keeps its own elevation)", () => {
    expect(planSoften(PROFILES.noon, 1).elevation).toBe(PLAN_ELEVATION);
    const high = planSoften({ ...PROFILES.noon, elevation: 82 }, 1);
    expect(high.elevation).toBe(82);
  });

  it("cuts golden hour's wall shadow from most of the room to about a metre", () => {
    const before = shadowLengthM(WALL_M, PROFILES.golden.elevation);
    const after = shadowLengthM(WALL_M, planSoften(PROFILES.golden, 1).elevation);
    expect(before).toBeGreaterThan(6);
    expect(after).toBeLessThan(0.9);
  });

  it("eases with the camera tween rather than jumping", () => {
    const half = planSoften(PROFILES.golden, 0.5);
    expect(half.elevation).toBeCloseTo((PROFILES.golden.elevation + PLAN_ELEVATION) / 2, 6);
  });
});
