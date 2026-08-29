"use client";
/**
 * The opening shot. Hearth is a room, and a room should be walked into: the studio settles over two
 * seconds instead of snapping on. The yaw enters 15° off `sw` and sweeps into place, the walls fade
 * up from the plan, and every piece of furniture rises the last 6 cm onto the floor. Then the
 * welcome card arrives, once the studio has stopped moving.
 *
 * The clock starts when this module is first evaluated — that is when the studio chunk lands, one
 * frame before the canvas mounts — so the camera rig, the walls and the furniture all read the same
 * timeline no matter which of them renders first. `prefers-reduced-motion` reduces the whole thing
 * to the cross-fade the curtain already performs (STYLE.md §3).
 */
import { useSyncExternalStore } from "react";
import { invalidate } from "@react-three/fiber";
import { hearthStore } from "../state/store";
import { clamp, easeOut } from "./math";

/** Total length of the settle, matching the time-of-day tween so the studio has one tempo. */
export const INTRO_MS = 2000;
/** How far off the resting yaw the camera enters, in degrees (STYLE.md §2: yaw stays on its corner). */
export const INTRO_SWEEP_DEG = 15;
/** How far furniture rises onto the floor during the settle, in centimetres. */
export const INTRO_RISE_CM = 6;

const SWEEP_RAD = (INTRO_SWEEP_DEG * Math.PI) / 180;
/**
 * Everything that *moves* — the yaw sweep and the furniture lift — is done well before the settle
 * closes, and lands *exactly*: an eased motion that runs the full two seconds keeps creeping
 * sub-pixel amounts long after it looks still, which is enough to make a pointer aimed at a
 * projected room coordinate miss (tests/e2e/interaction.spec.ts). The studio arrives, holds for a
 * beat, and then the welcome card comes in.
 */
const MOTION_MS = 1200;
/** The plaster curtain holds at least this long, so a very fast first frame still shows the plan. */
const CURTAIN_HOLD_MS = 180;
/** No frame at all (no WebGL, a failed context) must never leave the studio behind plaster. */
const CURTAIN_SAFETY_MS = 1600;

/**
 * "solid" shows the loading plan through the not-yet-painted canvas; "gone" is unmounted. There is
 * no fade between them on purpose: a CSS opacity transition anywhere on this page costs the studio
 * whole frames on a software renderer, and `studioApi.capture()` is waiting for those (Compare and
 * the design board both photograph the canvas). The two images are plaster with the same plan in the
 * middle, so the cut reads as the room arriving rather than as a change of screen.
 */
export type Curtain = "solid" | "gone";

export interface IntroView {
  /** True until the settle has finished; the welcome card waits for false. */
  active: boolean;
  /** 0 on the first frame, 1 once the walls have been asked to fade up. */
  wallFade: number;
  curtain: Curtain;
}

let startedAt = 0;
let reduced = false;
let finished = true;
let painted = false;
/** `performance.now()` of the studio's first painted frame — first paint, measured on the page. */
let paintedAt = 0;
const paintWaiters = new Set<() => void>();
let scale = 1;
let unwatch: (() => void) | undefined;
let view: IntroView = { active: false, wallFade: 1, curtain: "gone" };
const listeners = new Set<() => void>();

function publish(patch: Partial<IntroView>): void {
  view = { ...view, ...patch };
  for (const listener of listeners) listener();
}

/** Eased 0..1 progress through the opening motion. Cheap enough to call once per frame. */
export function introProgress(): number {
  if (finished || reduced) return 1;
  return easeOut(clamp((performance.now() - startedAt) / (MOTION_MS * scale), 0, 1));
}

/** Extra camera azimuth in radians: the sweep the yaw still has to travel, exactly 0 once done. */
export function introAzimuthOffset(): number {
  if (finished || reduced) return 0;
  if (performance.now() - startedAt >= MOTION_MS * scale) return 0;
  return (1 - introProgress()) * SWEEP_RAD;
}

/** How far the furniture layer is still lifted off the floor, in metres; 0 once the settle is over. */
export function introRiseMetres(): number {
  if (finished || reduced) return 0;
  if (performance.now() - startedAt >= MOTION_MS * scale) return 0;
  return (1 - introProgress()) * (INTRO_RISE_CM / 100);
}

