"use client";
/**
 * Grabbing a studio frame for the overlays that photograph the room (the compare split view and the
 * design board). `studioApi.capture()` resolves on the next rendered frame; the canvas runs
 * `frameloop="demand"`, so a frame that never arrives would leave an overlay waiting forever. This
 * gives every capture a deadline and one more try — a missed frame costs a beat, never the feature.
 */
import type { StudioApi } from "../scene/Studio";

const CAPTURE_TIMEOUT_MS = 6_000;

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

/** Captures one frame, retrying once (which also re-invalidates the render loop). */
export async function captureFrame(studio: StudioApi, timeoutMs = CAPTURE_TIMEOUT_MS): Promise<Blob> {
  try {
    return await withDeadline(studio.capture(), timeoutMs);
  } catch {
    return withDeadline(studio.capture(), timeoutMs);
  }
}
