import type { StoreApi } from "zustand";
import type { HearthStore } from "../state/types";

export type ConfirmReason = "accepted" | "declined" | "timeout" | "cancelled";
export interface ConfirmResult { accepted: boolean; reason: ConfirmReason }
export type ConfirmFunction = (message: string) => Promise<ConfirmResult>;

/** Bridges tool confirmation promises to the future in-page confirmation modal. */
export function createConfirmGate(
  store: StoreApi<HearthStore>,
  opts: { timeoutMs?: number } = {},
): { confirm: ConfirmFunction; resolve(id: string, answer: boolean): void; cancelAll(): void } {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  let sequence = 0;
  const pending = new Map<string, {
    finish(accepted: boolean, reason: ConfirmReason): void;
    timer: ReturnType<typeof setTimeout>;
  }>();

  const clearUi = (id: string): void => {
    if (store.getState().ui.pendingConfirm?.id === id) store.getState().setUi({ pendingConfirm: undefined });
  };

  const confirm: ConfirmFunction = (message) => new Promise<ConfirmResult>((resolve) => {
    sequence += 1;
    const id = `confirm-${sequence}`;
    const finish = (accepted: boolean, reason: ConfirmReason): void => {
      const entry = pending.get(id);
      if (!entry) return;
      clearTimeout(entry.timer);
      pending.delete(id);
      clearUi(id);
      resolve({ accepted, reason });
    };
    const timer = setTimeout(() => finish(false, "timeout"), timeoutMs);
    pending.set(id, { finish, timer });
    store.getState().setUi({ pendingConfirm: { id, message } });
  });

  return {
    confirm,
    resolve(id, answer) {
      pending.get(id)?.finish(answer, answer ? "accepted" : "declined");
    },
    cancelAll() {
      for (const entry of [...pending.values()]) entry.finish(false, "cancelled");
    },
  };
}
