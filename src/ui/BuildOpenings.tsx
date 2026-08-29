"use client";
/**
 * Openings for one room: every door, window and arch on its walls, each editable in place, plus the
 * form that adds another. Offsets and widths are centimetres from the wall's start, exactly as
 * `add_opening` and `move_opening` mean them (SCENE_SCHEMA.md), so a human edit and an agent edit
 * are the same edit.
 */
import { useMemo, useState } from "react";
import { walls } from "../engine/geometry";
import type { Opening, OpeningKind, Room, Wall } from "../engine/types";
import { addOpening, moveOpening, removeOpening } from "./buildOps";
import { plural } from "./format";
import { IconChevronDown, IconChevronRight, IconPlus, IconTrash, OpeningIcon } from "./icons";
import { Button, Chip, IconButton, Segmented, Stepper } from "./primitives";
import type { SegmentedOption } from "./primitives";

type Swing = "in" | "out";
type Hinge = "left" | "right";

const KINDS: readonly SegmentedOption<OpeningKind>[] = [
  { value: "door", label: "Door" },
  { value: "window", label: "Window" },
  { value: "arch", label: "Arch" },
];

const SWINGS: readonly SegmentedOption<Swing>[] = [{ value: "in", label: "In" }, { value: "out", label: "Out" }];
const HINGES: readonly SegmentedOption<Hinge>[] = [{ value: "left", label: "Left" }, { value: "right", label: "Right" }];

const DEFAULT_WIDTH: Record<OpeningKind, number> = { door: 90, window: 120, arch: 140 };
const MIN_WIDTH = 40;

function kindLabel(kind: OpeningKind): string {
  return `${kind[0]?.toUpperCase()}${kind.slice(1)}`;
}

function wallLabel(wall: Wall): string {
  return `${wall.side[0]?.toUpperCase()}${wall.side.slice(1)} · ${Math.round(wall.length)} cm`;
}

/** Centres a width on a wall, clamped to the wall. */
function centered(wall: Wall | undefined, width: number): number {
  if (!wall) return 0;
  return Math.max(0, Math.round((wall.length - width) / 2));
}

function WallChips({ list, value, onChange }: { list: Wall[]; value: string; onChange(id: string): void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="label-caps">Wall</span>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Wall">
        {list.map((wall) => (
          <Chip key={wall.id} active={wall.id === value} onClick={() => onChange(wall.id)}>
            {wallLabel(wall)}
          </Chip>
        ))}
      </div>
    </div>
  );
}

