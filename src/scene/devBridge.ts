"use client";
/**
 * Who may read `window.__hearth*`.
 *
 * The studio hangs five handles on `window` for the screenshot harness and Playwright —
 * `__hearth` (src/scene/interactionCommands.tsx), `__hearthStore` (src/ui/useHearth.ts) and
 * `__hearthStudio` / `__hearthPinQuality` / `__hearthPaint` (src/scene/Studio.tsx). They were gated
 * on `NODE_ENV !== "production"`, which meant the end-to-end suite could only ever run against
 * `next dev`: pointed at `pnpm build && pnpm start` nine specs failed on a handle that was not
 * there, so the bundle a judge actually visits was the one bundle never tested.
 *
 * So: on in development, and in a production build when the build opts in with
 * `NEXT_PUBLIC_HEARTH_E2E=1` or the page is opened with `?e2e=1`. Both are explicit — a plain visit
 * to https://hearth.yadneshsalvi.com exposes nothing.
 */

/** The query switch, read once at boot: a later `history.pushState` cannot revoke it mid-suite. */
const requestedAtBoot = typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("e2e") === "1";

/** True while the dev bridges may be installed. */
export function devBridgesEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  if (process.env.NEXT_PUBLIC_HEARTH_E2E === "1") return true;
  return requestedAtBoot;
}
