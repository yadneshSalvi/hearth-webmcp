import { beforeEach, describe, expect, it } from "vitest";
import { resolveWall } from "../../src/engine/geometry";
import { createTemplate } from "../../src/engine/templates";
import { hearthStore } from "../../src/state/store";
import { HearthError } from "../../src/state/types";

function reset(): void {
  hearthStore.getState().resetScene(createTemplate("2br"));
  hearthStore.setState({
    activity: [],
    cart: { lines: [], subtotalUsd: 0, status: "idle" },
    tools: { available: [], status: "unknown" },
    ui: { boardOpen: false, assistantOpen: false, toolsPanelOpen: false, toasts: [], pulseIds: [] },
  });
  hearthStore.temporal.getState().clear();
}

beforeEach(reset);

describe("furniture actions", () => {
  it("places readable ids, resolves defaults and records the human source", () => {
    const placed = hearthStore.getState().placeItem("human", { catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 });
    expect(placed.id).toBe("sofa-1");
    expect(placed.colorway).toBe("oak");
    expect(placed.status).toBe("placed");
    expect(hearthStore.getState().scene.furniture).toHaveLength(1);
    expect(hearthStore.getState().activity[0]).toMatchObject({ source: "human", summary: "You placed Endre Sofa", itemIds: ["sofa-1"] });
    const second = hearthStore.getState().placeItem("agent", { catalogId: "sofa-liva", roomId: "living", pos: { x: 350, y: 100 }, rotation: 180, colorway: "sage" });
    expect(second.id).toBe("sofa-2");
    expect(hearthStore.getState().activity[0]?.summary).toBe("Agent placed Liva Sofa");
  });

  it("moves, rotates, transfers, selects and timestamps source", () => {
    const item = hearthStore.getState().placeItem("agent", { catalogId: "armchair-nook", roomId: "living", pos: { x: 100, y: 100 }, rotation: 0 });
    hearthStore.getState().moveItem("human", item.id, { pos: { x: 80, y: 90 }, rotation: 90, roomId: "bed-1" });
    expect(hearthStore.getState().scene.furniture[0]).toMatchObject({ roomId: "bed-1", pos: { x: 80, y: 90 }, rotation: 90 });
    expect(hearthStore.getState().scene.meta.selection.lastMovedItemId).toBe(item.id);
    expect(hearthStore.getState().scene.meta.selection.lastMovedBy).toBe("human");
    expect(hearthStore.getState().scene.meta.selection.lastMovedAt).toBeTypeOf("number");
    expect(hearthStore.getState().activity[0]?.summary).toBe("You moved Nook Armchair");
  });

  it("changes colors and locks, then removes the item and linked cart line", () => {
    const item = hearthStore.getState().placeItem("agent", { catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 });
    hearthStore.getState().setColorway("human", item.id, "Sage");
    expect(hearthStore.getState().scene.furniture[0]?.colorway).toBe("sage");
    expect(hearthStore.getState().activity[0]?.summary).toBe("You set Endre Sofa to Sage");
    hearthStore.getState().setLocked("agent", item.id, true);
    expect(hearthStore.getState().scene.furniture[0]?.locked).toBe(true);
    expect(hearthStore.getState().activity[0]?.summary).toBe("Agent locked Endre Sofa");
    hearthStore.getState().setCart({ lines: [{ id: "line-1", variantId: "v", handle: "sofa-endre", title: "Endre Sofa", colorway: "sage", quantity: 1, unitUsd: 790, lineUsd: 790, itemId: item.id }], subtotalUsd: 790, status: "idle" });
    hearthStore.getState().removeItem("agent", item.id);
    expect(hearthStore.getState().scene.furniture).toEqual([]);
    expect(hearthStore.getState().cart.lines).toEqual([]);
    expect(hearthStore.getState().cart.subtotalUsd).toBe(0);
    expect(hearthStore.getState().activity[0]?.summary).toBe("Agent removed Endre Sofa");
  });

  it("keeps exactly one ghost and confirms it under a placed id", () => {
    const base = { id: "anything", catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 as const, colorway: "sage" as const, status: "ghost" as const };
    hearthStore.getState().setGhost("agent", base);
    expect(hearthStore.getState().scene.furniture).toHaveLength(1);
    expect(hearthStore.getState().scene.furniture[0]?.id).toBe("ghost-1");
    hearthStore.getState().setGhost("agent", { ...base, catalogId: "sofa-liva", colorway: "ochre", pos: { x: 300, y: 120 } });
    expect(hearthStore.getState().scene.furniture).toHaveLength(1);
    expect(hearthStore.getState().scene.furniture[0]?.catalogId).toBe("sofa-liva");
    const confirmed = hearthStore.getState().confirmGhost("human");
    expect(confirmed.id).toBe("sofa-1");
    expect(confirmed.status).toBe("placed");
    expect(hearthStore.getState().scene.furniture.some((item) => item.status === "ghost")).toBe(false);
    expect(hearthStore.getState().activity[0]?.summary).toBe("You kept Liva Sofa");
  });

  it("clears a ghost without touching placed furniture", () => {
    hearthStore.getState().placeItem("human", { catalogId: "plant-fern", roomId: "living", pos: { x: 50, y: 50 }, rotation: 0 });
    hearthStore.getState().setGhost("agent", { id: "g", catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0, colorway: "oak", status: "ghost" });
    hearthStore.getState().clearGhost("agent");
    expect(hearthStore.getState().scene.furniture).toHaveLength(1);
    expect(hearthStore.getState().scene.furniture[0]?.status).toBe("placed");
    expect(hearthStore.getState().activity[0]?.summary).toBe("Agent discarded preview of Endre Sofa");
  });
});

