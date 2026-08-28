import { pathToFileURL } from "node:url";
import { catalogSource } from "../../data/catalog.source";
import {
  HEARTH_PUBLICATION_ID,
  METAFIELD_DEFINITIONS,
  adminPreflight,
  definitionStatuses,
  listAdminProducts,
  storefrontProducts,
  storefrontShopName,
} from "./operations";

export interface VerifyReport {
  adminShop: string;
  storefrontShop: string;
  publications: number;
  scopes: number;
  definitions: number;
  adminHearthProducts: number;
  adminOtherProducts: number;
  storefrontProducts: number;
  sampleHandles: string[];
}

function isHearth(tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === "hearth");
}

function hasCoreMetafields(product: Awaited<ReturnType<typeof storefrontProducts>>[number]): boolean {
  return Boolean(product.dims?.value && product.colorways?.value && product.clearance?.value && product.glb?.value);
}

export async function runVerify(options: { print?: boolean } = {}): Promise<VerifyReport> {
  const [preflight, definitions, adminProducts, storefrontName, liveProducts] = await Promise.all([
    adminPreflight(),
    definitionStatuses(),
    listAdminProducts(),
    storefrontShopName(),
    storefrontProducts(),
  ]);
  if (preflight.shopName !== storefrontName) {
    throw new Error(`Admin shop ${preflight.shopName} does not match Storefront shop ${storefrontName}`);
  }
  if (!preflight.publications.some(({ id }) => id === HEARTH_PUBLICATION_ID)) {
    throw new Error(`Hearth publication ${HEARTH_PUBLICATION_ID} is missing`);
  }
  for (const requiredScope of ["write_products", "read_publications"]) {
    if (!preflight.scopes.includes(requiredScope)) throw new Error(`Admin token is missing ${requiredScope}`);
  }
  for (const expected of METAFIELD_DEFINITIONS) {
    const found = definitions.find(({ key }) => key === expected.key);
    if (!found || found.type !== expected.type || found.storefront !== "PUBLIC_READ") {
      throw new Error(`Metafield definition hearth.${expected.key} is missing or incorrect`);
    }
  }

  const expectedHandles = new Set(catalogSource.map(({ id }) => id));
  const liveHandles = new Set(liveProducts.map(({ handle }) => handle));
  const missing = [...expectedHandles].filter((handle) => !liveHandles.has(handle));
  if (missing.length > 0) throw new Error(`Storefront is missing ${missing.length} seeded handles: ${missing.slice(0, 5).join(", ")}`);
  const invalidMetafields = liveProducts.filter(({ handle }) => expectedHandles.has(handle)).filter((product) => !hasCoreMetafields(product));
  if (invalidMetafields.length > 0) {
    throw new Error(`Storefront products missing core metafields: ${invalidMetafields.slice(0, 5).map(({ handle }) => handle).join(", ")}`);
  }
  for (const item of catalogSource) {
    const live = liveProducts.find(({ handle }) => handle === item.id);
    if (!live || live.variants.nodes.length !== item.colorways.length) {
      throw new Error(`${item.id} does not expose all expected Storefront variants`);
    }
    const variantNames = new Set(live.variants.nodes.flatMap((variant) => variant.selectedOptions
      .filter(({ name }) => name.toLowerCase() === "colorway")
      .map(({ value }) => value.toLowerCase())));
    if (!item.colorways.every(({ name }) => variantNames.has(name.toLowerCase()))) {
      throw new Error(`${item.id} has incorrect Storefront colorway options`);
    }
  }

  const hearthProducts = adminProducts.filter(({ tags }) => isHearth(tags));
  const otherProducts = adminProducts.filter(({ tags }) => !isHearth(tags));
  const inactiveProducts = hearthProducts.filter(({ status }) => status !== "ACTIVE");
  const report: VerifyReport = {
    adminShop: preflight.shopName,
    storefrontShop: storefrontName,
    publications: preflight.publications.length,
    scopes: preflight.scopes.length,
    definitions: definitions.length,
    adminHearthProducts: hearthProducts.length,
    adminOtherProducts: otherProducts.length,
    storefrontProducts: liveProducts.length,
    sampleHandles: liveProducts.map(({ handle }) => handle).sort().slice(0, 5),
  };
  if (otherProducts.length > 0) throw new Error(`Admin still contains ${otherProducts.length} non-hearth products`);
  if (inactiveProducts.length > 0) throw new Error(`Admin contains ${inactiveProducts.length} non-active hearth products`);
  if (hearthProducts.length !== catalogSource.length) {
    throw new Error(`Admin has ${hearthProducts.length} hearth products; expected ${catalogSource.length}`);
  }

  if (options.print !== false) {
    console.table([
      { check: "Shop", admin: report.adminShop, storefront: report.storefrontShop },
      { check: "Publications", admin: report.publications, storefront: `Hearth ${HEARTH_PUBLICATION_ID.split("/").at(-1)}` },
      { check: "Scopes", admin: report.scopes, storefront: "—" },
      { check: "Metafields", admin: `${report.definitions}/8 PUBLIC_READ`, storefront: "sample readable" },
      { check: "Products", admin: `${report.adminHearthProducts} hearth / ${report.adminOtherProducts} other`, storefront: report.storefrontProducts },
    ]);
    console.log(`Storefront sample: ${report.sampleHandles.join(", ")}`);
  }
  return report;
}

async function main(): Promise<void> {
  await runVerify({ print: true });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Shopify verification failed");
    process.exitCode = 1;
  });
}
