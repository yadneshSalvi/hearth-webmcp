/**
 * The plan reader (TOOLS.md §40): one vision call that turns a floor-plan image into the
 * structured `ParsedPlan` the engine lays out. Server-only — the model key never reaches the page.
 * Accepts the human's uploaded image as a data: URL or an http(s) URL an agent named; the URL is
 * fetched here with a size cap and an image-only content-type check.
 */
import { PLAN_JSON_SCHEMA, MAX_IMAGE_BYTES, asParsedPlan, dataUrlBytes, dataUrlMime } from "@/src/floorplan/schema";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const OPENAI_URL = "https://api.openai.com/v1/responses";
const MAX_BODY_CHARS = 12 * 1024 * 1024;
const TIMEOUT_MS = 100_000;
const FETCH_TIMEOUT_MS = 15_000;

export const PLAN_READER_INSTRUCTIONS = [
  "You read residential 2D floor plans and return structured data for a room-layout engine.",
  "List every enclosed room or space on the plan. Include balconies, decks and terraces with type outdoor. Skip shafts, ducts, stair cores, wardrobes drawn as recesses, and unlabelled voids.",
  "bbox is the room's axis-aligned box as a fraction of the whole image (0..1), x from the left edge, y from the top edge.",
  "width_cm is the room's HORIZONTAL extent (left to right in the image), depth_cm its VERTICAL extent (top to bottom). Read the printed dimension label (for example 9'0\" x 10'6\" or 3.6 x 4.2 m) and convert to centimetres (1 ft = 30.48 cm, 1 in = 2.54 cm, 1 m = 100 cm). If the label does not say which number is horizontal, use the bbox aspect ratio to give the larger number to the longer side. If a room has no label, estimate from the scale implied by the labelled rooms; use 0 only when nothing can be inferred.",
  "dimension_label is the label text exactly as printed, or an empty string.",
  "doors_to lists the names of the rooms this room has a door, opening or arch into, plus \"outside\" for an entrance door. Use each room's name exactly as you list it.",
  "windows lists the compass sides (north = top of the image, east = right, south = bottom, west = left) of this room's walls that carry windows.",
  "entrance_room is the room the front door opens into. confidence is 0..1 for the whole reading. notes is one or two short sentences about anything ambiguous.",
].join(" ");

interface ReadRequest {
  image?: string;
  url?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function badRequest(detail: string, status = 400): Response {
  return Response.json({ ok: false, error: status === 404 ? "not_found" : "invalid", detail }, { status });
}

function unavailable(detail: string, status = 503): Response {
  return Response.json({ ok: false, error: "unavailable", detail }, { status });
}

async function fetchImage(url: string): Promise<{ ok: true; dataUrl: string } | { ok: false; response: Response }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, response: badRequest("image_url must be an absolute http(s) URL.") };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { ok: false, response: badRequest("image_url must use http or https.") };
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || host === "[::1]") {
    return { ok: false, response: badRequest("image_url must point at a public host.") };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { signal: controller.signal, redirect: "follow", headers: { Accept: "image/png,image/jpeg,image/webp" } });
    if (!response.ok) return { ok: false, response: badRequest(`The image URL answered ${response.status}.`, 404) };
    const type = (response.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
    const mime = type === "image/jpg" ? "image/jpeg" : type;
    if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return { ok: false, response: badRequest(`The URL is not a png, jpeg or webp image (${type || "unknown type"}).`) };
    const length = Number(response.headers.get("content-length") ?? "0");
    if (length > MAX_IMAGE_BYTES) return { ok: false, response: badRequest("The image is larger than 8 MB.") };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { ok: false, response: badRequest("The image is larger than 8 MB.") };
    if (bytes.byteLength === 0) return { ok: false, response: badRequest("The image URL returned no data.") };
    return { ok: true, dataUrl: `data:${mime};base64,${Buffer.from(bytes).toString("base64")}` };
  } catch {
    return { ok: false, response: badRequest("The image URL could not be fetched.", 404) };
  } finally {
    clearTimeout(timer);
  }
}

function outputText(payload: unknown): string | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.output)) return undefined;
  for (const item of payload.output) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (isRecord(part) && part.type === "output_text" && typeof part.text === "string") return part.text;
    }
  }
  return undefined;
}

export async function POST(request: Request): Promise<Response> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return badRequest("Request body could not be read.");
  }
  if (raw.length > MAX_BODY_CHARS) return badRequest("The image is larger than 8 MB.", 413);
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return badRequest("Request body must be valid JSON.");
  }
  if (!isRecord(body)) return badRequest("Request body must be an object.");
  const input: ReadRequest = {
    ...(typeof body.image === "string" ? { image: body.image } : {}),
    ...(typeof body.url === "string" ? { url: body.url } : {}),
  };
  if (!input.image && !input.url) return badRequest("Give image (a data: URL) or url.");
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return unavailable("The plan reader is not configured.");

  let dataUrl: string;
  if (input.image) {
    if (!dataUrlMime(input.image)) return badRequest("image must be a png, jpeg or webp data: URL.");
    if (dataUrlBytes(input.image) > MAX_IMAGE_BYTES) return badRequest("The image is larger than 8 MB.", 413);
    dataUrl = input.image;
  } else {
    const fetched = await fetchImage(input.url as string);
    if (!fetched.ok) return fetched.response;
    dataUrl = fetched.dataUrl;
  }

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.PLAN_READER_MODEL ?? process.env.ASSISTANT_MODEL ?? "gpt-5.6-sol",
        instructions: PLAN_READER_INSTRUCTIONS,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: "Extract every room of this floor plan." },
            { type: "input_image", image_url: dataUrl, detail: "high" },
          ],
        }],
        reasoning: { effort: process.env.PLAN_READER_REASONING_EFFORT ?? "medium" },
        text: { format: { type: "json_schema", name: "floor_plan", schema: PLAN_JSON_SCHEMA, strict: true } },
        max_output_tokens: 8_000,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok) {
      if (upstream.status === 429) return unavailable("The plan reader is rate-limited. Retry in a moment.");
      if (upstream.status === 401 || upstream.status === 403) return unavailable("The plan reader credentials were rejected.");
      return unavailable(`The plan reader failed (${upstream.status}).`, 502);
    }
    const payload: unknown = await upstream.json();
    const text = outputText(payload);
    if (!text) return unavailable("The plan reader returned no reading. Try a clearer image.", 502);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return unavailable("The plan reader returned an unreadable answer.", 502);
    }
    const plan = asParsedPlan(parsed);
    if (!plan) return unavailable("The plan reader returned an unexpected shape.", 502);
    if (plan.rooms.length === 0) return badRequest("No rooms were found in this image. Use a 2D floor plan with room names.", 422);
    return Response.json({ ok: true, plan, ms: Date.now() - started });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return unavailable("The plan reader timed out. Try a smaller image.", 504);
    return unavailable("The plan reader could not be reached.");
  } finally {
    clearTimeout(timer);
  }
}
