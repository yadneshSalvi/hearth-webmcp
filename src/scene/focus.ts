"use client";
/**
 * Camera focus override. By default the rig frames the active room; `studioApi.focus()` can pin it
 * to the whole home, to one room or to one item, and clearing the override returns to the active
 * room.
 *
 * The home shot is what a template apply lands on (src/scene/homeFocus.ts): choosing a 5-bedroom
 * plan and being left staring at one bedroom is the bug this exists to fix.
 */
import { useSyncExternalStore } from "react";

export interface FocusTarget {
  /** Frames the entire home. Wins over a room or item id if both are somehow set. */
  home?: boolean;
  roomId?: string;
  itemId?: string;
}

/** What the camera is framing, for the dev bridge and the chrome's selected states. */
export type FocusKind = "home" | "room" | "item";

let target: FocusTarget | undefined;
/**
 * Monotonic framing token. Every write counts as a framing command, even one that asks for the shot
 * the camera already has: an agent calling `set_view` with the current room, or a human re-picking
 * the active room in the switcher, means "put the camera back", and comparing targets alone would
 * silently ignore both (the rig re-homes on this token — src/scene/CameraRig.tsx).
 */
let token = 0;
const listeners = new Set<() => void>();

/** Pins the camera to the home, a room or an item; `undefined` returns to the active room. */
export function setFocusTarget(next: FocusTarget | undefined): void {
  target = next && (next.home || next.roomId || next.itemId) ? next : undefined;
  token += 1;
  for (const listener of listeners) listener();
}

/** How many framing commands have been issued. Changes on every `setFocusTarget` call. */
export function focusToken(): number {
  return token;
}

/** The current override, read imperatively (the store watcher and the dev bridge use this). */
export function getFocusTarget(): FocusTarget | undefined {
  return target;
}

/** True while the whole home is framed. */
export function isHomeFocus(): boolean {
  return target?.home === true;
}

/** What the rig is framing right now. No override means the active room. */
export function focusKind(): FocusKind {
  if (target?.home) return "home";
  if (target?.itemId) return "item";
  return "room";
}

/** Toggles the whole-home shot; switching it off returns to the active room. */
export function toggleHomeFocus(): void {
  setFocusTarget(isHomeFocus() ? undefined : { home: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The current camera focus override, or undefined when the active room is framed. */
export function useFocusTarget(): FocusTarget | undefined {
  return useSyncExternalStore(subscribe, getFocusTarget, () => undefined);
}

/** True while the whole home is framed, for the room switcher's selected state. */
export function useHomeFocus(): boolean {
  return useSyncExternalStore(subscribe, isHomeFocus, () => false);
}

/** The framing token, so the rig re-homes for every command and not only for a changed target. */
export function useFocusToken(): number {
  return useSyncExternalStore(subscribe, focusToken, () => 0);
}

