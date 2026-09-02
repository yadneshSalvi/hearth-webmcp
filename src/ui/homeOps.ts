"use client";
/**
 * Human-side clearing and restoring (TOOLS.md §23, §38, §39), through the same confirmation gate the
 * agent's tools use — attributed to the human — with a toast that offers Undo *and* keeps the
 * cleared layout in `ui.lastCleared` so "Restore furniture" works long after the toast is gone.
 */
import { hearthStore } from "../state/store";
import { HearthError } from "../state/types";
import { plural } from "./format";
import { historyMarker, toolUi, undoTo } from "./useHearth";
import { pushToast } from "./toast-bus";

/** Empties every room after the human confirms. Resolves true when something was cleared. */
export async function clearHome(): Promise<boolean> {
  const state = hearthStore.getState();
  const count = state.scene.furniture.filter((item) => item.status !== "ghost").length;
  if (count === 0) {
    pushToast({ title: "The home is already empty", tone: "info" });
    return false;
  }
  const decision = await toolUi.confirmHuman(`Clear the whole home and remove ${plural(count, "item")}?`);
  if (!decision.accepted) return false;
  const marker = historyMarker();
  const ids = hearthStore.getState().clearHome("human");
  pushToast({
    title: `Cleared the whole home · ${plural(ids.length, "item")}`,
    detail: "Restore furniture brings it all back.",
    tone: "info",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
  return true;
}

/** Empties one room after the human confirms. */
export async function clearRoom(roomId: string): Promise<boolean> {
  const state = hearthStore.getState();
  const room = state.scene.rooms.find((candidate) => candidate.id === roomId);
  if (!room) return false;
  const count = state.scene.furniture.filter((item) => item.roomId === roomId && item.status !== "ghost").length;
  if (count === 0) {
    pushToast({ title: `${room.name} is already empty`, tone: "info" });
    return false;
  }
  const decision = await toolUi.confirmHuman(`Clear ${room.name} and remove ${plural(count, "item")}?`);
  if (!decision.accepted) return false;
  const marker = historyMarker();
  hearthStore.getState().clearRoom("human", roomId);
  pushToast({
    title: `Cleared ${room.name} · ${plural(count, "item")}`,
    detail: "Restore furniture brings it back.",
    tone: "info",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
  return true;
}

/** Puts the last cleared layout back. */
export function restoreFurniture(): boolean {
  const marker = historyMarker();
  try {
    const report = hearthStore.getState().restoreFurniture("human");
    pushToast({
      title: `Restored ${plural(report.restored.length, "item")}`,
      ...(report.skipped.length > 0 ? { detail: `${plural(report.skipped.length, "item")} had no room to go back to.` } : {}),
      tone: "success",
      action: { label: "Undo", run: () => undoTo(marker) },
    });
    return true;
  } catch (error) {
    pushToast({ title: "Nothing to restore", detail: error instanceof HearthError ? error.detail : undefined, tone: "info" });
    return false;
  }
}
