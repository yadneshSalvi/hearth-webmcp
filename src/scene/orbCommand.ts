"use client";
/**
 * Agent presence commands. `studioApi.flyOrb()` pushes a destination and label here; the Orb
 * component subscribes and springs to it, then drifts back to its idle corner.
 */
import { useSyncExternalStore } from "react";
import type { Vec2 } from "../engine/types";

export interface OrbCommand {
  roomId: string;
  pos: Vec2;
  label: string;
  /** Monotonic id so repeating the same destination still re-triggers the flight. */
  issued: number;
}

let command: OrbCommand | undefined;
const listeners = new Set<() => void>();

/** Sends the orb to a room-local point with a label chip. */
export function flyOrbTo(point: { roomId: string; pos: Vec2 }, label: string): void {
  command = { roomId: point.roomId, pos: { ...point.pos }, label, issued: Date.now() };
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The most recent orb command, or undefined before the first tool action. */
export function useOrbCommand(): OrbCommand | undefined {
  return useSyncExternalStore(subscribe, () => command, () => undefined);
}
