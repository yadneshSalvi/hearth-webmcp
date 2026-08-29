"use client";
/**
 * Temporary lab strip (Phase 3 replaces it with the real studio chrome). Every control calls a real
 * store action tagged `source: "human"`, so the 3D reacts exactly as it will for a person.
 */
import { useEffect, useState } from "react";
import { polyBBox } from "@/src/engine/geometry";
import { swingZone } from "@/src/engine/doors";
import type { Conflict, TimeOfDay, Yaw } from "@/src/engine/types";
import { studioApi } from "@/src/scene/Studio";
import { hearthStore, useHearthStore } from "@/src/state/store";
import { palettePresets } from "@/src/tokens";
import type { PaletteId } from "@/src/tokens";

const YAWS: Yaw[] = ["nw", "ne", "se", "sw"];
const TIMES: TimeOfDay[] = ["morning", "noon", "golden", "evening"];
const PALETTES = Object.keys(palettePresets) as PaletteId[];

/** Dev-only control strip for driving every renderable state. */
export function LabStrip() {
  const scene = useHearthStore((state) => state.scene);
  const [open, setOpen] = useState(true);
  const { meta, rooms } = scene;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const actions = hearthStore.getState();
  const activeRoom = rooms.find((room) => room.id === meta.activeRoomId) ?? rooms[0];
  const centre = activeRoom
    ? (() => {
        const box = polyBBox(activeRoom.poly);
        return { x: Math.round((box.minX + box.maxX) / 2), y: Math.round((box.minY + box.maxY) / 2) };
      })()
    : { x: 0, y: 0 };

  const dropSofa = () => {
    if (!activeRoom) return;
    const jitter = (scene.furniture.length % 4) * 25;
    actions.placeItem("human", {
      catalogId: "sofa-liva",
      roomId: activeRoom.id,
      pos: { x: centre.x + jitter - 40, y: centre.y },
      rotation: 0,
      colorway: "sage",
    });
  };

  const removeLast = () => {
    const placed = scene.furniture.filter((item) => item.status === "placed");
    const last = placed[placed.length - 1];
    if (last) actions.removeItem("human", last.id);
  };

  const previewGhost = () => {
    if (!activeRoom) return;
    const existing = scene.furniture.find((item) => item.status === "ghost");
    if (existing) {
      actions.clearGhost("human");
      return;
    }
    actions.setGhost("human", {
      id: "ghost-1",
      catalogId: "armchair-kyst",
      roomId: activeRoom.id,
      pos: { x: Math.round(centre.x / 2), y: Math.round(centre.y * 0.7) },
      rotation: 0,
      colorway: "ochre",
      status: "ghost",
    });
  };

  const seedConflicts = () => {
    if (!activeRoom) return;
    const current = hearthStore.getState().overlays?.conflicts ?? [];
    if (current.length > 0) {
      actions.setOverlays({ conflicts: [] });
      return;
    }
    const box = polyBBox(activeRoom.poly);
    const doors = scene.openings.filter((opening) => opening.roomId === activeRoom.id && opening.kind === "door");
    const door = doors.find((opening) => opening.wallId === "w1") ?? doors[0];
    const arc = door ? swingZone(door, activeRoom) : null;
    const conflicts: Conflict[] = [
      {
        kind: "clearance",
        items: ["sofa-1"],
        roomId: activeRoom.id,
        detail: "sofa-1 has 40 cm of front clearance, needs 75 cm",
        fix: "move rug-1 35 cm south",
        zone: [
          { x: box.minX + 150, y: box.minY + 100 },
          { x: box.minX + 370, y: box.minY + 100 },
          { x: box.minX + 370, y: box.minY + 175 },
          { x: box.minX + 150, y: box.minY + 175 },
        ],
        severity: "warn",
      },
      {
        kind: "traffic",
        items: ["rug-1"],
        roomId: activeRoom.id,
        detail: "walkway pinches to 52 cm between rug-1 and armchair-1",
        fix: "move armchair-1 20 cm west",
        zone: [
          { x: box.minX + 65, y: box.maxY - 45 },
          { x: box.minX + 200, y: box.maxY - 150 },
          { x: box.minX + 420, y: box.maxY - 195 },
          { x: box.maxX - 15, y: box.minY + 225 },
        ],
        severity: "warn",
      },
      ...(arc
        ? [
            {
              kind: "door_swing" as const,
              items: ["chair-7", door?.id ?? "door-1"],
              roomId: activeRoom.id,
              detail: "chair-7 sits in the door swing arc",
              fix: "move chair-7 40 cm east",
              zone: arc,
              severity: "error" as const,
            },
          ]
        : []),
    ];
    actions.setOverlays({ conflicts });
  };

  if (!activeRoom) return null;

  if (!open) {
    return (
      <div data-lab className="absolute top-5 left-5 z-30">
        <button type="button" onClick={() => setOpen(true)} className="glass label-caps px-3 py-2" aria-label="Open the lab controls">
          Lab
        </button>
      </div>
    );
  }

  return (
    <div data-lab className="glass absolute top-5 left-5 z-30 flex w-[286px] flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <span className="label-caps">Renderer lab</span>
        <button type="button" onClick={() => setOpen(false)} className="label-caps px-1" aria-label="Collapse the lab controls">
          Hide
        </button>
      </div>

      <Group label="Room">
        {rooms.map((room) => (
          <Chip key={room.id} active={room.id === meta.activeRoomId} onClick={() => actions.setActiveRoom("human", room.id)} label={room.id}>
            {room.id}
          </Chip>
        ))}
      </Group>

      <Group label="View">
        <Chip active={meta.view === "dollhouse"} onClick={() => actions.setView("human", { view: "dollhouse" })} label="Dollhouse view">
          dollhouse
        </Chip>
        <Chip active={meta.view === "plan"} onClick={() => actions.setView("human", { view: "plan" })} label="Plan view">
          plan
        </Chip>
      </Group>

      <Group label="Yaw">
        {YAWS.map((yaw) => (
          <Chip key={yaw} active={meta.yaw === yaw} onClick={() => actions.setView("human", { yaw })} label={`Yaw ${yaw}`}>
            {yaw}
          </Chip>
        ))}
      </Group>

      <Group label="Time">
        {TIMES.map((time) => (
          <Chip key={time} active={meta.timeOfDay === time} onClick={() => actions.setTimeOfDay("human", time)} label={`Time ${time}`}>
            {time}
          </Chip>
        ))}
      </Group>

      <Group label="Palette">
        {PALETTES.map((id) => (
          <Chip
            key={id}
            active={meta.paletteId === id}
            onClick={() => actions.setPalette("human", id, rooms.map((room) => room.id))}
            label={`Palette ${palettePresets[id].name}`}
          >
            {id}
          </Chip>
        ))}
      </Group>

      <Group label="State">
        <Chip active={meta.accessibilityMode} onClick={() => actions.setAccessibility("human", !meta.accessibilityMode)} label="Accessibility mode">
          a11y
        </Chip>
        <Chip active={false} onClick={dropSofa} label="Drop a sofa">
          drop sofa
        </Chip>
        <Chip active={false} onClick={removeLast} label="Remove the last item">
          remove last
        </Chip>
        <Chip active={scene.furniture.some((item) => item.status === "ghost")} onClick={previewGhost} label="Toggle a ghost preview">
          ghost
        </Chip>
        <Chip active={(hearthStore.getState().overlays?.conflicts ?? []).length > 0} onClick={seedConflicts} label="Toggle seeded conflicts">
          conflicts
        </Chip>
        <Chip
          active={false}
          onClick={() => studioApi.flyOrb({ roomId: activeRoom.id, pos: { x: centre.x, y: centre.y - 60 } }, "Arranged the room")}
          label="Fly the agent orb"
        >
          fly orb
        </Chip>
        <Chip
          active={false}
          onClick={() =>
            studioApi.focus({
              itemId: scene.furniture.find((item) => item.roomId === activeRoom.id && item.status === "placed")?.id,
            })
          }
          label="Focus the first item in this room"
        >
          focus item
        </Chip>
        <Chip active={false} onClick={() => studioApi.focus(undefined)} label="Clear the camera focus">
          clear focus
        </Chip>
        <Chip
          active={false}
          onClick={() => {
            void studioApi.capture().then((blob) => {
              // Reported through the DOM rather than the console so the studio stays log-free.
              document.documentElement.dataset.lastCapture = `${blob.type}:${blob.size}`;
            });
          }}
          label="Capture the studio frame"
        >
          capture
        </Chip>
        <Chip
          active={false}
          onClick={() => {
            studioApi.focus(undefined);
            actions.setOverlays({ conflicts: [] });
            actions.applyTemplate("human", "2br", true);
          }}
          label="Reset the furnished 2BR scene"
        >
          reset
        </Chip>
      </Group>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-caps text-[10px]">{label}</span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  label,
  children,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-chip border px-2 py-1 text-[11px] transition-colors duration-200 ${
        active ? "border-terracotta bg-terracotta/12 text-ink" : "border-hairline bg-plaster/60 text-ink-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
