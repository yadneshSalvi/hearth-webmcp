/**
 * Warm-up policy for the studio's GLBs: which assets are worth fetching, in what order, and how
 * many at a time. Pure — no three, no React, no fetch — so the schedule itself is unit tested
 * (`tests/scene/assetWaves.test.ts`) rather than inferred from a network panel.
 *
 * The shape of the problem: every placed item in the home mounts on the first render, so a furnished
 * 2BR would ask for two dozen GLBs at once and the catalog would add another four dozen nobody has
 * looked at. Only the framed room is actually being looked at, so only the framed room loads eagerly;
 * everything else is a wave that waits for an idle moment and then trickles through a small queue.
 */

/** The bit of a furniture record this policy needs. */
export interface PlacedRef {
  roomId: string;
  catalogId: string;
  status?: string;
}

export interface WavePlanInput {
  /** The room the camera is framing; its assets are the ones the first frame draws. */
  activeRoomId: string;
  placed: readonly PlacedRef[];
  /** GLB url for a catalog id, or undefined when the product is unknown. */
  glbFor: (catalogId: string) => string | undefined;
  /** Every GLB the catalog ships, in catalog order. */
  catalog: readonly string[];
}

export interface AssetWaves {
  /** Assets of the framed room. Loaded by the items themselves, so nothing warms them. */
  framed: string[];
  /** Placed items in the rooms nobody is framing. Warmed first, because they are on the page. */
  rest: string[];
  /** Catalog products nobody has placed — needed only when a card is dragged onto the canvas. */
  catalog: string[];
}

/**
 * Splits the home's GLBs into the framed room, the rest of the home and the unplaced catalog, with
 * every url appearing in exactly one wave and in a stable order (a shared model is warmed once).
 */
export function planAssetWaves(input: WavePlanInput): AssetWaves {
  const seen = new Set<string>();
  const collect = (urls: Iterable<string | undefined>): string[] => {
    const wave: string[] = [];
    for (const url of urls) {
      if (url === undefined || seen.has(url)) continue;
      seen.add(url);
      wave.push(url);
    }
    return wave;
  };
  const urlsOf = (rooms: (roomId: string) => boolean): (string | undefined)[] =>
    input.placed
      .filter((item) => item.status !== "ghost" && rooms(item.roomId))
      .map((item) => input.glbFor(item.catalogId));

  return {
    framed: collect(urlsOf((roomId) => roomId === input.activeRoomId)),
    rest: collect(urlsOf((roomId) => roomId !== input.activeRoomId)),
    catalog: collect(input.catalog),
  };
}

export interface AssetQueue {
  /** Adds urls to the tail of the queue; a url already queued or started is ignored. */
  push(urls: readonly string[]): void;
  /** Loads currently running. Never above the limit. */
  inFlight(): number;
  /** Urls waiting for a slot. */
  pending(): number;
  /** Drops everything still waiting; loads already running are left to settle. */
  cancel(): void;
}

/**
 * A fixed-width queue over `load`. Four at a time is the point: a browser will happily open six
 * connections to one origin and then decode six DRACO meshes on the main thread, which is a stall
 * in the middle of whatever the human is doing. Rejections are swallowed — a warm-up that fails
 * costs nothing, because the item loads its own asset when it renders.
 */
export function createAssetQueue(limit: number, load: (url: string) => Promise<void>): AssetQueue {
  const waiting: string[] = [];
  const started = new Set<string>();
  let running = 0;
  let cancelled = false;

  const pump = (): void => {
    while (!cancelled && running < limit && waiting.length > 0) {
      const url = waiting.shift() as string;
      running += 1;
      let settled: Promise<unknown>;
      try {
        settled = load(url);
      } catch {
        settled = Promise.resolve();
      }
      void settled.catch(() => undefined).then(() => {
        running -= 1;
        pump();
      });
    }
  };

  return {
    push(urls) {
      if (cancelled) return;
      for (const url of urls) {
        if (started.has(url)) continue;
        started.add(url);
        waiting.push(url);
      }
      pump();
    },
    inFlight: () => running,
    pending: () => waiting.length,
    cancel() {
      cancelled = true;
      waiting.length = 0;
    },
  };
}
