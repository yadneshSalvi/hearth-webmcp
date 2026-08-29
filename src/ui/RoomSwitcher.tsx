"use client";
/** Room switcher: the active room's name and area, with a keyboard-navigable list of the home. */
import { useState } from "react";
import { roomAreaM2 } from "../engine/geometry";
import { hearthStore, useHearthStore } from "../state/store";
import { IconCheck, IconChevronDown } from "./icons";
import { Popover } from "./primitives";

export function RoomSwitcher() {
  const rooms = useHearthStore((state) => state.scene.rooms);
  const activeRoomId = useHearthStore((state) => state.scene.meta.activeRoomId);
  const [open, setOpen] = useState(false);
  const active = rooms.find((room) => room.id === activeRoomId) ?? rooms[0];
  if (!active) return null;

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex h-9 items-center gap-2 rounded-chip border border-hairline bg-plaster/60 px-2.5 text-[13px] text-ink transition-colors duration-200 ease-out-soft hover:bg-plaster"
      >
        <span className="max-w-[13ch] truncate font-medium">{active.name}</span>
        <span className="numerals shrink-0 whitespace-nowrap text-[12px] text-ink-muted">{roomAreaM2(active).toFixed(1)} m²</span>
        <IconChevronDown size={15} className="text-ink-faint" />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} label="Rooms in this home" width={244}>
        <ul className="flex flex-col">
          {rooms.map((room) => {
            const selected = room.id === active.id;
            return (
              <li key={room.id}>
                <button
                  type="button"
                  data-autofocus={selected ? "" : undefined}
                  onClick={() => {
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