describe("scene and presentation actions", () => {
  it("updates mode, view, lighting, accessibility, active room and selection", () => {
    const item = hearthStore.getState().placeItem("agent", { catalogId: "plant-fern", roomId: "living", pos: { x: 50, y: 50 }, rotation: 0 });
    hearthStore.getState().setMode("human", "build");
    hearthStore.getState().setView("agent", { view: "plan", yaw: "ne", focusRoomId: "bed-1", focusItemId: item.id });
    hearthStore.getState().setTimeOfDay("human", "evening");
    hearthStore.getState().setAccessibility("agent", true);
    hearthStore.getState().setActiveRoom("human", "bed-1");
    hearthStore.getState().setSelection("human", { itemId: item.id, roomId: "living", hoverItemId: item.id });
    const scene = hearthStore.getState().scene;
    expect(scene.meta.mode).toBe("build");
    expect(scene.meta.view).toBe("plan");
    expect(scene.meta.yaw).toBe("ne");
    expect(scene.meta.timeOfDay).toBe("evening");
    expect(scene.meta.accessibilityMode).toBe(true);
    expect(scene.meta.activeRoomId).toBe("bed-1");
    expect(scene.meta.selection).toMatchObject({ itemId: item.id, roomId: "living", hoverItemId: item.id });
    expect(hearthStore.getState().activity).toHaveLength(7);
    expect(hearthStore.getState().activity.every((entry) => entry.source === "human" || entry.source === "agent")).toBe(true);
  });

  it("applies palette tokens to room and home scopes", () => {
    hearthStore.getState().setPalette("agent", "dusk", ["living"]);
    expect(hearthStore.getState().scene.rooms.find((room) => room.id === "living")).toMatchObject({ floor: "stone", wallColor: "plum-tint" });
    expect(hearthStore.getState().scene.meta.paletteId).toBe("warm-clay");
    const all = hearthStore.getState().scene.rooms.map((room) => room.id);
    hearthStore.getState().setPalette("human", "nordic", all);
    expect(hearthStore.getState().scene.rooms.every((room) => room.floor === "pale-oak" && room.wallColor === "plaster")).toBe(true);
    expect(hearthStore.getState().scene.meta.paletteId).toBe("nordic");
    expect(hearthStore.getState().activity[0]?.summary).toBe("You applied Nordic to the home");
  });

  it("saves, loads and deletes room variants", () => {
    const item = hearthStore.getState().placeItem("human", { catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 });
    hearthStore.getState().saveVariant("human", "living", "Cosy");
    hearthStore.getState().moveItem("agent", item.id, { pos: { x: 300, y: 200 } });
    hearthStore.getState().saveVariant("agent", "living", "Media");
    expect(hearthStore.getState().scene.variants).toHaveLength(2);
    hearthStore.getState().loadVariant("human", "living", "cosy");
    expect(hearthStore.getState().scene.furniture.find((entry) => entry.id === item.id)?.pos).toEqual({ x: 200, y: 100 });
    expect(hearthStore.getState().activity[0]?.summary).toBe("You loaded variant “Cosy”");
    hearthStore.getState().deleteVariant("agent", "living", "Media");
    expect(hearthStore.getState().scene.variants.map((variant) => variant.name)).toEqual(["Cosy"]);
  });

  it("clears a room and replaces the home from a template", () => {
    hearthStore.getState().placeItem("human", { catalogId: "plant-fern", roomId: "living", pos: { x: 50, y: 50 }, rotation: 0 });
    hearthStore.getState().placeItem("human", { catalogId: "plant-palm", roomId: "bed-1", pos: { x: 250, y: 150 }, rotation: 0 });
    hearthStore.getState().clearRoom("agent", "living");
    expect(hearthStore.getState().scene.furniture.map((item) => item.roomId)).toEqual(["bed-1"]);
    expect(hearthStore.getState().activity[0]?.summary).toBe("Agent cleared Living Room");
    hearthStore.getState().applyTemplate("human", "studio", true);
    expect(hearthStore.getState().scene.meta.template).toBe("studio");
    expect(hearthStore.getState().scene.furniture.length).toBeGreaterThan(0);
    expect(hearthStore.getState().activity[0]?.summary).toBe("You applied the studio template furnished");
  });
});

