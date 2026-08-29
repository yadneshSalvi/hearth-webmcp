import { beforeEach, describe, expect, it } from "vitest";
import {
  DOLLHOUSE_PITCH,
  DOLLHOUSE_PITCH_DEG,
  PITCH_MAX_DEG,
  PITCH_MIN_DEG,
  VIEW_STEP_DEG,
  YAW_DEGREES,
  clampPitchDeg,
  fitHalfHeight,
  fitHalfHeightWorst,
  normalizeDeg,
  quantizeDeg,
  roomBox,
  stepAzimuth,
  viewStopAzimuths,
  yawAtDegrees,
  yawAzimuth,
} from "@/src/scene/math";
import {
  cameraBridgeSnapshot,
  cameraOffHome,
  consumeFramingSkip,
  effectiveOrbit,
  getCameraState,
  orbitBy,
  panByPixels,
  resetCamera,
  resetCameraStateForTests,
  setCameraPanLimit,
  setCameraPixelScale,
  setCameraPlanView,
  setOrbit,
  stepView,
  subscribeCamera,
  zoomBy,
} from "@/src/scene/cameraState";
import { createTemplate } from "@/src/engine/templates";
import { hearthStore } from "@/src/state/store";
import type { Yaw } from "@/src/engine/types";

const YAWS: Yaw[] = ["sw", "se", "ne", "nw"];
const DEG = Math.PI / 180;

describe("angle helpers", () => {
  it("normalises degrees into (−180, 180]", () => {
    expect(normalizeDeg(0)).toBe(0);
    expect(normalizeDeg(45)).toBe(45);
    expect(normalizeDeg(180)).toBe(180);
    expect(normalizeDeg(-180)).toBe(180);
    expect(normalizeDeg(190)).toBe(-170);
    expect(normalizeDeg(-190)).toBe(170);
    expect(normalizeDeg(540)).toBe(180);
    expect(normalizeDeg(-450)).toBe(-90);
    expect(normalizeDeg(Number.NaN)).toBe(0);
  });

  it("clamps the effective pitch to the free-orbit range", () => {
    expect(clampPitchDeg(0)).toBe(PITCH_MIN_DEG);
    expect(clampPitchDeg(90)).toBe(PITCH_MAX_DEG);
    expect(clampPitchDeg(DOLLHOUSE_PITCH_DEG)).toBeCloseTo(DOLLHOUSE_PITCH_DEG, 6);
    expect(PITCH_MIN_DEG).toBeLessThan(DOLLHOUSE_PITCH_DEG);
    expect(PITCH_MAX_DEG).toBeGreaterThan(DOLLHOUSE_PITCH_DEG);
  });

  it("quantises onto a grid and never returns −0", () => {
    expect(quantizeDeg(7.4, 4)).toBe(8);
    expect(quantizeDeg(-7.4, 4)).toBe(-8);
    expect(quantizeDeg(-1, 4)).toBe(0);
    expect(Object.is(quantizeDeg(-1, 4), -0)).toBe(false);
    expect(quantizeDeg(13, 0)).toBe(13);
  });

  it("recognises the four corners and refuses the elevations", () => {
    for (const yaw of YAWS) expect(yawAtDegrees(YAW_DEGREES[yaw])).toBe(yaw);
    expect(yawAtDegrees(-135 - 360)).toBe("nw");
    for (const elevation of [0, 90, 180, -90]) expect(yawAtDegrees(elevation)).toBeUndefined();
  });
});

