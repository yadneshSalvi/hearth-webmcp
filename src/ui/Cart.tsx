"use client";
/**
 * The cart panel. Lines mirror the same `ShopifyClient` the agent's `update_cart` tool writes to,
 * the budget lives in `meta.budgetUsd`, and checkout follows SHOPIFY.md §6: the store password is
 * posted into a named window before the checkout URL is opened, and is only ever shown masked.
 */
import { useEffect, useState } from "react";
import { createCatalog } from "../engine/catalog";
import { hearthStore, useHearthStore } from "../state/store";
import { CatalogThumb } from "./CatalogThumb";
import { useCopyFlash } from "./clipboard";
import { colorwayLabel, maskSecret, plural, usd } from "./format";
import { IconCart, IconChevronDown, IconChevronUp, IconCopy, IconMinus, IconPlus, IconTrash } from "./icons";
import { Button, EmptyState, Field, IconButton, Panel } from "./primitives";
import { pushToast } from "./toast-bus";
import { cartOps } from "./useHearth";

type Health = "checking" | "live" | "local";

/** Commits the typed budget on blur or Enter, so one edit is one undoable change. */
function commitBudget(raw: string): void {
  const digits = raw.replace(/[^\d]/g, "");
  const next = digits === "" ? undefined : Number(digits);
  if (next === hearthStore.getState().scene.meta.budgetUsd) return;
  hearthStore.getState().setBudget("human", next);
}

/** Probes the Storefront API once; anything other than a healthy answer means the local catalog. */
function useShopifyHealth(): Health {
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    fetch("/api/health/shopify", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() as Promise<{ storefront?: boolean }> : undefined))
      .then((body) => {
        if (!cancelled) setHealth(body?.storefront ? "live" : "local");
      })
      .catch(() => {
        if (!cancelled) setHealth("local");
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);
  return health;
}

