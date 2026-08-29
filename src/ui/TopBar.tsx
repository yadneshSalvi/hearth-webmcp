"use client";
/**
 * The studio's top bar: wordmark, room, mode on the left; light, camera, history and export on the
 * right. Every control writes a `source: "human"` store action, so the 3D reacts exactly as it does
 * for the agent.
 *
 * The camera group is the discoverability surface for the free orbit: the two rotate buttons step
 * the view 45° at a time (they are disabled in plan view, which is north-up by definition) and the
 * re-centre button appears the moment a drag has taken the camera off the framed shot.
 */
import { useState } from "react";
import type { Mode, TimeOfDay, View } from "../engine/types";
import { resetCamera, stepView, useCameraOffHome } from "../scene/cameraState";
import { hearthStore, useHearthStore } from "../state/store";
import { timeOfDayLabel } from "./format";
import {
  HearthMark, IconBoard, IconDollhouse, IconEvening, IconGolden, IconMorning, IconNoon, IconPlan,
  IconRecenter, IconRedo, IconRoom, IconUndo, IconYawLeft, IconYawRight,
} from "./icons";
import { LayoutsSheet } from "./LayoutsSheet";
import { Button, IconButton, Segmented } from "./primitives";
import { RoomSwitcher } from "./RoomSwitcher";
import { pushToast } from "./toast-bus";
import { redoSteps, toolUi, undoSteps, useHistoryDepth } from "./useHearth";
import type { ViewportTier } from "./useViewportTier";

const MODES = [
  { value: "build" as Mode, label: "Build" },
  { value: "design" as Mode, label: "Design" },
  { value: "shop" as Mode, label: "Shop" },
] as const;

const TIMES = [
  { value: "morning" as TimeOfDay, label: "Morning", icon: IconMorning },
  { value: "noon" as TimeOfDay, label: "Noon", icon: IconNoon },
  { value: "golden" as TimeOfDay, label: "Golden", icon: IconGolden },
  { value: "evening" as TimeOfDay, label: "Evening", icon: IconEvening },
] as const;

const VIEWS = [
  { value: "plan" as View, label: "Plan", icon: IconPlan },
  { value: "dollhouse" as View, label: "Dollhouse", icon: IconDollhouse },
] as const;

/** Why the rotate buttons are greyed out in plan view. */
const PLAN_REASON = "Plan view is always north-up";

async function exportBoard(): Promise<void> {
  const state = hearthStore.getState();
  const room = state.scene.rooms.find((candidate) => candidate.id === state.scene.meta.activeRoomId);
  if (!room) return;
  try {
    const board = await toolUi.exportBoard({ roomId: room.id, title: room.name });
    // A human export is an action too, so it gets a receipt like every agent one.
    state.pushActivity({
      id: `board-${Date.now()}`,
      t: Date.now(),
      source: "human",
      title: "Export design board",
      summary: `You exported a design board for ${room.name} · ${board.items} items`,
      itemIds: [],
    });
    pushToast({
      title: "Design board saved",
      detail: `${room.name} · ${board.items} items · ${board.size_px} px`,
      tone: "success",
    });
  } catch {
    pushToast({ title: "Design board failed", detail: "The studio frame could not be captured.", tone: "warn" });
  }
}

export function TopBar({ tier }: { tier: ViewportTier }) {
  const meta = useHearthStore((state) => state.scene.meta);
  const history = useHistoryDepth();
  const offHome = useCameraOffHome();
  const [layoutsOpen, setLayoutsOpen] = useState(false);
  const compact = tier === "compact";
  const plan = meta.view === "plan";

  return (
    <header data-studio-inset="" className="glass pointer-events-auto flex h-14 shrink-0 items-center gap-3 px-3">
      <div className="flex items-center gap-2 pl-1 pr-1">
        <HearthMark size={19} className="text-terracotta" />
        {/* Below 1024 px the bar is the room, the layouts and the export: the mark carries the name. */}
        {compact ? null : (
          <span className="font-display text-[19px] leading-none tracking-[-0.01em] text-ink">Hearth</span>
        )}
      </div>

      <span className="h-6 w-px shrink-0 bg-hairline" aria-hidden="true" />

      <RoomSwitcher />

      {compact ? null : (
        <>
          <Segmented
            label="Studio mode"
            value={meta.mode}
            options={MODES}
            onChange={(mode) => { if (mode !== meta.mode) hearthStore.getState().setMode("human", mode); }}
          />
          {meta.mode === "build" ? (
            <span className="label-caps hidden text-ink-faint lg:inline">editing walls</span>
          ) : null}
        </>
      )}

      <div className="flex-1" />

      {compact ? null : (
        <>
          <div className="flex items-center gap-2">
            <Segmented
              label="Time of day"
              value={meta.timeOfDay}
              options={TIMES}
              iconOnly
              onChange={(time) => { if (time !== meta.timeOfDay) hearthStore.getState().setTimeOfDay("human", time); }}
            />
            <span className="label-caps hidden w-[4.5rem] text-ink-muted xl:inline">{timeOfDayLabel(meta.timeOfDay)}</span>
          </div>

          <span className="h-6 w-px shrink-0 bg-hairline" aria-hidden="true" />

          <div className="flex items-center gap-1.5">
            <Segmented
              label="Camera view"
              value={meta.view}
              options={VIEWS}
              iconOnly
              onChange={(view) => { if (view !== meta.view) hearthStore.getState().setView("human", { view }); }}
            />
            <IconButton
              icon={IconYawLeft}
              label="Rotate the view 45° counter-clockwise"
              size="sm"
              disabled={plan}
              title={plan ? PLAN_REASON : undefined}
              aria-description={plan ? PLAN_REASON : undefined}
              onClick={() => stepView(-1)}
            />
            <IconButton
              icon={IconYawRight}
              label="Rotate the view 45° clockwise"
              size="sm"
              disabled={plan}
              title={plan ? PLAN_REASON : undefined}
              aria-description={plan ? PLAN_REASON : undefined}
              onClick={() => stepView(1)}
            />
            {/* Reserved width so the bar never shifts as the control fades in and out. */}
            <span className="flex h-7 w-7 items-center justify-center">
              {offHome ? (
                <IconButton
                  icon={IconRecenter}
                  label="Reset the view"
                  size="sm"
                  className="fade-in"
                  onClick={() => resetCamera({ tween: true })}
                />
              ) : null}
            </span>
          </div>

          <span className="h-6 w-px shrink-0 bg-hairline" aria-hidden="true" />

          <div className="flex items-center gap-1.5">
            <IconButton icon={IconUndo} label="Undo" size="sm" disabled={history.past === 0} onClick={() => undoSteps(1)} />
            <IconButton icon={IconRedo} label="Redo" size="sm" disabled={history.future === 0} onClick={() => redoSteps(1)} />
          </div>
        </>
      )}

      {compact ? (
        <IconButton icon={IconRoom} label="Layouts" onClick={() => setLayoutsOpen(true)} />
      ) : (
        <Button icon={IconRoom} onClick={() => setLayoutsOpen(true)}>Layouts</Button>
      )}

      <IconButton icon={IconBoard} label="Export design board" onClick={() => void exportBoard()} />
      <LayoutsSheet open={layoutsOpen} onClose={() => setLayoutsOpen(false)} />
    </header>
  );
}
