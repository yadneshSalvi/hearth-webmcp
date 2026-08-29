"use client";
/**
 * Toast bus — 40 lines instead of a library (STYLE.md §5 forbids stock toast styling). Structured
 * payloads only: a title, an optional detail with units, and at most one action.
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

/** Clears every toast (used when an overlay opens over them). */
export function clearToasts(): void {
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
  if (toasts.length === 0) return;
  toasts = EMPTY;
  emit();
}

function snapshot(): Toast[] {
  return toasts;
}

function serverSnapshot(): Toast[] {
  return EMPTY;
}

/** Subscribes a component to the toast queue. */
export function useToasts(): Toast[] {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
