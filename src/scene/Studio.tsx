"use client";
/**
 * The Hearth studio canvas: an orthographic dollhouse over a warm CSS gradient. Composes the camera
 * rig, the single lighting rig, rooms, furniture, conflict overlays, the agent orb and the post
 * chain, and exposes the imperative `studioApi` used by tools and the design-board export.
 */
import { useEffect } from "react";
import { Canvas, addAfterEffect, invalidate, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, SRGBColorSpace } from "three";
import type { Vec2 } from "../engine/types";
import { hearthStore } from "../state/store";
import { palette } from "../tokens";
import { CameraRig } from "./CameraRig";
import { Furniture } from "./Furniture";
import { Interaction } from "./Interaction";
import { LightingRig } from "./LightingRig";
import { Orb } from "./Orb";
import { Overlays } from "./Overlays";
import { Post, pinQualityTier } from "./Post";
import { Rooms } from "./Rooms";
import { preloadGlbs, probeGlbs } from "./assets";
import { setFocusTarget } from "./focus";
import type { FocusTarget } from "./focus";
import { useWakeOnActivity, wakeStudio } from "./idle";
import { flyOrbTo } from "./orbCommand";
import { useMeta } from "./useSceneStore";

export interface StudioApi {
  /** Frames a room or item; pass undefined to return to the active room. */
  focus(target: FocusTarget | undefined): void;
  /** Sends the agent orb to a room-local point with a label chip. */
  flyOrb(point: { roomId: string; pos: Vec2 }, label: string): void;
  /** Grabs the next rendered frame, composited over the studio background gradient. */
  capture(): Promise<Blob>;
}

type Resolver = { resolve: (blob: Blob) => void; reject: (error: Error) => void };
let pendingCaptures: Resolver[] = [];

/** Imperative studio handle. Stable across remounts so tool handlers can hold onto it. */
export const studioApi: StudioApi = {
  focus(target) {
    setFocusTarget(target);
    wakeStudio();
  },
  flyOrb(point, label) {
    flyOrbTo(point, label);
    wakeStudio();
  },
  capture() {
    return new Promise<Blob>((resolve, reject) => {
      pendingCaptures.push({ resolve, reject });
      wakeStudio();
      invalidate();
    });
  },
};

function drainCaptures(canvas: HTMLCanvasElement): void {
  if (pendingCaptures.length === 0) return;
  const waiting = pendingCaptures;
  pendingCaptures = [];
  try {
    const composite = document.createElement("canvas");
    composite.width = canvas.width;
    composite.height = canvas.height;
    const context = composite.getContext("2d");
    if (!context) throw new Error("2D context unavailable");
    const styles = getComputedStyle(document.documentElement);
    const gradient = context.createLinearGradient(0, 0, 0, composite.height);
    gradient.addColorStop(0, styles.getPropertyValue("--studio-bg-top").trim() || palette.canvasTop);
    gradient.addColorStop(1, styles.getPropertyValue("--studio-bg-bottom").trim() || palette.canvasBottom);
    context.fillStyle = gradient;
    context.fillRect(0, 0, composite.width, composite.height);
    context.drawImage(canvas, 0, 0);
    composite.toBlob((blob) => {
      if (blob) for (const entry of waiting) entry.resolve(blob);
      else for (const entry of waiting) entry.reject(new Error("Studio capture produced no image"));
    }, "image/png");
  } catch (error) {
    for (const entry of waiting) entry.reject(error instanceof Error ? error : new Error("Studio capture failed"));
  }
}

/** Reads the freshly rendered frame for `studioApi.capture()` before the buffer is cleared. */
function CaptureBridge() {
  const gl = useThree((state) => state.gl);
  useEffect(() => addAfterEffect(() => drainCaptures(gl.domElement)), [gl]);
  return null;
}

