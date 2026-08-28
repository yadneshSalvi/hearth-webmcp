import type { Metadata } from "next";
import { CheckoutClient } from "./checkout-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Checkout",
  description: "Continue from Hearth Studio to the Shopify test checkout.",
};

interface CheckoutPageProps {
  searchParams: Promise<{ cart?: string | string[] }>;
}

export default async function CheckoutPage({ searchParams }: CheckoutPageProps) {
  const value = (await searchParams).cart;
  const cartId = Array.isArray(value) ? value[0] : value;
  return <CheckoutClient cartId={cartId?.trim() ?? ""} />;
}
