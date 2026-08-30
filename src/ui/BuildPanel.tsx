"use client";
/**
 * Build mode's left panel: Rooms & Openings. The same six build tools an agent gets (TOOLS.md
 * §31–36) as human controls — a floor-plan template, the rooms with their size, floor and wall
 * colour, a form for a new room, and every opening on the active room's walls.
 */
import { useMemo, useState } from "react";
import { polyBBox, roomAreaM2 } from "../engine/geometry";
import type { Room, RoomType, TemplateId } from "../engine/types";
import { ROOM_TYPES } from "../engine/types";
import { hearthStore, useHearthStore } from "../state/store";
import type { RoomPlacement } from "../state/types";
import { floorHex, floors, wallColorHex, wallColors } from "../tokens";
import type { Floor, WallColor } from "../tokens";
import { BuildOpenings } from "./BuildOpenings";
import { applyTemplate, createRoom, updateRoom } from "./buildOps";
import { useCopyFlash } from "./clipboard";
import { IconAgent, IconCheck, IconChevronDown, IconChevronRight, IconPanelLeft, IconPlus, IconRoom } from "./icons";
import { Button, Chip, Field, IconButton, Panel, Segmented, Stepper } from "./primitives";
import type { SegmentedOption } from "./primitives";
import { plural } from "./format";
import { promptSuggestions } from "./prompts";

const TEMPLATES: readonly SegmentedOption<TemplateId>[] = [
  { value: "studio", label: "Studio" },
  { value: "1br", label: "1BR" },
  { value: "2br", label: "2BR" },
  { value: "3br", label: "3BR" },
  { value: "4br", label: "4BR" },
  { value: "5br", label: "5BR" },
  { value: "loft", label: "Loft" },
];

const PLACES: readonly { value: RoomPlacement; label: string }[] = [
  { value: "east_of", label: "East of" },
  { value: "south_of", label: "South of" },
  { value: "west_of", label: "West of" },
  { value: "north_of", label: "North of" },
];

const ROOM_STEP = 20;
const MIN_SIDE = 120;

function floorLabel(floor: Floor): string {
  return floor.replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());
}

function wallLabel(color: WallColor): string {
  return color === "plaster" ? "Plaster" : color.replace(/-tint$/, "").replace(/-/g, " ").replace(/^./, (first) => first.toUpperCase());
}

function roomTypeLabel(type: RoomType): string {
  return type.replace(/^./, (first) => first.toUpperCase());
}

/** A row of colour swatches acting as one radio group (floor materials, wall colours). */
function SwatchRow<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string; hex: string }[];
  value: T;
  onChange(value: T): void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-caps">{label}</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-label={`${label}: ${option.label}`}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
            className={`flex h-7 items-center gap-1.5 rounded-pill border px-2 text-[11.5px] transition-colors duration-200 ease-out-soft ${
              option.value === value ? "border-terracotta/45 bg-terracotta/10 text-ink" : "border-hairline text-ink-muted hover:text-ink"
            }`}
          >
            <span className="h-3 w-3 rounded-pill border border-charcoal/20" style={{ background: option.hex }} />
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function TemplateSection() {
  const template = useHearthStore((state) => state.scene.meta.template);
  const [choice, setChoice] = useState<TemplateId>(template ?? "2br");
  const [furnished, setFurnished] = useState(true);

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="label-caps">Floor plan</h3>
      <Segmented label="Floor-plan template" value={choice} options={TEMPLATES} size="sm" wrap onChange={(value) => setChoice(value)} />
      <div className="flex items-center gap-2">
        <Chip active={furnished} icon={furnished ? IconCheck : undefined} onClick={() => setFurnished(!furnished)}>
          Furnished
        </Chip>
        <span className="flex-1" />
        <Button variant="primary" size="sm" icon={IconRoom} onClick={() => void applyTemplate(choice, furnished)}>
          Apply
        </Button>
      </div>
      <p className="text-[11.5px] leading-snug text-ink-muted">
        {template ? `This home came from the ${template.toUpperCase()} template. ` : ""}
        Applying one replaces every room; you will be asked first.
      </p>
    </section>
  );
}