describe("45° view steps", () => {
  const effective = (yaw: Yaw, offsetDeg: number) => normalizeDeg(YAW_DEGREES[yaw] + offsetDeg);

  it("moves exactly one 45° notch from every corner and offset, both ways", () => {
    for (const yaw of YAWS) {
      for (const offset of [-45, 0, 45]) {
        for (const direction of [1, -1]) {
          const next = stepAzimuth(yaw, offset, direction);
          const from = effective(yaw, offset);
          const to = effective(next.yaw, next.offsetDeg);
          expect(normalizeDeg(to - from), `${yaw}${offset} ${direction}`).toBeCloseTo(direction * VIEW_STEP_DEG, 6);
          expect([-45, 0, 45]).toContain(next.offsetDeg);
          expect(YAWS).toContain(next.yaw);
        }
      }
    }
  });

  it("lands on the south elevation from sw, then on the se corner", () => {
    const south = stepAzimuth("sw", 0, 1);
    expect(south).toEqual({ yaw: "sw", offsetDeg: 45 });
    const corner = stepAzimuth(south.yaw, south.offsetDeg, 1);
    expect(corner).toEqual({ yaw: "se", offsetDeg: 0 });
  });

  it("wraps past due north without a long way round", () => {
    const north = stepAzimuth("nw", -45, 1);
    // nw − 45 = 180: stepping clockwise from due north returns to the nw corner.
    expect(north).toEqual({ yaw: "nw", offsetDeg: 0 });
    const back = stepAzimuth("nw", 0, -1);
    expect(back).toEqual({ yaw: "nw", offsetDeg: -45 });
    expect(normalizeDeg(YAW_DEGREES[back.yaw] + back.offsetDeg)).toBe(180);
  });

  it("snaps a freely orbited camera onto the next stop in the direction asked", () => {
    const forward = stepAzimuth("sw", 20, 1);
    expect(normalizeDeg(YAW_DEGREES[forward.yaw] + forward.offsetDeg)).toBe(0);
    const backward = stepAzimuth("sw", 20, -1);
    expect(normalizeDeg(YAW_DEGREES[backward.yaw] + backward.offsetDeg)).toBe(-45);
    const far = stepAzimuth("se", 125, 1);
    expect(normalizeDeg(YAW_DEGREES[far.yaw] + far.offsetDeg)).toBe(180);
  });

  it("keeps the corner it is already on when the target is an elevation beside it", () => {
    // Only an elevation forces the choice; the corner that needs no store write wins.
    expect(stepAzimuth("se", -80, 1).yaw).toBe("se");
    expect(stepAzimuth("se", -80, 1).offsetDeg).toBe(-45);
  });
});

describe("framing survives the free orbit", () => {
  it("keeps every 45° stop at both pitch extremes inside the corner's padded frame", () => {
    const scene = createTemplate("2br", { furnished: true });
    // The visible rect at 1440 × 900 with the catalog and the inspector open.
    const aspect = (1440 - 368 - 388) / (900 - 96 - 96);
    for (const room of scene.rooms) {
      const box = roomBox(room);
      const framed = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, aspect, 0.12);
      // The worst stop measured with no padding at all has to fit inside the padded framed shot,
      // which is what "the orbit never clips the room" means. Measured headroom is ~9 %.
      expect(fitHalfHeightWorst(box, aspect, 0), room.id).toBeLessThanOrEqual(framed);
    }
  });

  it("offers the eight stops as azimuths", () => {
    const stops = viewStopAzimuths().map((radians) => Math.round(radians / DEG));
    expect(stops).toEqual([-135, -90, -45, 0, 45, 90, 135, 180]);
  });
});

