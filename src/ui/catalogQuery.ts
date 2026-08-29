/**
 * The catalog panel runs the *same* ranked search the agent's `search_catalog` tool runs
 * (`src/engine/fit.ts`). That tool caps a page at 6 rows for its output budget, so the panel simply
 * pages through the engine by shrinking the pool — identical filters, identical ranking, no
 * second implementation of "what matches".
 */
import { searchCatalog } from "../engine/fit";
import { CATEGORIES } from "../engine/types";
import type { CatalogItem, Category } from "../engine/types";

const PAGE = 6;
const MAX_RESULTS = 120;

export interface CatalogFilters {
  query: string;
  category?: Category;
  style?: string;
  maxPriceUsd?: number;
}

export interface CatalogGroup {
  category: Category;
  items: CatalogItem[];
}

/** Every product matching the filters, in the engine's ranking order. */
export function catalogResults(catalog: CatalogItem[], filters: CatalogFilters): CatalogItem[] {
  const query = filters.query.trim();
  const search = {
    limit: PAGE,
    ...(query ? { query } : {}),
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.style ? { style: filters.style } : {}),
    ...(filters.maxPriceUsd !== undefined ? { maxPriceUsd: filters.maxPriceUsd } : {}),
  };
  const found: CatalogItem[] = [];
  let pool = catalog;
  while (found.length < MAX_RESULTS) {
    const page = searchCatalog(pool, search);
    if (page.length === 0) break;
    found.push(...page);
    const taken = new Set(page.map((item) => item.id));
    pool = pool.filter((item) => !taken.has(item.id));
    if (page.length < PAGE) break;
  }
  return found;
}

/** Groups results by category in catalog order so the "all" view reads as a composed shelf. */
export function catalogGroups(items: CatalogItem[]): CatalogGroup[] {
  const byCategory = new Map<Category, CatalogItem[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category);
    if (bucket) bucket.push(item);
    else byCategory.set(item.category, [item]);
  }
  return CATEGORIES.filter((category) => byCategory.has(category)).map((category) => ({
    category,
    items: byCategory.get(category) ?? [],
  }));
}

const CATEGORY_LABELS: Record<Category, string> = {
  sofa: "Sofas",
  armchair: "Armchairs",
  bed: "Beds",
  wardrobe: "Wardrobes",
  table: "Tables",
  desk: "Desks",
  chair: "Chairs",
  shelf: "Shelving",
  "tv-unit": "Media",
  rug: "Rugs",
  "floor-lamp": "Floor lamps",
  "table-lamp": "Table lamps",
  plant: "Plants",
  decor: "Decor",
};

/** "Floor lamps" — the plural chip and group label for a category. */
export function categoryLabel(category: Category): string {
  return CATEGORY_LABELS[category];
}

/** Unique style tags present in the catalog, alphabetically. */
export function styleTags(catalog: CatalogItem[]): string[] {
  return [...new Set(catalog.flatMap((item) => item.styleTags))].sort((a, b) => a.localeCompare(b));
}
