"use client";
/**
 * The chrome's import path into the studio's single toast queue. The queue itself lives in
 * `src/state/toasts.ts` because the canvas pushes to it too (`store.toast()`), and `src/scene`
 * must not import chrome. Nothing else is re-exported here — there is one queue, one renderer
 * (src/ui/Toasts.tsx) and one push function.
 */
export { clearToasts, dismissToast, pushToast, toastSnapshot, useToasts } from "../state/toasts";
export type { Toast, ToastAction, ToastTone } from "../state/toasts";
