"use client";

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";

interface CheckoutDetails {
  checkoutUrl: string;
  storePassword: string;
  passwordUrl: string;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; detail: string }
  | { status: "ready"; details: CheckoutDetails };

const WINDOW_NAME = "hearth-shop";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function CheckoutClient({ cartId }: { cartId: string }) {
  const [state, setState] = useState<LoadState>(() => cartId
    ? { status: "loading" }
    : { status: "error", detail: "This checkout link is missing its cart id." });
  const [copied, setCopied] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (!cartId) return;
    const controller = new AbortController();
    async function load(): Promise<void> {
      try {
        const response = await fetch(`/api/checkout?cartId=${encodeURIComponent(cartId)}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isRecord(payload) || typeof payload.checkoutUrl !== "string" || typeof payload.storePassword !== "string") {
          const detail = isRecord(payload) && typeof payload.detail === "string" ? payload.detail : "Checkout is unavailable right now.";
          setState({ status: "error", detail });
          return;
        }
        const checkout = new URL(payload.checkoutUrl);
        if (checkout.protocol !== "https:") throw new Error("Shopify returned an unsafe checkout URL");
        setState({
          status: "ready",
          details: { checkoutUrl: checkout.href, storePassword: payload.storePassword, passwordUrl: `${checkout.origin}/password` },
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState({ status: "error", detail: error instanceof Error ? error.message : "Checkout is unavailable right now." });
      }
    }
    void load();
    return () => controller.abort();
  }, [cartId]);

  function beginCheckout(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (state.status !== "ready" || !formRef.current) return;
    window.open("", WINDOW_NAME);
    formRef.current.submit();
    window.setTimeout(() => window.open(state.details.checkoutUrl, WINDOW_NAME), 1_000);
  }

  async function copyPassword(): Promise<void> {
    if (state.status !== "ready") return;
    await navigator.clipboard.writeText(state.details.storePassword);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_800);
  }

  return (
    <main className="grid min-h-full place-items-center overflow-auto p-6 sm:p-10">
      <section className="glass w-full max-w-lg p-5 sm:p-8" aria-busy={state.status === "loading"}>
        <p className="label-caps mb-4">Hearth Studio · secure handoff</p>
        <h1 className="font-display text-4xl leading-tight text-charcoal sm:text-5xl">Your room is ready.</h1>
        <p className="mt-4 max-w-md text-sm leading-6 text-ink-muted">
          We’ll unlock the Shopify development store, then open your cart in the same window.
        </p>

        {state.status === "loading" ? (
          <div className="mt-8 space-y-3" role="status" aria-live="polite">
            <div className="h-12 animate-pulse rounded-chip bg-oak/55" />
            <p className="font-display italic text-ink-muted">Preparing your checkout…</p>
          </div>
        ) : null}

        {state.status === "error" ? (
          <div className="mt-8 rounded-panel border border-hairline bg-plaster/80 p-5" role="alert">
            <p className="font-display text-xl italic">We couldn’t prepare checkout.</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">{state.detail}</p>
            <Link className="mt-4 inline-flex text-sm font-semibold text-dusty-blue underline underline-offset-4" href="/">
              Return to the studio
            </Link>
          </div>
        ) : null}

        {state.status === "ready" ? (
          <div className="mt-8">
            <form
              ref={formRef}
              method="post"
              action={state.details.passwordUrl}
              target={WINDOW_NAME}
              onSubmit={beginCheckout}
            >
              <input type="hidden" name="password" value={state.details.storePassword} />
              <button
                type="submit"
                className="min-h-12 w-full rounded-chip bg-terracotta px-5 py-3 text-sm font-semibold text-plaster shadow-chip transition-[transform,background-color] duration-[240ms] ease-out-soft hover:-translate-y-0.5 hover:bg-terracotta/90"
              >
                Unlock store and continue
              </button>
            </form>

            <div className="mt-5 flex items-center justify-between gap-4 rounded-chip border border-hairline bg-plaster/75 px-4 py-3">
              <div>
                <p className="label-caps">Store password</p>
                <p className="numerals mt-1 text-xl text-charcoal">{state.details.storePassword}</p>
              </div>
              <button
                type="button"
                aria-label="Copy store password"
                onClick={() => void copyPassword()}
                className="rounded-pill border border-hairline bg-oak/45 px-4 py-2 text-xs font-semibold text-charcoal transition-colors duration-[240ms] ease-out-soft hover:bg-oak/70"
              >
                {copied ? "Copied" : "Copy"}
              </button>
            </div>

            <p className="mt-5 text-xs leading-5 text-ink-muted">
              If the new window does not continue automatically, enter the password above and then use the direct link.
            </p>
            <a
              href={state.details.checkoutUrl}
              target={WINDOW_NAME}
              rel="noreferrer"
              className="mt-3 inline-flex text-sm font-semibold text-dusty-blue underline underline-offset-4"
            >
              Open checkout directly
            </a>
          </div>
        ) : null}
      </section>
    </main>
  );
}