/** Dev-only handle so the screenshot harness can read renderer state and sample frame rate. */
function DebugBridge() {
  const store = useThree((state) => state.get);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const target = window as unknown as { __hearthStudio?: unknown; __hearthPinQuality?: unknown };
    target.__hearthStudio = store;
    target.__hearthPinQuality = pinQualityTier;
    return () => {
      delete target.__hearthStudio;
      delete target.__hearthPinQuality;
    };
  }, [store]);
  return null;
}

/** Latest a deferred asset wave may wait for an idle moment before it goes anyway. */
const ASSET_WAVE_DEADLINE_MS = 4_000;

/**
 * Probes the scene's GLBs so a missing asset falls straight through to the designed placeholder, in
 * waves: the framed room immediately, then the rest of the home, then the remaining catalog — a
 * first paint never queues 71 files for rooms nobody is looking at. The deferred waves wait for an
 * idle moment, because decoding a DRACO mesh on the main thread during someone's drag is exactly
 * the stall this split exists to avoid. Probing is a HEAD request and `preloadGlbs` only warms what
 * the probe found, hence the gap between the two.
 */
function AssetProbe() {
  const activeRoomId = useMeta().activeRoomId;
  useEffect(() => {
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const idle = new Set<number>();
    const whenIdle = (run: () => void, immediate: boolean): void => {
      if (immediate || typeof requestIdleCallback !== "function") {
        const timer = setTimeout(() => {
          timers.delete(timer);
          run();
        }, 0);
        timers.add(timer);
        return;
      }
      const handle = requestIdleCallback(() => {
        idle.delete(handle);
        run();
      }, { timeout: ASSET_WAVE_DEADLINE_MS });
      idle.add(handle);
    };
    const wave = (urls: string[], immediate: boolean): void => {
      if (urls.length === 0) return;
      whenIdle(() => {
        probeGlbs(urls);
        whenIdle(() => preloadGlbs(urls), false);
      }, immediate);
    };

    const state = hearthStore.getState();
    const glbFor = new Map(state.catalog.map((product) => [product.id, product.glb]));
    const placed = state.scene.furniture.filter((item) => item.status !== "ghost");
    const urlsOf = (items: typeof placed): string[] =>
      [...new Set(items.map((item) => glbFor.get(item.catalogId)).filter((url): url is string => url !== undefined))];

    const framed = urlsOf(placed.filter((item) => item.roomId === activeRoomId));
    const seen = new Set(framed);
    const rest = urlsOf(placed.filter((item) => item.roomId !== activeRoomId)).filter((url) => !seen.has(url));
    for (const url of rest) seen.add(url);
    const catalog = [...new Set(state.catalog.map((product) => product.glb))].filter((url) => !seen.has(url));

    wave(framed, true);
    wave(rest, false);
    wave(catalog, false);
    return () => {
      for (const timer of timers) clearTimeout(timer);
      for (const handle of idle) cancelIdleCallback(handle);
    };
  }, [activeRoomId]);
  return null;
}

/**
 * Full-bleed studio. `frameloop="demand"` — every animation here is a react-spring value, and
 * react-spring invalidates the loop while it runs, so the GPU idles at zero once the studio is
 * quiet (see src/scene/idle.ts) yet never drops a frame during a tween.
 */
export default function Studio() {
  useWakeOnActivity();
  return (
    <div className="absolute inset-0" data-studio="canvas">
      <Canvas
        orthographic
        shadows="variance"
        frameloop="demand"
        dpr={[1, 2]}
        gl={{
          antialias: true,
          alpha: true,
          toneMapping: ACESFilmicToneMapping,
          outputColorSpace: SRGBColorSpace,
          powerPreference: "high-performance",
        }}
        // Drags and two-finger pans belong to the studio, not to the page's scroller.
        style={{ background: "transparent", touchAction: "none" }}
      >
        <CameraRig />
        <LightingRig />
        <Rooms />
        <Furniture />
        <Overlays />
        <Interaction />
        <Orb />
        <Post />
        <CaptureBridge />
        <DebugBridge />
        <AssetProbe />
      </Canvas>
    </div>
  );
}

export { Studio };
export type { FocusTarget };
