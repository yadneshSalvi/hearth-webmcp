"use client";
/**
 * The last composed design board, kept outside the store: it is a blob URL and a layout model, not
 * scene state, and it must survive the modal being closed and reopened. One board at a time — the
 * previous object URL is revoked as soon as a new one is published.
 */
import { useSyncExternalStore } from "react";
import type { BoardModel } from "./boardCompose";

export interface BoardPreview {
  /** Object URL of the PNG shown in the modal and re-downloaded by its button. */
  url: string;
  filename: string;
  model: BoardModel;
  at: number;
}

let current: BoardPreview | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Publishes a freshly composed board and revokes the one it replaces. */
export function publishBoard(preview: Omit<BoardPreview, "at">): void {
  if (current) URL.revokeObjectURL(current.url);
  current = { ...preview, at: Date.now() };
  emit();
}

/** Drops the board and its object URL (page teardown). */
export function clearBoard(): void {
  if (!current) return;
  URL.revokeObjectURL(current.url);
  current = undefined;
  emit();
}

/** Subscribes a component to the last composed board. */
export function useBoardPreview(): BoardPreview | undefined {
  return useSyncExternalStore(subscribe, () => current, () => undefined);
}
