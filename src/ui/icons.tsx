/**
 * Hearth's icon set — drawn here, never imported. 20 × 20 grid, 1.5 px stroke, round caps, single
 * colour from `currentColor` (STYLE.md §5 forbids icon libraries).
 */
import type { ComponentType, SVGProps } from "react";
import type { ActionSource, ConflictKind } from "../engine/types";

export interface IconProps {
  size?: number;
  className?: string;
}

type Glyph = SVGProps<SVGSVGElement>["children"];

function icon(children: Glyph, extra?: SVGProps<SVGSVGElement>): ComponentType<IconProps> {
  function Icon({ size = 18, className }: IconProps) {
    return (
      <svg
        viewBox="0 0 20 20"
        width={size}
        height={size}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={className}
        {...extra}
      >
        {children}
      </svg>
    );
  }
  return Icon;
}

/** The Hearth mark: a half-lit circle in terracotta, the wordmark's only ornament. */
export function HearthMark({ size = 20, className }: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width={size} height={size} aria-hidden="true" focusable="false" className={className}>
      <circle cx="10" cy="10" r="6.6" fill="none" stroke="currentColor" strokeWidth={1.5} />
      <path d="M10 3.4a6.6 6.6 0 0 0 0 13.2z" fill="currentColor" />
    </svg>
  );
}

