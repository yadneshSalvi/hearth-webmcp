import { describe, expect, it } from "vitest";
import { cartPayload } from "@/src/engine/describe";
import { homeBudgetRows } from "@/src/ui/homeBudget";

/**
 * The card's money rows (src/ui/homeBudget.ts). The rule under test is a contract, not a taste: the
 * panel's "Remaining" and the agent's `remaining_usd` are the same number, and neither of them is
 * about the furniture standing in the home.
 */
describe("the Entire home money rows", () => {
  const furnished5br = { furnitureUsd: 13_495, budgetUsd: 3_000, cartUsd: 0 };

  it("states all four figures, in the order they add up", () => {
    expect(homeBudgetRows(furnished5br).map((row) => [row.label, row.usd])).toEqual([
      ["Furniture value", 13_495],
      ["Budget", 3_000],
      ["Cart", 0],
      ["Remaining", 3_000],
    ]);
  });

  it("spends the budget on the cart, never on what is placed", () => {
    const rows = homeBudgetRows({ ...furnished5br, cartUsd: 1_240 });
    expect(rows.find((row) => row.label === "Remaining")?.usd).toBe(1_760);
    // The 13,495 of furniture in the home moves nothing.
    expect(homeBudgetRows({ ...furnished5br, furnitureUsd: 0, cartUsd: 1_240 }).find((row) => row.label === "Remaining")?.usd).toBe(1_760);
  });

  it("agrees with the number the tools report", () => {
    const cart = { lines: [], subtotalUsd: 1_240 };
    const payload = cartPayload(cart, 3_000);
    const rows = homeBudgetRows({ furnitureUsd: 13_495, budgetUsd: 3_000, cartUsd: cart.subtotalUsd });
    expect(rows.find((row) => row.label === "Remaining")?.usd).toBe(payload.remaining_usd);
  });

  it("only an overspent budget is loud", () => {
    expect(homeBudgetRows(furnished5br).every((row) => row.tone === "muted")).toBe(true);
    const over = homeBudgetRows({ ...furnished5br, cartUsd: 4_200 });
    expect(over.find((row) => row.label === "Remaining")).toEqual({ label: "Remaining", usd: -1_200, tone: "ink" });
  });

  it("says so when there is no budget, instead of inventing one", () => {
    const rows = homeBudgetRows({ furnitureUsd: 13_495, cartUsd: 240 });
    expect(rows.map((row) => row.label)).toEqual(["Furniture value", "Budget", "Cart"]);
    expect(rows.find((row) => row.label === "Budget")?.usd).toBeUndefined();
  });
});
