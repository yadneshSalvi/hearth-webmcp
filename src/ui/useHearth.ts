"use client";
/**
 * The studio's single wiring point: it starts the WebMCP registry, keeps the conflict overlays in
 * sync with the scene, owns the keyboard map and remembers whether this is a first run.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useStore } from "zustand";
import { createCatalog } from "../engine/catalog";
import { evaluateRoom } from "../engine/conflicts";
import type { Conflict, TimeOfDay, Yaw } from "../engine/types";
import { studioApi } from "../scene/Studio";
import { createLocalShopify } from "../shopify/local";
import { createSelectedShopify } from "../shopify/select";
import type { ShopifyMode } from "../shopify/select";
import { hearthStore, useHearthStore } from "../state/store";
import { clearToasts, toastSnapshot } from "../state/toasts";
import type { ActivityEntry, ToolGroup } from "../state/types";
import { useWebMCP } from "../tools/useWebMCP";
import type { WebMCPStatus } from "../tools/useWebMCP";
import { createCartOps } from "./cartOps";
import type { CartOps } from "./cartOps";
import { createToolUi } from "./toolUi";
import type { HearthToolUi } from "./toolUi";

const ONBOARDING_KEY = "hearth.onboarding.v1";
const TIMES: readonly TimeOfDay[] = ["morning", "noon", "golden", "evening"];
const YAWS: readonly Yaw[] = ["nw", "ne", "se", "sw"];
const EMPTY_CONFLICTS: Conflict[] = [];

/**
 * Page-lifetime singletons. The registry, the confirmation gate and the cart client must outlive
 * any component remount, and this module only ever loads in the browser (AppShell is imported with
 * `ssr: false`).
 *
 * One client, chosen at startup: the agent's tools and the human's cart panel are the same cart
 * (SHOPIFY.md §7), so the registry below is handed this exact instance.
 */
const shopify = createSelectedShopify({ local: createLocalShopify(hearthStore.getState().catalog) });
export const toolUi: HearthToolUi = createToolUi(studioApi, hearthStore);
export const cartOps: CartOps = createCartOps(shopify, hearthStore);

/** Which Shopify the studio is talking to, so the cart panel can say so honestly. */
export function useShopifyMode(): ShopifyMode {
  return useSyncExternalStore(shopify.subscribe, () => shopify.mode, () => "checking" as ShopifyMode);
}

export interface Hearth {
  status: WebMCPStatus;
  /** tool name → group, from the live registry (TOOLS.md §2). Empty when WebMCP is unavailable. */
  toolGroups: Record<string, ToolGroup>;
  /** Names annotated `readOnlyHint` — a receipt from one of these changed nothing, so it offers no undo. */
  readOnlyTools: ReadonlySet<string>;
  firstRun: boolean;
  dismissFirstRun(): void;
}

let receiptSeeded = false;

/**
 * The activity log is a record of what happened to this page, and the first thing that happened is
 * the home being opened. One truthful system row, written once per page load.
 */
function seedOpeningReceipt(): void {
  if (receiptSeeded) return;
  receiptSeeded = true;
  const state = hearthStore.getState();
  if (state.activity.length > 0) return;
  const rooms = state.scene.rooms.length;
  const items = state.scene.furniture.filter((item) => item.status === "placed").length;
  const template = state.scene.meta.template ?? "2br";
  state.pushActivity({
    id: `studio-${Date.now()}`,
    t: Date.now(),
    source: "system",
    title: "Studio ready",
    summary: `Studio opened the furnished ${template.toUpperCase()} home · ${rooms} rooms · ${items} items`,
    itemIds: [],
  });
}

/** Whether the welcome card was dismissed on this browser. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(ONBOARDING_KEY) === "dismissed";
  } catch {
    return false;
  }
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function step<T>(list: readonly T[], value: T, delta: number): T {
  const index = list.indexOf(value);
  return list[(index + delta + list.length) % list.length] as T;
}

/** Closes every dismissible overlay; the confirmation dialog handles Escape itself (it declines). */
function closeOverlays(): boolean {
  const { ui, setUi } = hearthStore.getState();
  if (!ui.toolsPanelOpen && !ui.shortcutsOpen && !ui.enableSheetOpen && !ui.boardOpen) return false;
  setUi({ toolsPanelOpen: false, shortcutsOpen: false, enableSheetOpen: false, boardOpen: false });
  return true;
}

/**
 * True while a modal owns the page, so a single-key shortcut cannot stack a second sheet at the
 * same z-index. The DOM is the honest test: every sheet is an `aria-modal` dialog, whoever opened it.
 */
function sheetIsOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Publishes the active room's conflicts so the renderer draws diagrams and the panels agree. */
export function useConflictSync(): void {
  const scene = useHearthStore((state) => state.scene);
  const catalogItems = useHearthStore((state) => state.catalog);
  const conflicts = useMemo(
    () => evaluateRoom(scene, scene.meta.activeRoomId, createCatalog(catalogItems)),
    [scene, catalogItems],
  );
  useEffect(() => {
    hearthStore.getState().setOverlays({ conflicts });
  }, [conflicts]);
}

