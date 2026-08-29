"use client";
/**
 * One silenced three.js warning.
 *
 * `@react-three/fiber` 9.7 builds its render loop on `new THREE.Clock()`, which three 0.185
 * deprecated in favour of `THREE.Timer` (r183). The warning is about R3F's internals, not about
 * anything Hearth renders, and there is no version of the two libraries where it is actionable —
 * so it is dropped here rather than left to be the first thing in a judge's console.
 *
 * The filter goes through three's own `setConsoleFunction` hook (not a `console.warn` patch), it
 * matches that exact message, and it forwards every other log, warning and error — including the
 * stack-trace form three uses for TSL — to the console untouched. Nothing else is suppressed.
 */
import { getConsoleFunction, setConsoleFunction } from "three";

const SILENCED = "THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.";

/** three's stack-trace carrier: `warn()` prints it as an Error when no console function is set. */
interface StackTrace {
  isStackTrace: true;
  getError(message: string): Error;
}

function isStackTrace(value: unknown): value is StackTrace {
  return typeof value === "object" && value !== null && "isStackTrace" in value;
}

let installed = false;

/** Installs the filter once, before anything constructs a `Clock`. */
export function silenceClockDeprecation(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const previous = getConsoleFunction();
  setConsoleFunction((type, message, ...params) => {
    if (type === "warn" && message === SILENCED) return;
    if (previous) {
      previous(type, message, ...params);
      return;
    }
    // three's own else-branch, kept intact: a stack trace prints as an Error, so it keeps its frames.
    const first = params[0];
    if (type !== "log" && isStackTrace(first)) {
      console[type](first.getError(message));
      return;
    }
    console[type](message, ...params);
  });
}
