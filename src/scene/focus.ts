"use client";
/**
 * Camera focus override. By default the rig frames the active room; `studioApi.focus()` can pin it
 * to one room or item, and clearing the override returns to the active room.
 */
import { useSyncExternalStore } from "react";

export interface FocusTarget {
  roomId?: string;
  itemId?: string;
}

let target: FocusTarget | undefined;
const listeners = new Set<() => void>();

/** Pins the camera to a room or item; `undefined` returns to the active room. */
export function setFocusTarget(next: FocusTarget | undefined): void {
  target = next && (next.roomId || next.itemId) ? next : undefined;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current camera focus override, or undefined when the active room is framed. */
export function useFocusTarget(): FocusTarget | undefined {
  return useSyncExternalStore(subscribe, () => target, () => undefined);
}