function OpeningRow({ opening, room, list, open, onToggle }: {
  opening: Opening;
  room: Room;
  list: Wall[];
  open: boolean;
  onToggle(): void;
}) {
  const wall = list.find((candidate) => candidate.id === opening.wallId);
  const maxOffset = Math.max(0, Math.round((wall?.length ?? opening.offset + opening.width) - opening.width));
  const maxWidth = Math.max(MIN_WIDTH, Math.round((wall?.length ?? opening.width) - opening.offset));

  return (
    <li className="rounded-chip border border-hairline bg-plaster/45">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left"
      >
        <OpeningIcon kind={opening.kind} size={16} className="mt-0.5 shrink-0 text-ink-muted" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {kindLabel(opening.kind)} · {wall?.side ?? opening.wallId} wall
          </span>
          <span className="numerals mt-0.5 block truncate text-[11.5px] text-ink-muted">
            {opening.offset} cm from start · {opening.width} cm wide
          </span>
        </span>
        {open ? <IconChevronDown size={15} className="mt-0.5 shrink-0 text-ink-faint" /> : <IconChevronRight size={15} className="mt-0.5 shrink-0 text-ink-faint" />}
      </button>

      {open ? (
        <div className="flex flex-col gap-2.5 border-t border-hairline px-2.5 py-2.5">
          <p className="label-caps truncate text-[10px] text-ink-faint">{opening.id}</p>
          <WallChips list={list} value={opening.wallId} onChange={(wallId) => moveOpening(opening.id, { wallId, offset: 0 })} />
          <div className="flex gap-2">
            <Stepper
              label="Offset"
              className="flex-1"
              value={opening.offset}
              max={maxOffset}
              onChange={(offset) => moveOpening(opening.id, { offset })}
            />
            <Stepper
              label="Width"
              className="flex-1"
              value={opening.width}
              min={MIN_WIDTH}
              max={maxWidth}
              onChange={(width) => moveOpening(opening.id, { width })}
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {opening.kind === "door" ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <span className="label-caps">Swing</span>
                  <Segmented
                    label={`Swing for ${opening.id}`}
                    size="sm"
                    value={opening.swing ?? "in"}
                    options={SWINGS}
                    onChange={(swing) => moveOpening(opening.id, { swing })}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="label-caps">Hinge</span>
                  <Segmented
                    label={`Hinge for ${opening.id}`}
                    size="sm"
                    value={opening.hinge ?? "left"}
                    options={HINGES}
                    onChange={(hinge) => moveOpening(opening.id, { hinge })}
                  />
                </div>
              </>
            ) : null}
            <span className="flex-1" />
            <IconButton icon={IconTrash} label={`Remove ${opening.id} from ${room.name}`} size="sm" onClick={() => removeOpening(opening)} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

/** Mounted with `key={room.id}`, so the draft opening always belongs to the room on screen. */
export function BuildOpenings({ room, openings }: { room: Room; openings: Opening[] }) {
  const list = useMemo(() => walls(room), [room]);
  const north = list.find((wall) => wall.side === "north") ?? list[0];
  const [expanded, setExpanded] = useState<string | undefined>(undefined);
  const [kind, setKind] = useState<OpeningKind>("window");
  const [wallId, setWallId] = useState(north?.id ?? "w0");
  const [width, setWidth] = useState(DEFAULT_WIDTH.window);
  const [offset, setOffset] = useState(centered(north, DEFAULT_WIDTH.window));
  const [swing, setSwing] = useState<Swing>("in");
  const [hinge, setHinge] = useState<Hinge>("left");

  const wall = list.find((candidate) => candidate.id === wallId) ?? north;
  const maxWidth = Math.max(MIN_WIDTH, Math.round(wall?.length ?? MIN_WIDTH));
  const maxOffset = Math.max(0, Math.round((wall?.length ?? width) - width));

  const changeKind = (next: OpeningKind): void => {
    setKind(next);
    setWidth(DEFAULT_WIDTH[next]);
    setOffset(centered(wall, DEFAULT_WIDTH[next]));
  };

  const changeWall = (next: string): void => {
    setWallId(next);
    setOffset(centered(list.find((candidate) => candidate.id === next), width));
  };

  const submit = (): void => {
    if (!wall) return;
    const added = addOpening({
      roomId: room.id,
      wallId: wall.id,
      kind,
      offset: Math.min(offset, Math.max(0, Math.round(wall.length - width))),
      width,
      ...(kind === "door" ? { swing, hinge } : {}),
      ...(kind === "window" ? { sillHeight: 90 } : {}),
    }, room.name);
    if (added) setExpanded(undefined);
  };

  return (
    <section className="flex flex-col gap-2.5">
      <h3 className="label-caps">
        {openings.length === 0 ? "Openings" : plural(openings.length, "opening")} in {room.name}
      </h3>
      {openings.length === 0 ? (
        <p className="font-display text-[13px] italic text-ink-muted">No door or window yet — this room is sealed.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {openings.map((opening) => (
            <OpeningRow
              key={opening.id}
              opening={opening}
              room={room}
              list={list}
              open={expanded === opening.id}
              onToggle={() => setExpanded(expanded === opening.id ? undefined : opening.id)}
            />
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2.5 rounded-chip border border-hairline bg-plaster/35 p-2.5">
        <Segmented label="Opening kind" value={kind} options={KINDS} size="sm" onChange={changeKind} className="self-start" />
        <WallChips list={list} value={wall?.id ?? wallId} onChange={changeWall} />
        <div className="flex gap-2">
          <Stepper label="Offset" className="flex-1" value={Math.min(offset, maxOffset)} max={maxOffset} onChange={setOffset} />
          <Stepper label="Width" className="flex-1" value={width} min={MIN_WIDTH} max={maxWidth} onChange={setWidth} />
        </div>
        {kind === "door" ? (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Swing</span>
              <Segmented label="Swing for the new door" size="sm" value={swing} options={SWINGS} onChange={(value) => setSwing(value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="label-caps">Hinge</span>
              <Segmented label="Hinge for the new door" size="sm" value={hinge} options={HINGES} onChange={(value) => setHinge(value)} />
            </div>
          </div>
        ) : null}
        <Button variant="primary" size="sm" icon={IconPlus} onClick={submit} block>
          Add {kind} on the {wall?.side ?? "wall"} wall
        </Button>
      </div>
    </section>
  );
}
