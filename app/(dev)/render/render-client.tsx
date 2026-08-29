"use client";
/** Client boundary for the product-shot route: three/R3F never runs on the server. */
import dynamic from "next/dynamic";

const ProductShot = dynamic(() => import("@/src/scene/ProductShot"), {
  ssr: false,
  loading: () => <p className="p-6 font-display text-[15px] italic text-ink-muted">Warming the shot…</p>,
});

export default function RenderClient() {
  return <ProductShot />;
}
