import StudioClient from "./StudioClient";

/** The studio route: one full-bleed canvas with floating chrome over it (STYLE.md §4). */
export default function Home() {
  return (
    <main className="relative h-full w-full">
      <StudioClient />
    </main>
  );
}
