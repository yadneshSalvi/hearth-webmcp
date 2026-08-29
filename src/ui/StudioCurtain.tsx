"use client";
/**
 * The hand-off. The loading skeleton is replaced by the real studio the instant the chunk lands,
 * which is one or two frames before the canvas has drawn anything — so the same plan outline stays
 * on over the same background gradient until the first frame paints. Nothing flashes, because both
 * images are plaster with the same plan in the middle of them.
 *
 * It is deliberately the cheapest thing that does the job: the plan drawing alone, under the
 * transparent canvas, removed in one step. The plaster behind it is the page's own gradient, and a
 * full-viewport layer — or worse, an opacity transition on one — costs the studio whole frames on a
 * software renderer, which are the frames `studioApi.capture()` waits for (Compare photographs two,
 * the design board one). Both states are plaster with the same plan in the middle, so the cut reads
 * as the room arriving rather than as a change of screen.
 */
import { useIntroView } from "../scene/intro";
import { PlanOutline } from "./StudioSkeleton";

export function StudioCurtain() {
  const { curtain } = useIntroView();
  if (curtain === "gone") return null;
  return (
    <div
      aria-hidden="true"
      data-studio="curtain"
      className="pointer-events-none absolute inset-0 flex items-center justify-center"
    >
      <PlanOutline className="h-[46vh] max-h-[420px] w-auto" />
    </div>
  );
}
