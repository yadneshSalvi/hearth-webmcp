import type { StoreApi } from "zustand";
import type { ShopifyClient } from "../shopify/types";
import { desiredToolGroups } from "../state/selectors";
import type { HearthStore, ToolGroup } from "../state/types";
import {
  bindDefinedTool, executeDefinedTool,
} from "./define";
import type { DefinedTool, ToolContext, ToolResult, ToolSource, ToolUi } from "./define";
import { allToolDefinitions } from "./handlers";

const GROUPS: readonly ToolGroup[] = [
  "core", "design", "shop", "present", "preview", "variants", "checkout", "build",
];

function groupState(): Record<ToolGroup, boolean> {
  return {
    core: false,
    design: false,
    shop: false,
    present: false,
    preview: false,
    variants: false,
    checkout: false,
    build: false,
  };
}

function webMcpStatus(): "native" | "polyfill" {
  return typeof window !== "undefined" && Reflect.has(window, "__webmcp_registered_tools") ? "polyfill" : "native";
}

function gateKey(state: HearthStore): string {
  const active = state.scene.meta.activeRoomId;
  const variants = state.scene.variants.filter((variant) => variant.roomId === active).length;
  const ghost = state.scene.furniture.some((item) => item.status === "ghost");
  return `${state.scene.meta.mode}|${ghost ? 1 : 0}|${variants}|${state.cart.lines.length}`;
}

function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

export interface Registry {
  start(): void;
  stop(): void;
  sync(): void;
  execute(name: string, input: unknown, source: ToolSource): Promise<ToolResult>;
  list(): DefinedTool[];
  readonly executing: number;
  state(): { registered: Record<ToolGroup, boolean> };
}

export interface RegistryOptions {
  modelContext: WebMCP.ModelContext;
  store: StoreApi<HearthStore>;
  ui: ToolUi;
  shopify: ShopifyClient;
  now?: () => number;
  schedule?: (fn: () => void) => void;
}

