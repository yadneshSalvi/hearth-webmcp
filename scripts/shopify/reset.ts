import { pathToFileURL } from "node:url";
import { confirmDestructive } from "./confirm";
import { deleteProducts, listAdminProducts } from "./operations";

function isHearth(tags: string[]): boolean {
  return tags.some((tag) => tag.toLowerCase() === "hearth");
}

export async function resetHearthProducts(args: string[] = process.argv.slice(2)): Promise<number> {
  const products = (await listAdminProducts()).filter(({ tags }) => isHearth(tags));
  if (products.length === 0) {
    console.log("No hearth-tagged products to delete.");
    return 0;
  }
  await confirmDestructive(`Delete ${products.length} hearth-tagged Shopify products?`, args);
  await deleteProducts(products, (done, total) => console.log(`[${done}/${total}] deleted hearth product`));
  console.log(`Reset complete: deleted ${products.length} hearth-tagged products.`);
  return products.length;
}

async function main(): Promise<void> {
  await resetHearthProducts();
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === entry) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Shopify reset failed");
    process.exitCode = 1;
  });
}
