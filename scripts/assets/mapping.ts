import { polyPizzaModels } from "./sources";
import type { AssetMapping, RotationY, SourceKey } from "./types";

function archive(
  id: string,
  sourceKey: "kenney-furniture" | "kaykit-furniture",
  sourceModel: string,
  sourceFile: string,
  rotationY: RotationY = 0,
  orientationConfidence: AssetMapping["orientationConfidence"] = "high",
): AssetMapping {
  return { id, sourceKey, sourceModel, sourceFile, rotationY, orientationConfidence };
}

function kenney(id: string, model: string, rotationY: RotationY = 0): AssetMapping {
  return archive(id, "kenney-furniture", model, `Models/GLTF format/${model}.glb`, rotationY);
}

function kaykit(id: string, model: string, rotationY: RotationY = 0): AssetMapping {
  const sourceFile = `KayKit-Furniture-Bits-1.0-main/addons/kaykit_furniture_bits/Assets/gltf/${model}.gltf`;
  return archive(id, "kaykit-furniture", model, sourceFile, rotationY);
}

function pizza(id: string, polyPizzaId: string, rotationY: RotationY = 0): AssetMapping {
  const model = polyPizzaModels[polyPizzaId];
  if (!model) throw new Error(`Missing poly.pizza metadata for ${polyPizzaId}`);
  return {
    id,
    sourceKey: model.sourceKey,
    sourceModel: `${model.name} (${polyPizzaId})`,
    sourceFile: model.downloadUrl,
    rotationY,
    orientationConfidence: "medium",
    polyPizzaId,
  };
}

export const assetMappings: readonly AssetMapping[] = [
  pizza("sofa-endre", "l84E3NzGSF", 180),
  pizza("sofa-fjord", "vuo7KBehok", 180),
  pizza("sofa-liva", "mWgQ94zhDZ", 180),
  pizza("sofa-maren", "fFfoi1LNKY", 180),
  pizza("sofa-svale", "l84E3NzGSF", 180),

  pizza("armchair-nook", "myd1WSucAz", 180),
  pizza("armchair-elsa", "myd1WSucAz", 180),
  kaykit("armchair-kyst", "armchair_pillows", 180),
  pizza("armchair-ro", "myd1WSucAz", 180),
  pizza("armchair-tuva", "Gnst85J3vK", 180),

  kenney("bed-birk", "bedDouble", 180),
  pizza("bed-ask", "BuRay4fVFr"),
  kenney("bed-viggo", "bedDouble", 180),
  pizza("bed-lyng", "rXo5Rkl5LC", 180),
  kaykit("bed-siv", "bed_double_A", 180),

  kenney("wardrobe-hald", "bookcaseClosedWide"),
  pizza("wardrobe-skive", "ND4Z53Ne4C", 180),
  kenney("wardrobe-nord", "bookcaseClosedWide"),
  pizza("wardrobe-eira", "tACDGJ4CGW", 180),
  kenney("wardrobe-tor", "bookcaseClosedWide"),

  kenney("table-rove", "table"),
  kaykit("table-ake", "table_medium_long"),
  pizza("table-elm", "gQFkiM8PlM", 90),
  pizza("table-rund", "oEArSZykyi"),
  kaykit("table-petit", "table_small"),

  kenney("desk-aalto", "desk"),
  pizza("desk-soren", "V86Go2rlnq"),
  pizza("desk-kari", "V86Go2rlnq"),
  kenney("desk-linn", "desk"),
  kenney("desk-varde", "desk"),

  kaykit("chair-finn", "chair_A", 180),
  kaykit("chair-ida", "chair_A_wood", 180),
  kaykit("chair-lars", "chair_B", 180),
  kaykit("chair-mysa", "chair_C", 180),
  kenney("chair-olve", "chairDesk", 180),

  pizza("shelf-kant", "tACDGJ4CGW", 180),
  pizza("shelf-lund", "tACDGJ4CGW", 180),
  pizza("shelf-rune", "tACDGJ4CGW", 180),
  pizza("shelf-saga", "tACDGJ4CGW", 180),
  pizza("shelf-vik", "tACDGJ4CGW", 180),

  kaykit("tv-unit-linje", "shelf_B_large", 180),
  kenney("tv-unit-form", "cabinetTelevisionDoors", 180),
  kenney("tv-unit-nova", "televisionModern", 180),
  pizza("tv-unit-sund", "G1H0wnCHQf", 180),
  pizza("tv-unit-ved", "G1H0wnCHQf", 180),

  kenney("rug-loop", "rugRectangle", 90),
  kenney("rug-flette", "rugRounded", 90),
  pizza("rug-mark", "7H5qKjuxVY"),
  pizza("rug-siv", "7H5qKjuxVY"),
  pizza("rug-ull", "7H5qKjuxVY"),

  pizza("lamp-glow", "eBQtooeh43"),
  kenney("floor-lamp-arc", "lampSquareFloor"),
  pizza("floor-lamp-sol", "eBQtooeh43"),
  pizza("floor-lamp-lyst", "eBQtooeh43"),
  pizza("floor-lamp-havn", "9L6lLUl9sD"),

  kenney("table-lamp-alva", "lampSquareTable"),
  kenney("table-lamp-natt", "lampSquareTable"),
  pizza("table-lamp-lune", "9Mo3JruPHY"),
  pizza("table-lamp-ember", "1nKtMmYxLT"),
  kaykit("table-lamp-moss", "lamp_table"),

  pizza("plant-fern", "0uJQPU1oAK"),
  pizza("plant-fig", "AhEloSUxKH"),
  pizza("plant-pilea", "JVoJ2itVzh"),
  pizza("plant-palm", "VtJh4Irl4w"),
  pizza("plant-ivy", "kaZVETMphs"),

  pizza("decor-bowl", "G6FktIrBkj"),
  pizza("decor-vase", "XGe3q5zQ5s"),
  kenney("decor-tray", "rugDoormat"),
  pizza("decor-sculpture", "fLy8KmmD1t"),
  pizza("decor-basket", "PPkR5hMOJp"),
] as const;

export function mappingById(): ReadonlyMap<string, AssetMapping> {
  return new Map(assetMappings.map((mapping) => [mapping.id, mapping]));
}

export function sourceIdentity(mapping: AssetMapping): string {
  return `${mapping.sourceKey}:${mapping.sourceModel}`;
}

export function countBySource(mappings: readonly AssetMapping[] = assetMappings): Record<SourceKey, number> {
  const counts = Object.fromEntries(
    Object.keys({
      "kenney-furniture": 0,
      "kaykit-furniture": 0,
      "quaternius-furniture": 0,
      "quaternius-interior": 0,
      "isa-house-plants": 0,
      "creative-household": 0,
    }).map((key) => [key, 0]),
  ) as Record<SourceKey, number>;
  for (const mapping of mappings) counts[mapping.sourceKey] += 1;
  return counts;
}
