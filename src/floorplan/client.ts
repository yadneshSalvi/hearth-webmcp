"use client";
/**
 * The browser's plan reader: posts the image to `/api/floorplan` and validates what comes back.
 * Tool handlers and the import sheet both go through this, so an agent's `import_floor_plan` and
 * a human's "Read plan" button are the same request.
 */
import { asParsedPlan } from "./schema";
import type { PlanReadRequest, PlanReader } from "./schema";

const ENDPOINT = "/api/floorplan";

function detailOf(payload: unknown, fallback: string): string {
  if (typeof payload === "object" && payload !== null && "detail" in payload && typeof (payload as { detail: unknown }).detail === "string") {
    return (payload as { detail: string }).detail;
  }
  return fallback;
}

export const readPlan: PlanReader = async (request: PlanReadRequest, signal?: AbortSignal) => {
  const started = Date.now();
  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return { ok: false, error: "unavailable", detail: "The plan read was cancelled." };
    return { ok: false, error: "unavailable", detail: "The plan reader could not be reached." };
  }
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, error: "unavailable", detail: "The plan reader returned an unreadable answer." };
  }
  if (!response.ok) {
    const error = response.status === 400 ? "invalid" : response.status === 404 ? "not_found" : "unavailable";
    return { ok: false, error, detail: detailOf(payload, `The plan reader failed (${response.status}).`) };
  }
  const plan = asParsedPlan(typeof payload === "object" && payload !== null ? (payload as { plan?: unknown }).plan : undefined);
  if (!plan) return { ok: false, error: "unavailable", detail: "The plan reader returned an unexpected shape." };
  return { ok: true, plan, ms: Date.now() - started };
};
