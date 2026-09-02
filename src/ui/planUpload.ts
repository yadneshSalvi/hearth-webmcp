"use client";
/**
 * Turning a file the human dropped into the `UploadedPlan` the studio keeps for `import_floor_plan`
 * (TOOLS.md §40): type and size checks, a data: URL, and the image's pixel size for the preview.
 */
import { hearthStore } from "../state/store";
import type { UploadedPlan } from "../state/types";
import { IMAGE_MIME, MAX_IMAGE_BYTES } from "../floorplan/schema";

export type PlanUploadResult = { ok: true; plan: UploadedPlan } | { ok: false; detail: string };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function measure(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("The image could not be decoded."));
    image.src = dataUrl;
  });
}

/** The first image file in a drop or paste, if any. */
export function imageFileFrom(transfer: DataTransfer | null): File | undefined {
  if (!transfer) return undefined;
  for (const file of Array.from(transfer.files)) if (file.type.startsWith("image/")) return file;
  return undefined;
}

/** Validates and decodes a floor-plan image; does not touch the store. */
export async function readPlanFile(file: File): Promise<PlanUploadResult> {
  const mime = file.type === "image/jpg" ? "image/jpeg" : file.type;
  if (!IMAGE_MIME.includes(mime as (typeof IMAGE_MIME)[number])) return { ok: false, detail: "Use a png, jpeg or webp image of the plan." };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, detail: "The image is larger than 8 MB." };
  try {
    const dataUrl = await readAsDataUrl(file);
    const size = await measure(dataUrl);
    if (size.width < 200 || size.height < 200) return { ok: false, detail: "The image is too small to read (under 200 px)." };
    return { ok: true, plan: { name: file.name, dataUrl, width: size.width, height: size.height, at: Date.now() } };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "The file could not be read." };
  }
}

/** Stores the plan so the import sheet and the agent's tool can both reach it. */
export function keepUploadedPlan(plan: UploadedPlan): void {
  hearthStore.getState().setUi({ uploadedPlan: plan });
}
