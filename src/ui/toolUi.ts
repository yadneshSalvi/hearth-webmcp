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

async function pixelSize(blob: Blob): Promise<string> {
  if (typeof createImageBitmap !== "function") return "unknown";
  try {
    const bitmap = await createImageBitmap(blob);
    const size = `${bitmap.width}x${bitmap.height}`;
    bitmap.close();
    return size;
  } catch {
    return "unknown";
  }
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
      studio.focus(target.kind === "room" ? { roomId: target.id } : { itemId: target.id });
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
     * Phase-3 design board: the live studio frame, downloaded as a PNG. Phase 5 replaces the body
     * with the composed board (render + plan + swatches + itemised list).
     */
    async exportBoard({ roomId, title }) {
      const blob = await studio.capture();
      const state = store.getState();
      const catalog = createCatalog(state.catalog);
      const items = state.scene.furniture.filter((item) => item.roomId === roomId && item.status === "placed");
      const total = items.reduce((sum, item) => sum + (catalog.byId(item.catalogId)?.price ?? 0), 0);
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || roomId;
      download(`hearth-${slug}.png`, blob);
      return { items: items.length, total_usd: Math.round(total), size_px: await pixelSize(blob) };
    },
  };
}
