"use client";
/**
 * Who decides when the camera pulls back to the whole home.
 *
 * A template apply replaces every room in the home, so the shot the human is looking at — one
 * bedroom of the plan they just discarded — is never the right answer. One rule, in one place, for
 * every caller: the human's Layouts sheet, the Build panel's picker and the agent's `apply_template`
 * tool all write the same receipt, and that receipt is the signal.
 *
 * The receipt, rather than the room array, is what is watched: `create_room` and `update_room`
 * replace `scene.rooms` too (immer hands back a new array for any edit), and re-applying the *same*
 * template changes neither `meta.template` nor the room ids. A fresh "Apply template" entry is the
 * only thing that means "this is a different home now".
 *
 * Undo is deliberately not special-cased: undoing an apply restores the previous activity list, so
 * the top entry is no longer the apply and the camera keeps whatever shot it had. Undoing *past* a
 * second apply surfaces the first one's receipt again and does re-frame the home.
 */
import { hearthStore } from "../state/store";
import { getFocusTarget, setFocusTarget } from "./focus";

/** The activity title `applyTemplate` writes, whoever called it (src/state/store.ts). */
export const TEMPLATE_RECEIPT_TITLE = "Apply template";

/** True when this activity entry is the receipt of a template apply. */
export function isTemplateReceipt(entry: { title: string } | undefined): boolean {
  return entry?.title === TEMPLATE_RECEIPT_TITLE;
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
