import { beforeEach, describe, expect, it } from "vitest";
import { CHOREOGRAPHED_TOOL, noDelays, staggerDelays } from "@/src/scene/choreography";
import { beginToolBatch, endToolBatch, resetToolBatch, toolBatch, toolBatchIsActive } from "@/src/state/tool-batch";
import { motion } from "@/src/tokens";

beforeEach(() => resetToolBatch());

describe("arrange_room stagger", () => {
  it("orders moved items shortest first so the longest travel lands last", () => {
    const delays = staggerDelays([
      { id: "sofa-1", distance: 3.2 },
      { id: "rug-1", distance: 0.4 },
      { id: "tv-unit-1", distance: 1.6 },
    ]);
    expect([...delays.entries()]).toEqual([
      ["rug-1", 0],
      ["tv-unit-1", motion.arrangeStaggerMs],
      ["sofa-1", motion.arrangeStaggerMs * 2],
    ]);
  });

  it("ignores items that did not really move", () => {
    const delays = staggerDelays([
      { id: "plant-1", distance: 0 },
      { id: "sofa-1", distance: 1e-9 },
      { id: "rug-1", distance: 0.9 },
    ]);
    expect([...delays.keys()]).toEqual(["rug-1"]);
    expect(delays.get("rug-1")).toBe(0);
  });

  it("returns nothing at all when no item moved", () => {
    expect(staggerDelays([{ id: "sofa-1", distance: 0 }]).size).toBe(0);
    expect(noDelays().size).toBe(0);
  });

  it("keeps a single move immediate", () => {
    expect(staggerDelays([{ id: "sofa-1", distance: 2 }]).get("sofa-1")).toBe(0);
  });
});

describe("tool batch marker", () => {
  it("names the running tool and keeps naming it after the batch closes", () => {
    beginToolBatch("arrange_room");
    expect(toolBatchIsActive()).toBe(true);
    expect(toolBatch()).toBe(CHOREOGRAPHED_TOOL);
    // The mutation renders a scheduler tick after the handler returns, so the marker has to survive
    // `endToolBatch()` — that timing is exactly what keying on the receipt got wrong.
    endToolBatch();
    expect(toolBatchIsActive()).toBe(false);
    expect(toolBatch()).toBe(CHOREOGRAPHED_TOOL);
  });

  it("keeps the outermost name through nested batches and replaces it on the next tool", () => {
    beginToolBatch("apply_template");
    beginToolBatch("place_furniture");
    endToolBatch();
    expect(toolBatch()).toBe("apply_template");
    endToolBatch();
    beginToolBatch("move_furniture");
    expect(toolBatch()).toBe("move_furniture");
    endToolBatch();
  });
});
