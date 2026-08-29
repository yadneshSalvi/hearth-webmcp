"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { ShopifyClient } from "../shopify/types";
import { hearthStore } from "../state/store";
import type { ToolUi } from "./define";
import { detectModelContext, ensureModelContext, webMcpPolyfillRequested } from "./polyfill-loader";
import type { WebMCPPolyfillMode } from "./polyfill-loader";
import { createRegistry } from "./registry";
import type { Registry } from "./registry";

export type WebMCPStatus = "native" | "polyfill" | "loading" | "unavailable";

interface UseWebMCPOptions {
  ui: ToolUi;
  shopify: ShopifyClient;
  mode?: WebMCPPolyfillMode;
}

/** Starts the client-only WebMCP registry in the pre-paint layout phase. */
export function useWebMCP(options: UseWebMCPOptions): { status: WebMCPStatus; registry: Registry | null } {
  const initial = useRef(options);
  const registryRef = useRef<Registry | null>(null);
  const [registry, setRegistry] = useState<Registry | null>(null);
  const [status, setStatus] = useState<WebMCPStatus>(() => detectModelContext() === "native" ? "native" : "unavailable");

  useLayoutEffect(() => {
    let disposed = false;
    const configuration = initial.current;
    const activate = (kind: "native" | "polyfill"): void => {
      if (disposed || !document.modelContext || registryRef.current) return;
      const created = createRegistry({
        modelContext: document.modelContext,
        store: hearthStore,
        ui: configuration.ui,
        shopify: configuration.shopify,
      });
      registryRef.current = created;
      created.start();
      setRegistry(created);
      setStatus(kind);
    };

    if (detectModelContext() === "native") activate("native");
    else if (webMcpPolyfillRequested(configuration.mode)) {
      setStatus("loading");
      void ensureModelContext().then((kind) => {
        if (kind === "native" || kind === "polyfill") activate(kind);
        else if (!disposed) setStatus("unavailable");
      });
    } else setStatus("unavailable");

    return () => {
      disposed = true;
      registryRef.current?.stop();
      registryRef.current = null;
    };
  }, []);

  return { status, registry };
}
