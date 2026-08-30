"use client";
/**
 * Build-mode store calls, with the same manners the tools have: every change is one `source:"human"`
 * action, a coded store error becomes a warm toast instead of an exception, and anything destructive
 * asks first through the shared confirmation gate the agent uses (TOOLS.md §31).
 */
import { roomSize } from "../engine/geometry";
import type { Opening, Room, RoomType, TemplateId } from "../engine/types";
import { hearthStore } from "../state/store";
import { HearthError } from "../state/types";
import type { OpeningInput, OpeningPatch, RoomPatch, RoomPlacement } from "../state/types";
import { templateConfirmMessage } from "./templates";
import { historyMarker, toolUi, undoTo } from "./useHearth";
import { pushToast } from "./toast-bus";

function detailOf(error: unknown): string {
  if (error instanceof HearthError) return error.detail;
  return error instanceof Error ? error.message : "The studio refused that change.";
}

/** Runs a store action, turning a coded refusal into a toast and reporting whether it went through. */
function attempt(title: string, run: () => void): boolean {
  try {
    run();
    return true;
  } catch (error) {
    pushToast({ title, detail: detailOf(error), tone: "warn" });
    return false;
  }
}

/** Replaces the home, asking first when there is furniture to lose — the tool's own question. */
export async function applyTemplate(template: TemplateId, furnished: boolean): Promise<void> {
  const placed = hearthStore.getState().scene.furniture.filter((item) => item.status === "placed").length;
  if (placed > 0) {
    // The human's own question, attributed to the human: the shared gate would otherwise say the
    // agent asked for this (src/ui/ConfirmModal.tsx).
    const decision = await toolUi.confirmHuman(templateConfirmMessage(template));
    if (!decision.accepted) return;
  }
  const marker = historyMarker();
  hearthStore.getState().applyTemplate("human", template, furnished);
  const scene = hearthStore.getState().scene;
  pushToast({
    title: `${template.toUpperCase()} template applied`,
    detail: `${scene.rooms.length} rooms · ${scene.openings.length} openings${furnished ? ` · ${scene.furniture.length} items` : ""}`,
    tone: "success",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
}

/** Patches a room; openings that no longer fit refuse the resize, items left outside warn. */
export function updateRoom(room: Room, patch: RoomPatch): boolean {
  const marker = historyMarker();
  let outside: string[] = [];
  const ok = attempt(`${room.name} cannot change that way`, () => {
    outside = hearthStore.getState().updateRoom("human", room.id, patch);
  });
  if (!ok) return false;
  const updated = hearthStore.getState().scene.rooms.find((candidate) => candidate.id === room.id);
  if (outside.length > 0) {
    pushToast({
      title: `${outside.length === 1 ? "1 item is" : `${outside.length} items are`} outside ${updated?.name ?? room.name}`,
      detail: "Move them back inside, or undo the resize.",
      tone: "warn",
      action: { label: "Undo", run: () => undoTo(marker) },
    });
  }
  return true;
}

export interface NewRoom {
  name: string;
  type: RoomType;
  width: number;
  depth: number;
  place: RoomPlacement;
  relativeTo: string;
}

/** Adds a room beside an existing one and makes it active, so the next edit lands where you look. */
export function createRoom(input: NewRoom): boolean {
  const marker = historyMarker();
  let created: Room | undefined;
  const ok = attempt("That room could not be added", () => {
    created = hearthStore.getState().createRoom("human", {
      name: input.name.trim(),
      type: input.type,
      width_cm: input.width,
      depth_cm: input.depth,
      place: input.place,
      relative_to: input.relativeTo,
    });
  });
  if (!ok || !created) return false;
  hearthStore.getState().setActiveRoom("human", created.id);
  pushToast({
    title: `${created.name} added`,
    detail: `${roomSize(created)} cm · add a door so it connects`,
    tone: "success",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
  return true;
}

/** Adds a door, window or arch to a wall. */
export function addOpening(input: OpeningInput, roomName: string): boolean {
  const marker = historyMarker();
  let added: Opening | undefined;
  const ok = attempt(`That ${input.kind} does not fit`, () => {
    added = hearthStore.getState().addOpening("human", input);
  });
  if (!ok || !added) return false;
  pushToast({
    title: `${input.kind[0]?.toUpperCase()}${input.kind.slice(1)} added to ${roomName}`,
    detail: `${added.width} cm wide · ${added.offset} cm from the wall start`,
    tone: "success",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
  return true;
}

/** Moves or resizes an opening in place; a refusal leaves the opening untouched. */
export function moveOpening(id: string, patch: OpeningPatch): boolean {
  return attempt(`${id} cannot go there`, () => hearthStore.getState().moveOpening("human", id, patch));
}

/** Removes an opening, with an undo in the toast. */
export function removeOpening(opening: Opening): void {
  const marker = historyMarker();
  if (!attempt(`${opening.id} could not be removed`, () => hearthStore.getState().removeOpening("human", opening.id))) return;
  pushToast({
    title: `${opening.id} removed`,
    tone: "info",
    action: { label: "Undo", run: () => undoTo(marker) },
  });
}