describe("room and opening actions", () => {
  it("places new rooms flush relative to each side", () => {
    const east = hearthStore.getState().createRoom("agent", { name: "Office", type: "office", width: 300, depth: 200, place: "east_of", relativeTo: "living" });
    expect(east.origin).toEqual({ x: 520, y: 0 });
    const south = hearthStore.getState().createRoom("human", { name: "Music", type: "studio", width_cm: 200, depth_cm: 150, place: "south_of", relative_to: "living" });
    expect(south.origin).toEqual({ x: 0, y: 440 });
    const west = hearthStore.getState().createRoom("agent", { name: "Study", type: "office", width: 100, depth: 100, place: "west_of", relativeTo: "living" });
    expect(west.origin).toEqual({ x: -100, y: 0 });
    const north = hearthStore.getState().createRoom("human", { name: "Library", type: "office", width: 120, depth: 90, place: "north_of", relativeTo: "living" });
    expect(north.origin).toEqual({ x: 0, y: -90 });
    expect(new Set(hearthStore.getState().scene.rooms.map((room) => room.id)).size).toBe(10);
  });

  it("places unanchored rooms at the current east edge and builds L polygons", () => {
    const room = hearthStore.getState().createRoom("agent", { name: "Sun Room", type: "living", width: 300, depth: 240, notch: { corner: "ne", width_cm: 80, depth_cm: 60 } });
    expect(room.id).toBe("sun-room");
    expect(room.origin.x).toBe(880);
    expect(room.poly).toHaveLength(6);
    expect(room.poly[2]).toEqual({ x: 220, y: 60 });
    const next = hearthStore.getState().createRoom("human", { name: "Sun Room", type: "living", width: 100, depth: 100 });
    expect(next.id).toBe("sun-room-2");
  });

  it("resizes from the north-west and returns newly outside item ids", () => {
    const item = hearthStore.getState().placeItem("human", { catalogId: "plant-fern", roomId: "living", pos: { x: 480, y: 400 }, rotation: 0 });
    const outside = hearthStore.getState().updateRoom("agent", "living", { width_cm: 500, depth_cm: 300, name: "Lounge", floor: "stone" });
    expect(outside).toEqual([item.id]);
    const room = hearthStore.getState().scene.rooms.find((candidate) => candidate.id === "living")!;
    expect(room.name).toBe("Lounge");
    expect(room.floor).toBe("stone");
    expect(room.origin).toEqual({ x: 0, y: 0 });
    expect(room.poly[0]).toEqual({ x: 0, y: 0 });
    expect(room.poly[2]).toEqual({ x: 500, y: 300 });
  });

  it("rejects a shrink that would leave openings outside their walls", () => {
    expect(() => hearthStore.getState().updateRoom("agent", "living", { width_cm: 200 })).toThrow(/window-living-north.*340-500.*200 cm north wall/);
    const state = hearthStore.getState();
    const living = state.scene.rooms.find((room) => room.id === "living")!;
    expect(living.poly[1]?.x).toBe(520);
    for (const opening of state.scene.openings.filter((entry) => entry.roomId === living.id)) {
      const wall = resolveWall(living, opening.wallId)!;
      expect(opening.offset + opening.width, opening.id).toBeLessThanOrEqual(wall.length);
    }
  });

  it("adds, moves and removes validated openings", () => {
    const before = hearthStore.getState().scene.openings.length;
    const added = hearthStore.getState().addOpening("agent", { roomId: "living", wallId: "north", offset: 20, width: 100, kind: "window", sillHeight: 90 });
    expect(added.id).toBe("window-1");
    expect(added.wallId).toBe("w0");
    expect(hearthStore.getState().scene.openings).toHaveLength(before + 1);
    hearthStore.getState().moveOpening("human", added.id, { wallId: "w3", offset: 10, width: 120 });
    expect(hearthStore.getState().scene.openings.find((opening) => opening.id === added.id)).toMatchObject({ wallId: "w3", offset: 10, width: 120 });
    expect(hearthStore.getState().activity[0]?.summary).toBe("You moved window-1 in Living Room");
    hearthStore.getState().removeOpening("agent", added.id);
    expect(hearthStore.getState().scene.openings.some((opening) => opening.id === added.id)).toBe(false);
  });
});