/** True while a piece mounting now belongs to the opening frame rather than dropping in. */
export function introSettling(): boolean {
  return !finished && !reduced;
}

/** Marks the first painted frame, which releases the plaster curtain over the canvas. */
export function markStudioPainted(): void {
  if (painted) return;
  painted = true;
  paintedAt = performance.now();
  const hold = Math.max(0, CURTAIN_HOLD_MS - (paintedAt - startedAt));
  setTimeout(revealStudio, hold);
  for (const waiter of paintWaiters) waiter();
  paintWaiters.clear();
}

/** `performance.now()` of the first painted frame, or 0 while the curtain is still up. */
export function studioPaintedAt(): number {
  return paintedAt;
}

/**
 * Runs `callback` on the first painted frame, or immediately if the studio has already painted.
 * Deferred work (the GLB warm-up) hangs off this so nothing competes with the first frame.
 */
export function whenStudioPainted(callback: () => void): () => void {
  if (painted) {
    callback();
    return () => undefined;
  }
  paintWaiters.add(callback);
  return () => {
    paintWaiters.delete(callback);
  };
}

function revealStudio(): void {
  if (view.curtain !== "solid") return;
  publish({ curtain: "gone" });
}

/**
 * Ends the settle: the camera is exactly on its yaw, the walls are at full opacity, and anything
 * placed from now on drops in as usual.
 */
function finish(): void {
  if (finished) return;
  finished = true;
  unwatch?.();
  unwatch = undefined;
  publish({ active: false, wallFade: 1 });
  invalidate();
}

/**
 * The camera sweep and the furniture lift are read from the wall clock inside `useFrame`, so this
 * loop is what asks for the frames that show them. It stops with the motion rather than running the
 * whole settle, so a software renderer is not asked for two seconds of frames it cannot afford.
 */
function tick(): void {
  if (finished || performance.now() - startedAt >= MOTION_MS * scale) {
    invalidate();
    return;
  }
  invalidate();
  requestAnimationFrame(tick);
}

/**
 * `?settle=<2..8>` stretches the opening in development so it can be watched (and screenshotted)
 * frame by frame. Production ignores it; the choreography itself is identical, just slower.
 */
function slowMotion(): number {
  if (process.env.NODE_ENV === "production") return 1;
  const asked = Number(new URLSearchParams(window.location.search).get("settle"));
  return Number.isFinite(asked) ? clamp(asked, 1, 8) : 1;
}

function start(): void {
  reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  scale = slowMotion();
  startedAt = performance.now();
  painted = false;
  finished = reduced;
  view = { active: !reduced, wallFade: reduced ? 1 : 0, curtain: "solid" };
  // One frame later the walls are told to fade up, which is what makes it a fade and not a cut.
  requestAnimationFrame(() => {
    publish({ wallFade: 1 });
    if (!reduced) tick();
  });
  if (!reduced) setTimeout(finish, INTRO_MS * scale);
  setTimeout(() => {
    if (!painted) revealStudio();
  }, CURTAIN_SAFETY_MS);

  // A human (or an agent, or a test) who starts changing the home outranks the opening flourish:
  // the first real scene change ends it, so the camera is never still moving under someone's hands.
  if (!reduced) {
    unwatch = hearthStore.subscribe((state, previous) => {
      if (state.scene !== previous.scene) finish();
    });
  }
}

if (typeof window !== "undefined") {
  start();
  // Dev-only handle: the screenshot harness reads (and the e2e run diagnoses) the opening settle.
  if (process.env.NODE_ENV !== "production") {
    (window as unknown as { __hearthIntro?: unknown }).__hearthIntro = {
      view: () => view,
      progress: introProgress,
      painted: () => painted,
      /** First paint of the studio in ms since the page started (performance.now()). */
      paintedAt: () => paintedAt,
      /** Milliseconds from the studio chunk landing to the first painted frame. */
      firstFrameMs: () => (paintedAt > 0 ? Math.round(paintedAt - startedAt) : undefined),
      settling: introSettling,
      startedAt: () => startedAt,
    };
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): IntroView {
  return view;
}

const SERVER_VIEW: IntroView = { active: false, wallFade: 1, curtain: "gone" };

/** The intro state the chrome and the renderer share. */
export function useIntroView(): IntroView {
  return useSyncExternalStore(subscribe, snapshot, () => SERVER_VIEW);
}
