"use client";
/**
 * The design-board preview. `export_design_board` (TOOLS.md §26) and the top bar's export button
 * both compose the same 1600 × 1000 PNG, start its download and open this modal, so the human sees
 * exactly what their agent just made and can save it again.
 */
import { hearthStore, useHearthStore } from "../state/store";
import { useBoardPreview } from "./board-bus";
import { BOARD_HEIGHT, BOARD_WIDTH } from "./boardCompose";
import { IconBoard } from "./icons";
import { Button } from "./primitives";
import { Sheet } from "./Sheet";

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
  if (!open || !preview) return null;

  const { model } = preview;
  const close = (): void => hearthStore.getState().setUi({ boardOpen: false });

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
