/**
 * The plan reader's output contract (TOOLS.md §40): what `/api/floorplan` returns and what
 * `planToScene` consumes. One zod schema, used by the route (to validate the model), the client
 * (to validate the response) and the tests (fixtures are checked against it).
 */
import * as z from "zod";
import type { ParsedPlan } from "../engine/floorplan";

export const SIDES = ["north", "east", "south", "west"] as const;
export const PARSED_ROOM_TYPES = ["living", "bedroom", "kitchen", "dining", "office", "bath", "hall", "studio", "outdoor", "other"] as const;

export const parsedRoomSchema = z.object({
  name: z.string().max(80),
  type: z.enum(PARSED_ROOM_TYPES),
  dimension_label: z.string().max(80),
  width_cm: z.number().nonnegative().max(10_000),
  depth_cm: z.number().nonnegative().max(10_000),
  bbox: z.object({ x0: z.number(), y0: z.number(), x1: z.number(), y1: z.number() }),
  doors_to: z.array(z.string().max(80)).max(20),
  windows: z.array(z.enum(SIDES)).max(4),
});

export const parsedPlanSchema = z.object({
  title: z.string().max(120),
  units: z.enum(["ft", "m", "cm", "unknown"]),
  north_up: z.boolean(),
  rooms: z.array(parsedRoomSchema).max(40),
  entrance_room: z.string().max(80),
  confidence: z.number().min(0).max(1),
  notes: z.string().max(600),
});

/** The JSON Schema handed to the vision model as its strict output format (draft-07 subset). */
export const PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    units: { type: "string", enum: ["ft", "m", "cm", "unknown"] },
    north_up: { type: "boolean" },
    rooms: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          type: { type: "string", enum: [...PARSED_ROOM_TYPES] },
          dimension_label: { type: "string" },
          width_cm: { type: "number" },
          depth_cm: { type: "number" },
          bbox: {
            type: "object",
            additionalProperties: false,
            properties: { x0: { type: "number" }, y0: { type: "number" }, x1: { type: "number" }, y1: { type: "number" } },
            required: ["x0", "y0", "x1", "y1"],
          },
          doors_to: { type: "array", items: { type: "string" } },
          windows: { type: "array", items: { type: "string", enum: [...SIDES] } },
        },
        required: ["name", "type", "dimension_label", "width_cm", "depth_cm", "bbox", "doors_to", "windows"],
      },
    },
    entrance_room: { type: "string" },
    confidence: { type: "number" },
    notes: { type: "string" },
  },
  required: ["title", "units", "north_up", "rooms", "entrance_room", "confidence", "notes"],
} as const;

/** Validates an unknown value as a ParsedPlan; returns undefined when it is not one. */
export function asParsedPlan(value: unknown): ParsedPlan | undefined {
  const parsed = parsedPlanSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

/** What the route accepts: a data: URL the human uploaded, or an http(s) URL the agent named. */
export interface PlanReadRequest {
  image?: string;
  url?: string;
}

export interface PlanReadResponse {
  ok: true;
  plan: ParsedPlan;
  /** Wall-clock ms the reader took, for the receipt. */
  ms: number;
}

export type PlanReader = (request: PlanReadRequest, signal?: AbortSignal) => Promise<
  { ok: true; plan: ParsedPlan; ms: number } | { ok: false; error: "unavailable" | "invalid" | "not_found"; detail: string }
>;

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const IMAGE_MIME = ["image/png", "image/jpeg", "image/webp"] as const;

/** Approximate decoded byte length of a base64 data: URL. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const payload = dataUrl.length - comma - 1;
  return Math.floor(payload * 3 / 4);
}

/** The mime type of a data: URL, or undefined when it is not an accepted image. */
export function dataUrlMime(dataUrl: string): (typeof IMAGE_MIME)[number] | undefined {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,/i.exec(dataUrl);
  const mime = match?.[1]?.toLowerCase();
  return IMAGE_MIME.find((entry) => entry === mime);
}