describe("camera state store", () => {
  beforeEach(() => {
    resetCameraStateForTests();
    hearthStore.getState().setView("human", { view: "dollhouse", yaw: "sw" });
  });

  it("starts on the framed shot", () => {
    expect(cameraOffHome()).toBe(false);
    expect(getCameraState().zoom).toBe(1);
    expect(effectiveOrbit()).toEqual({ azimuthDeg: 0, pitchDeg: 0 });
  });

  it("orbits immediately, normalises the azimuth and clamps the effective pitch", () => {
    orbitBy(200, 0);
    expect(getCameraState().orbit.azimuthDeg).toBe(-160);
    expect(getCameraState().mode).toBe("immediate");
    orbitBy(0, 400);
    expect(DOLLHOUSE_PITCH_DEG + getCameraState().orbit.pitchDeg).toBeCloseTo(PITCH_MAX_DEG, 6);
    orbitBy(0, -400);
    expect(DOLLHOUSE_PITCH_DEG + getCameraState().orbit.pitchDeg).toBeCloseTo(PITCH_MIN_DEG, 6);
    expect(cameraOffHome()).toBe(true);
  });

  it("tweens a commanded orbit", () => {
    setOrbit(45, 0, { tween: true });
    expect(getCameraState().mode).toBe("tween");
  });

  it("pans in metres per pixel and clamps to the limit", () => {
    setCameraPixelScale(0.02);
    setCameraPanLimit(4);
    panByPixels(100, -50);
    expect(getCameraState().pan).toEqual({ x: -2, y: -1 });
    panByPixels(-1000, 0);
    expect(getCameraState().pan.x).toBe(4);
  });

  it("clamps the zoom", () => {
    zoomBy(100);
    expect(getCameraState().zoom).toBe(2.2);
    zoomBy(0.0001);
    expect(getCameraState().zoom).toBe(0.6);
    zoomBy(0);
    expect(getCameraState().zoom).toBe(0.6);
  });

  it("re-homes on reset and notifies once", () => {
    let notifications = 0;
    const stop = subscribeCamera(() => { notifications += 1; });
    orbitBy(30, 5);
    zoomBy(1.4);
    const before = notifications;
    resetCamera({ tween: true });
    expect(notifications).toBe(before + 1);
    expect(cameraOffHome()).toBe(false);
    // Already home: nothing to publish.
    resetCamera({ tween: true });
    expect(notifications).toBe(before + 1);
    stop();
  });

  it("is inert in plan view and resets the orbit on the way in", () => {
    orbitBy(30, 10);
    setCameraPlanView(true);
    expect(effectiveOrbit()).toEqual({ azimuthDeg: 0, pitchDeg: 0 });
    orbitBy(30, 10);
    expect(getCameraState().orbit).toEqual({ azimuthDeg: 0, pitchDeg: 0 });
    setCameraPlanView(false);
    orbitBy(30, 0);
    expect(getCameraState().orbit.azimuthDeg).toBe(30);
  });

  it("steps the view: the corner goes to the scene, the remainder to the offset", () => {
    expect(consumeFramingSkip()).toBe(false);
    stepView(1);
    expect(hearthStore.getState().scene.meta.yaw).toBe("sw");
    expect(getCameraState().orbit.azimuthDeg).toBe(45);
    // An offset-only step writes no yaw, so it must not swallow the next framing reset.
    expect(consumeFramingSkip()).toBe(false);

    stepView(1);
    expect(hearthStore.getState().scene.meta.yaw).toBe("se");
    expect(getCameraState().orbit.azimuthDeg).toBe(0);
    expect(consumeFramingSkip()).toBe(true);
    expect(consumeFramingSkip()).toBe(false);
  });

  it("keeps the tilt through a 45° step and reports effective angles to the bridge", () => {
    orbitBy(0, 20);
    stepView(1);
    const bridge = cameraBridgeSnapshot();
    expect(bridge.azimuthDeg).toBe(0);
    expect(bridge.pitchDeg).toBeCloseTo(DOLLHOUSE_PITCH_DEG + 20, 6);
    expect(bridge.view).toBe("dollhouse");
    expect(bridge.offHome).toBe(true);
  });

  it("reports plan view as north-up from directly above", () => {
    hearthStore.getState().setView("human", { view: "plan" });
    setCameraPlanView(true);
    const bridge = cameraBridgeSnapshot();
    expect(bridge.azimuthDeg).toBe(0);
    expect(bridge.pitchDeg).toBeCloseTo(90, 6);
    // A plan-view step is refused outright: the rotate buttons are disabled there.
    stepView(1);
    expect(hearthStore.getState().scene.meta.yaw).toBe("sw");
  });
});
