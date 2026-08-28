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
        "score": 93,
        "scores": {
          "balance": 6,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 9,
          "storage": 10,
          "traffic": 10,
        },
        "suggestions": [
          "Shift sofa-1 40 cm toward the room centre to improve the visual balance.",
        ],
        "summary": "Living Room feels settled and practical. Conversation seating works best; balance needs the most care.",
      }
    `);
  });

  it("snapshots the furnished main bedroom", () => {
    expect(designReport(furnished2br(), "bed-1", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 93,
        "scores": {
          "balance": 5,
          "conversation": 10,
          "focal_point": 10,
          "lighting": 10,
          "storage": 10,
          "traffic": 10,
        },
        "suggestions": [
          "Shift bed-1 40 cm toward the room centre to improve the visual balance.",
        ],
        "summary": "Main Bedroom feels settled and practical. Lighting works best; balance needs the most care.",
      }
    `);
  });

  it("snapshots the furnished kitchen and dining room", () => {
    expect(designReport(furnished2br(), "kitchen", catalog, [])).toMatchInlineSnapshot(`
      {
        "score": 43,
        "scores": {
          "balance": 5,
          "conversation": 2,
          "focal_point": 1,
          "lighting": 2,
          "storage": 6,
          "traffic": 10,
        },
        "suggestions": [
          "Give chair-1 a clear focus, such as a window or media unit, within 15°.",
          "Place another seat within 250 cm of chair-1 and turn the two seats toward each other.",
          "Add a floor lamp within 150 cm of chair-2 for dependable evening light.",
        ],
        "summary": "Kitchen & Dining needs a clearer plan. Traffic flow works best; focal direction needs the most care.",
      }
    `);
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
          "Start with two seats no more than 250 cm apart, facing each other.",
          "Choose a main seat and aim it within 15° of a window or media focus.",
          "Place the first large piece near a wall, leaving a 60 cm clear route.",
        ],
        "summary": "Living Room is ready for a first layout; furniture is needed before balance, lighting and function can settle.",
      }
    `);
  });

  it("snapshots the adversarial room with traffic conflicts", () => {
    expect(designReport(worstCase2br(), "living", catalog, worstConflicts())).toMatchInlineSnapshot(`
      {
        "score": 56,
        "scores": {
          "balance": 6,
          "conversation": 3,
          "focal_point": 10,
          "lighting": 7,
          "storage": 10,
          "traffic": 0,
        },
        "suggestions": [
          "Clear the route: move item-0 40 cm east.",
          "Place another seat within 250 cm of sofa-1 and turn the two seats toward each other.",
          "Shift sofa-1 40 cm toward the room centre to improve the visual balance.",
        ],
        "summary": "Living Room needs a clearer plan. Focal direction works best; traffic flow needs the most care.",
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
    expect(after.scores.storage).toBe(10);
    expect(after.scores.storage).toBeGreaterThan(before.scores.storage);
    expect(after.score).toBeGreaterThan(before.score);
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
