import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The catalog parade is a development harness (AGENTS.md): it walks every GLB through the real
 * pipeline so mis-tints are visible side by side, and it never ships. This server layout gates the
 * whole segment, so a production build serves the 404 page instead of the harness.
 */
export default function ParadeLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
