"use client";
/** The keyboard map, opened with ?. Every shortcut here is also a visible control somewhere. */
import { hearthStore, useHearthStore } from "../state/store";
import { Kbd } from "./primitives";
import { Sheet } from "./Sheet";

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["⌘", "Z"], label: "Undo the last change" },
  { keys: ["⇧", "⌘", "Z"], label: "Redo" },
  { keys: ["1"], label: "Plan view" },
  { keys: ["2"], label: "Dollhouse view" },
  { keys: ["["], label: "Rotate the view counter-clockwise" },
  { keys: ["]"], label: "Rotate the view clockwise" },
  { keys: ["T"], label: "Cycle morning · noon · golden · evening" },
  { keys: ["⌘", "K"], label: "Jump to the prompt chips" },
  { keys: ["?"], label: "This sheet" },
  { keys: ["Esc"], label: "Close any overlay" },
];

export function ShortcutsSheet() {
  const open = useHearthStore((state) => state.ui.shortcutsOpen ?? false);
  const close = (): void => hearthStore.getState().setUi({ shortcutsOpen: false });

  return (
    <Sheet open={open} onClose={close} title="Keyboard" subtitle="The studio is fully keyboard-drivable." width={420}>
      <ul className="flex flex-col">
        {SHORTCUTS.map((shortcut) => (
          <li key={shortcut.label} className="flex items-center justify-between gap-3 border-b border-hairline/70 py-2.5 last:border-0">
            <span className="text-[12.5px] text-ink-muted">{shortcut.label}</span>
            <span className="flex shrink-0 items-center gap-1">
              {shortcut.keys.map((key) => (
                <Kbd key={key}>{key}</Kbd>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
