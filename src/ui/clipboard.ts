"use client";
/** Clipboard with a flash state: "Copied — paste into ChatGPT" is how the studio hands work over. */
import { useCallback, useEffect, useRef, useState } from "react";

const FLASH_MS = 1_800;
/** The hand-off flash on a prompt chip: long enough to read "paste into ChatGPT" and act on it. */
export const HANDOFF_FLASH_MS = 2_500;

/** Copies text, falling back to a hidden textarea when the async clipboard is blocked. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Permission-denied or insecure context: fall through to the legacy path.
  }
  try {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.cssText = "position:fixed;top:-1000px;opacity:0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** `copied` stays true for `flashMs` (1.8 s by default) after a successful copy, so a label can flash. */
export function useCopyFlash(flashMs = FLASH_MS): { copied: boolean; copy(text: string): void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = useCallback((text: string) => {
    void copyText(text).then((ok) => {
      if (!ok) return;
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), flashMs);
    });
  }, [flashMs]);

  return { copied, copy };
}
