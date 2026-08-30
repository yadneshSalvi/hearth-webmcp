"use client";
/**
 * Per-item opacity fades that leave the shared material cache alone. Materials in src/scene are
 * cached by spec so the whole home uploads a handful of them, which means writing `opacity` on one
 * would fade every item that shares it. While a fade is running, each mesh under the target swaps to
 * its own clone; the originals come straight back the moment it reaches 1 again.
 *
 * Two channels share those clones (see `useMaterialFade`): the transient cross-fade and the steady
 * "this piece is standing in front of the framed room" fade, multiplied together by one loop.
 */
import { useEffect, useMemo, useRef } from "react";
import { invalidate } from "@react-three/fiber";
import type { RefObject } from "react";
import { Mesh } from "three";
import type { Group, Material, Object3D } from "three";

interface Borrowed {
  mesh: Mesh;
  original: Material | Material[];
  clones: Material[];
}

/** One item's fade: which materials are on loan, and the frame that is driving them. */
export interface FadeState {
  borrowed: Borrowed[];
  frame: number;
}

/** Starts an opacity fade on one item; calling it again retargets a fade already in flight. */
export type RunFade = (from: number, to: number, ms: number) => void;

/** Tweens the steady-state channel toward `value` over `ms`; 1 means "not faded". */
export type SetBaseFade = (value: number, ms: number) => void;

/**
 * Two channels over one item's materials, multiplied together and written by one loop.
 *
 * `run` is the transient one — the reduced-motion cross-fade on a new pose, the shrink-and-fade
 * removal — and `setBase` is the steady state: how far this piece is faded because it stands
 * between the camera and the framed room (src/scene/Furniture.tsx). Two independent loops writing
 * the same `opacity` would fight for it frame by frame.
 */
export interface MaterialFade {
  run: RunFade;
  setBase: SetBaseFade;
  /** The combined opacity right now, so a caller can switch a fully faded body off. */
  value: () => number;
}

/** A fresh, idle fade. */
export function createFadeState(): FadeState {
  return { borrowed: [], frame: 0 };
}

function borrow(root: Object3D): Borrowed[] {
  const entries: Borrowed[] = [];
  root.traverse((node) => {
    if (!(node instanceof Mesh) || !node.material) return;
    const original = node.material as Material | Material[];
    const clones = (Array.isArray(original) ? original : [original]).map((material) => {
      const clone = material.clone();
      clone.transparent = true;
      clone.depthWrite = false;
      return clone;
    });
    node.material = Array.isArray(original) ? clones : (clones[0] as Material);
    entries.push({ mesh: node, original, clones });
  });
  return entries;
}

/** Hands every borrowed material back to its mesh and disposes the clones. */
export function restoreFade(state: FadeState): void {
  for (const entry of state.borrowed) {
    entry.mesh.material = entry.original;
    for (const clone of entry.clones) clone.dispose();
  }
  state.borrowed = [];
}

/**
 * Writes one opacity value across `root`, cloning its materials on first use. A value of 1 needs no
 * clone at all, so it also ends the fade: the shared materials go straight back.
 */
export function applyFade(state: FadeState, root: Object3D | null, value: number): void {
  if (value >= 1) {
    restoreFade(state);
    return;
  }
  if (state.borrowed.length === 0 && root) state.borrowed = borrow(root);
  for (const entry of state.borrowed) for (const clone of entry.clones) clone.opacity = value;
}

/** One animated channel: where it started, where it is going and when it set off. */
interface Channel {
  from: number;
  to: number;
  startedAt: number;
  ms: number;
}

function valueOf(channel: Channel, now: number): number {
  const progress = channel.ms <= 0 ? 1 : Math.min(1, (now - channel.startedAt) / channel.ms);
  return channel.from + (channel.to - channel.from) * progress;
}

function settled(channel: Channel, now: number): boolean {
  return channel.ms <= 0 || now - channel.startedAt >= channel.ms;
}

function idle(value: number): Channel {
  return { from: value, to: value, startedAt: 0, ms: 0 };
}

/**
 * Wires a clock-driven opacity fade for everything under `target` and returns its two triggers.
 *
 * The fade is driven by its own `requestAnimationFrame` loop, for two reasons. react-spring honours
 * `prefers-reduced-motion` by skipping animations outright, and under reduced motion the transient
 * cross-fade is the *whole* transition (STYLE.md §3) — a skipped one would leave items popping in
 * and out. And the canvas renders on demand, so something outside the render pass has to ask for the
 * next frame: `invalidate()` called from inside `useFrame` is folded into the frame already drawn.
 */
export function useMaterialFade(target: RefObject<Group | null>): MaterialFade {
  const state = useRef<FadeState>(createFadeState());
  const transient = useRef<Channel>(idle(1));
  const base = useRef<Channel>(idle(1));

  useEffect(() => {
    const current = state.current;
    return () => {
      cancelAnimationFrame(current.frame);
      restoreFade(current);
    };
  }, []);

  return useMemo(() => {
    const pump = (): void => {
      const current = state.current;
      cancelAnimationFrame(current.frame);
      const tick = (): void => {
        const now = performance.now();
        applyFade(current, target.current, valueOf(transient.current, now) * valueOf(base.current, now));
        invalidate();
        const done = settled(transient.current, now) && settled(base.current, now);
        current.frame = done ? 0 : requestAnimationFrame(tick);
      };
      current.frame = requestAnimationFrame(tick);
    };
    return {
      run: (from, to, ms) => {
        transient.current = { from, to, startedAt: performance.now(), ms };
        pump();
      },
      setBase: (value, ms) => {
        const now = performance.now();
        const at = valueOf(base.current, now);
        if (at === value && settled(base.current, now)) return;
        base.current = { from: at, to: value, startedAt: now, ms };
        pump();
      },
      value: () => {
        const now = performance.now();
        return valueOf(transient.current, now) * valueOf(base.current, now);
      },
    };
  }, [target]);
}
