"use client";
/**
 * The browser side of `ToolUi` (TOOLS.md §4): confirmation dialog, camera focus, item pulse, agent
 * orb and downloads. Tool handlers only ever see the four contract methods; the extras are used by
 * the chrome itself.
 */
import type { StoreApi } from "zustand";
import { createCatalog } from "../engine/catalog";
import type { Vec2 } from "../engine/types";
import type { StudioApi } from "../scene/Studio";
import type { HearthStore } from "../state/types";
import { createConfirmGate } from "../tools/confirm";
import type { ExportBoardResult, ToolFocus, ToolUi } from "../tools/define";
import { publishBoard } from "./board-bus";
import { BOARD_SIZE_PX } from "./boardCompose";
import { composeBoard } from "./boardExport";

/** How long a pulsed item stays highlighted for the renderer and the interaction layer. */
const PULSE_MS = 1_600;

export interface HearthToolUi extends ToolUi {
  /** Sends the agent orb to a room-local point with a label chip. */
  flyOrb(point: { roomId: string; pos: Vec2 }, label: string): void;
  /** Starts a browser download without leaving the page. */
  download(name: string, blob: Blob): void;
  /** Answers the open confirmation dialog. */
  resolveConfirm(id: string, answer: boolean): void;
  /** Declines every open confirmation (used when the page tears down). */
  cancelConfirms(): void;
  exportBoard(input: { roomId: string; title: string }): Promise<ExportBoardResult>;
}

function itemLabel(store: StoreApi<HearthStore>, id: string): string | undefined {
  const state = store.getState();
  const item = state.scene.furniture.find((candidate) => candidate.id === id);
  if (!item) return undefined;
  return createCatalog(state.catalog).byId(item.catalogId)?.name;
}

/** Wires the studio handle and the store into the effects tool handlers are allowed to ask for. */
export function createToolUi(studio: StudioApi, store: StoreApi<HearthStore>): HearthToolUi {
  const gate = createConfirmGate(store);
  let pulseTimer: ReturnType<typeof setTimeout> | undefined;

  const download = (name: string, blob: Blob): void => {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return {
    confirm: gate.confirm,
    resolveConfirm: gate.resolve,
    cancelConfirms: gate.cancelAll,

    focus(target: ToolFocus) {
      // Compared as a string, not against the union: `set_view` gains `focus: "home"` in the tools
      // layer right after this lands, and this branch is already waiting for it.
      const kind: string = target.kind;
      if (kind === "home") {
        studio.focus({ home: true });
        return;
      }
      studio.focus(kind === "room" ? { roomId: target.id } : { itemId: target.id });
    },

    /**
     * Highlights the ids and sends the orb to the first one, so every tool action has a visible
     * site on the canvas before the promise resolves (TOOLS.md §0).
     */
    pulse(ids: string[]) {
      store.getState().setUi({ pulseIds: [...ids] });
      if (pulseTimer) clearTimeout(pulseTimer);
      pulseTimer = setTimeout(() => store.getState().setUi({ pulseIds: [] }), PULSE_MS);
      const first = ids[0];
      if (!first) return;
      const item = store.getState().scene.furniture.find((candidate) => candidate.id === first);
      if (item) studio.flyOrb({ roomId: item.roomId, pos: item.pos }, itemLabel(store, first) ?? "Working here");
    },

    flyOrb(point, label) {
      studio.flyOrb(point, label);
    },

    download,

    /**
     * The composed design board (TOOLS.md §26): dollhouse render, plan, palette swatches and the
     * itemised list, painted at 1600 × 1000. The download starts immediately — the tool contract
     * promises it — and the same PNG opens in the preview modal for the human.
     */
    async exportBoard({ roomId, title }) {
      const { blob, model, filename } = await composeBoard(studio, store, { roomId, title });
      download(filename, blob);
      publishBoard({ url: URL.createObjectURL(blob), filename, model });
      store.getState().setUi({ boardOpen: true });
      return { items: model.itemCount, total_usd: model.totalUsd, size_px: BOARD_SIZE_PX };
    },
  };
}
