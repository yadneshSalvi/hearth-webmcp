"use client";
/**
 * First run, remembered. Whether the welcome card has ever been dismissed on this browser lives in
 * localStorage; when it should appear is a question about the opening choreography, so it waits for
 * `src/scene/intro.ts` to finish settling the studio (STYLE.md §3, §4).
 */
import { useCallback, useState } from "react";
import { useIntroView } from "../scene/intro";

export const ONBOARDING_KEY = "hearth.onboarding.v1";

/** Whether the welcome card was dismissed on this browser. */
export function readOnboardingDismissed(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "dismissed";
  } catch {
    return false;
  }
}

/** Remembers the dismissal. A blocked localStorage only costs the memory of it. */
export function writeOnboardingDismissed(): void {
  try {
    window.localStorage.setItem(ONBOARDING_KEY, "dismissed");
  } catch {
    // Private-mode storage refuses writes; the card simply returns next load.
  }
}

export interface FirstRun {
  /** True until the human dismisses the welcome card (remembered across loads). */
  firstRun: boolean;
  dismiss(): void;
}

export function useFirstRun(): FirstRun {
  const [dismissed, setDismissed] = useState(readOnboardingDismissed);
  const dismiss = useCallback(() => {
    setDismissed(true);
    writeOnboardingDismissed();
  }, []);
  return { firstRun: !dismissed, dismiss };
}

/** True once the opening settle is over, so the welcome card lands on a studio that has stopped. */
export function useOnboardingReveal(): boolean {
  return !useIntroView().active;
}
