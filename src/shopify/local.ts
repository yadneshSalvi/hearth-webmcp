import { createCatalog } from "../engine/catalog";
import type { CatalogItem } from "../engine/types";
import type {
  CartAddLine, CatalogProduct, Result, ShopifyCart, ShopifyCartLine, ShopifyClient,
} from "./types";

const LOCAL_CHECKOUT_URL = "https://hearth-studio.myshopify.com/cart";

function localVariantId(handle: string, colorway: string): string {
  return `gid://shopify/ProductVariant/local-${handle}-${colorway}`;
}

function cloneCart(cart: ShopifyCart): ShopifyCart {
  return structuredClone(cart);
}

function asProduct(item: CatalogItem): CatalogProduct {
  const price = item.price ?? 0;
  return {
    ...structuredClone(item),
    handle: item.id,
    price,
    variants: item.colorways.map(({ id }) => ({
      id: item.shopify?.variantIds[id] ?? localVariantId(item.id, id),
      colorway: id,
      price,
      available: true,
    })),
  };
}

/** Deterministic, in-memory Shopify substitute used offline and in tests. */
export function createLocalShopify(catalogItems: CatalogItem[]): ShopifyClient {
  const catalog = createCatalog(catalogItems);
  const products = catalog.all().map(asProduct);
  const variants = new Map(products.flatMap((product) => product.variants.map((variant) => [
    variant.id,
    { product, variant },
  ] as const)));
  let lineSequence = 0;
  const cart: ShopifyCart = { id: "local-cart", lines: [], subtotalUsd: 0, count: 0 };

  const recompute = (): ShopifyCart => {
    cart.subtotalUsd = cart.lines.reduce((total, line) => total + line.lineUsd, 0);
    cart.count = cart.lines.reduce((total, line) => total + line.quantity, 0);
    return cloneCart(cart);
  };

  const addLine = (input: CartAddLine): Result<ShopifyCartLine> => {
    const found = variants.get(input.variantId);
    if (!found) return { ok: false, error: "not_found", detail: `Variant ${input.variantId} was not found` };
    if (!Number.isInteger(input.quantity) || input.quantity < 1) {
      return { ok: false, error: "invalid", detail: "Cart quantity must be a positive integer" };
    }
    lineSequence += 1;
    const line: ShopifyCartLine = {
      id: `local-line-${lineSequence}`,
      variantId: found.variant.id,
      handle: found.product.handle,
      title: found.product.name,
      colorway: found.variant.colorway,
      quantity: input.quantity,
      unitUsd: found.variant.price,
      lineUsd: found.variant.price * input.quantity,
      ...(input.itemId ? { itemId: input.itemId } : {}),
    };
    cart.lines.push(line);
    return { ok: true, value: line };
  };

  return {
    unavailable: false,
    async search(q) {
      const terms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
      const matches = products.filter((product) => {
        if (terms.length === 0) return true;
        const haystack = [
          product.id, product.name, product.category, product.description ?? "",
          ...product.styleTags, ...product.colorways.flatMap((colorway) => [colorway.id, colorway.name]),
        ].join(" ").toLowerCase();
        return terms.every((term) => haystack.includes(term));
      });
      return { ok: true, value: structuredClone(matches) };
    },
    async product(handle) {
      const found = catalog.resolveProduct(handle);
      const product = found && products.find((candidate) => candidate.id === found.id);
      return product
        ? { ok: true, value: structuredClone(product) }
        : { ok: false, error: "not_found", detail: `Product ${handle} was not found` };
    },
    async cartGet() {
      return { ok: true, value: recompute() };
    },
    async cartAdd(lines) {
      for (const line of lines) {
        if (!variants.has(line.variantId)) {
          return { ok: false, error: "not_found", detail: `Variant ${line.variantId} was not found` };
        }
        if (!Number.isInteger(line.quantity) || line.quantity < 1) {
          return { ok: false, error: "invalid", detail: "Cart quantity must be a positive integer" };
        }
      }
      for (const line of lines) {
        const result = addLine(line);
        if (!result.ok) return result;
      }
      return { ok: true, value: recompute() };
    },
    async cartRemove(lineIds) {
      const requested = new Set(lineIds);
      if ([...requested].some((id) => !cart.lines.some((line) => line.id === id))) {
        return { ok: false, error: "not_found", detail: "One or more cart lines were not found" };
      }
      cart.lines = cart.lines.filter((line) => !requested.has(line.id));
      return { ok: true, value: recompute() };
    },
    async cartSetQuantity(lineId, qty) {
      if (!Number.isInteger(qty) || qty < 0) {
        return { ok: false, error: "invalid", detail: "Cart quantity must be a non-negative integer" };
      }
      const line = cart.lines.find((candidate) => candidate.id === lineId);
      if (!line) return { ok: false, error: "not_found", detail: `Cart line ${lineId} was not found` };
      if (qty === 0) cart.lines = cart.lines.filter((candidate) => candidate.id !== lineId);
      else {
        line.quantity = qty;
        line.lineUsd = line.unitUsd * qty;
      }
      return { ok: true, value: recompute() };
    },
    async cartUpdateLine(lineId, variantId, quantity) {
      if (!Number.isInteger(quantity) || quantity < 1) {
        return { ok: false, error: "invalid", detail: "Cart quantity must be a positive integer" };
      }
      const line = cart.lines.find((candidate) => candidate.id === lineId);
      if (!line) return { ok: false, error: "not_found", detail: `Cart line ${lineId} was not found` };
      const found = variants.get(variantId);
      if (!found) return { ok: false, error: "not_found", detail: `Variant ${variantId} was not found` };
      line.variantId = found.variant.id;
      line.handle = found.product.handle;
      line.title = found.product.name;
      line.colorway = found.variant.colorway;
      line.quantity = quantity;
      line.unitUsd = found.variant.price;
      line.lineUsd = found.variant.price * quantity;
      return { ok: true, value: recompute() };
    },
    async checkoutLink() {
      return { ok: true, value: { checkoutUrl: LOCAL_CHECKOUT_URL, storePassword: "" } };
    },
  };
}
