import { describe, expect, it } from "vitest";
import {
  DOLLHOUSE_PITCH,
  PLAN_PITCH,
  cameraOffset,
  cameraPosition,
  cameraRight,
  cameraUp,
  boxCentre,
  boxCorners,
  cubicBezier,
  fitHalfHeight,
  homeBox,
  roomBox,
  nearestAngle,
  rotationRadians,
  WALL_FADED,
  wallFadeOpacity,
  wallOpacity,
  yawAzimuth,
} from "@/src/scene/math";
import type { Vec3 } from "@/src/scene/math";
import { createTemplate } from "@/src/engine/templates";

const DEG = Math.PI / 180;

describe("yaw → camera position", () => {
  it("maps each corner to a 45° azimuth", () => {
    expect(yawAzimuth("sw") / DEG).toBeCloseTo(-45);
    expect(yawAzimuth("se") / DEG).toBeCloseTo(45);
    expect(yawAzimuth("ne") / DEG).toBeCloseTo(135);
    expect(yawAzimuth("nw") / DEG).toBeCloseTo(-135);
  });

  it("places the sw camera to the south-west, looking north-east", () => {
    const offset = cameraOffset(yawAzimuth("sw"), DOLLHOUSE_PITCH);
    expect(offset[0]).toBeLessThan(0); // west
    expect(offset[2]).toBeGreaterThan(0); // south
    expect(offset[1]).toBeCloseTo(Math.sin(DOLLHOUSE_PITCH), 6);
  });

  it("puts every dollhouse corner on the matching compass quadrant", () => {
    const quadrants: Record<string, [number, number]> = { sw: [-1, 1], se: [1, 1], ne: [1, -1], nw: [-1, -1] };
    for (const [yaw, [sx, sz]] of Object.entries(quadrants)) {
      const offset = cameraOffset(yawAzimuth(yaw as "sw"), DOLLHOUSE_PITCH);
      expect(Math.sign(Number(offset[0].toFixed(6)))).toBe(sx);
      expect(Math.sign(Number(offset[2].toFixed(6)))).toBe(sz);
    }
  });

  it("uses the isometric 35.264° pitch", () => {
    expect(DOLLHOUSE_PITCH / DEG).toBeCloseTo(35.264, 2);
  });

  it("keeps screen right east-ish and screen up toward the far corner", () => {
    const azimuth = yawAzimuth("sw");
    const right = cameraRight(azimuth);
    const up = cameraUp(azimuth, DOLLHOUSE_PITCH);
    // From the south-west, right points south-east and up points north-east.
    expect(right[0]).toBeGreaterThan(0);
    expect(right[2]).toBeGreaterThan(0);
    expect(up[0]).toBeGreaterThan(0);
    expect(up[2]).toBeLessThan(0);
    expect(up[1]).toBeCloseTo(Math.cos(DOLLHOUSE_PITCH), 6);
  });

  it("points plan view straight down with north up", () => {
    const up = cameraUp(0, PLAN_PITCH);
    expect(up[0]).toBeCloseTo(0, 6);
    expect(up[1]).toBeCloseTo(0, 6);
    expect(up[2]).toBeCloseTo(-1, 6);
    const offset = cameraOffset(0, PLAN_PITCH);
    expect(offset[1]).toBeCloseTo(1, 6);
  });

  it("positions the camera at the requested distance from the framed centre", () => {
    const position = cameraPosition([1, 0, 2], yawAzimuth("ne"), DOLLHOUSE_PITCH, 10);
    const distance = Math.hypot(position[0] - 1, position[1] - 0, position[2] - 2);
    expect(distance).toBeCloseTo(10, 6);
  });
});