function StatusDot({ health, offline }: { health: Health; offline: boolean }) {
  const tone = offline ? "bg-rose" : health === "live" ? "bg-sage" : health === "local" ? "bg-ochre" : "bg-ink-faint";
  const label = offline ? "Cart offline" : health === "live" ? "Shopify live" : health === "local" ? "Local catalog" : "Checking Shopify";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-pill ${tone}`} aria-hidden="true" />
      <span className="label-caps text-[10px]">{label}</span>
    </span>
  );
}

async function startCheckout(setPassword: (value: string) => void): Promise<void> {
  const link = await cartOps.checkout();
  if (!link) return;
  const { checkoutUrl, storePassword } = link;
  if (!storePassword) {
    window.open(checkoutUrl, "hearth-shop", "noopener");
    return;
  }
  setPassword(storePassword);
  const form = document.createElement("form");
  form.method = "post";
  form.action = new URL("/password", checkoutUrl).toString();
  form.target = "hearth-shop";
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "password";
  field.value = storePassword;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
  setTimeout(() => window.open(checkoutUrl, "hearth-shop"), 1_100);
  pushToast({ title: "Opening checkout", detail: "The store password is entered for you.", tone: "info" });
}

export function Cart({ className = "" }: { className?: string }) {
  const cart = useHearthStore((state) => state.cart);
  const catalogItems = useHearthStore((state) => state.catalog);
  const budgetUsd = useHearthStore((state) => state.scene.meta.budgetUsd);
  const open = useHearthStore((state) => state.ui.cartOpen ?? false);
  const health = useShopifyHealth();
  const [password, setPassword] = useState("");
  const passwordCopy = useCopyFlash();
  const catalog = createCatalog(catalogItems);
  const remaining = budgetUsd === undefined ? undefined : budgetUsd - cart.subtotalUsd;

  return (
    <Panel
      label="Cart"
      className={className}
      actions={
        <>
          <span className="numerals text-[13px] text-ink">{usd(cart.subtotalUsd)}</span>
          <IconButton
            icon={open ? IconChevronDown : IconChevronUp}
            label={open ? "Collapse the cart" : "Expand the cart"}
            size="sm"
            onClick={() => hearthStore.getState().setUi({ cartOpen: !open })}
          />
        </>
      }
      flush
      bodyClassName="min-h-0"
      footer={open ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <StatusDot health={health} offline={cart.status === "offline"} />
            <Button
              variant="primary"
              size="sm"
              icon={IconCart}
              disabled={cart.lines.length === 0}
              onClick={() => void startCheckout(setPassword)}
            >
              Checkout
            </Button>
          </div>
          {password ? (
            <div className="flex items-center justify-between gap-2 rounded-chip border border-hairline bg-plaster/60 px-2.5 py-1.5">
              <span className="text-[11.5px] text-ink-muted">Store password: {maskSecret(password)}</span>
              <Button variant="ghost" size="sm" icon={IconCopy} onClick={() => passwordCopy.copy(password)}>
                {passwordCopy.copied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    >
      {open ? (
        <>
          {cart.lines.length === 0 ? (
            <EmptyState title="Nothing in the cart yet." hint="Place something you like, then add it — or ask your agent to." />
          ) : (
            <ul className="min-h-0 flex-1 overflow-y-auto panel-scroll">
              {cart.lines.map((line) => {
                const product = catalog.byId(line.handle);
                return (
                  <li key={line.id} className="flex items-center gap-2.5 border-b border-hairline/70 px-3.5 py-2.5 last:border-0">
                    {product ? (
                      <CatalogThumb
                        productId={product.id}
                        category={product.category}
                        colorway={line.colorway}
                        name={line.title}
                        width={44}
                        decorative
                      />
                    ) : null}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[12.5px] text-ink">{line.title}</span>
                      <span className="label-caps text-[10px]">{colorwayLabel(line.colorway)}</span>
                    </span>
                    <span className="flex items-center gap-1">
                      <IconButton
                        icon={line.quantity > 1 ? IconMinus : IconTrash}
                        label={line.quantity > 1 ? `Decrease ${line.title}` : `Remove ${line.title}`}
                        size="sm"
                        onClick={() => void cartOps.setQuantity(line.id, line.quantity - 1)}
                      />
                      <span className="numerals w-4 text-center text-[12.5px] text-ink">{line.quantity}</span>
                      <IconButton
                        icon={IconPlus}
                        label={`Increase ${line.title}`}
                        size="sm"
                        onClick={() => void cartOps.setQuantity(line.id, line.quantity + 1)}
                      />
                    </span>
                    <span className="numerals w-[52px] shrink-0 text-right text-[12.5px] text-ink">{usd(line.lineUsd)}</span>
                  </li>
                );
              })}
            </ul>
          )}

          <div className="flex shrink-0 flex-col gap-2.5 border-t border-hairline p-3.5">
            <div className="flex items-baseline justify-between gap-3">
              <span className="label-caps">Subtotal · {plural(cart.lines.length, "line")}</span>
              <span className="numerals text-[15px] text-ink">{usd(cart.subtotalUsd)}</span>
            </div>

            <div className="flex items-end gap-2.5">
              <Field
                key={`budget-${budgetUsd ?? "none"}`}
                label="Budget"
                prefix="$"
                numeric
                inputMode="numeric"
                placeholder="3,000"
                defaultValue={budgetUsd === undefined ? "" : budgetUsd.toLocaleString("en-US")}
                onBlur={(event) => commitBudget(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitBudget(event.currentTarget.value);
                }}
                className="flex-1"
              />
              <div className="flex h-9 flex-col justify-center text-right">
                <span className="label-caps text-[10px]">Remaining</span>
                <span
                  className={`numerals text-[13px] ${remaining !== undefined && remaining < 0 ? "text-amber" : "text-ink"}`}
                >
                  {remaining === undefined ? "—" : usd(remaining)}
                </span>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </Panel>
  );
}
