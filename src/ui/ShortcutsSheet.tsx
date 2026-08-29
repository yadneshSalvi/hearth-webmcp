"use client";
/**
 * The keyboard and pointer map, opened with ?. Every row here is also a visible control or a
 * gesture the canvas answers — this sheet is where the free orbit is discovered.
 */
import { hearthStore, useHearthStore } from "../state/store";
import { Kbd } from "./primitives";
import { Sheet } from "./Sheet";

interface Row {
  keys: string[];
  label: string;
}

const KEYS: Row[] = [
  { keys: ["⌘", "Z"], label: "Undo the last change" },
  { keys: ["⇧", "⌘", "Z"], label: "Redo" },
  { keys: ["1"], label: "Plan view" },
  { keys: ["2"], label: "Dollhouse view" },
  { keys: ["["], label: "Turn the view 45° counter-clockwise" },
  { keys: ["]"], label: "Turn the view 45° clockwise" },
  { keys: ["0"], label: "Reset the view to the framed shot" },
  { keys: ["H"], label: "Frame the entire home, and back" },
  { keys: ["T"], label: "Cycle morning · noon · golden · evening" },
  { keys: ["⌘", "K"], label: "Jump to the prompt chips" },
  { keys: ["?"], label: "This sheet" },
  { keys: ["Esc"], label: "Close any overlay" },
];

const POINTER: Row[] = [
  { keys: ["Drag"], label: "Pan — drag the floor or the background" },
  { keys: ["Right-drag"], label: "Orbit the view freely" },
  { keys: ["⇧", "Drag"], label: "Orbit with the left button" },
  { keys: ["Scroll"], label: "Zoom in and out" },
  { keys: ["Double-click"], label: "Reset the view" },
];

function Rows({ rows }: { rows: Row[] }) {
  return (
    <ul className="flex flex-col">
      {rows.map((row) => (
        <li key={row.label} className="flex items-center justify-between gap-3 border-b border-hairline/70 py-2 last:border-0">
          <span className="text-[12.5px] text-ink-muted">{row.label}</span>
          <span className="flex shrink-0 items-center gap-1">
            {row.keys.map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function ShortcutsSheet() {
  const open = useHearthStore((state) => state.ui.shortcutsOpen ?? false);
  const close = (): void => hearthStore.getState().setUi({ shortcutsOpen: false });

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Keyboard & pointer"
      subtitle="Every key and gesture the studio answers."
      width={420}
    >
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-1">
          <h3 className="label-caps text-ink-faint">Keys</h3>
          <Rows rows={KEYS} />
        </section>
        <section className="flex flex-col gap-1">
          <h3 className="label-caps text-ink-faint">Mouse, trackpad and touch</h3>
          <Rows rows={POINTER} />
        </section>
      </div>
    </Sheet>
  );
}
