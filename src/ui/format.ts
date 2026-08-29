/**
 * Pure formatting helpers for the studio chrome. Every measurement carries its unit and every
 * number that lands in a receipt or a price is rendered with Fraunces tabular numerals by the
 * component that consumes these strings (STYLE.md §1, §4).
 */
import type { ActionSource, ConflictKind, Dims, Mode, TimeOfDay, View } from "../engine/types";
import { colorways } from "../tokens";

/** "$1,240" · "-$120" for an overspent budget. Cents are never shown. */
export function usd(value: number): string {
  const rounded = Math.round(value);
  const magnitude = Math.abs(rounded).toLocaleString("en-US");
  return `${rounded < 0 ? "-" : ""}$${magnitude}`;
}

/** "240 cm" */
export function cm(value: number): string {
  return `${Math.round(value)} cm`;
}

/** "220 × 95 cm" — footprint only, the form used on catalog cards. */
export function dimsLine(dims: Dims): string {
  return `${Math.round(dims.w)} × ${Math.round(dims.d)} cm`;
}

/** "220 × 95 × 85 cm" — width × depth × height, the form used in the inspector. */
export function dimsFull(dims: Dims): string {
  return `${Math.round(dims.w)} × ${Math.round(dims.d)} × ${Math.round(dims.h)} cm`;
}

/** "22.9 m²" from an area in cm². */
export function areaM2(areaCm2: number): string {
  return `${(areaCm2 / 10_000).toFixed(1)} m²`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Receipt timestamps: "just now", "12 s ago", "4 min ago", "2 h ago", "3 d ago", then a date. */
export function relativeTime(at: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < 10_000) return "just now";
  if (elapsed < MINUTE) return `${Math.floor(elapsed / 1000)} s ago`;
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)} d ago`;
  return new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const TIME_LABELS: Record<TimeOfDay, string> = {
  morning: "Morning",
  noon: "Noon",
  golden: "Golden",
  evening: "Evening",
};

/** "Golden" — the label shown beside the time-of-day glyphs. */
export function timeOfDayLabel(time: TimeOfDay): string {
  return TIME_LABELS[time];
}

const MODE_LABELS: Record<Mode, string> = { build: "Build", design: "Design", shop: "Shop" };

/** "Design" */
export function modeLabel(mode: Mode): string {
  return MODE_LABELS[mode];
}

const VIEW_LABELS: Record<View, string> = { plan: "Plan", dollhouse: "Dollhouse" };

/** "Dollhouse" */
export function viewLabel(view: View): string {
  return VIEW_LABELS[view];
}

/** "Dusty blue" — falls back to a title-cased id for colorways outside the palette. */
export function colorwayLabel(id: string): string {
  const known = (colorways as Record<string, { name: string } | undefined>)[id];
  if (known) return known.name;
  return id.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());
}

/** The palette hex for a colorway id, or plaster when unknown. */
export function colorwayHex(id: string): string {
  const known = (colorways as Record<string, { hex: string } | undefined>)[id];
  return known?.hex ?? colorways.plaster.hex;
}

const CONFLICT_LABELS: Record<ConflictKind, string> = {
  overlap: "Overlap",
  outside: "Outside the room",
  clearance: "Clearance",
  door_swing: "Door swing",
  traffic: "Walkway",
  access_path: "Accessible path",
  turning_circle: "Turning circle",
  reach: "Reach",
};

/** "Door swing" — the conflict kind as a human title. */
export function conflictLabel(kind: ConflictKind): string {
  return CONFLICT_LABELS[kind];
}

/** "door swing" — the same kind inside a sentence, used by the prompt suggestions. */
export function conflictPhrase(kind: ConflictKind): string {
  return CONFLICT_LABELS[kind].toLowerCase();
}

const SOURCE_LABELS: Record<ActionSource, string> = {
  human: "You",
  agent: "Agent",
  assistant: "Assistant",
  system: "Studio",
};

/** "Agent" — the actor column of the activity log. */
export function sourceLabel(source: ActionSource): string {
  return SOURCE_LABELS[source];
}

/**
 * The affirmative button of the confirmation dialog, phrased from the tool's own question so the
 * human reads an answer rather than a generic "OK" (TOOLS.md §0, confirmation).
 */
export function confirmLabel(message: string): string {
  if (/^clear\b/i.test(message) || /\bclear\b/i.test(message)) return "Yes, clear it";
  if (/\breplace\b|\btemplate\b/i.test(message)) return "Yes, replace it";
  if (/\bremove\b|\bdelete\b/i.test(message)) return "Yes, remove it";
  return "Yes, continue";
}

/** Masks a store password for display; the value itself is never logged. */
export function maskSecret(secret: string): string {
  return "•".repeat(Math.min(8, Math.max(4, secret.length)));
}

/** "3 items" / "1 item" */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

/** Compact JSON for the receipt disclosure; undefined becomes an em dash. */
export function compactJson(value: unknown): string {
  if (value === undefined) return "—";
  try {
    return JSON.stringify(value, null, 2) ?? "—";
  } catch {
    return "—";
  }
}

export interface TextRun {
  text: string;
  /** True for a number, price, measurement or percentage — rendered in Fraunces tabular numerals. */
  numeric: boolean;
}

const NUMERIC = /(?<![\w.-])\$?-?\d[\d,.]*(?:\s?(?:cm|m²|%|°))?(?![\w])/g;

/**
 * Splits a receipt line into plain and numeric runs so measurements and prices can be set in
 * Fraunces tabular numerals inside an Inter sentence (STYLE.md §1).
 */
export function splitNumerals(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let cursor = 0;
  for (const match of text.matchAll(NUMERIC)) {
    const start = match.index ?? 0;
    if (start > cursor) runs.push({ text: text.slice(cursor, start), numeric: false });
    runs.push({ text: match[0], numeric: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) runs.push({ text: text.slice(cursor), numeric: false });
  return runs.length > 0 ? runs : [{ text, numeric: false }];
}
