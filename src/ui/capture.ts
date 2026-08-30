"use client";
/**
 * Grabbing a studio frame for the overlays that photograph the room (the compare split view and the
 * design board). `studioApi.capture()` resolves on the next rendered frame; the canvas runs
 * `frameloop="demand"`, so a frame that never arrives would leave an overlay waiting forever. This
 * gives every capture a deadline and one more try — a missed frame costs a beat, never the feature.
 *
 * Both overlays are composed artefacts (STYLE.md §6), so both are photographed from the *framed*
 * shot: a board exported while the human happened to be orbited to 52° and zoomed in would inherit
 * that angle, and two boards of the same room would not look like the same product. The human's
 * adjustments are given back the moment the shutter closes.
 */
import { cameraAdjustments, cameraOffHome, resetCamera, restoreCameraAdjustments } from "../scene/cameraState";
import { getFocusTarget, setFocusTarget } from "../scene/focus";
import { hearthStore } from "../state/store";
import { motion } from "../tokens";
import type { StudioApi } from "../scene/Studio";

const CAPTURE_TIMEOUT_MS = 6_000;
/** A beat for the rig to write the re-homed camera before the shutter opens. */
const REHOME_MS = 120;
/** A framing change is a 600 ms tween (STYLE.md §2), plus a beat. */
const REFRAME_MS = motion.cameraTweenMs + 140;

/** Which room the camera is framing right now, or undefined for the whole home or one item. */
function framedRoomId(): string | undefined {
  const target = getFocusTarget();
  if (target?.home || target?.itemId) return undefined;
  return target?.roomId ?? hearthStore.getState().scene.meta.activeRoomId;
}

function withDeadline(promise: Promise<Blob>, ms: number): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("The studio did not render a frame in time")), ms);
    promise.then(
      (blob) => {
        clearTimeout(timer);
        resolve(blob);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error("The studio frame could not be captured"));
      },
    );
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Runs `shoot` on `roomId`'s own framed shot, then puts the studio back exactly as it was.
 *
 * Two things are borrowed. The framing: a board headed "Living Room · 7 items" whose hero image is
 * all eleven rooms (because a template apply had just framed the home) is not a board of that room.
 * And the human's orbit, zoom and pan, which a composed artefact must not inherit. Both are given
 * back in the reverse order, so the pan lands on the framing it belongs to.
 */
export async function fromFramedShot<T>(shoot: () => Promise<T>, roomId?: string): Promise<T> {
  const focus = getFocusTarget();
  const reframe = roomId !== undefined && framedRoomId() !== roomId;
  const adjusted = cameraOffHome();
  const saved = cameraAdjustments();
  if (reframe) setFocusTarget({ roomId });
  if (adjusted) resetCamera({ tween: false });
  if (reframe) await wait(REFRAME_MS);
  else if (adjusted) await wait(REHOME_MS);
  try {
    return await shoot();
  } finally {
    if (reframe) {
      setFocusTarget(focus);
      // The rig re-homes on a framing change from a React effect, i.e. after this render — so the
      // adjustments have to be handed back after that effect, or it wipes them.
      if (adjusted) await wait(REHOME_MS);
    }
    if (adjusted) restoreCameraAdjustments(saved);
  }
}

/**
 * How much longer the second attempt is given. A machine that missed the first six seconds is a slow
 * machine — a software renderer, a laptop under load — and asking it the same question with the same
 * stopwatch just fails twice. Measured under Chrome's CPU throttling, a studio frame that misses
 * 6 s still lands inside 18 s; the comparison and the board would rather take a beat than die with a
 * warning toast, which is what the split view did once per few full suite runs.
 */
const RETRY_PATIENCE = 3;

/** Captures one frame, retrying once with more patience (which also re-invalidates the render loop). */
export async function captureFrame(studio: StudioApi, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<Blob> {
  try {
    return await withDeadline(studio.capture(), timeoutMs);
  } catch {
    return withDeadline(studio.capture(), timeoutMs * RETRY_PATIENCE);
  }
}
