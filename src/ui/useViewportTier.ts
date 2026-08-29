"use client";
/**
 * Layout tiers (the approved blueprint): ≥ 1280 full layout · 1024–1279 side panels collapse to
 * icon rails · < 1024 view-only plus the prompt bar.
 */
import { useSyncExternalStore } from "react";

export type ViewportTier = "full" | "rails" | "compact";

const RAILS_MIN = 1024;
const FULL_MIN = 1280;

function tierFor(width: number): ViewportTier {
  if (width >= FULL_MIN) return "full";
  if (width >= RAILS_MIN) return "rails";
  return "compact";
}

let current: ViewportTier = "full";
const listeners = new Set<() => void>();

function measure(): void {
  const next = tierFor(window.innerWidth);
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) {
    current = tierFor(window.innerWidth);
    window.addEventListener("resize", measure, { passive: true });
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("resize", measure);
  };
}

function snapshot(): ViewportTier {
  return current;
}

function serverSnapshot(): ViewportTier {
  return "full";
}

/** The current layout tier, updated on resize. */
export function useViewportTier(): ViewportTier {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
