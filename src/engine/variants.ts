import type { CatalogSource } from "./describe";
import { truncateList } from "./describe";
import type { Furniture, Variant } from "./types";

/** Compact differences between two saved room layouts. */
export interface VariantDiff {
  only_left: string[];
  only_right: string[];
  moved: string[];
  changed_colorway: string[];
  more?: number;
}

function itemName(item: Furniture, catalog: CatalogSource): string {
  const cat = Array.isArray(catalog) ? catalog.find((candidate) => candidate.id === item.catalogId) : catalog.byId(item.catalogId);
  return cat?.name ?? item.catalogId;
}

function groups(variant: Variant, catalog: CatalogSource): Map<string, Furniture[]> {
  const result = new Map<string, Furniture[]>();
  for (const item of variant.furniture) {
    const name = itemName(item, catalog);
    const current = result.get(name) ?? [];
    current.push(item);
    result.set(name, current);
  }
  for (const items of result.values()) items.sort((a, b) => a.id.localeCompare(b.id));
  return result;
}

function counted(name: string, count: number): string {
  return count > 1 ? `${name} ×${count}` : name;
}

function stateKey(item: Furniture): string {
  return `${item.pos.x},${item.pos.y},${item.rotation},${item.colorway}`;
}

function pairItems(left: Furniture[], right: Furniture[]): Array<[Furniture, Furniture]> {
  const unmatchedLeft = [...left];
  const unmatchedRight = [...right];
  const pairs: Array<[Furniture, Furniture]> = [];

  for (let index = unmatchedLeft.length - 1; index >= 0; index -= 1) {
    const item = unmatchedLeft[index] as Furniture;
    const rightIndex = unmatchedRight.findIndex((candidate) => candidate.id === item.id);
    if (rightIndex < 0) continue;
    pairs.push([item, unmatchedRight[rightIndex] as Furniture]);
    unmatchedLeft.splice(index, 1);
    unmatchedRight.splice(rightIndex, 1);
  }
  for (let index = unmatchedLeft.length - 1; index >= 0; index -= 1) {
    const item = unmatchedLeft[index] as Furniture;
    const rightIndex = unmatchedRight.findIndex((candidate) => stateKey(candidate) === stateKey(item));
    if (rightIndex < 0) continue;
    pairs.push([item, unmatchedRight[rightIndex] as Furniture]);
    unmatchedLeft.splice(index, 1);
    unmatchedRight.splice(rightIndex, 1);
  }
  const count = Math.min(unmatchedLeft.length, unmatchedRight.length);
  for (let index = 0; index < count; index += 1) pairs.push([unmatchedLeft[index] as Furniture, unmatchedRight[index] as Furniture]);
  return pairs;
}

function positionsDiffer(left: Furniture, right: Furniture): boolean {
  return left.pos.x !== right.pos.x || left.pos.y !== right.pos.y || left.rotation !== right.rotation;
}

function capLists(diff: Omit<VariantDiff, "more">): VariantDiff {
  const left = truncateList(diff.only_left, 8);
  const right = truncateList(diff.only_right, 8);
  const moved = truncateList(diff.moved, 8);
  const colors = truncateList(diff.changed_colorway, 8);
  const more = left.more + right.more + moved.more + colors.more;
  return {
    only_left: left.items,
    only_right: right.items,
    moved: moved.items,
    changed_colorway: colors.items,
    ...(more > 0 ? { more } : {}),
  };
}

/** Diffs two variants by display name while preserving duplicate counts. */
export function diffVariants(a: Variant, b: Variant, catalog: CatalogSource): VariantDiff {
  const leftGroups = groups(a, catalog);
  const rightGroups = groups(b, catalog);
  const names = [...new Set([...leftGroups.keys(), ...rightGroups.keys()])].sort((left, right) => left.localeCompare(right));
  const onlyLeft: string[] = [];
  const onlyRight: string[] = [];
  const moved: string[] = [];
  const colors: string[] = [];

  for (const name of names) {
    const left = leftGroups.get(name) ?? [];
    const right = rightGroups.get(name) ?? [];
    if (left.length > right.length) onlyLeft.push(counted(name, left.length - right.length));
    if (right.length > left.length) onlyRight.push(counted(name, right.length - left.length));
    const pairs = pairItems(left, right);
    const movedCount = pairs.filter(([leftItem, rightItem]) => positionsDiffer(leftItem, rightItem)).length;
    const colorCount = pairs.filter(([leftItem, rightItem]) => leftItem.colorway !== rightItem.colorway).length;
    if (movedCount > 0) moved.push(counted(name, movedCount));
    if (colorCount > 0) colors.push(counted(name, colorCount));
  }

  return capLists({ only_left: onlyLeft, only_right: onlyRight, moved, changed_colorway: colors });
}

/** Formats the save_variant result's compact nested summary. */
export function variantSummary(variant: Variant): { name: string; items: number } {
  return { name: variant.name, items: variant.furniture.length };
}
