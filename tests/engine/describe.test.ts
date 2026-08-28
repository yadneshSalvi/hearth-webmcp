import { describe, expect, it } from "vitest";
import { catalogSource } from "../../data/catalog.source";
import { createCatalog } from "../../src/engine/catalog";
import {
  cartPayload,
  clip,
  dimsStr,
  fitsBudget,
  footStr,
  itemLine,
  m2,
  posArr,
  roomDetails,
  roomRow,
  selectionPayload,
  shrinkToBudget,
  spansStr,
  truncateList,
  usd,
  wallsLine,
} from "../../src/engine/describe";
import type { Furniture, Room } from "../../src/engine/types";
import { furnished2br, worstCase2br } from "../fixtures/scenes";

const catalog = createCatalog(catalogSource);
const endre = catalog.byId("sofa-endre")!;

describe("compact engine describers", () => {
  it("formats dimensions, footprints, points, spans and money exactly", () => {
    expect(dimsStr(endre.dims)).toBe("220x95x85");
    expect(footStr(endre, 0)).toBe("220x95");
    expect(footStr(endre, 90)).toBe("95x220");
    expect(footStr(endre, 180)).toBe("220x95");
    expect(footStr(endre, 270)).toBe("95x220");
    expect(posArr({ x: 259.6, y: 409.5 })).toEqual([260, 410]);
    expect(spansStr([{ start: 0, end: 140 }, { start: 260, end: 520 }])).toBe("0-140,260-520");
    expect(spansStr([])).toBe("");
    expect(usd(789.6)).toBe(790);
    expect(usd(-1.5)).toBe(-1);
    expect(m2(228_800)).toBe(22.9);
    expect(m2(11_520)).toBe(1.2);
  });

  it("lists rectangular and concave walls clockwise", () => {
    const scene = furnished2br();
    const living = scene.rooms.find((room) => room.id === "living")!;
    expect(wallsLine(living)).toBe("N 520 · E 440 · S 520 · W 440");
    const lRoom: Room = {
      id: "l",
      name: "L",
      type: "studio",
      poly: [{ x: 0, y: 0 }, { x: 520, y: 0 }, { x: 520, y: 300 }, { x: 300, y: 300 }, { x: 300, y: 160 }, { x: 0, y: 160 }],
      origin: { x: 0, y: 0 },
      floor: "oak",
    };
    expect(wallsLine(lRoom)).toBe("N 520 · E 300 · S 220 · W 140 · S 300 · W 160");
    expect(wallsLine(lRoom).split(" · ")).toHaveLength(6);
  });

  it("formats placed and ghost item lines exactly", () => {
    const item: Furniture = {
      id: "sofa-1",
      catalogId: endre.id,
      roomId: "living",
      pos: { x: 260, y: 410 },
      rotation: 0,
      colorway: "oak",
      status: "placed",
    };
    expect(itemLine(item, endre)).toBe("sofa-1 Endre Sofa @260,410 r0 220x95 oak");
    expect(itemLine({ ...item, rotation: 90 }, endre)).toBe("sofa-1 Endre Sofa @260,410 r90 95x220 oak");
    expect(itemLine({ ...item, status: "ghost" }, endre)).toBe("sofa-1 Endre Sofa @260,410 r0 220x95 oak ghost");
  });

  it("builds the exact compact room summary row", () => {
    const scene = furnished2br();
    const living = scene.rooms.find((room) => room.id === "living")!;
    expect(roomRow(scene, living, catalog, 1)).toEqual({
      id: "living",
      name: "Living Room",
      type: "living",
      area_m2: 22.9,
      walls: "N 520 · E 440 · S 520 · W 440",
      items: 7,
      conflicts: 1,
    });
    expect(roomRow(scene, living, catalogSource, 0).items).toBe(7);
  });

  it("builds room details in the contracted shape", () => {
    const scene = furnished2br();
    const living = scene.rooms.find((room) => room.id === "living")!;
    const payload = roomDetails(scene, living, catalog, 2);
    expect(payload.room).toEqual({ id: "living", name: "Living Room", type: "living", size_cm: "520x440", area_m2: 22.9, floor: "oak", wall_color: "plaster" });
    expect(payload.walls).toHaveLength(4);
    expect(payload.walls[0]).toEqual({ id: "w0", side: "north", length_cm: 520, free_spans: "0-150,500-520" });
    expect(payload.openings).toHaveLength(4);
    expect(payload.openings[0]).toEqual({ id: "door-living-hall", kind: "door", wall: "w2", offset_cm: 20, width_cm: 90, swing: "in", hinge: "right" });
    expect(payload.openings[2]).toEqual({ id: "window-living-north", kind: "window", wall: "w0", offset_cm: 340, width_cm: 160 });
    expect(payload.items).toHaveLength(7);
    expect(payload.items[0]).toBe("sofa-1 Endre Sofa @260,48 r0 220x95 sage");
    expect(payload.items[2]).toBe("rug-1 Loop Rug @260,240 r90 300x200 terracotta");
    expect(payload.more).toBe(0);
    expect(payload.conflicts).toBe(2);
  });

  it("keeps every scene-summary and room-detail fixture payload in budget", () => {
    for (const scene of [furnished2br(), worstCase2br()]) {
      const summary = {
        ok: true,
        home: { template: scene.meta.template, rooms: scene.rooms.length, items: scene.furniture.length },
        mode: scene.meta.mode,
        view: scene.meta.view,
        time_of_day: scene.meta.timeOfDay,
        accessibility: scene.meta.accessibilityMode,
        active_room: scene.meta.activeRoomId,
        rooms: scene.rooms.map((room) => roomRow(scene, room, catalog, 12)),
        selection: { item: null, room: scene.meta.activeRoomId },
        cart: { lines: 0, subtotal_usd: 0 },
        hint: "Use get_room_details for walls, openings and item positions of one room.",
      };
      expect(fitsBudget(summary)).toBe(true);
      expect(JSON.stringify(summary).length).toBeLessThanOrEqual(1_500);
      for (const room of scene.rooms) {
        const details = { ok: true, ...roomDetails(scene, room, catalog, 12), hint: "x".repeat(120) };
        expect(fitsBudget(details), `${scene.furniture.length} items / ${room.id}`).toBe(true);
        expect(JSON.stringify(details).length).toBeLessThanOrEqual(1_500);
      }
    }
    const worst = worstCase2br();
    const living = worst.rooms.find((room) => room.id === "living")!;
    expect(roomDetails(worst, living, catalog, 12).more).toBeGreaterThan(0);
  });

  it("describes selection, hover and latest movement without ambient time", () => {
    const scene = furnished2br();
    scene.meta.selection = {
      itemId: "sofa-1",
      hoverItemId: "armchair-1",
      roomId: "living",
      lastMovedItemId: "armchair-1",
      lastMovedBy: "human",
      lastMovedAt: 1,
    };
    const payload = selectionPayload(scene, catalog);
    expect(payload.selected_item).toEqual({ id: "sofa-1", name: "Endre Sofa", room: "living", pos: [260, 48], rotation: 0, dims: "220x95x85" });
    expect(payload.hovered_item?.id).toBe("armchair-1");
    expect(payload.hovered_item?.name).toBe("Nook Armchair");
    expect(payload.last_moved).toEqual({ id: "armchair-1", by: "human", ago_s: 0 });
    expect(payload.selected_room).toBe("living");
    expect(payload.camera).toEqual({ view: "dollhouse", focus: "living" });
    scene.meta.selection = {};
    expect(selectionPayload(scene, catalog).selected_item).toBeNull();
    expect(selectionPayload(scene, catalog).hovered_item).toBeNull();
    expect(selectionPayload(scene, catalog).last_moved).toBeNull();
  });

  it("formats cart lines, totals, budget and truncation", () => {
    const cart = {
      lines: [{ handle: "sofa-endre", title: "Endre Sofa", colorway: "oak", quantity: 2, unitUsd: 790, lineUsd: 1_580, itemId: "sofa-1" }],
      subtotalUsd: 1_580,
    };
    expect(cartPayload(cart, 3_000)).toEqual({
      lines: [{ product: "sofa-endre", name: "Endre Sofa", colorway: "oak", qty: 2, unit_usd: 790, line_usd: 1_580, item: "sofa-1" }],
      count: 2,
      subtotal_usd: 1_580,
      budget_usd: 3_000,
      remaining_usd: 1_420,
      checkout_available: true,
    });
    expect(cartPayload({ lines: [], subtotalUsd: 0 })).toEqual({ lines: [], count: 0, subtotal_usd: 0, checkout_available: false });
    const many = { lines: Array.from({ length: 12 }, (_, index) => ({ ...cart.lines[0]!, handle: `item-${index}` })), subtotalUsd: 18_960 };
    expect(cartPayload(many).lines).toHaveLength(10);
    expect(cartPayload(many).more).toBe(2);
    expect(cartPayload(many).count).toBe(24);
    const verbose = { lines: Array.from({ length: 10 }, (_, index) => ({ ...cart.lines[0]!, handle: `item-${index}`, title: "Long product name ".repeat(12) })), subtotalUsd: 15_800 };
    const budgeted = { ok: true, ...cartPayload(verbose), hint: "x".repeat(120) };
    expect(fitsBudget(budgeted)).toBe(true);
    expect(cartPayload(verbose).more).toBeGreaterThan(0);
  });

  it("truncates lists and clips strings safely", () => {
    expect(truncateList([1, 2, 3, 4], 2)).toEqual({ items: [1, 2], more: 2 });
    expect(truncateList([1, 2], 8)).toEqual({ items: [1, 2], more: 0 });
    expect(truncateList([1, 2], -1)).toEqual({ items: [], more: 2 });
    expect(clip("hearth", 20)).toBe("hearth");
    expect(clip("hearth", 6)).toBe("hearth");
    expect(clip("hearth", 5)).toBe("hear…");
    expect(clip("hearth", 1)).toBe("…");
    expect(clip("hearth", 0)).toBe("");
    expect(clip("hearth", 5)).toHaveLength(5);
    expect(clip("😀😀", 3)).toBe("😀…");
    expect(clip("😀😀", 2)).toBe("…");
  });

  it("shrinks oversized payloads using ordered steps and fallbacks", () => {
    const payload: { description?: string; hint?: string; rows: string[] } = {
      description: "d".repeat(3_000),
      hint: "h".repeat(200),
      rows: Array.from({ length: 12 }, () => "r".repeat(200)),
    };
    let firstStep = false;
    const returned = shrinkToBudget(payload, [() => { firstStep = true; delete payload.description; }]);
    expect(returned).toBe(payload);
    expect(firstStep).toBe(true);
    expect(fitsBudget(payload)).toBe(true);
    expect(JSON.stringify(payload).length).toBeLessThanOrEqual(1_500);
    expect(payload.rows.length).toBeLessThanOrEqual(8);
    expect(fitsBudget({ text: "x".repeat(1_480) })).toBe(true);
    expect(fitsBudget({ text: "x".repeat(1_500) })).toBe(false);
    expect(fitsBudget(undefined)).toBe(false);
  });
});
