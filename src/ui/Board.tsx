"use client";
/**
 * The design-board preview. `export_design_board` (TOOLS.md §26) and the top bar's export button
 * both compose the same 1600 × 1000 PNG, start its download and open this modal, so the human sees
 * exactly what their agent just made and can save it again.
 */
import { useEffect } from "react";
import { hearthStore, useHearthStore } from "../state/store";
import { useBoardPreview } from "./board-bus";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./boardCompose";
import { IconBoard } from "./icons";
import { Button } from "./primitives";
import { Sheet } from "./Sheet";

/**
 * The board's own receipt — the tool's and the top bar's both read "Export design board" — is
 * pushed after this modal opens, so it is the one entry that must not close what it announced.
 */
const OWN_RECEIPT = "Export design board";

function close(): void {
  hearthStore.getState().setUi({ boardOpen: false });
}

/**
 * A board is a photograph of a moment, so it closes as soon as the studio moves on. An agent that
 * exports a board and keeps working used to leave the preview parked over everything it did next —
 * `set_time_of_day`, `compare_variants`, `preview_in_room` and `confirm_preview` all played out
 * behind it. Any scene change, any cart change, any other tool's receipt and any overlay a tool
 * opens dismisses it, the same way the compare split view watches the layout.
 */
function useAutoClose(): void {
  useEffect(() => {
    const open = hearthStore.getState();
    let scene = open.scene;
    let cart = open.cart;
    let activity = open.activity;
    return hearthStore.subscribe((state) => {
      if (state.scene !== scene || state.cart !== cart) {
        scene = state.scene;
        cart = state.cart;
        close();
        return;
      }
      // A confirmation dialog or a compare view means a tool is mid-execution behind the preview.
      if (state.ui.compare !== undefined || state.ui.pendingConfirm !== undefined) {
        close();
        return;
      }
      if (state.activity === activity) return;
      const newest = state.activity[0];
      activity = state.activity;
      if (newest && newest.title !== OWN_RECEIPT) close();
    });
  }, []);
}

function saveAgain(url: string, filename: string): void {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function Board() {
  const open = useHearthStore((state) => state.ui.boardOpen);
  const preview = useBoardPreview();
  // Subscribed before the early return: the modal must watch the studio for as long as it is up.
  useAutoClose();
  if (!open || !preview) return null;

  const { model } = preview;

  return (
    <Sheet
      open
      onClose={close}
      title={model.title}
      subtitle={`Design board · ${BOARD_WIDTH} × ${BOARD_HEIGHT} px · saved to your downloads`}
      width={960}
      footer={
        <>
          <Button variant="secondary" onClick={close}>Done</Button>
          <Button variant="primary" icon={IconBoard} data-autofocus="" onClick={() => saveAgain(preview.url, preview.filename)}>
            Download PNG
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {/* The composed board is a local blob; next/image would only add a proxy in front of it. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.url}
          alt={`Design board for ${model.title}: dollhouse render, plan, palette and ${model.itemCount} items`}
          width={BOARD_WIDTH}
          height={BOARD_HEIGHT}
          className="w-full rounded-panel border border-hairline bg-plaster shadow-chip"
        />
        <div className="flex items-baseline justify-between gap-3">
          <p className="label-caps truncate">{model.caps}</p>
          <p className="numerals shrink-0 text-[15px] text-ink">{model.total}</p>
        </div>
      </div>
    </Sheet>
  );
}
