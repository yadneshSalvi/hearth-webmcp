"use client";
/**
 * Who decides when the camera pulls back to the whole home.
 *
 * A template apply replaces every room in the home, so the shot the human is looking at — one
 * bedroom of the plan they just discarded — is never the right answer. One rule, in one place, for
 * every caller: the human's Layouts sheet, the Build panel's picker, the agent's `apply_template`
 * tool and an undo of any of them. The apply's *receipt* is the signal.
 *
 * The receipt, rather than the room array, is what is watched: `create_room` and `update_room`
 * replace `scene.rooms` too (immer hands back a new array for any edit), and re-applying the *same*
 * template changes neither `meta.template` nor the room ids. A fresh apply receipt is the only thing
 * that means "this is a different home now".
 *
 * There are two shapes of that receipt, and both have to count. A human's apply writes the store's
 * own "Apply template" entry; an agent's or the assistant's is *suppressed* on purpose — `prepend`
 * in src/state/store.ts drops a non-human store entry while a tool batch is open, so one tool call
 * leaves one row — and what lands instead is the tool's receipt, titled "Apply floor-plan template"
 * and tagged `tool: "apply_template"`. Watching the title alone meant the agent's apply, the primary
 * way this studio is driven, never pulled the camera back at all.
 *
 * Undo and redo are the same rule read backwards: undoing an apply *also* replaces every room in
 * the home, so it is an apply too and the camera pulls back to the whole home again. The store's
 * `undo`/`redo` hand back the receipts they moved, so the chrome tells this module (`frameHomeForHistory`)
 * rather than this module guessing from the restored activity list.
 */
import { hearthStore } from "../state/store";
import { getFocusTarget, setFocusTarget } from "./focus";

/** The activity title the store's own `applyTemplate` writes (src/state/store.ts). */
export const TEMPLATE_RECEIPT_TITLE = "Apply template";
/** The tool whose receipt lands instead when an agent or the assistant applies one (TOOLS.md §31). */
export const TEMPLATE_TOOL_NAME = "apply_template";

/** The store's own `applyImportedPlan` title and the tool that lands instead (TOOLS.md §40). */
export const IMPORT_RECEIPT_TITLE = "Import floor plan";
export const IMPORT_TOOL_NAME = "import_floor_plan";

/** True when this activity entry is the receipt of a template apply or a plan import, from either writer. */
export function isTemplateReceipt(entry: { title: string; tool?: string } | undefined): boolean {
  if (!entry) return false;
  return entry.tool === TEMPLATE_TOOL_NAME || entry.title === TEMPLATE_RECEIPT_TITLE
    || entry.tool === IMPORT_TOOL_NAME || entry.title === IMPORT_RECEIPT_TITLE;
}

/**
 * Frames the whole home when an undo or a redo moved a template apply. Called by the chrome with the
 * receipts the store handed back (src/ui/useHearth.ts) — undoing the plan you just chose puts the
 * previous home on screen, and being left inside one of its bedrooms is the same bug as before.
 */
export function frameHomeForHistory(entries: readonly { title: string; tool?: string }[]): boolean {
  if (!entries.some((entry) => isTemplateReceipt(entry))) return false;
  setFocusTarget({ home: true });
  return true;
}

/**
 * A human picked a room on the canvas. Every framing override lets go — the whole-home shot a
 * template apply leaves on, a room or item another command pinned — and the rig goes back to
 * framing the active room, which the caller sets next.
 *
 * The case this exists for is the one the subscription below cannot see. After an apply the home is
 * framed *and* `activeRoomId` is already the front room, so clicking that room's own floor changed
 * no id, released nothing, and did nothing at all — while clicking any other room worked. The room
 * switcher has always cleared the override before activating; the floor now does too.
 */
export function releaseFocusForRoomPick(): void {
  if (getFocusTarget()) setFocusTarget(undefined);
}

/**
 * Subscribes to the store: frames the whole home on a template apply, and lets go of that shot as
 * soon as the human activates a room (the switcher, a click on a floor, an agent's `set_view`).
 */
export function watchHomeFraming(): () => void {
  let seen = hearthStore.getState().activity[0]?.id;
  return hearthStore.subscribe((state, previous) => {
    const entry = state.activity[0];
    const applied = entry !== undefined && entry.id !== seen && isTemplateReceipt(entry);
    seen = entry?.id;
    if (applied) {
      setFocusTarget({ home: true });
      return;
    }
    if (getFocusTarget()?.home && state.scene.meta.activeRoomId !== previous.scene.meta.activeRoomId) {
      setFocusTarget(undefined);
    }
  });
}
