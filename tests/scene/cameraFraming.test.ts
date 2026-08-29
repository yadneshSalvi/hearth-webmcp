import { beforeEach, describe, expect, it } from "vitest";
import { polyBBox, roomAreaM2 } from "@/src/engine/geometry";
import { createTemplate } from "@/src/engine/templates";
import { TEMPLATE_IDS } from "@/src/engine/types";
import type { TemplateId } from "@/src/engine/types";
import { hearthStore } from "@/src/state/store";
import {
  focusKind,
  getFocusTarget,
  isHomeFocus,
  setFocusTarget,
  toggleHomeFocus,
} from "@/src/scene/focus";
import { watchHomeFraming } from "@/src/scene/homeFocus";
import { cameraBridgeSnapshot, resetCameraStateForTests } from "@/src/scene/cameraState";
import { M, WALL_T, homeCentreCm, wallOpacity, wholeHomeBox } from "@/src/scene/math";

/** The biggest bedroom plan the engine ships — 2br today, 5br once the new templates land. */
const BIGGEST: TemplateId = [...TEMPLATE_IDS]
  .filter((id) => /^\d+br$/.test(id))
  .sort((a, b) => Number(a.replace("br", "")) - Number(b.replace("br", "")))
  .at(-1) ?? "2br";

describe("the whole-home box", () => {
  it("wraps every room's walls and centres on the footprint, for every template", () => {
    for (const id of TEMPLATE_IDS) {
      const rooms = createTemplate(id).rooms;
      const box = wholeHomeBox(rooms);
      const pad = WALL_T * M;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const room of rooms) {
        const bounds = polyBBox(room.poly);
        minX = Math.min(minX, room.origin.x + bounds.minX);
        minY = Math.min(minY, room.origin.y + bounds.minY);
        maxX = Math.max(maxX, room.origin.x + bounds.maxX);
        maxY = Math.max(maxY, room.origin.y + bounds.maxY);
        // Every room, walls and all, has to be inside the framed volume.
        expect(room.origin.x + bounds.minX, `${id}/${room.id} west`).toBeGreaterThanOrEqual(box.min[0] / M - 0.001);
        expect(room.origin.y + bounds.maxY, `${id}/${room.id} south`).toBeLessThanOrEqual(box.max[2] / M + 0.001);
      }
      // The pad is the wall thickness, exactly as `roomBox` inflates a single room.
      expect(box.min[0]).toBeCloseTo(minX * M - pad, 6);
      expect(box.min[2]).toBeCloseTo(minY * M - pad, 6);
      expect(box.max[0]).toBeCloseTo(maxX * M + pad, 6);
      expect(box.max[2]).toBeCloseTo(maxY * M + pad, 6);
      // Floor to wall top, never below the floor.
      expect(box.min[1]).toBe(0);
      expect(box.max[1]).toBeCloseTo(2.6, 6);

      const centre = homeCentreCm(rooms);
      expect(centre.x).toBeCloseTo((minX + maxX) / 2, 6);
      expect(centre.y).toBeCloseTo((minY + maxY) / 2, 6);
    }
  });

  it("frames the biggest plan whole: its area is the sum of its rooms", () => {
    const rooms = createTemplate(BIGGEST, { furnished: true }).rooms;
    const total = rooms.reduce((sum, room) => sum + roomAreaM2(room), 0);
    expect(rooms.length).toBeGreaterThanOrEqual(6);
    expect(total).toBeGreaterThan(70);
    const box = wholeHomeBox(rooms);
    // A home is wider than one room: the framed volume has to be bigger than any single room box.
    for (const room of rooms) {
      const bounds = polyBBox(room.poly);
      expect((box.max[0] - box.min[0]) / M, room.id).toBeGreaterThanOrEqual(bounds.w);
      expect((box.max[2] - box.min[2]) / M, room.id).toBeGreaterThanOrEqual(bounds.d);
    }
  });
});

