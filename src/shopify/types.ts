import type { CatalogItem } from "../engine/types";

export type ShopifyError = "unavailable" | "not_found" | "invalid";

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: ShopifyError; detail: string };

export interface CatalogVariant {
  id: string;
  colorway: string;
  price: number;
  available: boolean;
}

export interface CatalogProduct extends CatalogItem {
  handle: string;
  price: number;
  variants: CatalogVariant[];
  imageUrl?: string;
}

export interface ShopifyCartLine {
  id: string;
  variantId: string;
  handle: string;
  title: string;
  colorway: string;
  quantity: number;
  unitUsd: number;
  lineUsd: number;
  itemId?: string;
}

export interface ShopifyCart {
  id: string;
  /** Storefront checkoutUrl when known (live client); absent for the local client. */
  checkoutUrl?: string;
  lines: ShopifyCartLine[];
  subtotalUsd: number;
  count: number;
}

export interface CartAddLine {
  variantId: string;
  quantity: number;
  itemId?: string;
}

/** Browser/local commerce boundary shared by all tool handlers. */
export interface ShopifyClient {
  readonly unavailable: boolean;
  search(q: string): Promise<Result<CatalogProduct[]>>;
  product(handle: string): Promise<Result<CatalogProduct>>;
  cartGet(): Promise<Result<ShopifyCart>>;
  cartAdd(lines: CartAddLine[]): Promise<Result<ShopifyCart>>;
  cartRemove(lineIds: string[]): Promise<Result<ShopifyCart>>;
  cartSetQuantity(lineId: string, qty: number): Promise<Result<ShopifyCart>>;
  checkoutLink(): Promise<Result<{ checkoutUrl: string; storePassword: string }>>;
}
