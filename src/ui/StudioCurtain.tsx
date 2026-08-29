"use client";
/**
 * The hand-off. The loading skeleton is replaced by the real studio the instant the chunk lands,
 * which is one or two frames before the canvas has drawn anything — so the same plan outline stays
 * on over the same background gradient, and cross-fades out on the first painted frame. Nothing
 * flashes, because both images are plaster with the same plan in the middle of them.
 *
 * Only the canvas is covered: the floating panels underneath are already the real ones, and a
 * second set of blurred glass surfaces over them would cost the startup frames it is here to hide.
 */
import { useIntroView } from "../scene/intro";
import { PlanOutline } from "./StudioSkeleton";

const BACKDROP = "linear-gradient(180deg, var(--studio-bg-top) 0%, var(--studio-bg-bottom) 100%)";

export function StudioCurtain() {
  const { curtain } = useIntroView();
  if (curtain === "gone") return null;
  return (
    <div
      aria-hidden="true"
      data-studio="curtain"
      className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center transition-opacity duration-[320ms] ease-out-soft"
      style={{ background: BACKDROP, opacity: curtain === "solid" ? 1 : 0 }}
    >
      <PlanOutline className="h-[46vh] max-h-[420px] w-auto" />
    </div>
  );
}
