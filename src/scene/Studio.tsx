"use client";
/**
 * The Hearth studio canvas: an orthographic dollhouse over a warm CSS gradient. Composes the camera
 * rig, the single lighting rig, rooms, furniture, conflict overlays, the agent orb and the post
 * chain, and exposes the imperative `studioApi` used by tools and the design-board export.
 */
import { useEffect } from "react";
import { Canvas, addAfterEffect, invalidate, useThree } from "@react-three/fiber";
import { ACESFilmicToneMapping, SRGBColorSpace, Vector3 } from "three";
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
import { planAssetWaves } from "./assetWaves";
import { cameraBridgeSnapshot } from "./cameraState";
import { devBridgesEnabled } from "./devBridge";
import { setFocusTarget } from "./focus";
import type { FocusTarget } from "./focus";
import { warmGlbs, warmQueueDepth } from "./glb";
import { watchHomeFraming } from "./homeFocus";
import { useWakeOnActivity, wakeStudio } from "./idle";
import { markStudioPainted, studioPaintedAt, whenStudioPainted } from "./intro";
import { flyOrbTo } from "./orbCommand";
import { M } from "./math";
import { silenceClockDeprecation } from "./threeConsole";
import { useMeta } from "./useSceneStore";

// R3F 9.7 builds its loop on the deprecated `THREE.Clock`, so the warning fires the moment a canvas
// mounts. Filtered here, in the module that owns the canvas, before anything constructs one.
silenceClockDeprecation();

export interface StudioApi {
  /** Frames a room or item; pass undefined to return to the active room. */
  focus(target: FocusTarget | undefined): void;
  /**
   * World centimetres → the captured frame, in 0–1 of its width and height. Resolution-independent
   * on purpose: `capture()` hands back a device-pixel image, and the design board only needs to know
   * *where in the frame* the room it is describing actually sits (src/ui/boardExport.ts).
   */
  projectNormalized(world: Vec2): { x: number; y: number } | undefined;
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
/** The live camera projection, published by CaptureBridge for `studioApi.projectNormalized`. */
let projectFrame: ((world: Vec2) => { x: number; y: number } | undefined) | undefined;

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
  projectNormalized(world) {
    return projectFrame?.(world);
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
  const camera = useThree((state) => state.camera);
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
  useEffect(() => {
    const point = new Vector3();
    const project = (world: Vec2): { x: number; y: number } | undefined => {
      const projected = point.set(world.x * M, 0, world.y * M).project(camera);
      if (!Number.isFinite(projected.x) || !Number.isFinite(projected.y)) return undefined;
      return { x: (projected.x + 1) / 2, y: (1 - projected.y) / 2 };
    };
    projectFrame = project;
    return () => {
      if (projectFrame === project) projectFrame = undefined;
    };
  }, [camera]);
  useEffect(() => addAfterEffect(() => {
    // Marked here rather than in the camera rig: `addAfterEffect` runs after `gl.render`, so the
    // curtain lifts on a frame that exists instead of on the frame that is about to be drawn.
    markStudioPainted();
    drainCaptures(gl.domElement);
  }), [gl]);
  return null;
}

/** Test-only handle so the screenshot harness can read renderer state and sample frame rate. */
function DebugBridge() {
  const store = useThree((state) => state.get);
  useEffect(() => {
    if (!devBridgesEnabled()) return;
    const target = window as unknown as {
      __hearthStudio?: unknown;
      __hearthPinQuality?: unknown;
      __hearthPaint?: unknown;
    };
    // The R3F state getter, with the camera the human is looking through hung off it: QA and the
    // end-to-end suite drive real gestures and read the effective azimuth, pitch, zoom and pan back.
    target.__hearthStudio = Object.assign(store, { camera: cameraBridgeSnapshot });
    target.__hearthPinQuality = pinQualityTier;
    // First paint of the studio, in ms since the page started, plus what the warm-up still owes.
    target.__hearthPaint = () => ({ firstFrameMs: Math.round(studioPaintedAt()), warm: warmQueueDepth() });
    return () => {
      delete target.__hearthStudio;
      delete target.__hearthPinQuality;
      delete target.__hearthPaint;
    };
  }, [store]);
  return null;
}

/**
 * Pulls the camera back to the whole home the moment a template is applied, whoever applied it
 * (src/scene/homeFocus.ts). Mounted here because the studio owns the camera, not the chrome.
 */
function HomeFraming() {
  useEffect(() => watchHomeFraming(), []);
  return null;
}

/** Latest a deferred asset wave may wait for an idle moment before it goes anyway. */
const ASSET_WAVE_DEADLINE_MS = 4_000;

/**
 * The GLB warm-up. Nothing is fetched before the studio has painted, and nothing outside the framed
 * room is fetched until the browser is idle: the framed room's items load their own assets on the
 * first render (`src/scene/glb.ts`), then the rest of the home and finally the unplaced catalog
 * trickle in four at a time. Presence is read from the built manifest, so there are no HEAD probes
 * at all — the boot used to spend ~140 requests on 71 files for rooms nobody was looking at.
 */
function AssetWarmup() {
  const activeRoomId = useMeta().activeRoomId;
  useEffect(() => {
    let cancelled = false;
    let idleHandle: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const warm = (): void => {
      if (cancelled) return;
      const state = hearthStore.getState();
      const glbFor = new Map(state.catalog.map((product) => [product.id, product.glb]));
      const waves = planAssetWaves({
        activeRoomId,
        placed: state.scene.furniture,
        glbFor: (catalogId) => glbFor.get(catalogId),
        catalog: state.catalog.map((product) => product.glb),
      });
      // `waves.framed` is deliberately not warmed: those items are on screen and already loading.
      warmGlbs(waves.rest);
      warmGlbs(waves.catalog);
    };

    const schedule = (): void => {
      if (cancelled) return;
      if (typeof requestIdleCallback === "function") {
        idleHandle = requestIdleCallback(warm, { timeout: ASSET_WAVE_DEADLINE_MS });
        return;
      }
      timer = setTimeout(warm, 0);
    };

    const stopWaiting = whenStudioPainted(schedule);
    return () => {
      cancelled = true;
      stopWaiting();
      if (idleHandle !== undefined) cancelIdleCallback(idleHandle);
      if (timer !== undefined) clearTimeout(timer);
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
        <AssetWarmup />
        <HomeFraming />
      </Canvas>
    </div>
  );
}

export { Studio };
export type { FocusTarget };
