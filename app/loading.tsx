import { StudioSkeleton } from "@/src/ui/StudioSkeleton";

/** Route-level loading UI: the same designed plan skeleton the client boundary shows. */
export default function Loading() {
  return (
    <main className="relative h-full w-full">
      <StudioSkeleton />
    </main>
  );
}
