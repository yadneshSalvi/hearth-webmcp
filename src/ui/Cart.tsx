"use client";
/**
 * The cart panel. Lines mirror the same `ShopifyClient` the agent's `update_cart` tool writes to —
 * the very instance, chosen at startup (src/shopify/select.ts) — so the dot says which Shopify this
 * is talking to rather than which one exists. Checkout follows SHOPIFY.md §6: a named window is
 * opened on the click itself, the store password is posted into it, and the window is then sent to
 * the real `checkoutUrl`. The password is only ever shown masked.
 */
import { useState } from "react";
import { createCatalog } from "../engine/catalog";
import { hearthStore, useHearthStore } from "../state/store";
import type { ShopifyMode } from "../shopify/select";
import { CatalogThumb } from "./CatalogThumb";
import { useCopyFlash } from "./clipboard";
import { colorwayLabel, maskSecret, plural, usd } from "./format";
import { IconCart, IconChevronDown, IconChevronUp, IconCopy, IconMinus, IconPlus, IconTrash } from "./icons";
import { Button, EmptyState, Field, IconButton, Panel } from "./primitives";
import { pushToast } from "./toast-bus";
import { cartOps, useShopifyMode } from "./useHearth";

/** The window the password form and the checkout URL share, per SHOPIFY.md §6. */
const WINDOW_NAME = "hearth-shop";
/** The Lax `_shopify_essential` cookie has to land before the checkout URL is requested. */
const UNLOCK_MS = 1_100;

/** Commits the typed budget on blur or Enter, so one edit is one undoable change. */
function commitBudget(raw: string): void {
  const digits = raw.replace(/[^\d]/g, "");
  const next = digits === "" ? undefined : Number(digits);
  if (next === hearthStore.getState().scene.meta.budgetUsd) return;
  hearthStore.getState().setBudget("human", next);
}

/** The dot reports the client in use, not a probe result — those two disagreed before. */
function StatusDot({ mode, offline }: { mode: ShopifyMode; offline: boolean }) {
  const tone = offline ? "bg-rose" : mode === "live" ? "bg-sage" : mode === "local" ? "bg-ochre" : "bg-ink-faint";
  const label = offline ? "Cart offline" : mode === "live" ? "Shopify live" : mode === "local" ? "Local catalog" : "Checking Shopify";
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-pill ${tone}`} aria-hidden="true" />
      <span className="label-caps text-[10px]">{label}</span>
    </span>
  );
}

interface CheckoutLink {
  checkoutUrl: string;
  storePassword: string;
}

/** Posts the store password into an already-open window, then sends that window to the checkout. */
function unlockAndOpen(target: Window | null, link: CheckoutLink): void {
  const { checkoutUrl, storePassword } = link;
  if (!storePassword) {
    if (target) target.location.replace(checkoutUrl);
    return;
  }
  const form = document.createElement("form");
  form.method = "post";
  form.action = new URL("/password", checkoutUrl).toString();
  form.target = WINDOW_NAME;
  const field = document.createElement("input");
  field.type = "hidden";
  field.name = "password";
  field.value = storePassword;
  form.appendChild(field);
  document.body.appendChild(form);
  form.submit();
  form.remove();
  // The same window is navigated rather than opened a second time: `window.open` with `noopener`
  // treats a named target as `_blank` (per spec), which would lose the password cookie's window.
  if (target) setTimeout(() => target.location.replace(checkoutUrl), UNLOCK_MS);
}

/**
 * Checkout, click-first. The window is opened synchronously so the click's transient activation is
 * still valid; the awaited `/api/checkout` round-trip then navigates it. When the popup is blocked
 * the panel keeps the link and the password visible instead of failing silently.
 */
async function startCheckout(onLink: (link: CheckoutLink) => void): Promise<void> {
  const target = window.open("", WINDOW_NAME);
  const link = await cartOps.checkout();
  if (!link?.checkoutUrl) {
    target?.close();
    return;
  }
  onLink(link);
  unlockAndOpen(target, link);
  pushToast(target
    ? { title: "Opening checkout", detail: "The store password is entered for you.", tone: "info" }
    : { title: "Checkout is ready", detail: "Your browser blocked the window — use the link in the cart.", tone: "warn" });
}

export function Cart({ className = "" }: { className?: string }) {
  const cart = useHearthStore((state) => state.cart);
  const catalogItems = useHearthStore((state) => state.catalog);
  const budgetUsd = useHearthStore((state) => state.scene.meta.budgetUsd);
  const open = useHearthStore((state) => state.ui.cartOpen ?? false);
  const mode = useShopifyMode();
  const [link, setLink] = useState<CheckoutLink | undefined>(undefined);
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
            <StatusDot mode={mode} offline={cart.status === "offline"} />
            <Button
              variant="primary"
              size="sm"
              icon={IconCart}
              disabled={cart.lines.length === 0 || mode !== "live"}
              onClick={() => void startCheckout(setLink)}
            >
              Checkout
            </Button>
          </div>
          {mode === "local" ? (
            <p className="text-[11.5px] leading-snug text-ink-muted">
              Checkout needs the live Shopify store; this session is browsing the local catalog.
            </p>
          ) : null}
          {link ? (
            <div className="flex flex-col gap-1.5 rounded-chip border border-hairline bg-plaster/60 px-2.5 py-2">
              <a
                href={link.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-[11.5px] text-dusty-blue underline decoration-dusty-blue/40 underline-offset-2"
              >
                Open checkout
              </a>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11.5px] text-ink-muted">Store password: {maskSecret(link.storePassword)}</span>
                <Button variant="ghost" size="sm" icon={IconCopy} onClick={() => passwordCopy.copy(link.storePassword)}>
                  {passwordCopy.copied ? "Copied" : "Copy"}
                </Button>
              </div>
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
                    {/* A line can appear the instant a tool adds it (`confirm_preview` → cart), well
                        before its render decodes — and a product the live store has but this
                        snapshot does not has no render at all. Either way the tile draws the local
                        `/assets/thumbs` art or its silhouette, never an empty grey square. */}
                    <CatalogThumb
                      productId={product?.id ?? line.handle}
                      category={product?.category ?? "decor"}
                      colorway={line.colorway}
                      name={line.title}
                      width={44}
                      decorative
                      sketch
                    />
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
