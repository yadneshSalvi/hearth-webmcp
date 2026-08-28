export const PRODUCT_FIELDS = `
  fragment ProductFields on Product {
    id
    handle
    title
    productType
    tags
    vendor
    description(truncateAt: 200)
    priceRange { minVariantPrice { amount currencyCode } }
    featuredImage { url(transform: { maxWidth: 800 }) altText }
    variants(first: 12) {
      nodes {
        id
        title
        availableForSale
        price { amount currencyCode }
        selectedOptions { name value }
      }
    }
    dims: metafield(namespace: "hearth", key: "dims_cm") { value }
    colorways: metafield(namespace: "hearth", key: "colorways") { value }
    clearance: metafield(namespace: "hearth", key: "clearance_front_cm") { value }
    seats: metafield(namespace: "hearth", key: "seat_count") { value }
    glb: metafield(namespace: "hearth", key: "glb_url") { value }
    againstWall: metafield(namespace: "hearth", key: "against_wall") { value }
  }
`;

export const SEARCH_PRODUCTS_QUERY = `
  ${PRODUCT_FIELDS}
  query Search($q: String!, $first: Int!) {
    products(first: $first, query: $q, sortKey: RELEVANCE) {
      nodes { ...ProductFields }
    }
  }
`;

export const PRODUCT_BY_HANDLE_QUERY = `
  ${PRODUCT_FIELDS}
  query Product($handle: String!) {
    product(handle: $handle) { ...ProductFields }
  }
`;

export const CART_FIELDS = `
  fragment CartFields on Cart {
    id
    checkoutUrl
    totalQuantity
    cost { subtotalAmount { amount currencyCode } }
    lines(first: 50) {
      nodes {
        id
        quantity
        attributes { key value }
        cost { totalAmount { amount currencyCode } }
        merchandise {
          ... on ProductVariant {
            id
            title
            price { amount currencyCode }
            selectedOptions { name value }
            product { handle title }
          }
        }
      }
    }
  }
`;

export const CART_QUERY = `
  ${CART_FIELDS}
  query Cart($id: ID!) { cart(id: $id) { ...CartFields } }
`;

export const CART_CREATE_MUTATION = `
  ${CART_FIELDS}
  mutation CartCreate($lines: [CartLineInput!]) {
    cartCreate(input: { lines: $lines }) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

export const CART_ADD_MUTATION = `
  ${CART_FIELDS}
  mutation CartAdd($cartId: ID!, $lines: [CartLineInput!]!) {
    cartLinesAdd(cartId: $cartId, lines: $lines) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

export const CART_REMOVE_MUTATION = `
  ${CART_FIELDS}
  mutation CartRemove($cartId: ID!, $lineIds: [ID!]!) {
    cartLinesRemove(cartId: $cartId, lineIds: $lineIds) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

export const CART_UPDATE_MUTATION = `
  ${CART_FIELDS}
  mutation CartUpdate($cartId: ID!, $lines: [CartLineUpdateInput!]!) {
    cartLinesUpdate(cartId: $cartId, lines: $lines) {
      cart { ...CartFields }
      userErrors { field message }
    }
  }
`;

export interface CatalogSearchFilters {
  q?: string;
  category?: string;
  maxPrice?: number;
  style?: string;
  colorway?: string;
}

/** Escapes a value for Shopify's search grammar and always returns a quoted atom. */
export function quoteShopifySearchValue(value: string): string {
  const escaped = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .trim();
  return `"${escaped}"`;
}

/** Builds only known search clauses; dimensions are deliberately filtered after mapping. */
export function buildStorefrontProductQuery(filters: CatalogSearchFilters): string {
  const clauses: string[] = [];
  const q = filters.q?.trim();
  if (q) clauses.push(quoteShopifySearchValue(q));
  if (filters.category?.trim()) {
    clauses.push(`product_type:${quoteShopifySearchValue(filters.category)}`);
  }
  if (Number.isFinite(filters.maxPrice) && (filters.maxPrice as number) >= 0) {
    clauses.push(`variants.price:<=${filters.maxPrice}`);
  }
  if (filters.style?.trim()) {
    clauses.push(`tag:${quoteShopifySearchValue(filters.style)}`);
  }
  if (filters.colorway?.trim()) {
    const option = filters.colorway.replace(/-/g, " ");
    clauses.push(`variant_title:${quoteShopifySearchValue(option)}`);
  }
  return clauses.join(" AND ");
}