export const IconSearch = icon(<><circle cx="9" cy="9" r="5.4" /><path d="M13.1 13.1 16.8 16.8" /></>);
export const IconClose = icon(<><path d="M5.4 5.4 14.6 14.6" /><path d="M14.6 5.4 5.4 14.6" /></>);
export const IconChevronDown = icon(<path d="M6 8.4 10 12.4 14 8.4" />);
export const IconChevronUp = icon(<path d="M6 11.6 10 7.6 14 11.6" />);
export const IconChevronRight = icon(<path d="M8.4 6 12.4 10 8.4 14" />);
export const IconUndo = icon(<><path d="M4.2 9.6h8.3a3.9 3.9 0 0 1 0 7.8H8.6" /><path d="M7.7 6.1 4.2 9.6l3.5 3.5" /></>);
export const IconRedo = icon(<><path d="M15.8 9.6H7.5a3.9 3.9 0 0 0 0 7.8h3.9" /><path d="M12.3 6.1 15.8 9.6l-3.5 3.5" /></>);
export const IconPlan = icon(<><rect x="3.4" y="3.4" width="13.2" height="13.2" rx="1.8" /><path d="M9.6 3.4v13.2" /><path d="M3.4 11.4h6.2" /></>);
export const IconDollhouse = icon(<><path d="M10 3.2 16.8 7 10 10.8 3.2 7z" /><path d="M3.2 7v6L10 16.8V10.8" /><path d="M16.8 7v6L10 16.8" /></>);
export const IconRotateLeft = icon(<><path d="M15.6 11.6A6 6 0 1 0 4.6 8.2" /><path d="M4.4 4.4v3.9h3.9" /></>);
export const IconRotateRight = icon(<><path d="M4.4 11.6A6 6 0 1 1 15.4 8.2" /><path d="M15.6 4.4v3.9h-3.9" /></>);
export const IconYawLeft = icon(<><path d="M4.8 8.4A7.6 7.6 0 0 1 15.2 8.4" /><path d="M4.6 4.6v3.9h3.9" /><path d="M6 14.4h8" /></>);
export const IconYawRight = icon(<><path d="M4.8 8.4A7.6 7.6 0 0 1 15.2 8.4" /><path d="M15.4 4.6v3.9h-3.9" /><path d="M6 14.4h8" /></>);
export const IconBoard = icon(<><path d="M10 3.4v8.4" /><path d="M6.6 8.6 10 12 13.4 8.6" /><path d="M4 15.8h12" /></>);
export const IconMorning = icon(<><path d="M6.2 12.4a3.8 3.8 0 0 1 7.6 0" /><path d="M3.2 12.4h13.6" /><path d="M10 5.2v1.6" /><path d="M15 7.4l-1.1 1.1" /><path d="M5 7.4l1.1 1.1" /></>);
export const IconNoon = icon(<><circle cx="10" cy="10" r="3.4" /><path d="M10 3.2v1.4" /><path d="M10 15.4v1.4" /><path d="M3.2 10h1.4" /><path d="M15.4 10h1.4" /><path d="M5.4 5.4l1 1" /><path d="M13.6 13.6l1 1" /><path d="M14.6 5.4l-1 1" /><path d="M6.4 13.6l-1 1" /></>);
export const IconGolden = icon(<><circle cx="10" cy="11.2" r="3.1" /><path d="M3.2 15.6h13.6" /><path d="M10 4.4v1.6" /><path d="M3.6 8.2h1.6" /><path d="M14.8 8.2h1.6" /></>);
export const IconEvening = icon(<path d="M12.4 3.6a6.6 6.6 0 1 0 4 9 7.2 7.2 0 0 1-4-9z" />);
export const IconLock = icon(<><rect x="5.2" y="9.2" width="9.6" height="7.2" rx="1.8" /><path d="M7.6 9.2V7.4a2.4 2.4 0 0 1 4.8 0v1.8" /></>);
export const IconUnlock = icon(<><rect x="5.2" y="9.2" width="9.6" height="7.2" rx="1.8" /><path d="M7.6 9.2V7.4a2.4 2.4 0 0 1 4.7-.6" /></>);
export const IconTrash = icon(<><path d="M4.4 6.4h11.2" /><path d="M8 6.4V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.4" /><path d="M6.2 6.4l.7 9a1.1 1.1 0 0 0 1.1 1h4a1.1 1.1 0 0 0 1.1-1l.7-9" /></>);
export const IconCart = icon(<><path d="M4.2 7h11.6l-1.3 8a1.5 1.5 0 0 1-1.5 1.3H7a1.5 1.5 0 0 1-1.5-1.3z" /><path d="M7.4 7V5.6a2.6 2.6 0 0 1 5.2 0V7" /></>);
export const IconCopy = icon(<><rect x="3.4" y="3.4" width="9" height="9" rx="1.6" /><rect x="7.6" y="7.6" width="9" height="9" rx="1.6" /></>);
export const IconCheck = icon(<path d="M4.8 10.4 8.4 14 15.2 6.4" />);
export const IconPlus = icon(<><path d="M10 5.4v9.2" /><path d="M5.4 10h9.2" /></>);
export const IconMinus = icon(<path d="M5.4 10h9.2" />);
export const IconTools = icon(<><circle cx="10" cy="5.2" r="1.9" /><circle cx="5" cy="14.4" r="1.9" /><circle cx="15" cy="14.4" r="1.9" /><path d="M8.7 6.9 6.3 12.7" /><path d="M11.3 6.9l2.4 5.8" /><path d="M6.9 14.4h6.2" /></>);
export const IconHuman = icon(<><circle cx="10" cy="7" r="2.8" /><path d="M4.8 16.6a5.2 5.2 0 0 1 10.4 0" /></>);
export const IconAgent = icon(<path d="M10 3.4l1.6 4.5 4.5 1.6-4.5 1.6L10 15.6l-1.6-4.5L3.9 9.5l4.5-1.6z" />);
export const IconAssistant = icon(<path d="M3.4 7a2 2 0 0 1 2-2h9.2a2 2 0 0 1 2 2v4.6a2 2 0 0 1-2 2H9.6L6 16.6v-3H5.4a2 2 0 0 1-2-2z" />);
export const IconStudio = icon(<path d="M10 3.6 16.4 10 10 16.4 3.6 10z" />);
export const IconKeyboard = icon(<><rect x="3" y="6" width="14" height="8" rx="2" /><path d="M6.2 9h.01" /><path d="M9.2 9h.01" /><path d="M12.2 9h.01" /><path d="M6.6 11.6h6.8" /></>);
export const IconInfo = icon(<><circle cx="10" cy="10" r="6.6" /><path d="M10 9.2v4.2" /><path d="M10 6.6h.01" /></>);
export const IconPanelLeft = icon(<><rect x="3.4" y="3.4" width="13.2" height="13.2" rx="2" /><path d="M8.2 3.4v13.2" /></>);
export const IconPanelRight = icon(<><rect x="3.4" y="3.4" width="13.2" height="13.2" rx="2" /><path d="M11.8 3.4v13.2" /></>);
export const IconRoom = icon(<><path d="M3.4 6.4 10 3.4l6.6 3v10.2H3.4z" /><path d="M8 16.6v-5h4v5" /></>);
export const IconSwing = icon(<><path d="M5 15V5" /><path d="M15 5A10 10 0 0 1 5 15" strokeDasharray="2.6 2.2" /></>);
export const IconZone = icon(<rect x="4" y="4" width="12" height="12" rx="2" strokeDasharray="2.8 2.4" />);
export const IconPath = icon(<path d="M3.6 15.4c3.2 0 3.2-4.4 6.4-4.4s3.2-4.4 6.4-4.4" strokeDasharray="2.6 2.2" />);
export const IconDrag = icon(<><path d="M7.4 5.4h.01" /><path d="M12.6 5.4h.01" /><path d="M7.4 10h.01" /><path d="M12.6 10h.01" /><path d="M7.4 14.6h.01" /><path d="M12.6 14.6h.01" /></>);

/** The diagram glyph that matches how the conflict is drawn on the floor (STYLE.md §3). */
export function ConflictIcon({ kind, size, className }: { kind: ConflictKind } & IconProps) {
  switch (kind) {
    case "door_swing":
      return <IconSwing size={size} className={className} />;
    case "traffic":
    case "access_path":
      return <IconPath size={size} className={className} />;
    default:
      return <IconZone size={size} className={className} />;
  }
}

/** The activity row glyph for who acted. */
export function SourceIcon({ source, size, className }: { source: ActionSource } & IconProps) {
  switch (source) {
    case "human":
      return <IconHuman size={size} className={className} />;
    case "agent":
      return <IconAgent size={size} className={className} />;
    case "assistant":
      return <IconAssistant size={size} className={className} />;
    default:
      return <IconStudio size={size} className={className} />;
  }
}