describe("the wall cut-away with the whole home framed", () => {
  const azimuth = (-45 * Math.PI) / 180;
  const pitch = Math.atan(1 / Math.SQRT2);
  // A wall on the far side of a 12 m home, facing away from the camera: it should stand.
  const outwardAway = { x: 0, y: -1 };
  const samplesFar = [{ x: 500, y: 100 }];
  const homeCentre = { x: 500, y: 860 };

  it("keeps a back wall opaque that the in-front test would have cut", () => {
    // A wall 7.6 m *behind* the centre is untouched either way; the interesting case is in front.
    const samplesFront = [{ x: 500, y: 1600 }];
    expect(wallOpacity(outwardAway, samplesFront, homeCentre, azimuth, pitch)).toBeLessThan(0.5);
    expect(wallOpacity(outwardAway, samplesFront, homeCentre, azimuth, pitch, { cutInFront: false })).toBe(1);
  });

  it("still cuts a wall whose outward face is turned to the camera", () => {
    const outwardToCamera = { x: -Math.SQRT1_2, y: Math.SQRT1_2 };
    expect(wallOpacity(outwardToCamera, samplesFar, homeCentre, azimuth, pitch, { cutInFront: false })).toBeLessThan(0.05);
  });

  it("is unchanged for a room focus (the default)", () => {
    expect(wallOpacity(outwardAway, samplesFar, homeCentre, azimuth, pitch))
      .toBe(wallOpacity(outwardAway, samplesFar, homeCentre, azimuth, pitch, { cutInFront: true }));
  });
});

describe("the focus override", () => {
  beforeEach(() => {
    setFocusTarget(undefined);
    resetCameraStateForTests();
    hearthStore.getState().setView("human", { view: "dollhouse", yaw: "sw" });
  });

  it("frames the home, and a room focus clears it", () => {
    expect(focusKind()).toBe("room");
    setFocusTarget({ home: true });
    expect(isHomeFocus()).toBe(true);
    expect(focusKind()).toBe("home");
    expect(cameraBridgeSnapshot().focus).toBe("home");

    setFocusTarget({ roomId: "living" });
    expect(isHomeFocus()).toBe(false);
    expect(focusKind()).toBe("room");
    expect(getFocusTarget()).toEqual({ roomId: "living" });

    setFocusTarget({ itemId: "sofa-1" });
    expect(focusKind()).toBe("item");
    expect(cameraBridgeSnapshot().focus).toBe("item");
  });

  it("toggles, and publishes a fresh object so the rig treats it as a framing command", () => {
    toggleHomeFocus();
    const first = getFocusTarget();
    expect(first?.home).toBe(true);
    setFocusTarget({ home: true });
    expect(getFocusTarget()).not.toBe(first);
    toggleHomeFocus();
    expect(getFocusTarget()).toBeUndefined();
  });

  it("ignores an empty target", () => {
    setFocusTarget({});
    expect(getFocusTarget()).toBeUndefined();
    expect(focusKind()).toBe("room");
  });
});

describe("framing the home after a template apply", () => {
  let stop = (): void => undefined;

  beforeEach(() => {
    setFocusTarget(undefined);
    stop();
    stop = watchHomeFraming();
  });

  it("pulls back to the whole home when a template lands", () => {
    hearthStore.getState().applyTemplate("human", BIGGEST, true);
    expect(isHomeFocus()).toBe(true);
    expect(hearthStore.getState().scene.meta.template).toBe(BIGGEST);
  });

  it("re-frames on a second apply, including the same template twice", () => {
    hearthStore.getState().applyTemplate("agent", "studio", false);
    expect(isHomeFocus()).toBe(true);
    setFocusTarget(undefined);
    hearthStore.getState().applyTemplate("agent", "studio", false);
    expect(isHomeFocus()).toBe(true);
  });

  it("lets go of the home shot as soon as another room is activated", () => {
    hearthStore.getState().applyTemplate("human", "2br", false);
    expect(isHomeFocus()).toBe(true);
    const other = hearthStore.getState().scene.rooms.find((room) => room.id !== hearthStore.getState().scene.meta.activeRoomId);
    expect(other).toBeTruthy();
    hearthStore.getState().setActiveRoom("human", other!.id);
    expect(isHomeFocus()).toBe(false);
  });

  it("does not fire for a room edit", () => {
    hearthStore.getState().applyTemplate("human", "2br", false);
    setFocusTarget(undefined);
    const room = hearthStore.getState().scene.rooms[0]!;
    hearthStore.getState().updateRoom("human", room.id, { name: "Renamed" });
    expect(isHomeFocus()).toBe(false);
    hearthStore.getState().createRoom("human", {
      name: "Utility", type: "hall", width_cm: 200, depth_cm: 200, place: "east_of", relative_to: room.id,
    });
    expect(isHomeFocus()).toBe(false);
  });
});
