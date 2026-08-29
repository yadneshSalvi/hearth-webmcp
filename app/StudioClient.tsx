"use client";
/**
 * Client boundary for the studio. Everything three/R3F touches lives inside `src/ui/AppShell`,
 * which is imported dynamically with `ssr: false`; the fallback is the designed plan skeleton.
 */
import dynamic from "next/dynamic";
import { useEffect } from "react";
import { createTemplate } from "@/src/engine/templates";
import { hearthStore, useHearthStore } from "@/src/state/store";
import { StudioSkeleton } from "@/src/ui/StudioSkeleton";

const AppShell = dynamic(() => import("@/src/ui/AppShell"), {
  ssr: false,
  loading: () => <StudioSkeleton />,
});

export default function StudioClient() {
  const roomCount = useHearthStore((state) => state.scene.rooms.length);
  useEffect(() => {
    if (roomCount === 0) hearthStore.getState().resetScene(createTemplate("2br", { furnished: true }));
  }, [roomCount]);
  return (
    <div className="relative h-full w-full overflow-hidden">
      <AppShell />
    </div>
  );
}
