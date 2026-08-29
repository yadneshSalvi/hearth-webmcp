"use client";
/**
 * Making sure the fallback assistant has tools to call.
 *
 * The studio registers on `document.modelContext` only when the browser already has WebMCP
 * (`useHearth` starts the registry `native-only`, so the status chip stays honest about a flagless
 * browser). Opening the Assistant is the explicit request for the polyfill instead: this loads it
 * and, when no registry claimed the page, starts one over it — so the panel executes the same 26
 * tools, through the same path, with the same orb, pulse and receipts (TOOLS.md §4).
 *
 * The registry it owns is published so the chrome can keep reading tool groups and `readOnlyHint`
 * from the live definitions rather than guessing.
 */
import { useSyncExternalStore } from "react";
import type { ShopifyClient } from "../shopify/types";
import { hearthStore } from "../state/store";
import type { ToolUi } from "../tools/define";
import { ensureModelContext } from "../tools/polyfill-loader";
import { createRegistry } from "../tools/registry";
import type { Registry } from "../tools/registry";

export type ToolsKind = "native" | "polyfill" | "unavailable";

let owned: Registry | undefined;
let pending: Promise<ToolsKind> | undefined;
const listeners = new Set<() => void>();

/** True when the studio's own registry never started, so nothing is registered on this page. */
function unclaimed(): boolean {
  const { status, available } = hearthStore.getState().tools;
  return available.length === 0 && (status === "unavailable" || status === "unknown");
}

/**
 * Resolves once `document.modelContext` exists and Hearth's tools are registered on it. Safe to
 * call repeatedly: the polyfill loads once and at most one registry is ever owned here.
 */
export function ensureAssistantTools(deps: { ui: ToolUi; shopify: ShopifyClient }): Promise<ToolsKind> {
  if (pending) return pending;
  pending = ensureModelContext().then((kind): ToolsKind => {
    const modelContext = document.modelContext;
    if (kind === "unavailable" || !modelContext) return "unavailable";
    if (!owned && unclaimed()) {
      owned = createRegistry({ modelContext, store: hearthStore, ui: deps.ui, shopify: deps.shopify });
      owned.start();
      for (const listener of listeners) listener();
    }
    return kind;
  }).catch((): ToolsKind => "unavailable");
  return pending;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): Registry | undefined {
  return owned;
}

/** The registry this module started for the fallback assistant, if it had to start one. */
export function useAssistantRegistry(): Registry | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined);
}
