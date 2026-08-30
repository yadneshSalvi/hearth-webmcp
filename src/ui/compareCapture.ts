"use client";
/**
 * Photographing two saved variants. The studio has one canvas, so the only honest way to show two
 * layouts side by side is to load each in turn, grab a frame once the drop springs have settled, and
 * put the room back exactly as it was. `previewFurniture` keeps all three swaps out of the activity
 * feed and out of undo — the human did not rearrange anything by asking to compare.
 */
import type { Furniture, Variant } from "../engine/types";
import { hearthStore } from "../state/store";
import { studioApi } from "../scene/Studio";
import { captureFrame, fromFramedShot } from "./capture";

/** Drop-and-settle for a fresh set of items (react-spring `motion.spring`), plus a beat. */
const SETTLE_MS = 720;

export interface ComparePair {
  left: Blob;
  right: Blob;
  leftVariant: Variant;
  rightVariant: Variant;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function findVariant(roomId: string, name: string): Variant | undefined {
  return hearthStore
    .getState()
    .scene.variants.find((candidate) => candidate.roomId === roomId && candidate.name.toLowerCase() === name.trim().toLowerCase());
}

/** Variant furniture is stored placed; a stale ghost from a preview never belongs in a comparison. */
function layoutFor(variant: Variant, others: Furniture[]): Furniture[] {
  return [...others, ...variant.furniture.map((item) => ({ ...item, pos: { ...item.pos }, status: "placed" as const }))];
}

/**
 * The photo session that is already running, if one is.
 *
 * A comparison swaps the room's furniture three times — variant A, variant B, then the layout it
 * found — and the overlay closes itself when *anything else* changes the layout, which is how a
 * second, overlapping session reads to the first. React's StrictMode starts exactly that second
 * session in development: the effect runs, is cleaned up and runs again, and with a room the camera
 * has to reframe onto first the two sessions stagger by the 740 ms reframe, so the later one's swaps
 * land after the earlier one has put the split on screen and shut it again a beat later. One session
 * per comparison, shared by every caller asking for it.
 */
let inFlight: { key: string; pair: Promise<ComparePair> } | undefined;

/** Captures both variants and restores the room, even if a capture fails. */
export function captureComparison(roomId: string, left: string, right: string): Promise<ComparePair> {
  const key = `${roomId}\u0000${left}\u0000${right}`;
  if (inFlight?.key === key) return inFlight.pair;
  const pair = shootComparison(roomId, left, right).finally(() => {
    if (inFlight?.pair === pair) inFlight = undefined;
  });
  inFlight = { key, pair };
  return pair;
}

async function shootComparison(roomId: string, left: string, right: string): Promise<ComparePair> {
  const leftVariant = findVariant(roomId, left);
  const rightVariant = findVariant(roomId, right);
  if (!leftVariant || !rightVariant) throw new Error("Both variants must still be saved to compare them");

  const original = hearthStore.getState().scene.furniture.map((item) => ({ ...item, pos: { ...item.pos } }));
  const others = original.filter((item) => item.roomId !== roomId && item.status !== "ghost");

  /** Swaps the scene and remembers exactly what we put there, so we know if someone else moves it. */
  const swap = (items: Furniture[]): Furniture[] => {
    hearthStore.getState().previewFurniture(items);
    return hearthStore.getState().scene.furniture;
  };
  let ours: Furniture[] | undefined;

  const shoot = async (variant: Variant): Promise<Blob> => {
    ours = swap(layoutFor(variant, others));
    await wait(SETTLE_MS);
    return captureFrame(studioApi);
  };

  try {
    // Both halves from the same framed shot, whatever the human has orbited to: two variants
    // photographed from two different angles are not a comparison.
    return await fromFramedShot(async () => ({
      left: await shoot(leftVariant),
      right: await shoot(rightVariant),
      leftVariant,
      rightVariant,
    }), roomId);
  } finally {
    // If a human or an agent changed the layout while we were photographing, their change wins and
    // the comparison closes itself; putting the old furniture back would silently undo their work.
    if (hearthStore.getState().scene.furniture === ours) swap(original);
  }
}
