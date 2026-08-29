"use client";
/**
 * The studio's one toast queue — 90 lines instead of a library (STYLE.md §5 forbids stock toast
 * styling). Structured payloads only: a title, an optional detail with units, and at most one action.
 *
 * It lives in `src/state` rather than `src/ui` because the canvas pushes to it too (a refused drag,
 * a locked item, a removal) and `src/scene` must not import chrome. `src/ui/toast-bus.ts` is the
 * chrome's import path into this module; there is no second queue.
 */
import { useSyncExternalStore } from "react";

export type ToastTone = "info" | "warn" | "success";

export interface ToastAction {
  label: string;
  run(): void;
}

export interface Toast {
  id: string;
  title: string;
  detail?: string;
  action?: ToastAction;
  tone: ToastTone;
}

const AUTO_DISMISS_MS = 5_000;
const MAX_VISIBLE = 3;
const EMPTY: Toast[] = [];

let toasts: Toast[] = EMPTY;
let sequence = 0;
const listeners = new Set<() => void>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Removes a toast immediately; safe to call twice. */
export function dismissToast(id: string): void {
  const timer = timers.get(id);
  if (timer) {
    clearTimeout(timer);
    timers.delete(id);
  }
  if (!toasts.some((toast) => toast.id === id)) return;
  toasts = toasts.filter((toast) => toast.id !== id);
  emit();
}

/** Queues a toast and returns its id. Auto-dismisses after 5 s. */
export function pushToast(input: { title: string; detail?: string; action?: ToastAction; tone?: ToastTone }): string {
  sequence += 1;
  const id = `toast-${sequence}`;
  const toast: Toast = {
    id,
    title: input.title,
    tone: input.tone ?? "info",
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.action ? { action: input.action } : {}),
  };
  toasts = [...toasts, toast].slice(-MAX_VISIBLE);
  timers.set(id, setTimeout(() => dismissToast(id), AUTO_DISMISS_MS));
  emit();
  return id;
}

/** Clears every toast (an overlay opened over them, or Escape). */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length === 0) return;
  toasts = EMPTY;
  emit();
}

/** The queue as it stands, for non-React readers (the dev bridge, tests). */
export function toastSnapshot(): Toast[] {
  return toasts;
}

function serverSnapshot(): Toast[] {
  return EMPTY;
}

/** Subscribes a component to the toast queue. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, toastSnapshot, serverSnapshot);
}
