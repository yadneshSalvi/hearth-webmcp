"use client";
/**
 * Client boundary for the studio: three/R3F never runs on the server, so the canvas is imported
 * dynamically with `ssr: false` and the store is seeded with the furnished 2BR if it is empty.
 */
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { createTemplate } from "@/src/engine/templates";
import { hearthStore, useHearthStore } from "@/src/state/store";
import { LabStrip } from "./LabStrip";

const Studio = dynamic(() => import("@/src/scene/Studio"), {
  ssr: false,
  loading: () => <StudioSkeleton />,
});

/** Full-bleed studio plus the temporary lab controls. */
export default function StudioClient() {
  const roomCount = useHearthStore((state) => state.scene.rooms.length);
  useEffect(() => {
    if (roomCount === 0) hearthStore.getState().resetScene(createTemplate("2br", { furnished: true }));
  }, [roomCount]);
  return (
    <div className="relative h-full w-full overflow-hidden">
      <Studio />
      <LabStrip />
    </div>
  );
}

/** Designed loading state: a calm plaster wash while the canvas boots. */
function StudioSkeleton() {
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="font-display text-ink-muted text-lg italic">Warming the studio…</p>
    </div>
  );
}
