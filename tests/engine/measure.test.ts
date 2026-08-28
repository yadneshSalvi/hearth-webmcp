import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import { measure, resolveSubject } from "../../src/engine/measure";
import { furnished2br, loftScene } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);

describe("measure", () => {
  it("resolves wall sides and ids, including repeated L-room sides", () => {
    const scene = furnished2br();
    expect(resolveSubject(scene, "living", "north", catalog)).toEqual({ kind: "wall", id: "w0", side: "north" });
    expect(resolveSubject(scene, "living", "NORTH", catalog)).toEqual({ kind: "wall", id: "w0", side: "north" });
    expect(resolveSubject(scene, "living", "nor", catalog)).toEqual({ kind: "wall", id: "w0", side: "north" });
    expect(resolveSubject(scene, "living", "w1", catalog)).toEqual({ kind: "wall", id: "w1", side: "east" });
    expect(resolveSubject(scene, "living", "W2", catalog)).toEqual({ kind: "wall", id: "w2", side: "south" });
    const loft = loftScene();
    expect(resolveSubject(loft, "loft", "north", catalog)).toEqual({ kind: "wall", id: "w0", side: "north" });
    expect(resolveSubject(loft, "loft", "w2", catalog)).toEqual({ kind: "wall", id: "w2", side: "north" });
    expect(resolveSubject(loft, "loft", "w5", catalog)).toEqual({ kind: "wall", id: "w5", side: "west" });
  });

  it("resolves items by id, display name, prefix and selection", () => {
    const scene = furnished2br();
    expect(resolveSubject(scene, "living", "sofa-1", catalog)).toEqual({ kind: "item", id: "sofa-1", name: "Endre Sofa" });
    expect(resolveSubject(scene, "living", "Endre Sofa", catalog)).toEqual({ kind: "item", id: "sofa-1", name: "Endre Sofa" });
    expect(resolveSubject(scene, "living", "Endre", catalog)).toEqual({ kind: "item", id: "sofa-1", name: "Endre Sofa" });
    expect(resolveSubject(scene, "living", "Nook", catalog)).toEqual({ kind: "item", id: "armchair-1", name: "Nook Armchair" });
    scene.meta.selection.itemId = "armchair-1";
    expect(resolveSubject(scene, "living", "selected", catalog)).toEqual({ kind: "item", id: "armchair-1", name: "Nook Armchair" });
    expect(resolveSubject(scene, "kitchen", "selected", catalog)).toBeUndefined();
    expect(resolveSubject(scene, "kitchen", "chair", catalog)).toBeUndefined();
  });

  it("resolves openings by exact id and unique prefix", () => {
    const scene = furnished2br();
    expect(resolveSubject(scene, "living", "door-living-hall", catalog)).toEqual({ kind: "opening", id: "door-living-hall" });
    expect(resolveSubject(scene, "living", "window-living-north", catalog)).toEqual({ kind: "opening", id: "window-living-north" });
    expect(resolveSubject(scene, "living", "window-living-n", catalog)).toEqual({ kind: "opening", id: "window-living-north" });
    expect(resolveSubject(scene, "living", "window-living", catalog)).toBeUndefined();
    expect(resolveSubject(scene, "missing", "w0", catalog)).toBeUndefined();
  });

  it("measures a wall and limits free spans", () => {
    const result = measure(furnished2br(), "living", "north", catalog);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subject).toEqual({ kind: "wall", id: "w0", side: "north" });
    expect(result.length_cm).toBe(520);
    expect(result.free_spans).toEqual([{ start: 0, end: 150 }, { start: 500, end: 520 }]);
    expect(result.free_spans?.length).toBeLessThanOrEqual(6);
    const lWall = measure(loftScene(), "loft", "w2", catalog);
    expect(lWall.ok).toBe(true);
    if (lWall.ok) {
      expect(lWall.subject).toEqual({ kind: "wall", id: "w2", side: "north" });
      expect(lWall.length_cm).toBe(300);
      expect(lWall.free_spans).toEqual([{ start: 0, end: 70 }, { start: 230, end: 300 }]);
    }
  });

  it("measures a rotated item with full and footprint dimensions", () => {
    const scene = furnished2br();
    const sofa = measure(scene, "living", "sofa-1", catalog);
    expect(sofa).toEqual({
      ok: true,
      subject: { kind: "item", id: "sofa-1", name: "Endre Sofa" },
      dims: "220x95x85",
      footprint: "220x95",
      pos: [260, 48],
      rotation: 0,
      clearance_front_cm: 75,
    });
    const rug = measure(scene, "living", "rug-1", catalog);
    expect(rug.ok).toBe(true);
    if (rug.ok) {
      expect(rug.dims).toBe("200x300x2");
      expect(rug.footprint).toBe("300x200");
      expect(rug.rotation).toBe(90);
      expect(rug.clearance_front_cm).toBe(0);
    }
  });

  it("measures an opening", () => {
    const door = measure(furnished2br(), "living", "door-living-hall", catalog);
    expect(door).toEqual({
      ok: true,
      subject: { kind: "opening", id: "door-living-hall" },
      width_cm: 90,
      offset_cm: 20,
      wall: "w2",
    });
    const window = measure(furnished2br(), "living", "window-living-north", catalogSource);
    expect(window.ok).toBe(true);
    if (window.ok) {
      expect(window.width_cm).toBe(160);
      expect(window.offset_cm).toBe(340);
      expect(window.wall).toBe("w0");
    }
  });

  it("measures item-to-item gaps in both directions", () => {
    const scene = furnished2br();
    const south = measure(scene, "living", "sofa-1", "tv-unit-1", catalog);
    expect(south.ok).toBe(true);
    if (south.ok) {
      expect(south.gap_cm).toBe(305);
      expect(south.direction).toBe("south");
      expect(south.to).toEqual({ kind: "item", id: "tv-unit-1", name: "Linje TV Unit" });
    }
    const north = measure(scene, "living", "tv-unit-1", "sofa-1", catalog);
    expect(north.ok).toBe(true);
    if (north.ok) {
      expect(north.gap_cm).toBe(305);
      expect(north.direction).toBe("north");
    }
    const northward = measure(scene, "living", "armchair-1", "sofa-1", catalog);
    expect(northward.ok).toBe(true);
    if (northward.ok) expect(northward.direction).toBe("north");
  });

  it("measures items against walls in either argument order", () => {
    const scene = furnished2br();
    const itemWall = measure(scene, "living", "sofa-1", "north", catalog);
    expect(itemWall.ok).toBe(true);
    if (itemWall.ok) {
      expect(itemWall.distance_cm).toBe(0);
      expect(itemWall.subject.kind).toBe("item");
      expect(itemWall.to?.kind).toBe("wall");
    }
    const wallItem = measure(scene, "living", "north", "sofa-1", catalog);
    expect(wallItem.ok).toBe(true);
    if (wallItem.ok) {
      expect(wallItem.distance_cm).toBe(0);
      expect(wallItem.subject.kind).toBe("wall");
      expect(wallItem.to?.kind).toBe("item");
    }
    const east = measure(scene, "living", "sofa-1", "east", catalog);
    expect(east.ok).toBe(true);
    if (east.ok) expect(east.distance_cm).toBe(150);
  });

  it("measures items and openings edge to edge", () => {
    const scene = furnished2br();
    const itemOpening = measure(scene, "living", "sofa-1", "window-living-north", catalog);
    expect(itemOpening.ok).toBe(true);
    if (itemOpening.ok) {
      expect(itemOpening.distance_cm).toBe(0);
      expect(itemOpening.to?.kind).toBe("opening");
    }
    const openingItem = measure(scene, "living", "window-living-north", "sofa-1", catalog);
    expect(openingItem.ok).toBe(true);
    if (openingItem.ok) {
      expect(openingItem.distance_cm).toBe(0);
      expect(openingItem.subject.kind).toBe("opening");
    }
    const far = measure(scene, "living", "tv-unit-1", "window-living-north", catalog);
    expect(far.ok).toBe(true);
    if (far.ok) expect(far.distance_cm).toBeGreaterThan(300);
  });

  it("measures opposite, adjacent and identical walls", () => {
    const scene = furnished2br();
    const opposite = measure(scene, "living", "north", "south", catalog);
    expect(opposite.ok).toBe(true);
    if (opposite.ok) expect(opposite.distance_cm).toBe(440);
    const horizontal = measure(scene, "living", "west", "east", catalog);
    expect(horizontal.ok).toBe(true);
    if (horizontal.ok) expect(horizontal.distance_cm).toBe(520);
    const adjacent = measure(scene, "living", "north", "east", catalog);
    expect(adjacent.ok).toBe(true);
    if (adjacent.ok) expect(adjacent.distance_cm).toBe(0);
    const same = measure(scene, "living", "w0", "north", catalog);
    expect(same.ok).toBe(true);
    if (same.ok) expect(same.distance_cm).toBe(0);
  });

  it("supports wall-opening and opening-opening pairs", () => {
    const scene = furnished2br();
    const wallOpening = measure(scene, "living", "w0", "window-living-north", catalog);
    expect(wallOpening.ok).toBe(true);
    if (wallOpening.ok) expect(wallOpening.distance_cm).toBe(0);
    const openingWall = measure(scene, "living", "window-living-north", "w0", catalog);
    expect(openingWall.ok).toBe(true);
    if (openingWall.ok) expect(openingWall.distance_cm).toBe(0);
    const openings = measure(scene, "living", "window-living-north", "window-living-west", catalog);
    expect(openings.ok).toBe(true);
    if (openings.ok) expect(openings.distance_cm).toBe(428);
  });

  it("returns compact alternatives for unknown references", () => {
    const scene = furnished2br();
    const item = measure(scene, "living", "sofa-9", catalog);
    expect(item.ok).toBe(false);
    if (!item.ok) {
      expect(item.error).toBe("not_found");
      expect(item.alternatives).toHaveLength(3);
      expect(item.alternatives).toContain("sofa-1");
    }
    const target = measure(scene, "living", "sofa-1", "widnow-living-north", catalog);
    expect(target.ok).toBe(false);
    if (!target.ok) {
      expect(target.alternatives).toHaveLength(3);
      expect(target.alternatives).toContain("window-living-north");
    }
    const room = measure(scene, "missing", "north", catalog);
    expect(room.ok).toBe(false);
    if (!room.ok) {
      expect(room.alternatives).toEqual(["living", "kitchen", "bed-1"]);
      expect(room.error).toBe("not_found");
    }
  });

  it("accepts an explicit undefined comparison target", () => {
    const result = measure(furnished2br(), "living", "south", undefined, catalog);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.subject).toEqual({ kind: "wall", id: "w2", side: "south" });
      expect(result.length_cm).toBe(520);
      expect(result.to).toBeUndefined();
    }
  });
});
