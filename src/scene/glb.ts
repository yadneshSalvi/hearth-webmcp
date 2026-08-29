"use client";
/**
 * The GLB gate: which assets exist, which may be rendered yet, and the warm-up queue that brings the
 * rest in behind the first frame.
 *
 * **Presence is known, not probed.** Every catalog product ships a built GLB and
 * `tests/assets/manifest.test.ts` proves it — the manifest rows and the catalog ids are asserted
 * equal and every file is stat-ed — so a shipped url needs no HEAD request to be believed. What is
 * left of the old probe is the honest fallback for a url the catalog does not ship (a live Shopify
 * product mapped to an asset that was never built): that one is probed, and a miss renders the
 * designed placeholder. A file that 404s or decodes badly despite all this lands in `GlbBoundary`,
 * which wraps one item, so a broken asset is one placeholder rather than a blank studio.
 */
import { Component, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { useGLTF } from "@react-three/drei";
import { catalogSource } from "../../data/catalog.source";
import { createAssetQueue } from "./assetWaves";

/** Local decoder copied from three's examples so nothing is fetched from a CDN. */
export const DRACO_PATH = "/draco/";

export type GlbState = "unknown" | "present" | "missing";

/** Every GLB the built catalog ships. Listed in `data/assets.manifest.json`, on disk in `public`. */
const SHIPPED = new Set<string>(catalogSource.map((product) => product.glb));

/** How many GLBs a deferred wave may have in flight at once (see `assetWaves.ts`). */
export const WARM_CONCURRENCY = 4;

const states = new Map<string, GlbState>();
/** Shipped urls the studio has decided to load: the framed room now, the rest as they are warmed. */
const opened = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function probe(url: string): void {
  if (states.has(url) || typeof fetch === "undefined") return;
  states.set(url, "unknown");
  void fetch(url, { method: "HEAD" })
    .then((response) => {
      states.set(url, response.ok ? "present" : "missing");
    })
    .catch(() => {
      states.set(url, "missing");
    })
    .finally(emit);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Marks shipped urls as loadable now, and tells anything rendering their placeholder to swap. */
export function openGlbs(urls: Iterable<string>): void {
  let changed = false;
  for (const url of urls) {
    if (!SHIPPED.has(url) || opened.has(url)) continue;
    opened.add(url);
    changed = true;
  }
  if (changed) emit();
}

function stateOf(url: string, eager: boolean): GlbState {
  if (!SHIPPED.has(url)) return states.get(url) ?? "unknown";
  return eager || opened.has(url) ? "present" : "unknown";
}

/**
 * Whether this GLB may be rendered yet. `eager` items (the framed room, a ghost under the pointer,
 * a product shot) load immediately; everything else waits for its warm-up wave and draws the
 * designed placeholder until then, so the first frame is never two dozen parallel GLB requests.
 */
export function useGlbState(url: string, eager = true): GlbState {
  const state = useSyncExternalStore(
    subscribe,
    () => stateOf(url, eager),
    () => "unknown" as GlbState,
  );
  // Deliberately no side effect for a shipped url: `stateOf` already answers "present" for an eager
  // one, and opening it here would notify subscribers *during* render, which React rightly refuses.
  if (typeof window !== "undefined" && !SHIPPED.has(url)) probe(url);
  return state;
}

/**
 * Pulls one GLB into the HTTP cache, then opens it and hands it to the loader. Fetching the bytes
 * first is what makes the queue's width mean anything: `useGLTF.preload` returns no handle, so a
 * batch of preloads is a batch of uncounted requests, while a fetch resolves and frees its slot.
 */
async function warmOne(url: string): Promise<void> {
  if (typeof fetch !== "undefined") {
    const response = await fetch(url, { credentials: "same-origin" });
    if (!response.ok) {
      // A shipped url that answers 404 is a build problem, not a runtime one: record it so the
      // placeholder is permanent and honest rather than retried on every render.
      states.set(url, "missing");
      SHIPPED.delete(url);
      emit();
      return;
    }
    await response.arrayBuffer();
  }
  openGlbs([url]);
  useGLTF.preload(url, DRACO_PATH, true);
}

const warmQueue = createAssetQueue(WARM_CONCURRENCY, warmOne);

/** Queues a wave of GLBs for the warm-up, four at a time, in the order given. */
export function warmGlbs(urls: readonly string[]): void {
  warmQueue.push(urls);
}

/** Loads waiting in the warm-up queue, for the dev bridge and the tests. */
export function warmQueueDepth(): { inFlight: number; pending: number } {
  return { inFlight: warmQueue.inFlight(), pending: warmQueue.pending() };
}

interface BoundaryProps {
  fallback: ReactNode;
  children: ReactNode;
}

interface BoundaryState {
  failed: boolean;
}

/** Falls back to the procedural placeholder when a GLB is missing or decodes badly. */
export class GlbBoundary extends Component<BoundaryProps, BoundaryState> {
  constructor(props: BoundaryProps) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(): void {
    // Swallowed on purpose: a missing asset is a designed state, not a page error.
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