/** The conflicts published for the active room. */
export function useConflicts(): Conflict[] {
  return useHearthStore((state) => state.overlays?.conflicts ?? EMPTY_CONFLICTS);
}

/** Undo/redo depth from zundo, for the top bar's disabled states. */
export function useHistoryDepth(): { past: number; future: number } {
  const past = useStore(hearthStore.temporal, (state) => state.pastStates.length);
  const future = useStore(hearthStore.temporal, (state) => state.futureStates.length);
  return { past, future };
}

let historyReceipts = 0;

/** Writes the human-side receipt for an undo or redo, naming what actually changed. */
function historyReceipt(kind: "Undo" | "Redo", entries: ActivityEntry[]): void {
  if (entries.length === 0) return;
  historyReceipts += 1;
  const what = (entries[0]?.summary ?? "a change").replace(/^(You|Agent|Assistant|System) /, "");
  hearthStore.getState().pushActivity({
    id: `history-${Date.now()}-${historyReceipts}`,
    t: Date.now(),
    source: "human",
    title: kind,
    summary: entries.length === 1
      ? `You ${kind === "Undo" ? "undid" : "redid"}: ${what}`
      : `You ${kind === "Undo" ? "undid" : "redid"} ${entries.length} changes`,
    itemIds: entries.flatMap((entry) => entry.itemIds),
  });
}

/** Undoes n steps, but never calls into zundo with an empty history. */
export function undoSteps(steps = 1): void {
  if (hearthStore.temporal.getState().pastStates.length === 0) return;
  historyReceipt("Undo", hearthStore.getState().undo(steps));
}

/** A snapshot of the undo depth, so a toast can undo exactly the steps one interaction produced. */
export function historyMarker(): number {
  return hearthStore.temporal.getState().pastStates.length;
}

/** Undoes back to a marker taken before an interaction (selection changes included). */
export function undoTo(marker: number): void {
  const steps = hearthStore.temporal.getState().pastStates.length - marker;
  if (steps > 0) historyReceipt("Undo", hearthStore.getState().undo(steps));
}

/** Redoes n steps, but never calls into zundo with an empty future. */
export function redoSteps(steps = 1): void {
  if (hearthStore.temporal.getState().futureStates.length === 0) return;
  historyReceipt("Redo", hearthStore.getState().redo(steps));
}

export function useHearth(): Hearth {
  const { status, registry } = useWebMCP({ ui: toolUi, shopify, mode: "native-only" });
  const [dismissed, setDismissed] = useState(readDismissed);

  const toolGroups = useMemo(() => {
    const map: Record<string, ToolGroup> = {};
    for (const tool of registry?.list() ?? []) map[tool.name] = tool.group;
    return map;
  }, [registry]);

  const readOnlyTools = useMemo(() => {
    const names = new Set<string>();
    for (const tool of registry?.list() ?? []) if (tool.annotations?.readOnlyHint) names.add(tool.name);
    return names;
  }, [registry]);

  // Honest status: when no registry starts there is nothing registered, and the chip must say so.
  useEffect(() => {
    if (status === "unavailable") hearthStore.getState().setToolsMirror([], "unavailable");
  }, [status]);

  useEffect(() => {
    void cartOps.refresh();
    seedOpeningReceipt();
  }, []);

  // Dev-only handle so the screenshot harness can read and drive chrome state (see DebugBridge).
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    const target = window as unknown as { __hearthStore?: unknown };
    target.__hearthStore = hearthStore;
    return () => {
      delete target.__hearthStore;
    };
  }, []);

  const dismissFirstRun = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(ONBOARDING_KEY, "dismissed");
    } catch {
      // A blocked localStorage only costs the memory of the dismissal.
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      // Auto-repeat from a held key would cycle the time of day or the view dozens of times a
      // second and fill the receipt log; one press is one change.
      if (event.repeat) return;
      const store = hearthStore.getState();
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "k") {
        event.preventDefault();
        document.querySelector<HTMLElement>("[data-prompt-chip]")?.focus();
        return;
      }
      if (isTypingTarget(event.target)) return;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redoSteps(1);
        else undoSteps(1);
        return;
      }
      if (command || event.altKey) return;
      const { view, yaw, timeOfDay } = store.scene.meta;
      switch (event.key) {
        case "1":
          if (view !== "plan") store.setView("human", { view: "plan" });
          break;
        case "2":
          if (view !== "dollhouse") store.setView("human", { view: "dollhouse" });
          break;
        case "[":
          store.setView("human", { yaw: step(YAWS, yaw, -1) });
          break;
        case "]":
          store.setView("human", { yaw: step(YAWS, yaw, 1) });
          break;
        case "t":
        case "T":
          store.setTimeOfDay("human", step(TIMES, timeOfDay, 1));
          break;
        case "?":
          // Two sheets at z-[60] is a stack with no reading order; the open one wins.
          if (!sheetIsOpen()) store.setUi({ shortcutsOpen: true });
          break;
        case "Escape":
          // Escape unwinds the page one layer at a time: overlays first, then any toasts.
          if (!closeOverlays() && toastSnapshot().length > 0) clearToasts();
          break;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { status, toolGroups, readOnlyTools, firstRun: !dismissed, dismissFirstRun };
}