describe("orthographic fit", () => {
  const box = { min: [0, 0, 0] as [number, number, number], max: [5.2, 2.6, 4.4] as [number, number, number] };

  it("frames the box with the requested padding", () => {
    const bare = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, 16 / 9, 0);
    const padded = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, 16 / 9, 0.12);
    expect(padded / bare).toBeCloseTo(1.12, 6);
  });

  it("scales linearly with the box", () => {
    const small = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, 1.6, 0.12);
    const big = fitHalfHeight(
      { min: [0, 0, 0], max: [10.4, 5.2, 8.8] },
      yawAzimuth("sw"),
      DOLLHOUSE_PITCH,
      1.6,
      0.12,
    );
    expect(big / small).toBeCloseTo(2, 6);
  });

  it("grows when the viewport gets narrower", () => {
    const wide = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, 1.6, 0.12);
    const narrow = fitHalfHeight(box, yawAzimuth("sw"), DOLLHOUSE_PITCH, 0.6, 0.12);
    expect(narrow).toBeGreaterThan(wide);
  });

  it("fits a plan view to the floor rectangle", () => {
    // At the room's own aspect the depth sets the half-height; at 1:1 the wider axis wins.
    expect(fitHalfHeight(box, 0, PLAN_PITCH, 5.2 / 4.4, 0)).toBeCloseTo(4.4 / 2, 6);
    expect(fitHalfHeight(box, 0, PLAN_PITCH, 1, 0)).toBeCloseTo(5.2 / 2, 6);
  });

  it("covers the whole 2BR home", () => {
    const home = homeBox(createTemplate("2br").rooms);
    expect(home.min).toEqual([0, 0, 0]);
    expect(home.max[0]).toBeCloseTo(8.8, 6);
    expect(home.max[2]).toBeCloseTo(10, 6);
    expect(home.max[1]).toBeCloseTo(2.6, 6);
  });
});

