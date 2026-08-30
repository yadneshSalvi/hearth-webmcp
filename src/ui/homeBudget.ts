/**
 * The money rows on the Inspector's "Entire home" card.
 *
 * A budget is spent by *buying*, not by placing: `remaining_usd` in `get_cart` and
 * `get_scene_summary` is `budget − cart subtotal` (src/engine/describe.ts `cartPayload`), and the
 * card has to say the same thing or the panel and the agent disagree in front of the human. Reading
 * it against the value of everything placed made a furnished 5BR report "Remaining -$10,495" — a
 * catalogue's worth of furniture the human had not bought and a red number that looks like a bug.
 *
 * So the card states all four figures and lets them add up: what is in the home, what may be spent,
 * what is in the cart, and what is left.
 */

export interface HomeBudgetRow {
  label: string;
  /** Dollars; `undefined` is a row with no figure to give ("Budget · not set"). */
  usd?: number;
  tone: "ink" | "muted";
}

export interface HomeBudgetInput {
  /** Catalog value of every placed item in the home. */
  furnitureUsd: number;
  /** `scene.meta.budgetUsd`, or undefined when the home has no budget. */
  budgetUsd?: number;
  /** The cart's subtotal — the only money actually committed. */
  cartUsd: number;
}

/**
 * Furniture value, budget, cart, remaining — in that order, so the arithmetic reads down the column.
 * Only an overspent budget takes the `ink` tone; everything else is a quiet figure, because a home
 * worth more than its budget is the normal state of a design studio, not a warning.
 */
export function homeBudgetRows({ furnitureUsd, budgetUsd, cartUsd }: HomeBudgetInput): HomeBudgetRow[] {
  const rows: HomeBudgetRow[] = [{ label: "Furniture value", usd: furnitureUsd, tone: "muted" }];
  if (budgetUsd === undefined) {
    rows.push({ label: "Budget", tone: "muted" }, { label: "Cart", usd: cartUsd, tone: "muted" });
    return rows;
  }
  const remaining = budgetUsd - cartUsd;
  rows.push(
    { label: "Budget", usd: budgetUsd, tone: "muted" },
    { label: "Cart", usd: cartUsd, tone: "muted" },
    { label: "Remaining", usd: remaining, tone: remaining < 0 ? "ink" : "muted" },
  );
  return rows;
}
