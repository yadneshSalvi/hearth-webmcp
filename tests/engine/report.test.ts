import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import { designReport } from "../../src/engine/report";
import type { Conflict, Scene } from "../../src/engine/types";
import { emptyHome, furnished2br, worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

function issue(index: number, kind: Conflict["kind"] = "traffic", severity: Conflict["severity"] = "error"): Conflict {
  return {
    kind,
    items: [`item-${index}`],
    roomId: "living",
    detail: `issue ${index}`,
    fix: `move item-${index} 40 cm east`,
    severity,
  };
}

function worstConflicts(): Conflict[] {
  return Array.from({ length: 12 }, (_, index) => issue(
    index,
    index % 3 === 0 ? "traffic" : index % 3 === 1 ? "access_path" : "door_swing",
    index % 2 === 0 ? "error" : "warn",
  ));
}

describe("designReport", () => {
  it("snapshots the furnished living room", () => {
    expect(designReport(furnished2br(), "living", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 99,
        "scores": {
          "balance": 10,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 9,
          "storage": 10,
          "traffic": 10,
        },
        "suggestions": [],
        "summary": "Living Room feels settled and practical. Balance works best; lighting needs the most care.",
      }
    `);
  });

  it("snapshots the furnished main bedroom", () => {
    expect(designReport(furnished2br(), "bed-1", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 96,
        "scores": {
          "balance": 9,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 10,
          "storage": 8,
          "traffic": 10,
        },
        "suggestions": [],
        "summary": "Main Bedroom feels settled and practical. Calm is 10/10; storage needs the most care.",
      }
    `);
  });

  it("snapshots the furnished second bedroom", () => {
    expect(designReport(furnished2br(), "bed-2", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 91,
        "scores": {
          "balance": 10,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 10,
          "storage": 4,
          "traffic": 10,
        },
        "suggestions": [
          "Add a wardrobe on a clear wall in bed-2, keeping 70 cm open in front.",
        ],
        "summary": "Second Bedroom feels settled and practical. Calm is 10/10; storage needs the most care.",
      }
    `);
  });

  it("snapshots the furnished kitchen and dining room", () => {
    expect(designReport(furnished2br(), "kitchen", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 97,
        "scores": {
          "balance": 8,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 10,
          "storage": 7,
          "traffic": 10,
        },
        "suggestions": [],
        "summary": "Kitchen & Dining feels settled and practical. Table seating works best; balance needs the most care.",
      }
    `);
  });

  it("meets the furnished 2BR room calibration floors", () => {
    const scene = furnished2br();
    expect(designReport(scene, "living", catalog, []).score).toBeGreaterThanOrEqual(85);
    expect(designReport(scene, "bed-1", catalog, []).score).toBeGreaterThanOrEqual(85);
    expect(designReport(scene, "kitchen", catalog, []).score).toBeGreaterThanOrEqual(75);
    expect(designReport(scene, "bed-2", catalog, []).score).toBeGreaterThanOrEqual(65);
  });

  it("snapshots an empty room", () => {
    expect(designReport(emptyHome(), "living", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 20,
        "scores": {
          "balance": 0,
          "conversation": 0,
          "focal_point": 0,
          "lighting": 0,
          "storage": 0,
          "traffic": 10,
        },
        "suggestions": [
          "Start with a sofa against a clear wall, keeping a 60 cm route between openings.",
          "Add a warm floor lamp, keeping it within 150 cm of the room's main activity.",
          "Add a shelf on a clear wall in living, keeping 70 cm open in front.",
        ],
        "summary": "Living Room is ready for its anchor piece; start there, then let warm light and clear routes shape the room.",
      }
    `);
  });

  it("snapshots the adversarial room with traffic conflicts", () => {
    expect(designReport(worstCase2br(), "living", catalog, worstConflicts())).toMatchInlineSnapshot(`
      {
        "score": 62,
        "scores": {
          "balance": 10,
          "conversation": 3,
          "focal_point": 10,
          "lighting": 7,
          "storage": 10,
          "traffic": 0,
        },
        "suggestions": [
          "Clear the route: move item-0 40 cm east.",
          "Place another seat within 250 cm of sofa-1, with the two seats turned toward each other.",
          "Add a warm lamp within 150 cm of chair-7 for a softer evening layer.",
        ],
        "summary": "Living Room is ready for a clearer plan. Balance works best; traffic flow needs the most care.",
      }
    `);
  });

  it("lowers lighting when the only lamp is removed", () => {
    const scene = furnished2br();
    const before = designReport(scene, "living", catalog, []);
    scene.furniture = scene.furniture.filter((item) => item.id !== "floor-lamp-1");
    const after = designReport(scene, "living", catalog, []);
    expect(before.scores.lighting).toBe(9);
    expect(after.scores.lighting).toBe(7);
    expect(after.scores.lighting).toBeLessThan(before.scores.lighting);
    expect(after.score).toBeLessThan(before.score);
  });

  it("lowers focal point when the sofa turns away from the window", () => {
    const scene = furnished2br();
    scene.furniture = scene.furniture.filter((item) => item.id !== "tv-unit-1");
    const sofa = scene.furniture.find((item) => item.id === "sofa-1");
    if (!sofa) throw new Error("fixture is missing sofa-1");
    sofa.pos = { x: 410, y: 330 };
    sofa.rotation = 90;
    const facing = designReport(scene, "living", catalog, []);
    sofa.rotation = 270;
    const away = designReport(scene, "living", catalog, []);
    expect(facing.scores.focal_point).toBe(10);
    expect(away.scores.focal_point).toBeLessThan(facing.scores.focal_point);
    expect(away.score).toBeLessThan(facing.score);
  });

  it("raises bedroom storage when a wardrobe is added", () => {
    const scene = emptyHome();
    const before = designReport(scene, "bed-1", catalog, []);
    scene.furniture.push({
      id: "wardrobe-1",
      catalogId: "wardrobe-hald",
      roomId: "bed-1",
      pos: { x: 200, y: 30 },
      rotation: 0,
      colorway: "oak",
      status: "placed",
    });
    const after = designReport(scene, "bed-1", catalog, []);
    expect(before.scores.storage).toBe(0);
    expect(after.scores.storage).toBe(8);
    expect(after.scores.storage).toBeGreaterThan(before.scores.storage);
    expect(after.score).toBeGreaterThan(before.score);
  });

  it("uses the room's anchor piece in empty-room guidance", () => {
    const scene = emptyHome();
    const kitchen = designReport(scene, "kitchen", catalog, []);
    const bedroom = designReport(scene, "bed-1", catalog, []);
    const living = scene.rooms.find((room) => room.id === "living");
    if (!living) throw new Error("fixture is missing the living room");
    living.type = "office";
    const office = designReport(scene, "living", catalog, []);
    expect(kitchen.score).toBeLessThanOrEqual(30);
    expect(bedroom.score).toBeLessThanOrEqual(30);
    expect(office.score).toBeLessThanOrEqual(30);
    expect(kitchen.suggestions[0]).toContain("dining table");
    expect(bedroom.suggestions[0]).toContain("bed headboard");
    expect(office.suggestions[0]).toContain("desk");
  });

  it("scores an office desk under a window and lowers focus when its path is blocked", () => {
    const scene = emptyHome();
    const office = scene.rooms.find((room) => room.id === "living");
    if (!office) throw new Error("fixture is missing the living room");
    office.type = "office";
    scene.furniture.push(
      { id: "desk-office", catalogId: "desk-soren", roomId: "living", pos: { x: 420, y: 30 }, rotation: 0, colorway: "oak", status: "placed" },
      { id: "shelf-office", catalogId: "shelf-lund", roomId: "living", pos: { x: 50, y: 15 }, rotation: 0, colorway: "plaster", status: "placed" },
    );
    const clear = designReport(scene, "living", catalog, []);
    const pathConflict = { ...issue(20, "traffic", "warn"), items: ["desk-office"] };
    const blocked = designReport(scene, "living", catalog, [pathConflict]);
    expect(clear.scores.focal_point).toBe(10);
    expect(clear.scores.conversation).toBe(10);
    expect(clear.scores.storage).toBe(10);
    expect(blocked.scores.conversation).toBeLessThan(clear.scores.conversation);
    expect(blocked.summary).toContain("Focus");
  });

  it("subtracts only traffic, access-path and door-swing conflicts", () => {
    const scene = furnished2br();
    const clean = designReport(scene, "living", catalog, []);
    const warned = designReport(scene, "living", catalog, [issue(1, "traffic", "warn")]);
    const blocked = designReport(scene, "living", catalog, [issue(1), issue(2, "access_path"), issue(3, "door_swing")]);
    const overlap = designReport(scene, "living", catalog, [issue(1, "overlap")]);
    expect(clean.scores.traffic).toBe(10);
    expect(warned.scores.traffic).toBe(8);
    expect(blocked.scores.traffic).toBe(1);
    expect(overlap.scores.traffic).toBe(10);
    expect(blocked.score).toBeLessThan(clean.score);
    expect(overlap.score).toBe(clean.score);
  });

  it("is deterministic and does not mutate inputs", () => {
    const scene = furnished2br();
    const conflicts = [issue(1, "traffic", "warn")];
    const sceneBefore = structuredClone(scene);
    const conflictsBefore = structuredClone(conflicts);
    const first = designReport(scene, "living", catalog, conflicts);
    const second = designReport(scene, "living", catalog, conflicts);
    expect(second).toEqual(first);
    expect(scene).toEqual(sceneBefore);
    expect(conflicts).toEqual(conflictsBefore);
    scene.meta.timeOfDay = "evening";
    expect(designReport(scene, "living", catalog, conflicts)).toEqual(first);
  });

  it("keeps all scores and text inside the contract limits", () => {
    const reports = [
      designReport(furnished2br(), "living", catalog, []),
      designReport(furnished2br(), "bed-1", catalog, []),
      designReport(furnished2br(), "bed-2", catalog, []),
      designReport(furnished2br(), "kitchen", catalog, []),
      designReport(emptyHome(), "living", catalog, []),
      designReport(worstCase2br(), "living", catalog, worstConflicts()),
    ];
    for (const report of reports) {
      expect(Number.isInteger(report.score)).toBe(true);
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
      expect(report.summary.length).toBeLessThanOrEqual(200);
      expect(report.summary).not.toContain("!");
      expect(report.suggestions.length).toBeLessThanOrEqual(3);
      for (const value of Object.values(report.scores)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(10);
      }
      for (const suggestion of report.suggestions) {
        expect(suggestion.length).toBeLessThanOrEqual(120);
        expect(suggestion).not.toContain("!");
      }
    }
  });

  it("returns a short nothing-to-critique report for bath and hall", () => {
    const scene = furnished2br();
    const bath = designReport(scene, "bath", catalog, worstConflicts());
    const hall = designReport(scene, "hall", catalog, worstConflicts());
    expect(bath.score).toBe(100);
    expect(hall.score).toBe(100);
    expect(bath.summary).toContain("nothing to critique");
    expect(hall.summary).toContain("nothing to critique");
    expect(bath.suggestions).toEqual([]);
    expect(hall.suggestions).toEqual([]);
    expect(Object.values(bath.scores)).toEqual([10, 10, 10, 10, 10, 10]);
    expect(Object.values(hall.scores)).toEqual([10, 10, 10, 10, 10, 10]);
  });

  it("returns a safe report when the room id is stale", () => {
    const scene: Scene = furnished2br();
    const report = designReport(scene, "missing", catalog, []);
    expect(report.score).toBe(0);
    expect(report.summary).toContain("not found");
    expect(report.summary).toContain("nothing to critique");
    expect(report.suggestions).toEqual([]);
    expect(Object.values(report.scores)).toEqual([0, 0, 0, 0, 0, 0]);
  });
});