describe("temporal and auxiliary state", () => {
  it("undoes and redoes scene only", () => {
    const item = hearthStore.getState().placeItem("agent", { catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 });
    hearthStore.getState().moveItem("human", item.id, { pos: { x: 300, y: 200 } });
    const activityLength = hearthStore.getState().activity.length;
    hearthStore.getState().setCartStatus("offline");
    const undone = hearthStore.getState().undo();
    expect(undone[0]?.summary).toBe("You moved Endre Sofa");
    expect(hearthStore.getState().scene.furniture[0]?.pos).toEqual({ x: 200, y: 100 });
    expect(hearthStore.getState().cart.status).toBe("offline");
    expect(hearthStore.getState().activity).toHaveLength(activityLength);
    hearthStore.getState().redo();
    expect(hearthStore.getState().scene.furniture[0]?.pos).toEqual({ x: 300, y: 200 });
  });

  it("keeps selection and active-room clicks outside scene history", () => {
    const item = hearthStore.getState().placeItem("human", { catalogId: "sofa-endre", roomId: "living", pos: { x: 200, y: 100 }, rotation: 0 });
    hearthStore.getState().moveItem("human", item.id, { pos: { x: 300, y: 200 } });
    const beforeClicks = hearthStore.temporal.getState().pastStates.length;
    hearthStore.getState().setSelection("human", { itemId: item.id });
    hearthStore.getState().setSelection("human", { itemId: undefined, hoverItemId: item.id });
    hearthStore.getState().setActiveRoom("human", "bed-1");
    expect(hearthStore.temporal.getState().pastStates).toHaveLength(beforeClicks);
    expect(hearthStore.getState().undo()[0]).toMatchObject({ title: "Move furniture" });
    expect(hearthStore.getState().scene.furniture[0]?.pos).toEqual({ x: 200, y: 100 });
    expect(hearthStore.getState().scene.meta.activeRoomId).toBe("bed-1");
    expect(hearthStore.getState().scene.meta.selection).toMatchObject({ hoverItemId: item.id });
  });

  it("limits scene history to 100 entries", () => {
    const item = hearthStore.getState().placeItem("agent", { catalogId: "plant-fern", roomId: "living", pos: { x: 50, y: 50 }, rotation: 0 });
    for (let index = 0; index < 105; index += 1) hearthStore.getState().moveItem("agent", item.id, { pos: { x: 50 + index, y: 50 } });
    expect(hearthStore.temporal.getState().pastStates).toHaveLength(100);
    hearthStore.getState().undo(100);
    expect(hearthStore.temporal.getState().pastStates).toHaveLength(0);
    expect(hearthStore.temporal.getState().futureStates).toHaveLength(100);
  });

  it("updates cart, tools, UI and caps newest-first activity at 200", () => {
    hearthStore.getState().setCart({ id: "cart-1", lines: [], subtotalUsd: 0, status: "pending" });
    hearthStore.getState().setToolsMirror([{ name: "measure", description: "Measure", inputSchema: {} }], "native");
    hearthStore.getState().setUi({ boardOpen: true, pendingConfirm: { id: "c", message: "Continue?" } });
    for (let index = 0; index < 205; index += 1) hearthStore.getState().pushActivity({ id: `a-${index}`, t: index, source: "system", title: "Test", summary: `${index}`, itemIds: [] });
    expect(hearthStore.getState().cart).toMatchObject({ id: "cart-1", status: "pending" });
    expect(hearthStore.getState().tools).toMatchObject({ status: "native" });
    expect(hearthStore.getState().tools.available[0]?.name).toBe("measure");
    expect(hearthStore.getState().ui).toMatchObject({ boardOpen: true, pendingConfirm: { id: "c" } });
    expect(hearthStore.getState().activity).toHaveLength(200);
    expect(hearthStore.getState().activity[0]?.id).toBe("a-204");
    expect(hearthStore.getState().activity.at(-1)?.id).toBe("a-5");
  });
});

