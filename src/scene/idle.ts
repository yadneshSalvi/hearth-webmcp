"use client";
/**
 * Idle governor. The canvas runs `frameloop="demand"`, so a frame is only drawn when react-spring
 * (or React) asks for one. Looping animations — the orb bob, conflict pulses, traffic dashes — are
 * paused once the studio has been quiet for `IDLE_MS`, which drops the GPU to zero when nothing
 * is happening and resumes instantly on the next interaction or store mutation.
 */
import { useEffect, useSyncExternalStore } from "react";
import { hearthStore } from "../state/store";

export const IDLE_MS = 8000;

let awake = true;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Marks the studio active for another `IDLE_MS`; safe to call on every pointer move. */
export function wakeStudio(): void {
  if (typeof window === "undefined") return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    awake = false;
    emit();
  }, IDLE_MS);
  if (!awake) {
    awake = true;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while looping animations should keep requesting frames. */
export function useStudioAwake(): boolean {
  return useSyncExternalStore(subscribe, () => awake, () => true);
}

/** Wakes the studio on every store mutation and on pointer/keyboard activity. Mount once. */
export function useWakeOnActivity(): void {
  useEffect(() => {
    wakeStudio();
    const unsubscribe = hearthStore.subscribe(() => wakeStudio());
    const onActivity = () => wakeStudio();
    window.addEventListener("pointermove", onActivity, { passive: true });
    window.addEventListener("pointerdown", onActivity, { passive: true });
    window.addEventListener("wheel", onActivity, { passive: true });
    window.addEventListener("keydown", onActivity);
    return () => {
      unsubscribe();
      window.removeEventListener("pointermove", onActivity);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("wheel", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, []);
}

/** Tracks `prefers-reduced-motion`; choreography degrades to cross-fades (STYLE.md §3). */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeMotion, motionSnapshot, () => false);
}

function subscribeMotion(listener: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => undefined;
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

function motionSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