/** Creates Hearth's abort-controller-based dynamic WebMCP registry. */
export function createRegistry(options: RegistryOptions): Registry {
  const now = options.now ?? Date.now;
  const schedule = options.schedule ?? ((fn: () => void) => { setTimeout(fn, 50); });
  const registered = groupState();
  const controllers = new Map<ToolGroup, AbortController>();
  const recentlyAborted = new Set<ToolGroup>();
  let activeExecutions = 0;
  let pendingSync = false;
  let syncScheduled = false;
  let started = false;
  let subscription: (() => void) | undefined;
  let selectedGateKey = gateKey(options.store.getState());
  let mirrorRequest = 0;

  const placeholderContext: ToolContext = {
    store: options.store,
    ui: options.ui,
    shopify: options.shopify,
    source: "agent",
  };
  const definitions = allToolDefinitions(placeholderContext).sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(definitions.map((tool) => [tool.name, tool]));

  const flushPending = (): void => {
    if (activeExecutions !== 0 || !pendingSync || syncScheduled || !started) return;
    syncScheduled = true;
    schedule(() => {
      syncScheduled = false;
      if (!started) return;
      pendingSync = false;
      sync();
    });
  };

  for (const tool of definitions) {
    bindDefinedTool(tool, {
      context(source, signal) {
        return {
          store: options.store,
          ui: options.ui,
          shopify: options.shopify,
          source,
          ...(signal ? { signal } : {}),
        };
      },
      before() {
        activeExecutions += 1;
      },
      after() {
        activeExecutions = Math.max(0, activeExecutions - 1);
        flushPending();
      },
      now,
    });
  }

  const registerOne = (tool: DefinedTool, controller: AbortController): void => {
    try {
      const registration = options.modelContext.registerTool(tool, { signal: controller.signal });
      void registration.catch((error: unknown) => {
        if (isAbortError(error)) return;
        console.warn(`[Hearth WebMCP] Failed to register ${tool.name}.`, error);
      });
    } catch (error) {
      if (isAbortError(error)) return;
      console.warn(`[Hearth WebMCP] Failed to register ${tool.name}.`, error);
    }
  };

  const registerGroupsTogether = (groups: Set<ToolGroup>): void => {
    for (const group of groups) {
      if (!controllers.has(group)) controllers.set(group, new AbortController());
      registered[group] = true;
    }
    for (const tool of definitions) {
      if (!groups.has(tool.group)) continue;
      const controller = controllers.get(tool.group);
      if (controller) registerOne(tool, controller);
    }
  };

  const registerGroup = (group: ToolGroup): void => {
    if (registered[group]) return;
    if (recentlyAborted.has(group)) {
      queueMicrotask(() => {
        recentlyAborted.delete(group);
        if (started && desiredToolGroups(options.store.getState()).includes(group) && !registered[group]) registerGroup(group);
      });
      return;
    }
    const controller = new AbortController();
    controllers.set(group, controller);
    registered[group] = true;
    definitions.filter((tool) => tool.group === group).forEach((tool) => registerOne(tool, controller));
  };

  const abortGroup = (group: ToolGroup): void => {
    if (!registered[group]) return;
    controllers.get(group)?.abort();
    controllers.delete(group);
    registered[group] = false;
    recentlyAborted.add(group);
    queueMicrotask(() => recentlyAborted.delete(group));
  };

  const mirror = (): void => {
    const request = ++mirrorRequest;
    void options.modelContext.getTools().then((tools) => {
      if (request !== mirrorRequest) return;
      options.store.getState().setToolsMirror(tools
        .map((registeredTool) => ({
          name: registeredTool.name,
          title: registeredTool.title ?? byName.get(registeredTool.name)?.title,
          description: registeredTool.description,
          inputSchema: registeredTool.inputSchema ?? {},
        }))
        .sort((a, b) => a.name.localeCompare(b.name)), webMcpStatus());
    }).catch((error: unknown) => {
      console.warn("[Hearth WebMCP] Failed to mirror registered tools.", error);
      options.store.getState().setToolsMirror([], "unavailable");
    });
  };

  const onToolChange = (): void => mirror();

  function sync(): void {
    if (!started) return;
    if (activeExecutions > 0) {
      pendingSync = true;
      return;
    }
    const desired = new Set(desiredToolGroups(options.store.getState()));
    for (const group of GROUPS) {
      if (desired.has(group) && !registered[group]) registerGroup(group);
      else if (!desired.has(group) && registered[group]) abortGroup(group);
    }
  }

  const registry: Registry = {
    start() {
      if (started) return;
      started = true;
      pendingSync = false;
      selectedGateKey = gateKey(options.store.getState());
      const initialGroups = new Set(desiredToolGroups(options.store.getState()));
      registerGroupsTogether(initialGroups);
      sync();
      options.modelContext.addEventListener("toolchange", onToolChange);
      mirror();
      subscription = options.store.subscribe((state) => {
        const next = gateKey(state);
        if (next === selectedGateKey) return;
        selectedGateKey = next;
        sync();
      });
    },
    stop() {
      if (!started) return;
      started = false;
      pendingSync = false;
      syncScheduled = false;
      subscription?.();
      subscription = undefined;
      options.modelContext.removeEventListener("toolchange", onToolChange);
      mirrorRequest += 1;
      for (const group of GROUPS) abortGroup(group);
      recentlyAborted.clear();
      options.store.getState().setToolsMirror([], webMcpStatus());
    },
    sync,
    async execute(name, input, source) {
      const tool = byName.get(name);
      if (!tool) return { ok: false, error: "not_found", detail: `Tool ${name} is not defined.`, alternatives: definitions.slice(0, 3).map((candidate) => candidate.name) };
      if (source !== "test" && !desiredToolGroups(options.store.getState()).includes(tool.group)) {
        const mode = options.store.getState().scene.meta.mode;
        const detail = tool.group === "build"
          ? `${tool.name} is unavailable in ${mode} mode; set_mode build first.`
          : `${tool.name} is unavailable until its ${tool.group} gate is open.`;
        return { ok: false, error: "blocked", detail };
      }
      return executeDefinedTool(tool, input, source);
    },
    list() {
      return [...definitions];
    },
    get executing() {
      return activeExecutions;
    },
    state() {
      return { registered: { ...registered } };
    },
  };

  return registry;
}
