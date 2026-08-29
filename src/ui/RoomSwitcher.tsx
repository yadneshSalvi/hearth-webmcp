"use client";
/**
 * Room switcher: what the camera is framing — the whole home or one room — with its area, and a
 * keyboard-navigable list of the home under it. "Entire home" sits at the top because that is the
 * shot a template apply lands on (src/scene/homeFocus.ts), and this is where you get back to it.
 */
import { useState } from "react";
import { roomAreaM2 } from "../engine/geometry";
import { setFocusTarget, toggleHomeFocus, useHomeFocus } from "../scene/focus";
import { hearthStore, useHearthStore } from "../state/store";
import { IconCheck, IconChevronDown, IconHome } from "./icons";
import { Popover } from "./primitives";

export function RoomSwitcher() {
  const rooms = useHearthStore((state) => state.scene.rooms);
  const activeRoomId = useHearthStore((state) => state.scene.meta.activeRoomId);
  const home = useHomeFocus();
  const [open, setOpen] = useState(false);
  const active = rooms.find((room) => room.id === activeRoomId) ?? rooms[0];
  if (!active) return null;

  const totalAreaM2 = rooms.reduce((sum, room) => sum + roomAreaM2(room), 0);
  const label = home ? "Entire home" : active.name;
  const areaM2 = home ? totalAreaM2 : roomAreaM2(active);

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 items-center gap-2 rounded-chip border border-hairline bg-plaster/60 px-2.5 text-[13px] text-ink transition-colors duration-200 ease-out-soft hover:bg-plaster"
      >
        <span className="max-w-[13ch] truncate font-medium">{label}</span>
        <span className="numerals shrink-0 whitespace-nowrap text-[12px] text-ink-muted">{areaM2.toFixed(1)} m²</span>
        <IconChevronDown size={15} className="text-ink-faint" />
      </button>
      {/* Solid, not glass: an eleven-room list reaches down over the catalog cards, and two glass
          surfaces stacked make both illegible (STYLE.md §1). */}
      <Popover open={open} onClose={() => setOpen(false)} label="Rooms in this home" width={244} solid>
        <ul className="flex flex-col">
          <li>
            <button
              type="button"
              aria-current={home ? "true" : undefined}
              data-autofocus={home ? "" : undefined}
              onClick={() => {
                toggleHomeFocus();
                setOpen(false);
              }}
              className={`flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-[13px] transition-colors duration-200 ease-out-soft ${
                home ? "bg-terracotta/10 text-ink" : "text-ink-muted hover:bg-charcoal/6 hover:text-ink"
              }`}
            >
              <IconHome size={14} className={home ? "text-terracotta" : "text-ink-faint"} />
              <span className="flex-1 truncate">Entire home</span>
              <span className="numerals text-[12px] text-ink-faint">{totalAreaM2.toFixed(1)} m²</span>
              {home ? <IconCheck size={14} className="text-terracotta" /> : <span className="w-3.5" />}
            </button>
          </li>
          <li aria-hidden="true" className="my-1 h-px bg-hairline" />
          {rooms.map((room) => {
            const selected = !home && room.id === active.id;
            return (
              <li key={room.id}>
                <button
                  type="button"
                  aria-current={selected ? "true" : undefined}
                  data-autofocus={selected ? "" : undefined}
                  onClick={() => {
                    // Picking a room lets go of any override, including the whole-home shot — even
                    // when it is the room that was already active.
                    setFocusTarget(undefined);
                    hearthStore.getState().setActiveRoom("human", room.id);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-chip px-2.5 py-2 text-left text-[13px] transition-colors duration-200 ease-out-soft ${
                    selected ? "bg-terracotta/10 text-ink" : "text-ink-muted hover:bg-charcoal/6 hover:text-ink"
                  }`}
                >
                  <span className="flex-1 truncate">{room.name}</span>
                  <span className="numerals text-[12px] text-ink-faint">{roomAreaM2(room).toFixed(1)} m²</span>
                  {selected ? <IconCheck size={14} className="text-terracotta" /> : <span className="w-3.5" />}
                </button>
              </li>
            );
          })}
        </ul>
      </Popover>
    </div>
  );
}
