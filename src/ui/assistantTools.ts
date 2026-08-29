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
 * from the live definitions rather than guessing — and `executeAssistantTool` runs the loop's calls
 * through whichever registry this page has, tagged `assistant`, so the receipts carry the plum
 * Assistant tint instead of being filed as an agent's work.
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
/** The studio's own registry, published by `useHearth` when WebMCP was there at mount. */
let studio: Registry | undefined;
let pending: Promise<ToolsKind> | undefined;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

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
      emit();
    }
    return kind;
  }).catch((): ToolsKind => "unavailable");
  return pending;
}

/** `useHearth` hands over the registry it started, so the assistant can reuse it. */
export function publishStudioRegistry(next: Registry | undefined): void {
  if (studio === next) return;
  studio = next;
  emit();
}

/** Whichever of Hearth's registries is live on this page. */
function liveRegistry(): Registry | undefined {
  return owned ?? studio;
}

/** Chrome's `executeTool` takes JSON in and answers with JSON; the polyfill accepts the same. */
interface ExecutableModelContext {
  getTools(): Promise<{ name: string }[]>;
  executeTool(tool: unknown, input: string): Promise<unknown>;
}

function parse(raw: unknown): unknown {
  if (typeof raw !== "string") return raw;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/**
 * Runs one tool for the fallback assistant. Where one of Hearth's registries is on the page the call
 * goes straight through it with `source: "assistant"` — same handler, same confirmation gate, same
 * orb and receipt, but filed as the assistant's work. Otherwise (a page whose tools were registered
 * by something else) it falls back to WebMCP itself.
 */
export async function executeAssistantTool(name: string, input: unknown): Promise<unknown> {
  const registry = liveRegistry();
  if (registry) return registry.execute(name, input, "assistant");
  const runtime = document.modelContext as unknown as ExecutableModelContext | undefined;
  if (!runtime || typeof runtime.executeTool !== "function") {
    return { ok: false, error: "unavailable", detail: "This browser cannot execute WebMCP tools." };
  }
  const tool = (await runtime.getTools()).find((candidate) => candidate.name === name);
  if (!tool) return { ok: false, error: "not_found", detail: `Tool ${name} is no longer available.` };
  return parse(await runtime.executeTool(tool, JSON.stringify(input)));
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
