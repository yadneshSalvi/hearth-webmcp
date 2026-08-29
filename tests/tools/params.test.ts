import { describe, expect, it } from "vitest";
import { normalizeToolInput } from "@/src/tools/params";

describe("normalizeToolInput", () => {
  it("rewrites the three aliases models actually send", () => {
    expect(normalizeToolInput({ room_id: "living" })).toEqual({ room: "living" });
    expect(normalizeToolInput({ item_id: "sofa-1" })).toEqual({ item: "sofa-1" });
    expect(normalizeToolInput({ product_id: "sofa-endre" })).toEqual({ product: "sofa-endre" });
  });

  it("accepts the camelCase forms too", () => {
    expect(normalizeToolInput({ roomId: "living", itemId: "sofa-1", productId: "sofa-endre" }))
      .toEqual({ room: "living", item: "sofa-1", product: "sofa-endre" });
  });

  it("keeps every other parameter exactly as given", () => {
    const input = {
      product_id: "sofa-endre",
      room_id: "living",
      anchor: { wall: "north", along: "center", next_to: "rug-1" },
      rotation: 90,
      colorway: "sage",
    };
    expect(normalizeToolInput(input)).toEqual({
      product: "sofa-endre",
      room: "living",
      anchor: { wall: "north", along: "center", next_to: "rug-1" },
      rotation: 90,
      colorway: "sage",
    });
  });

  it("never rewrites inside anchor, which speaks its own words", () => {
    const anchor = { next_to: "sofa-1", side: "right", gap_cm: 10 };
    const result = normalizeToolInput({ item_id: "lamp-1", anchor }) as { anchor: unknown };
    expect(result.anchor).toEqual(anchor);
  });

  it("lets the canonical key win and drops the alias either way", () => {
    expect(normalizeToolInput({ room: "bed-1", room_id: "living" })).toEqual({ room: "bed-1" });
    expect(normalizeToolInput({ room_id: "living", room: "bed-1" })).toEqual({ room: "bed-1" });
  });

  it("returns the same object when there is nothing to rewrite", () => {
    const input = { room: "living", style: "conversation" };
    expect(normalizeToolInput(input)).toBe(input);
  });

  it("passes non-objects straight through, so the caller's own errors still read true", () => {
    for (const value of [undefined, null, 7, "living", ["a"], true]) {
      expect(normalizeToolInput(value)).toBe(value);
    }
  });

  it("preserves an explicit undefined rather than inventing a value", () => {
    expect(normalizeToolInput({ room: undefined, room_id: "living" })).toEqual({ room: "living" });
  });
});