describe("validation", () => {
  it("throws coded errors instead of silently ignoring unknown ids", () => {
    const calls = [
      () => hearthStore.getState().moveItem("agent", "missing", { pos: { x: 0, y: 0 } }),
      () => hearthStore.getState().removeItem("human", "missing"),
      () => hearthStore.getState().setActiveRoom("human", "missing"),
      () => hearthStore.getState().clearRoom("agent", "missing"),
      () => hearthStore.getState().removeOpening("agent", "missing"),
      () => hearthStore.getState().loadVariant("agent", "living", "missing"),
    ];
    for (const call of calls) {
      expect(call).toThrow(HearthError);
      try { call(); } catch (error) { expect((error as HearthError).code).toBe("not_found"); }
    }
  });

  it("rejects invalid rotations, colorways, dimensions and opening bounds", () => {
    expect(() => hearthStore.getState().placeItem("agent", { catalogId: "sofa-endre", roomId: "living", pos: { x: 0, y: 0 }, rotation: 45 as 0 })).toThrow(/Rotation/);
    const item = hearthStore.getState().placeItem("agent", { catalogId: "sofa-endre", roomId: "living", pos: { x: 100, y: 100 }, rotation: 0 });
    expect(() => hearthStore.getState().setColorway("agent", item.id, "blue")).toThrow(/Colorway/);
    expect(() => hearthStore.getState().createRoom("agent", { name: "Bad", type: "office", width: -1, depth: 100 })).toThrow(/positive/);
    expect(() => hearthStore.getState().addOpening("agent", { roomId: "living", wallId: "w0", offset: 500, width: 90, kind: "door" })).toThrow(/fit within/);
    expect(() => hearthStore.getState().undo(0)).toThrow(/positive integer/);
  });
});
