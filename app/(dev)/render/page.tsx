import { notFound } from "next/navigation";
import { connection } from "next/server";
import RenderClient from "./render-client";

/**
 * Dev-only product-shot route: `/render?id=<catalogId>&colorway=<id>` renders one catalog item
 * through the real studio materials for `scripts/assets/thumbs-retint.ts`.
 *
 * `connection()` keeps it out of the prerender, so the production gate answers a real 404 per
 * request rather than serving a cached not-found page with a 200.
 */
export default async function RenderPage() {
  await connection();
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <main className="relative min-h-full w-full">
      <RenderClient />
    </main>
  );
}
