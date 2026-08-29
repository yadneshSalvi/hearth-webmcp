"use client";
/**
 * Move choreography for the furniture layer. `arrange_room` is the one tool whose result is a whole
 * new layout, and STYLE.md §3 asks for it to read as one composed gesture: every moved item glides
 * with a 60 ms stagger, longest distance last.
 *
 * The delays are computed from the mutation itself (`src/state/tool-batch.ts` names the tool that is
 * mutating the store) rather than from the receipt in `activity[]`, which is only written after the
 * store — and therefore the render — has already moved everything to its final pose.
 */
import { motion as motionTokens } from "../tokens";

export interface MovedItem {
  id: string;
  /** Distance travelled in world metres. */
  distance: number;
}

/** The tool whose store mutation is choreographed; every other change starts immediately. */
export const CHOREOGRAPHED_TOOL = "arrange_room";

/** Anything shorter than this is numerical noise, not a move. */
const MOVE_EPSILON = 1e-4;

const EMPTY: ReadonlyMap<string, number> = new Map();

/** The empty plan, shared so a render that choreographs nothing keeps a stable identity. */
export function noDelays(): ReadonlyMap<string, number> {
  return EMPTY;
}

/**
 * Item id → glide delay in ms: shortest distance first, so the longest travel lands last.
 * Ties keep their input order, which keeps the result deterministic for a given scene.
 */
export function staggerDelays(moved: readonly MovedItem[], staggerMs = motionTokens.arrangeStaggerMs): ReadonlyMap<string, number> {
  const real = moved.filter((entry) => entry.distance > MOVE_EPSILON);
  if (real.length === 0) return EMPTY;
  const delays = new Map<string, number>();
  [...real]
    .sort((a, b) => a.distance - b.distance)
    .forEach((entry, index) => delays.set(entry.id, index * staggerMs));
  return delays;
}
