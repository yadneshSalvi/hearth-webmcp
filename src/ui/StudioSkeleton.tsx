/**
 * The loading state: the plan outline of the home drawn in plaster with hairline walls, under the
 * Fraunces wordmark. A skeleton of the thing that is coming — never a spinner (STYLE.md §4).
 */
import { ink, palette } from "../tokens";

/** The 2BR onboarding plan, room-local cm converted straight to SVG units. */
const ROOMS: { x: number; y: number; w: number; d: number }[] = [
  { x: 0, y: 0, w: 520, d: 440 },
  { x: 520, y: 0, w: 360, d: 440 },
  { x: 0, y: 440, w: 400, d: 360 },
  { x: 400, y: 440, w: 120, d: 360 },
  { x: 520, y: 440, w: 340, d: 320 },
  { x: 400, y: 800, w: 220, d: 200 },
];

function PanelGhost({ className }: { className: string }) {
  return <div className={`glass breathe ${className}`} aria-hidden="true" />;
}

/**
 * The plan outline of the home, in plaster with hairline walls. Shared with `StudioCurtain`, which
 * holds this same drawing over the canvas until the first frame is painted, so the loading state
 * and the hand-off are literally the same image.
 */
export function PlanOutline({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="-30 -30 940 1060" className={className} aria-hidden="true">
      {ROOMS.map((room) => (
        <rect
          key={`${room.x}-${room.y}`}
          x={room.x}
          y={room.y}
          width={room.w}
          height={room.d}
          rx={10}
          fill={palette.plaster}
          stroke={ink.hairline}
          strokeWidth={7}
        />
      ))}
    </svg>
  );
}

export function StudioSkeleton() {
  return (
    <div className="absolute inset-0 overflow-hidden" data-studio="skeleton">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-5">
        {/* The wordmark is display-scale here, not chrome-scale: this is the only thing on the page
            for a moment, and it is what the browser measures as Largest Contentful Paint. It is
            server-rendered, so the largest thing anyone sees is on screen at first paint rather than
            after the studio chunk has hydrated. */}
        <div className="flex flex-col items-center gap-2">
          <p className="font-display text-[44px] leading-none tracking-[-0.015em] text-ink">Hearth</p>
          <p className="font-display text-[14px] italic text-ink-muted">Warming the studio…</p>
        </div>
        <PlanOutline className="breathe h-[46vh] max-h-[420px] w-auto" />
      </div>

      {/* Ghosts sit exactly where the real chrome lands, so nothing shifts when it arrives. */}
      <PanelGhost className="absolute top-5 right-5 left-5 h-14" />
      <PanelGhost className="absolute top-[88px] bottom-[88px] left-5 hidden w-[328px] lg:block" />
      <PanelGhost className="absolute top-[88px] right-5 bottom-[88px] hidden w-[344px] lg:block" />
      <PanelGhost className="absolute bottom-5 left-5 h-14 right-5 lg:right-[212px]" />
      <PanelGhost className="absolute bottom-[30px] right-5 hidden h-9 w-[180px] rounded-pill lg:block" />
    </div>
  );
}

export default StudioSkeleton;
