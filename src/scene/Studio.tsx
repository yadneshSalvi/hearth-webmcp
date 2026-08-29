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

/**
 * The live root's own `invalidate` and `setFrameloop`, published by CaptureBridge. The module-level
 * import can bind to a different copy of the R3F runtime than the one driving this canvas, in which
 * case it schedules a frame nobody renders — and a `frameloop="demand"` canvas renders nothing on
 * its own, so a capture would wait forever.
 */
let requestFrame: (() => void) | undefined;
let setLoop: ((mode: "always" | "demand") => void) | undefined;

/** Frames to keep asking for while a capture is pending; the pump stops the moment one is drained. */
const CAPTURE_FRAME_BUDGET = 180;

/**
 * While a capture is queued the loop runs continuously and is nudged every animation frame, then
 * drops straight back to demand. A capture is the one moment where a frame is not optional.
 */
function pumpFrames(): void {
  let budget = CAPTURE_FRAME_BUDGET;
  setLoop?.("always");
  const kick = (): void => {
    if (pendingCaptures.length === 0 || budget <= 0) {
      setLoop?.("demand");
      return;
    }
    budget -= 1;
    (requestFrame ?? invalidate)();
    requestAnimationFrame(kick);
  };
  kick();
}

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
      pumpFrames();
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
  const invalidateRoot = useThree((state) => state.invalidate);
  const setFrameloop = useThree((state) => state.setFrameloop);
  useEffect(() => {
    requestFrame = invalidateRoot;
    setLoop = setFrameloop;
    return () => {
      if (requestFrame === invalidateRoot) requestFrame = undefined;
      if (setLoop === setFrameloop) setLoop = undefined;
    };
  }, [invalidateRoot, setFrameloop]);
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

/** Probes the scene's GLBs once so missing assets fall straight through to the placeholders. */
function AssetProbe() {
  useEffect(() => {
    const urls = [...new Set(hearthStore.getState().catalog.map((product) => product.glb))];
    probeGlbs(urls);
    const timer = setTimeout(() => preloadGlbs(urls), 500);
    return () => clearTimeout(timer);
  }, []);
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
        style={{ background: "transparent" }}
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
