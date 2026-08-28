import { catalogSource } from "../../data/catalog.source";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CART_CREATE_MUTATION, SEARCH_PRODUCTS_QUERY } from "../../src/shopify/queries";
import { snapshotByHandle } from "../../src/shopify/snapshot";
import { storefrontGraphql } from "../../scripts/shopify/storefront";
import { runVerify } from "../../scripts/shopify/verify";

try {
  process.loadEnvFile();
} catch {
  // CI may inject the settings and omit .env.
}

const RUN_INTEGRATION = Boolean(process.env.SHOPIFY_ADMIN_TOKEN);
const BASE_URL = "http://127.0.0.1:3105";
let server: ChildProcessWithoutNullStreams | undefined;
let serverOutput = "";

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (server?.exitCode !== null) throw new Error(`next dev exited early\n${serverOutput.slice(-4_000)}`);
    try {
      const response = await fetch(`${BASE_URL}/api/health/shopify`);
      if (response.ok) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`next dev did not become ready\n${serverOutput.slice(-4_000)}`);
}

describe.skipIf(!RUN_INTEGRATION)("Shopify live integration", () => {
  beforeAll(async () => {
    server = spawn("pnpm", ["dev", "-p", "3105"], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "pipe",
    });
    server.stdout.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
    server.stderr.on("data", (chunk: Buffer) => { serverOutput += chunk.toString(); });
    await waitForServer();
  }, 90_000);

  afterAll(async () => {
    if (!server || server.exitCode !== null) return;
    server.kill("SIGTERM");
    await Promise.race([once(server, "exit"), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  });

  it("passes full Admin and Storefront verification", async () => {
    const report = await runVerify({ print: false });
    expect(report).toMatchObject({ adminHearthProducts: catalogSource.length, adminOtherProducts: 0, storefrontProducts: catalogSource.length, definitions: 8 });
  }, 60_000);

  it("returns seeded handles and creates a checkout-capable cart through Storefront", async () => {
    const products = await storefrontGraphql<{
      products: { nodes: Array<{ handle: string }> };
    }, { q: string; first: number }>(SEARCH_PRODUCTS_QUERY, { q: "tag:hearth", first: 3 });
    expect(products.products.nodes).toHaveLength(3);
    expect(products.products.nodes.every(({ handle }) => Boolean(snapshotByHandle(handle)))).toBe(true);

    const cart = await storefrontGraphql<{
      cartCreate: { cart: { id: string; checkoutUrl: string } | null; userErrors: Array<{ message: string }> };
    }, { lines: [] }>(CART_CREATE_MUTATION, { lines: [] });
    expect(cart.cartCreate.userErrors).toEqual([]);
    expect(cart.cartCreate.cart?.checkoutUrl).toMatch(/^https:\/\//);
  });

  it("exercises search, product, cart add/remove, and checkout routes", async () => {
    const search = await fetch(`${BASE_URL}/api/shop/search?q=sofa`);
    const searchBody = await search.json() as { products: Array<{ handle: string }> };
    expect(search.ok).toBe(true);
    expect(searchBody.products.length).toBeGreaterThanOrEqual(3);

    const product = await fetch(`${BASE_URL}/api/shop/product?handle=sofa-endre`);
    const productBody = await product.json() as { product: { handle: string } };
    expect(productBody.product.handle).toBe("sofa-endre");

    const create = await fetch(`${BASE_URL}/api/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "create", lines: [] }),
    });
    const created = await create.json() as { cart: { id: string; lines: [] } };
    expect(create.ok).toBe(true);
    const variantId = snapshotByHandle("sofa-endre")?.variants[0]?.id;
    expect(variantId).toBeTruthy();

    const add = await fetch(`${BASE_URL}/api/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "add", cartId: created.cart.id, lines: [{ variantId, quantity: 1, itemId: "sofa-1" }] }),
    });
    const added = await add.json() as { cart: { lines: Array<{ id: string; itemId?: string }> } };
    expect(add.ok).toBe(true);
    expect(added.cart.lines[0]?.itemId).toBe("sofa-1");

    const set = await fetch(`${BASE_URL}/api/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "set", cartId: created.cart.id, lines: [{ id: added.cart.lines[0]?.id, quantity: 2 }] }),
    });
    const updated = await set.json() as { cart: { count: number; lines: Array<{ quantity: number }> } };
    expect(set.ok).toBe(true);
    expect(updated.cart.count).toBe(2);
    expect(updated.cart.lines[0]?.quantity).toBe(2);

    const get = await fetch(`${BASE_URL}/api/cart?id=${encodeURIComponent(created.cart.id)}`);
    const fetched = await get.json() as { cart: { count: number } };
    expect(get.ok).toBe(true);
    expect(fetched.cart.count).toBe(2);

    const remove = await fetch(`${BASE_URL}/api/cart`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "remove", cartId: created.cart.id, lineIds: [added.cart.lines[0]?.id] }),
    });
    const removed = await remove.json() as { cart: { lines: unknown[] } };
    expect(remove.ok).toBe(true);
    expect(removed.cart.lines).toEqual([]);

    const checkout = await fetch(`${BASE_URL}/api/checkout?cartId=${encodeURIComponent(created.cart.id)}`);
    const checkoutBody = await checkout.json() as { checkoutUrl: string; storePassword: string };
    expect(checkoutBody.checkoutUrl).toMatch(/^https:\/\//);
    expect(checkoutBody.storePassword.length).toBeGreaterThan(0);
  }, 60_000);
});