describe("framing never clips the room it frames", () => {
  const YAWS = ["nw", "ne", "se", "sw"] as const;
  const ASPECTS = [1440 / 900, 1280 / 800, 1920 / 1080, 1024 / 1366];

  /** Projects a world point into normalised device coordinates for an orthographic fit. */
  function project(point: Vec3, centre: Vec3, azimuth: number, pitch: number, half: number, aspect: number) {
    const right = cameraRight(azimuth);
    const up = cameraUp(azimuth, pitch);
    const dx = point[0] - centre[0];
    const dy = point[1] - centre[1];
    const dz = point[2] - centre[2];
    return {
      x: (dx * right[0] + dy * right[1] + dz * right[2]) / (half * aspect),
      y: (dx * up[0] + dy * up[1] + dz * up[2]) / half,
    };
  }

  it("keeps every corner of every 2BR room inside the frame at every yaw and aspect", () => {
    const scene = createTemplate("2br", { furnished: true });
    for (const room of scene.rooms) {
      const box = roomBox(room);
      const centre = boxCentre(box);
      for (const yaw of YAWS) {
        for (const aspect of ASPECTS) {
          const azimuth = yawAzimuth(yaw);
          const half = fitHalfHeight(box, azimuth, DOLLHOUSE_PITCH, aspect, 0.12);
          for (const corner of boxCorners(box)) {
            const ndc = project(corner, centre, azimuth, DOLLHOUSE_PITCH, half, aspect);
            expect(Math.abs(ndc.x), `${room.id} ${yaw} ${aspect.toFixed(2)} x`).toBeLessThanOrEqual(1);
            expect(Math.abs(ndc.y), `${room.id} ${yaw} ${aspect.toFixed(2)} y`).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });

  it("leaves the promised 12 % of padding on the tightest axis", () => {
    const room = createTemplate("2br").rooms[0];
    expect(room).toBeDefined();
    const box = roomBox(room as Parameters<typeof roomBox>[0]);
    const centre = boxCentre(box);
    const azimuth = yawAzimuth("sw");
    const half = fitHalfHeight(box, azimuth, DOLLHOUSE_PITCH, 1440 / 900, 0.12);
    let tightest = 0;
    for (const corner of boxCorners(box)) {
      const ndc = project(corner, centre, azimuth, DOLLHOUSE_PITCH, half, 1440 / 900);
      tightest = Math.max(tightest, Math.abs(ndc.x), Math.abs(ndc.y));
    }
    expect(tightest).toBeCloseTo(1 / 1.12, 4);
  });

  it("includes the outward wall thickness, so a room's own walls cannot clip", () => {
    const room = createTemplate("2br").rooms[0];
    expect(room).toBeDefined();
    const bare = homeBox([room as Parameters<typeof roomBox>[0]]);
    const framed = roomBox(room as Parameters<typeof roomBox>[0]);
    expect(bare.min[0] - framed.min[0]).toBeCloseTo(0.12, 6);
    expect(framed.max[2] - bare.max[2]).toBeCloseTo(0.12, 6);
    expect(framed.max[1]).toBeCloseTo(bare.max[1], 6);
  });
});

describe("angle and easing helpers", () => {
  it("takes the short way round", () => {
    expect(nearestAngle(170 * DEG, -170 * DEG) / DEG).toBeCloseTo(190, 6);
    expect(nearestAngle(-170 * DEG, 170 * DEG) / DEG).toBeCloseTo(-190, 6);
    expect(nearestAngle(0, 45 * DEG) / DEG).toBeCloseTo(45, 6);
  });

  it("maps rotation to the mesh Y angle (0 = front faces south)", () => {
    expect(rotationRadians(0)).toBeCloseTo(Math.PI, 6);
    expect(rotationRadians(90)).toBeCloseTo(Math.PI / 2, 6);
    expect(rotationRadians(180)).toBeCloseTo(0, 6);
    expect(rotationRadians(270)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it("eases out from 0 to 1", () => {
    const ease = cubicBezier(0.22, 1, 0.36, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    expect(ease(0.25)).toBeGreaterThan(0.25);
    expect(ease(0.5)).toBeGreaterThan(0.8);
  });
});

describe("wall auto-fade", () => {
  it("fades walls whose outward normal faces the camera", () => {
    const azimuth = yawAzimuth("sw");
    expect(wallFadeOpacity({ x: 0, y: 1 }, azimuth, DOLLHOUSE_PITCH)).toBeCloseTo(0.12, 6); // south wall
    expect(wallFadeOpacity({ x: -1, y: 0 }, azimuth, DOLLHOUSE_PITCH)).toBeCloseTo(0.12, 6); // west wall
    expect(wallFadeOpacity({ x: 0, y: -1 }, azimuth, DOLLHOUSE_PITCH)).toBeCloseTo(1, 6); // north wall
    expect(wallFadeOpacity({ x: 1, y: 0 }, azimuth, DOLLHOUSE_PITCH)).toBeCloseTo(1, 6); // east wall
  });

  it("keeps every wall opaque in plan view", () => {
    for (const outward of [{ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 0, y: -1 }, { x: 1, y: 0 }]) {
      expect(wallFadeOpacity(outward, 0, PLAN_PITCH)).toBe(1);
    }
  });

  it("also cuts away a neighbouring room's wall that stands in front of the framed room", () => {
    const azimuth = yawAzimuth("sw");
    const focus = { x: 260, y: 220 };
    // bed-1's north wall: outward faces north (away from the camera) but sits south of the living room.
    const inFront = wallOpacity({ x: 0, y: -1 }, [{ x: 0, y: 440 }, { x: 200, y: 440 }, { x: 400, y: 440 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(inFront).toBeCloseTo(WALL_FADED, 6);
    // The kitchen's north wall is behind the living room and stays solid as a backdrop.
    const behind = wallOpacity({ x: 0, y: -1 }, [{ x: 520, y: 0 }, { x: 700, y: 0 }, { x: 880, y: 0 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(behind).toBeCloseTo(1, 6);
  });

  it("keeps the framed room's own far walls solid and cuts its near walls", () => {
    const azimuth = yawAzimuth("sw");
    const focus = { x: 260, y: 220 };
    const north = wallOpacity({ x: 0, y: -1 }, [{ x: 0, y: 0 }, { x: 260, y: 0 }, { x: 520, y: 0 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(north).toBeCloseTo(1, 6);
    const south = wallOpacity({ x: 0, y: 1 }, [{ x: 0, y: 440 }, { x: 260, y: 440 }, { x: 520, y: 440 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(south).toBeCloseTo(WALL_FADED, 6);
    const west = wallOpacity({ x: -1, y: 0 }, [{ x: 0, y: 0 }, { x: 0, y: 220 }, { x: 0, y: 440 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(west).toBeCloseTo(WALL_FADED, 6);
    const east = wallOpacity({ x: 1, y: 0 }, [{ x: 520, y: 0 }, { x: 520, y: 220 }, { x: 520, y: 440 }], focus, azimuth, DOLLHOUSE_PITCH);
    expect(east).toBeCloseTo(1, 6);
  });
});
