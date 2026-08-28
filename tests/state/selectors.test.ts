import { beforeEach, describe, expect, it } from "vitest";
import { createTemplate } from "../../src/engine/templates";
import { activeRoom, activityRecent, cartCount, desiredToolGroups, ghost, itemsInRoom, resolveItem, resolveRoom, roomById, variantsForRoom } from "../../src/state/selectors";
import { hearthStore } from "../../src/state/store";

beforeEach(() => {
  hearthStore.getState().resetScene(createTemplate("2br", { furnished: true }));
  hearthStore.setState({ activity: [], cart: { lines: [], subtotalUsd: 0, status: "idle" } });
});

describe("scene selectors", () => {
  it("resolves active rooms by id, name and unique prefix", () => {
    const state = hearthStore.getState();
    expect(activeRoom(state)?.id).toBe("living");
    expect(roomById(state, "LIVING")?.name).toBe("Living Room");
    expect(resolveRoom(state, "Main Bedroom")?.id).toBe("bed-1");
    expect(resolveRoom(state, "second")?.id).toBe("bed-2");
    expect(resolveRoom(state, "bed")).toBeUndefined();
    expect(resolveRoom(state, "missing")).toBeUndefined();
  });

  it("resolves items by id, product name and selected", () => {
    let state = hearthStore.getState();
    expect(resolveItem(state, "SOFA-1")?.catalogId).toBe("sofa-endre");
    expect(resolveItem(state, "Endre Sofa")?.id).toBe("sofa-1");
    hearthStore.getState().setSelection("human", { itemId: "armchair-1" });
    state = hearthStore.getState();
    expect(resolveItem(state, "selected")?.id).toBe("armchair-1");
    expect(resolveItem(state, "missing")).toBeUndefined();
  });

  it("filters room items and variants", () => {
    const state = hearthStore.getState();
    expect(itemsInRoom(state, "living")).toHaveLength(7);
    expect(itemsInRoom(state, "kitchen")).toHaveLength(6);
    expect(ghost(state)).toBeUndefined();
    hearthStore.getState().setGhost("agent", { id: "x", catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 200 }, rotation: 0, colorway: "oak", status: "ghost" });
    expect(itemsInRoom(hearthStore.getState(), "living")).toHaveLength(7);
    expect(itemsInRoom(hearthStore.getState(), "living", { includeGhost: true })).toHaveLength(8);
    expect(ghost(hearthStore.getState())?.id).toBe("ghost-1");
    hearthStore.getState().saveVariant("human", "living", "A");
    expect(variantsForRoom(hearthStore.getState(), "living").map((variant) => variant.name)).toEqual(["A"]);
  });

  it("counts quantities and returns recent activity", () => {
    hearthStore.getState().setCart({ lines: [
      { id: "1", variantId: "v1", handle: "a", title: "A", colorway: "oak", quantity: 2, unitUsd: 1, lineUsd: 2 },
      { id: "2", variantId: "v2", handle: "b", title: "B", colorway: "sage", quantity: 3, unitUsd: 1, lineUsd: 3 },
    ], subtotalUsd: 5, status: "idle" });
    hearthStore.getState().setMode("human", "shop");
    hearthStore.getState().setMode("agent", "design");
    expect(cartCount(hearthStore.getState())).toBe(5);
    expect(activityRecent(1)(hearthStore.getState())).toHaveLength(1);
    expect(activityRecent(1)(hearthStore.getState())[0]?.source).toBe("agent");
    expect(activityRecent(0)(hearthStore.getState())).toEqual([]);
  });
});

describe("tool registration gates", () => {
  it("always returns the four default groups", () => {
    expect(desiredToolGroups(hearthStore.getState())).toEqual(["core", "design", "shop", "present"]);
  });

  it("adds build, preview, variants and checkout only at their gates", () => {
    hearthStore.getState().setMode("human", "build");
    expect(desiredToolGroups(hearthStore.getState())).toContain("build");
    hearthStore.getState().setGhost("agent", { id: "x", catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 200 }, rotation: 0, colorway: "oak", status: "ghost" });
    expect(desiredToolGroups(hearthStore.getState())).toContain("preview");
    hearthStore.getState().saveVariant("agent", "living", "A");
    expect(desiredToolGroups(hearthStore.getState())).not.toContain("variants");
    hearthStore.getState().saveVariant("agent", "living", "B");
    expect(desiredToolGroups(hearthStore.getState())).toContain("variants");
    hearthStore.getState().setCart({ lines: [{ id: "1", variantId: "v", handle: "sofa-endre", title: "Endre Sofa", colorway: "oak", quantity: 1, unitUsd: 790, lineUsd: 790 }], subtotalUsd: 790, status: "idle" });
    expect(desiredToolGroups(hearthStore.getState())).toEqual(["core", "design", "shop", "present", "preview", "variants", "checkout", "build"]);
    hearthStore.getState().clearGhost("agent");
    hearthStore.getState().setCart({ lines: [], subtotalUsd: 0, status: "idle" });
    hearthStore.getState().setMode("human", "design");
    expect(desiredToolGroups(hearthStore.getState())).toEqual(["core", "design", "shop", "present", "variants"]);
  });
});
