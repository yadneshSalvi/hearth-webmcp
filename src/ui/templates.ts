/**
 * What a floor-plan template looks like before you apply it: its name, a one-line spec read off the
 * scene it would build, and a mini plan drawn from the same room polygons the renderer uses.
 *
 * The list itself is `TEMPLATE_IDS` (src/engine/types.ts), so a template added to the engine shows
 * up in the Layouts chooser without a second list to keep in step.
 */
import { createTemplate, templateLabel } from "../engine";
import { polyBBox, roomAreaM2 } from "../engine/geometry";
import { TEMPLATE_IDS } from "../engine/types";
import type { Room, Scene, TemplateId } from "../engine/types";
import { floorHex } from "../tokens";

/** The one sentence the confirmation gate asks, whoever asked for the layout. */
function confirmSentence(label: string): string {
  return `Replace this home with the ${label} layout?`;
}

/**
 * The question the confirmation gate asks before a layout replaces the home. One sentence, the
 * layout named the way the chooser names it — never the raw id (`1br`), whoever asked. The name
 * itself belongs to the engine (`templateLabel`), so the chooser, the tool and this sentence cannot
 * disagree about what a home is called.
 */
export function templateConfirmMessage(id: TemplateId): string {
  return confirmSentence(templateLabel(id));
}

/** The shape `apply_template` asks in today (src/tools/handlers/build.ts). */
const TOOL_CONFIRM = /^Replace this home and its \d+ placed items with the (.+) layout\?$/;
/** The shape it asked in before it took its labels from the engine — still rewritten, not shown raw. */
const LEGACY_TOOL_CONFIRM = /^Replace this home and its \d+ placed items with the (\S+) template\?$/;

function isTemplateId(id: string): id is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(id);
}

/**
 * The agent's `apply_template` writes its own confirmation, and a tool's message is part of its
 * contract: it names the count because an agent's caller cannot see the room. The chrome owns how a
 * question is *worded* for a human, and it already shows the count in the subtitle underneath — so
 * it rewrites that one shape into `templateConfirmMessage`. Anything else passes through untouched.
 *
 * Two shapes are matched, and a round-3 gate review is why: the tool moved to engine-owned labels
 * ("… with the 5 bedrooms layout?") while this regex still demanded the old raw-id one ("… with the
 * 5br template?"), so every agent-path confirmation went out unrewritten with the count said twice.
 * `tests/tools/handlers.test.ts` now feeds this function the string the live tool actually produces,
 * so the two cannot drift apart again.
 */
export function humanizeConfirmMessage(message: string): string {
  const current = TOOL_CONFIRM.exec(message)?.[1];
  if (current) return confirmSentence(current);
  const legacy = LEGACY_TOOL_CONFIRM.exec(message)?.[1];
  if (legacy && isTemplateId(legacy)) return templateConfirmMessage(legacy);
  return message;
}

export interface TemplateSummary {
  rooms: number;
  beds: number;
  baths: number;
  areaM2: number;
}

/** Counts the rooms, beds, baths and floor area of a template's scene. */
export function templateSummary(scene: Scene): TemplateSummary {
  let beds = 0;
  let baths = 0;
  let area = 0;
  for (const room of scene.rooms) {
    if (room.type === "bedroom") beds += 1;
    if (room.type === "bath") baths += 1;
    area += roomAreaM2(room);
  }
  return { rooms: scene.rooms.length, beds, baths, areaM2: Math.round(area) };
}

/** "6 rooms · 2 bed · 1 bath · 94 m²" — beds and baths are dropped when a plan has none. */
export function summaryLine(summary: TemplateSummary): string {
  const parts = [`${summary.rooms} rooms`];
  if (summary.beds > 0) parts.push(`${summary.beds} bed`);
  if (summary.baths > 0) parts.push(`${summary.baths} bath`);
  parts.push(`${summary.areaM2} m²`);
  return parts.join(" · ");
}

export interface MiniPlanRoom {
  id: string;
  /** SVG `points` for the room polygon, already scaled into the box. */
  points: string;
  fill: string;
}

export interface MiniPlan {
  width: number;
  height: number;
  rooms: MiniPlanRoom[];
}

/**
 * The home's polygons scaled to fit a `width × height` box, centred, with `pad` px of air. L-shaped
 * rooms keep their notch: this draws the polygon, not its bounding rectangle.
 */
export function miniPlan(rooms: Room[], width: number, height: number, pad = 5): MiniPlan {
  const empty = { width, height, rooms: [] };
  if (rooms.length === 0) return empty;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const room of rooms) {
    const box = polyBBox(room.poly);
    minX = Math.min(minX, room.origin.x + box.minX);
    minY = Math.min(minY, room.origin.y + box.minY);
    maxX = Math.max(maxX, room.origin.x + box.maxX);
    maxY = Math.max(maxY, room.origin.y + box.maxY);
  }
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  if (!(spanX > 0) || !(spanY > 0)) return empty;
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offsetX = (width - spanX * scale) / 2;
  const offsetY = (height - spanY * scale) / 2;
  const at = (x: number, y: number): string =>
    `${((x - minX) * scale + offsetX).toFixed(1)},${((y - minY) * scale + offsetY).toFixed(1)}`;
  return {
    width,
    height,
    rooms: rooms.map((room) => ({
      id: room.id,
      points: room.poly.map((point) => at(room.origin.x + point.x, room.origin.y + point.y)).join(" "),
      fill: floorHex(room.floor),
    })),
  };
}

export interface TemplateCard {
  id: TemplateId;
  label: string;
  spec: string;
  plan: MiniPlan;
}

/** Every template the engine ships, ready to render as a card. Deterministic, so it memoises. */
export function templateCards(width: number, height: number): TemplateCard[] {
  return TEMPLATE_IDS.map((id) => {
    const scene = createTemplate(id);
    return {
      id,
      label: templateLabel(id),
      spec: summaryLine(templateSummary(scene)),
      plan: miniPlan(scene.rooms, width, height),
    };
  });
}
