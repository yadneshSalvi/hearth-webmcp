"use client";
/**
 * Transient pointer-hover state, kept out of the store on purpose: `setSelection` is undoable and
 * writes the activity feed, so a hover must not create history. The store's `selection.hoverItemId`
 * still wins when tools or panels drive it — see `useIsHovered`.
 */
import { useSyncExternalStore } from "react";

let hoveredId: string | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Sets (or clears) the pointer-hovered furniture id. */
export function setPointerHover(id: string | undefined): void {
  if (hoveredId === id) return;
  hoveredId = id;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): string | undefined {
  return hoveredId;
}

/** True when this item is hovered by the pointer or by the store's `selection.hoverItemId`. */
export function useIsHovered(id: string, storeHoverId?: string): boolean {
  const pointer = useSyncExternalStore(subscribe, snapshot, () => undefined);
  return pointer === id || storeHoverId === id;
}
