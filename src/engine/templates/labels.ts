import type { TemplateId } from "../types";

const labels: Record<TemplateId, string> = {
  studio: "Studio",
  "1br": "1 bedroom",
  "2br": "2 bedrooms",
  "3br": "3 bedrooms",
  "4br": "4 bedrooms",
  "5br": "5 bedrooms",
  loft: "Loft",
};

const shortLabels: Record<TemplateId, string> = {
  studio: "Studio",
  "1br": "1BR",
  "2br": "2BR",
  "3br": "3BR",
  "4br": "4BR",
  "5br": "5BR",
  loft: "Loft",
};

/** Human-readable floor-plan name for confirmation and chooser copy. */
export function templateLabel(id: TemplateId): string {
  return labels[id];
}

/** Compact floor-plan name for receipts and constrained controls. */
export function templateShortLabel(id: TemplateId): string {
  return shortLabels[id];
}
