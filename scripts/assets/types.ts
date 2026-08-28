export type LicenseId = "CC0";

export type SourceKey =
  | "kenney-furniture"
  | "kaykit-furniture"
  | "quaternius-furniture"
  | "quaternius-interior"
  | "isa-house-plants"
  | "creative-household";

export type RotationY = 0 | 90 | 180 | 270;

export interface SourceCollection {
  key: SourceKey;
  label: string;
  author: string;
  license: LicenseId;
  licenseUrl: string;
  pageUrl: string;
  archive?: {
    url: string;
    fileName: string;
    extractDir: string;
    sha256?: string;
  };
}

export interface PolyPizzaModel {
  id: string;
  name: string;
  sourceKey: Exclude<SourceKey, "kenney-furniture" | "kaykit-furniture">;
  pageUrl: string;
  downloadUrl: string;
  bytes: number;
  sha256?: string;
}

export interface AssetMapping {
  id: string;
  sourceKey: SourceKey;
  sourceModel: string;
  sourceFile: string;
  rotationY: RotationY;
  orientationConfidence: "high" | "medium";
  polyPizzaId?: string;
}

export interface AssetManifestRow {
  id: string;
  source: string;
  sourceFile: string;
  license: LicenseId;
  scale: number;
  rotationY: RotationY;
  bbox_cm: { w: number; d: number; h: number };
  materials: string[];
  bytes: number;
}
