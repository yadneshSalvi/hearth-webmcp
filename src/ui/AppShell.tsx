"use client";
/**
 * The studio shell: a full-bleed canvas with floating glass panels over it (STYLE.md §4).
 * Catalog left · Inspector / Activity / status / Cart right · prompt bar bottom · toasts bottom-left
 * of the stage. Side panels collapse to icon rails between 1024 and 1279 px and disappear below
 * 1024 px, where the studio stays view-only plus the prompt bar.
 *
 * This module is the client-only boundary: it is the first place that imports three/R3F, and
 * `app/StudioClient.tsx` loads it with `ssr: false`.
 */
import Studio from "../scene/Studio";
import { useHearthStore } from "../state/store";
import { Activity } from "./Activity";
import { Assistant } from "./Assistant";
import { Board } from "./Board";
import { BuildPanel } from "./BuildPanel";
import { Cart } from "./Cart";
import { Catalog } from "./Catalog";
import { Compare } from "./Compare";
import { ConfirmModal } from "./ConfirmModal";
import { EnableSheet } from "./EnableSheet";
import { IconCart, IconPanelRight, IconRoom, IconTools } from "./icons";
import { Inspector } from "./Inspector";
import { Onboarding } from "./Onboarding";
import { IconButton } from "./primitives";
import { PromptBar } from "./PromptBar";
import { ShortcutsSheet } from "./ShortcutsSheet";
import { StatusChip } from "./StatusChip";
import { StudioCurtain } from "./StudioCurtain";
import { Toasts } from "./Toasts";
import { ToolsPanel } from "./ToolsPanel";
import { TopBar } from "./TopBar";
import { hearthStore } from "../state/store";
import { useConflictSync, useHearth } from "./useHearth";
import type { WebMCPStatus } from "../tools/useWebMCP";
import { useOnboardingReveal } from "./useFirstRun";
import { useViewportTier } from "./useViewportTier";
import type { ViewportTier } from "./useViewportTier";

/** Keeps `overlays.conflicts` in step with the scene without re-rendering the shell. */
function ConflictSync() {
  useConflictSync();
  return null;
}

/**
 * The welcome card waits for the opening settle to finish (src/scene/intro.ts). It subscribes here,
 * in a leaf, rather than in the shell: a shell-wide re-render also re-renders the R3F tree, and four
 * of those while the studio is compiling its first frame is a real cost on a machine without a GPU.
 */
function FirstRunCard({ status, onDismiss }: { status: WebMCPStatus; onDismiss(): void }) {
  if (!useOnboardingReveal()) return null;
  return (
    <div className="pointer-events-none absolute top-[88px] left-1/2 z-40 -translate-x-1/2">
      <Onboarding status={status} onDismiss={onDismiss} />
    </div>
  );
}

/**
 * A panel shows at the full tier unless it was collapsed, and at the rails tier only when it was
 * explicitly expanded. Below 1024 px the studio is view-only.
 */
function panelVisible(tier: ViewportTier, collapsed: boolean | undefined): boolean {
  if (tier === "compact") return false;
  if (tier === "rails") return collapsed === false;
  return collapsed !== true;
}

function Rail({ children }: { children: React.ReactNode }) {
  return (
    <div className="glass pointer-events-auto flex w-12 shrink-0 self-start flex-col items-center gap-1.5 p-1.5">
      {children}
    </div>
  );
}

export default function AppShell() {
  const tier = useViewportTier();
  const { status, toolGroups, readOnlyTools, firstRun, dismissFirstRun } = useHearth();
  const catalogCollapsed = useHearthStore((state) => state.ui.catalogCollapsed);
  const inspectorCollapsed = useHearthStore((state) => state.ui.inspectorCollapsed);
  const toolsOpen = useHearthStore((state) => state.ui.toolsPanelOpen);
  // Build mode edits the shell of the home, so the left panel becomes Rooms & openings.
  const buildMode = useHearthStore((state) => state.scene.meta.mode) === "build";
  // Exactly one of the log, the cart and the assistant is expanded: three full panels never fit
  // 900 px. The assistant takes the log's slot and links back to the rows it wrote.
  const cartOpen = useHearthStore((state) => state.ui.cartOpen ?? false);
  const assistantOpen = useHearthStore((state) => state.ui.assistantOpen);

  const catalogVisible = panelVisible(tier, catalogCollapsed);
  const sideVisible = panelVisible(tier, inspectorCollapsed);
  const rails = tier !== "compact";

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Before the canvas: the curtain is what shows *through* it until the first frame paints. */}
      <StudioCurtain />
      <Studio />
      <ConflictSync />

      <div className="pointer-events-none absolute inset-0 z-20 flex flex-col gap-4 p-5">
        <TopBar tier={tier} />

        <div className="flex min-h-0 min-w-0 flex-1 gap-4">
          {catalogVisible ? (
            buildMode
              ? <BuildPanel className="w-[328px] shrink-0" collapsible />
              : <Catalog className="w-[328px] shrink-0" collapsible />
          ) : rails ? (
            <Rail>
              <IconButton
                icon={IconRoom}
                label="Open the catalog"
                onClick={() => hearthStore.getState().setUi({ catalogCollapsed: false })}
              />
            </Rail>
          ) : null}

          <div className="relative min-h-0 min-w-0 flex-1">
            <Toasts className="absolute bottom-0 left-0" />
          </div>

          {sideVisible ? (
            // Three panels rarely fit 900 px at once. Each keeps a floor — the inspector shows the
            // item and its conflicts, the log keeps two rows, the cart keeps its money and checkout —
            // then their own scrollers take over, and the column itself scrolls as a last resort.
            <div className="flex min-h-0 w-[344px] shrink-0 flex-col gap-3 overflow-y-auto panel-scroll">
              {/* The assistant needs room to hold a conversation, so the inspector yields to it. */}
              <Inspector className={assistantOpen ? "max-h-[27%] min-h-[148px]" : "min-h-[300px]"} collapsible />
              {assistantOpen ? (
                <Assistant className="min-h-[320px] flex-1" />
              ) : (
                <Activity
                  className={cartOpen ? "shrink-0" : "min-h-[152px] flex-1"}
                  collapsed={cartOpen}
                  onExpand={() => hearthStore.getState().setUi({ cartOpen: false })}
                  readOnlyTools={readOnlyTools}
                />
              )}
              <Cart className={cartOpen ? "min-h-[244px] max-h-[52%]" : "shrink-0"} />
            </div>
          ) : rails ? (
            <Rail>
              <IconButton
                icon={IconPanelRight}
                label="Open the inspector, activity and cart"
                onClick={() => hearthStore.getState().setUi({ inspectorCollapsed: false })}
              />
              <IconButton
                icon={IconCart}
                label="Open the cart"
                onClick={() => hearthStore.getState().setUi({ inspectorCollapsed: false, cartOpen: true })}
              />
              <IconButton
                icon={IconTools}
                label="Show the agent tools"
                active={toolsOpen}
                onClick={() => hearthStore.getState().setUi({ toolsPanelOpen: !toolsOpen })}
              />
            </Rail>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <PromptBar className="min-w-0 flex-1" tier={tier} />
          <StatusChip className="pointer-events-auto" />
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 bottom-[88px] z-40">
        <ToolsPanel toolGroups={toolGroups} />
      </div>

      {firstRun ? <FirstRunCard status={status} onDismiss={dismissFirstRun} /> : null}

      <Compare />
      <Board />
      <ConfirmModal />
      <EnableSheet />
      <ShortcutsSheet />
    </div>
  );
}
