"use client";
/**
 * The removal beat: a just-removed item stays on screen for `EXIT_MS` so it can shrink and fade out
 * (STYLE.md §3) instead of blinking away. Transient only — the store stays the source of truth for
 * what exists; this just holds the last render of what no longer does.
 */
import { useEffect, useState } from "react";
import { hearthStore } from "../state/store";
import { resolveOne } from "./furniturePose";
import type { Resolved } from "./furniturePose";

/** How long a removed item keeps its place while it shrinks and fades. */
export const EXIT_MS = 240;

/**
 * Keeps a just-removed item mounted for 240 ms so it can shrink and fade out, driven by the store
 * transition itself. Transient exit state only — the store stays the source of truth for what exists.
 */
export function useExitingItems(): Resolved[] {
  const [exiting, setExiting] = useState<Resolved[]>([]);
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const unsubscribe = hearthStore.subscribe((state, previous) => {
      if (state.scene.furniture === previous.scene.furniture) return;
      const alive = new Set(state.scene.furniture.map((item) => item.id));
      const byId = (id: string) => previous.catalog.find((product) => product.id === id);
      const gone = previous.scene.furniture
        .filter((item) => !alive.has(item.id) && item.status === "placed")
        .map((item) => resolveOne(item, previous.scene.rooms, byId, previous.scene.furniture))
        .filter((entry): entry is Resolved => entry !== undefined);
      if (gone.length === 0) return;
      setExiting((current) => [...current, ...gone]);
      const ids = new Set(gone.map((entry) => entry.item.id));
      const timer = setTimeout(() => {
        timers.delete(timer);
        setExiting((current) => current.filter((entry) => !ids.has(entry.item.id)));
      }, EXIT_MS + 60);
      timers.add(timer);
    });
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, []);
  return exiting;
}