function RoomEditor({ room }: { room: Room }) {
  const [name, setName] = useState(room.name);
  const box = useMemo(() => polyBBox(room.poly), [room]);
  const width = Math.round(box.w);
  const depth = Math.round(box.d);

  const commitName = (): void => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === room.name) {
      setName(room.name);
      return;
    }
    if (!updateRoom(room, { name: trimmed })) setName(room.name);
  };

  return (
    <div className="flex flex-col gap-3 border-t border-hairline px-2.5 py-2.5">
      <Field
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === "Enter") commitName();
          if (event.key === "Escape") setName(room.name);
        }}
      />
      <div className="flex gap-2">
        <Stepper label="Width" className="flex-1" value={width} step={ROOM_STEP} min={MIN_SIDE} onChange={(value) => updateRoom(room, { width_cm: value })} />
        <Stepper label="Depth" className="flex-1" value={depth} step={ROOM_STEP} min={MIN_SIDE} onChange={(value) => updateRoom(room, { depth_cm: value })} />
      </div>
      <SwatchRow
        label="Floor"
        value={room.floor}
        options={floors.map((floor) => ({ value: floor, label: floorLabel(floor), hex: floorHex(floor) }))}
        onChange={(floor) => updateRoom(room, { floor })}
      />
      <SwatchRow
        label="Walls"
        value={room.wallColor ?? "plaster"}
        options={wallColors.map((color) => ({ value: color, label: wallLabel(color), hex: wallColorHex(color) }))}
        onChange={(wallColor) => updateRoom(room, { wallColor })}
      />
    </div>
  );
}

