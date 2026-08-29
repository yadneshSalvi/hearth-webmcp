import { describe, expect, it, vi } from "vitest";
import { createAssetQueue, planAssetWaves } from "@/src/scene/assetWaves";
import type { PlacedRef } from "@/src/scene/assetWaves";

const glbFor = (catalogId: string): string | undefined =>
  catalogId === "unknown-product" ? undefined : `/assets/glb/${catalogId}.glb`;

const item = (roomId: string, catalogId: string, status?: string): PlacedRef =>
  status === undefined ? { roomId, catalogId } : { roomId, catalogId, status };

describe("planAssetWaves", () => {
  const placed = [
    item("living", "sofa-endre"),
    item("living", "rug-loop"),
    item("bed-1", "bed-ask"),
    item("bed-1", "sofa-endre"),
    item("living", "table-rund", "ghost"),
  ];
  const catalog = ["/assets/glb/sofa-endre.glb", "/assets/glb/table-rund.glb", "/assets/glb/plant-fern.glb"];

  it("puts the framed room's assets in the first wave, in placement order", () => {
    const waves = planAssetWaves({ activeRoomId: "living", placed, glbFor, catalog });
    expect(waves.framed).toEqual(["/assets/glb/sofa-endre.glb", "/assets/glb/rug-loop.glb"]);
  });

  it("never repeats a url across waves, so a shared model is warmed once", () => {
    const waves = planAssetWaves({ activeRoomId: "living", placed, glbFor, catalog });
    expect(waves.rest).toEqual(["/assets/glb/bed-ask.glb"]);
    expect(waves.catalog).toEqual(["/assets/glb/table-rund.glb", "/assets/glb/plant-fern.glb"]);
    const all = [...waves.framed, ...waves.rest, ...waves.catalog];
    expect(new Set(all).size).toBe(all.length);
  });

  it("ignores ghosts (the pointer's preview loads its own asset) and unknown products", () => {
    const waves = planAssetWaves({
      activeRoomId: "living",
      placed: [item("living", "table-rund", "ghost"), item("living", "unknown-product")],
      glbFor,
      catalog: [],
    });
    expect(waves.framed).toEqual([]);
  });

  it("frames nothing when the active room is empty and still warms the rest", () => {
    const waves = planAssetWaves({ activeRoomId: "bath-1", placed, glbFor, catalog: [] });
    expect(waves.framed).toEqual([]);
    expect(waves.rest).toEqual([
      "/assets/glb/sofa-endre.glb",
      "/assets/glb/rug-loop.glb",
      "/assets/glb/bed-ask.glb",
    ]);
  });
});

/** A load whose promise the test resolves by hand, so in-flight counts are observable. */
function controllable() {
  const resolvers = new Map<string, () => void>();
  const load = vi.fn(
    (url: string) =>
      new Promise<void>((resolve) => {
        resolvers.set(url, resolve);
      }),
  );
  const flush = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return {
    load,
    flush,
    settle: async (url: string) => {
      resolvers.get(url)?.();
      await flush();
    },
  };
}

describe("createAssetQueue", () => {
  it("never runs more than the limit at once and drains in order", async () => {
    const { load, settle } = controllable();
    const queue = createAssetQueue(2, load);
    queue.push(["a", "b", "c", "d"]);
    expect(queue.inFlight()).toBe(2);
    expect(queue.pending()).toBe(2);
    expect(load.mock.calls.map(([url]) => url)).toEqual(["a", "b"]);

    await settle("a");
    expect(load.mock.calls.map(([url]) => url)).toEqual(["a", "b", "c"]);
    expect(queue.inFlight()).toBe(2);

    await settle("b");
    await settle("c");
    await settle("d");
    expect(queue.inFlight()).toBe(0);
    expect(queue.pending()).toBe(0);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it("loads each url once, however often it is pushed", async () => {
    const { load, settle, flush } = controllable();
    const queue = createAssetQueue(4, load);
    queue.push(["a", "a"]);
    queue.push(["a"]);
    await settle("a");
    queue.push(["a"]);
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("keeps draining after a rejection, because a failed warm-up costs nothing", async () => {
    const failures = new Set(["a"]);
    const seen: string[] = [];
    const queue = createAssetQueue(1, async (url) => {
      seen.push(url);
      if (failures.has(url)) throw new Error("404");
    });
    queue.push(["a", "b"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(seen).toEqual(["a", "b"]);
    expect(queue.inFlight()).toBe(0);
  });

  it("drops what is still waiting when cancelled", async () => {
    const { load, settle } = controllable();
    const queue = createAssetQueue(1, load);
    queue.push(["a", "b", "c"]);
    queue.cancel();
    expect(queue.pending()).toBe(0);
    await settle("a");
    expect(load).toHaveBeenCalledTimes(1);
  });
});
