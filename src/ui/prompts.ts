/**
 * The prompt bar teaches the collaboration: four chips, always in the human's own words, always
 * true of the room in front of them. Pure so the wording is unit-tested rather than eyeballed.
 */
import type { ConflictKind, Mode } from "../engine/types";
import { conflictPhrase } from "./format";

export interface PromptContext {
  mode: Mode;
  /** Active room display name, e.g. "Living Room". */
  roomName: string;
  /** Product name of the selected item, when the human has one selected. */
  selectionName?: string;
  /** Conflict kinds in the active room, errors first (only the kind is needed for wording). */
  conflictKinds: ConflictKind[];
  cartLines: number;
  variants: number;
  accessibility: boolean;
}

function lower(name: string): string {
  return name.toLowerCase();
}

/** Generic reads, used to pad the list so the bar is never half empty. */
function fillers(ctx: PromptContext): string[] {
  return [
    `Which walls in the ${lower(ctx.roomName)} are free?`,
    "Score this room and name the top fix",
    "Set the light to evening",
    "Export a design board",
    "Measure the north wall",
  ];
}

function modePrompts(ctx: PromptContext): string[] {
  if (ctx.mode === "shop") {
    return [
      "Find a sofa under $800 that fits the north wall",
      "Try the Endre sofa in sage here",
      ctx.cartLines > 0 ? "Give me the checkout link" : "Add a floor lamp to my cart",
    ];
  }
  if (ctx.mode === "build") {
    return [
      "Add a 120 cm window on the north wall",
      `Make the ${lower(ctx.roomName)} 40 cm wider`,
      "Centre the door on the west wall",
    ];
  }
  return [
    "Arrange this room for conversation",
    "Set up this room for movie nights",
    ctx.variants >= 2 ? "Compare my two saved layouts" : "Save this layout as Cosy",
  ];
}

/**
 * Returns exactly four contextual prompts, most specific first: the selection, then the worst
 * conflict, then the current mode, then accessibility, then generic reads.
 */
export function promptSuggestions(ctx: PromptContext): string[] {
  const candidates: string[] = [];
  if (ctx.selectionName) candidates.push(`Move the ${ctx.selectionName} 40 cm from the window`);
  const kind = ctx.conflictKinds[0];
  if (kind) candidates.push(`Fix the ${conflictPhrase(kind)} in the ${lower(ctx.roomName)}`);
  candidates.push(...modePrompts(ctx));
  if (!ctx.accessibility) candidates.push("Make this room wheelchair friendly");
  candidates.push(...fillers(ctx));

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    unique.push(candidate);
    if (unique.length === 4) break;
  }
  return unique;
}