function RoomsSection({ rooms, activeRoomId }: { rooms: Room[]; activeRoomId: string }) {
  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="label-caps">{plural(rooms.length, "room")} · select one to edit</h3>
      <ul className="flex flex-col gap-1.5">
        {rooms.map((room) => {
          const active = room.id === activeRoomId;
          return (
            <li key={room.id} className={`rounded-chip border ${active ? "border-terracotta/35 bg-terracotta/6" : "border-hairline bg-plaster/45"}`}>
              <button
                type="button"
                aria-expanded={active}
                onClick={() => hearthStore.getState().setActiveRoom("human", room.id)}
                className="flex w-full items-center gap-2 px-2.5 py-2 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-ink">{room.name}</span>
                  <span className="numerals mt-0.5 block text-[11.5px] text-ink-muted">
                    {Math.round(polyBBox(room.poly).w)} × {Math.round(polyBBox(room.poly).d)} cm · {roomAreaM2(room).toFixed(1)} m²
                  </span>
                </span>
                <span className="label-caps shrink-0 text-[10px] text-ink-faint">{roomTypeLabel(room.type)}</span>
                {active ? <IconChevronDown size={15} className="shrink-0 text-ink-faint" /> : <IconChevronRight size={15} className="shrink-0 text-ink-faint" />}
              </button>
              {active ? <RoomEditor key={room.id} room={room} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function AddRoomForm({ rooms, activeRoomId }: { rooms: Room[]; activeRoomId: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Office");
  const [type, setType] = useState<RoomType>("office");
  const [width, setWidth] = useState(360);
  const [depth, setDepth] = useState(320);
  const [place, setPlace] = useState<RoomPlacement>("east_of");
  const [relativeTo, setRelativeTo] = useState(activeRoomId);

  const anchor = rooms.find((room) => room.id === relativeTo) ?? rooms.find((room) => room.id === activeRoomId) ?? rooms[0];

  return (
    <section className="flex flex-col gap-2.5">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 self-start"
      >
        <h3 className="label-caps">Add room</h3>
        {open ? <IconChevronDown size={14} className="text-ink-faint" /> : <IconChevronRight size={14} className="text-ink-faint" />}
      </button>

      {open ? (
        <div className="flex flex-col gap-2.5 rounded-chip border border-hairline bg-plaster/35 p-2.5">
          <Field label="Name" value={name} onChange={(event) => setName(event.target.value)} />
          <div className="flex flex-col gap-1.5">
            <span className="label-caps">Type</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Room type">
              {ROOM_TYPES.map((entry) => (
                <Chip key={entry} active={type === entry} onClick={() => setType(entry)}>{roomTypeLabel(entry)}</Chip>
              ))}
            </div>
          </div>
          <div className="flex gap-2">
            <Stepper label="Width" className="flex-1" value={width} step={ROOM_STEP} min={MIN_SIDE} onChange={setWidth} />
            <Stepper label="Depth" className="flex-1" value={depth} step={ROOM_STEP} min={MIN_SIDE} onChange={setDepth} />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="label-caps">Place</span>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Placement">
              {PLACES.map((entry) => (
                <Chip key={entry.value} active={place === entry.value} onClick={() => setPlace(entry.value)}>{entry.label}</Chip>
              ))}
            </div>
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Place relative to which room">
              {rooms.map((room) => (
                <Chip key={room.id} active={anchor?.id === room.id} onClick={() => setRelativeTo(room.id)}>{room.name}</Chip>
              ))}
            </div>
          </div>
          <Button
            variant="primary"
            size="sm"
            icon={IconPlus}
            block
            onClick={() => {
              if (!anchor) return;
              if (createRoom({ name, type, width, depth, place, relativeTo: anchor.id })) setOpen(false);
            }}
          >
            Add {name.trim() || "room"} {PLACES.find((entry) => entry.value === place)?.label.toLowerCase()} {anchor?.name ?? "the home"}
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PromptChip({ prompt }: { prompt: string }) {
  const { copied, copy } = useCopyFlash();
  return (
    <button
      type="button"
      onClick={() => copy(prompt)}
      title={prompt}
      className={`flex w-full items-center rounded-chip border px-2.5 py-1.5 text-left transition-colors duration-200 ease-out-soft ${
        copied ? "border-sage/45 bg-sage/14" : "border-hairline bg-plaster/45 hover:bg-plaster"
      }`}
    >
      <span className="font-display truncate text-[12px] italic text-ink-muted">
        {copied ? "Copied — paste into ChatGPT" : `“${prompt}”`}
      </span>
    </button>
  );
}

function PromptsSection({ roomName }: { roomName: string }) {
  const prompts = useMemo(
    () => promptSuggestions({ mode: "build", roomName, conflictKinds: [], cartLines: 0, variants: 0, accessibility: true }).slice(0, 3),
    [roomName],
  );
  return (
    <section className="flex flex-col gap-2">
      <h3 className="label-caps flex items-center gap-1.5">
        <IconAgent size={13} className="text-terracotta" />
        Ask your agent
      </h3>
      <div className="flex flex-col gap-1.5">
        {prompts.map((prompt) => <PromptChip key={prompt} prompt={prompt} />)}
      </div>
    </section>
  );
}

/** The build-mode twin of the catalog panel: it edits the shell of the home, not its contents. */
export function BuildPanel({ className = "", collapsible = false }: { className?: string; collapsible?: boolean }) {
  const rooms = useHearthStore((state) => state.scene.rooms);
  const openings = useHearthStore((state) => state.scene.openings);
  const activeRoomId = useHearthStore((state) => state.scene.meta.activeRoomId);
  const room = rooms.find((candidate) => candidate.id === activeRoomId) ?? rooms[0];

  return (
    <Panel
      label="Rooms & openings"
      className={className}
      actions={
        <>
          {collapsible ? (
            <IconButton
              icon={IconPanelLeft}
              label="Collapse the build panel"
              size="sm"
              onClick={() => hearthStore.getState().setUi({ catalogCollapsed: true })}
            />
          ) : null}
        </>
      }
      flush
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5 panel-scroll">
        <TemplateSection />
        <span className="h-px w-full bg-hairline" aria-hidden="true" />
        <RoomsSection rooms={rooms} activeRoomId={room?.id ?? activeRoomId} />
        {room ? (
          <>
            <span className="h-px w-full bg-hairline" aria-hidden="true" />
            <BuildOpenings key={room.id} room={room} openings={openings.filter((opening) => opening.roomId === room.id)} />
          </>
        ) : null}
        <span className="h-px w-full bg-hairline" aria-hidden="true" />
        <AddRoomForm rooms={rooms} activeRoomId={room?.id ?? activeRoomId} />
        <span className="h-px w-full bg-hairline" aria-hidden="true" />
        <PromptsSection roomName={room?.name ?? "room"} />
      </div>
    </Panel>
  );
}
