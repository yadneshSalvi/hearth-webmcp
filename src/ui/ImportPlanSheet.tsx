"use client";
/**
 * Import a floor plan (TOOLS.md §40): drop or pick an image of a plan, let the plan reader name the
 * rooms and their printed sizes, check the mini plan the engine laid out, then build the home from
 * it. The same `readPlan` → `planToScene` → `applyImportedPlan` path the agent's tool takes, so a
 * human's "Build this home" and an agent's `import_floor_plan` produce the same rooms.
 *
 * The image is also kept in `ui.uploadedPlan`, which is what the agent's tool reads when it is
 * called without a URL — dropping a plan here is how a human hands it to their agent.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import { createPortal } from "react-dom";
import { planToScene } from "../engine/floorplan";
import type { ParsedPlan, PlanBuild } from "../engine/floorplan";
import { polyBBox, roomAreaM2 } from "../engine/geometry";
import { starterFurniture } from "../engine/starter";
import { readPlan } from "../floorplan/client";
import { hearthStore, useHearthStore } from "../state/store";
import { palette } from "../tokens";
import { useCopyFlash } from "./clipboard";
import { plural } from "./format";
import { IconCheck, IconHandoff, IconUpload } from "./icons";
import { imageFileFrom, keepUploadedPlan, readPlanFile } from "./planUpload";
import { Button, Chip, Field, Tag } from "./primitives";
import { Sheet } from "./Sheet";
import { miniPlan } from "./templates";
import { pushToast } from "./toast-bus";
import { historyMarker, toolUi, undoTo } from "./useHearth";

const PLAN_W = 300;
const PLAN_H = 190;
const AGENT_PROMPT = "Build my home from the floor plan I uploaded, furnished";

type Status = { kind: "idle" } | { kind: "reading" } | { kind: "ready"; parsed: ParsedPlan; build: PlanBuild } | { kind: "error"; detail: string };

function roomTypeLabel(type: string): string {
  return type.replace(/^./, (first) => first.toUpperCase());
}

/** The drop target and file picker; shows the chosen image once there is one. */
function PlanPicker({ onFile, busy }: { onFile(file: File): void; busy: boolean }) {
  const plan = useHearthStore((state) => state.ui.uploadedPlan);
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    setOver(false);
    const file = imageFileFrom(event.dataTransfer);
    if (file) onFile(file);
    else pushToast({ title: "Drop an image of the plan", detail: "png, jpeg or webp, up to 8 MB.", tone: "warn" });
  };

  const onPick = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0];
    if (file) onFile(file);
    event.target.value = "";
  };

  return (
    <div
      data-plan-dropzone=""
      onDragOver={(event) => { event.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-2.5 rounded-panel border border-dashed p-3 text-center transition-colors duration-200 ease-out-soft ${
        over ? "border-terracotta/60 bg-terracotta/8" : "border-charcoal/24 bg-plaster/45"
      }`}
    >
      {plan ? (
        <>
          {/* A data: URL from the human's own file; next/image has nothing to optimise here. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={plan.dataUrl} alt={`Your floor plan: ${plan.name}`} className="max-h-[190px] w-auto max-w-full rounded-chip border border-hairline bg-canvas-top object-contain" />
          <p className="numerals max-w-full truncate text-[11.5px] text-ink-muted">
            {plan.name} · {plan.width} × {plan.height} px
          </p>
        </>
      ) : (
        <>
          <IconUpload size={22} className="text-terracotta" />
          <p className="font-display text-[15px] leading-snug text-ink">Drop your floor plan here</p>
          <p className="max-w-[30ch] text-[12px] leading-relaxed text-ink-muted">
            A 2D plan with room names works best; printed sizes make it exact. png, jpeg or webp, up to 8 MB.
          </p>
        </>
      )}
      <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" aria-label="Choose a floor-plan image" onChange={onPick} />
      <Button size="sm" icon={IconUpload} disabled={busy} onClick={() => input.current?.click()}>
        {plan ? "Choose another image" : "Browse for an image"}
      </Button>
    </div>
  );
}

/** What the reader saw and how the engine laid it out. */
function PlanReading({ parsed, build }: { parsed: ParsedPlan; build: PlanBuild }) {
  const plan = useMemo(() => miniPlan(build.scene.rooms, PLAN_W, PLAN_H), [build]);
  const area = build.scene.rooms.reduce((total, room) => total + roomAreaM2(room), 0);
  return (
    <div className="flex min-h-0 flex-col gap-2.5" data-plan-reading="">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-display truncate text-[15px] leading-tight text-ink">{parsed.title.trim() || "Your plan"}</h3>
        <span className="numerals shrink-0 text-[11.5px] text-ink-muted">
          {plural(build.scene.rooms.length, "room")} · {area.toFixed(0)} m² · read at {Math.round(parsed.confidence * 100)}%
        </span>
      </div>
      <span className="flex items-center justify-center overflow-hidden rounded-chip border border-hairline bg-canvas-top">
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} width="100%" height={120} aria-hidden="true" focusable="false">
          {plan.rooms.map((room) => (
            <polygon key={room.id} points={room.points} fill={room.fill} fillOpacity={0.62} stroke={palette.charcoal} strokeOpacity={0.34} strokeWidth={1} />
          ))}
        </svg>
      </span>
      <ul className="flex max-h-[150px] flex-col overflow-y-auto panel-scroll" aria-label="Rooms found on the plan">
        {build.scene.rooms.map((room) => {
          const box = polyBBox(room.poly);
          return (
            <li key={room.id} className="flex items-baseline justify-between gap-2 border-b border-hairline/70 py-1 last:border-0">
              <span className="min-w-0 truncate text-[12.5px] text-ink">{room.name}</span>
              <span className="label-caps shrink-0 text-[10px] text-ink-faint">{roomTypeLabel(room.type)}</span>
              <span className="numerals shrink-0 text-[11.5px] text-ink-muted">{Math.round(box.w)} × {Math.round(box.d)} cm</span>
            </li>
          );
        })}
      </ul>
      {build.skipped.length > 0 || build.notes.length > 0 ? (
        <ul className="flex flex-col gap-1 text-[11.5px] leading-snug text-ink-muted">
          {build.skipped.map((entry) => <li key={entry}>Left out: {entry}.</li>)}
          {build.notes.slice(0, 3).map((note) => <li key={note}>{note}</li>)}
        </ul>
      ) : null}
    </div>
  );
}

function AgentHandoff() {
  const { copied, copy } = useCopyFlash();
  return (
    <button
      type="button"
      onClick={() => copy(AGENT_PROMPT)}
      title={AGENT_PROMPT}
      className={`flex w-full items-center gap-2 rounded-chip border px-2.5 py-1.5 text-left transition-colors duration-200 ease-out-soft ${
        copied ? "border-sage/45 bg-sage/14" : "border-hairline bg-plaster/45 hover:bg-plaster"
      }`}
    >
      {copied ? <IconHandoff size={14} className="shrink-0 text-sage" /> : null}
      <span className="font-display min-w-0 flex-1 truncate text-[12px] italic text-ink-muted">
        {copied ? "Copied — paste into ChatGPT" : `Or ask your agent: “${AGENT_PROMPT}”`}
      </span>
    </button>
  );
}

export function ImportPlanSheet() {
  const open = useHearthStore((state) => state.ui.importSheetOpen ?? false);
  const uploaded = useHearthStore((state) => state.ui.uploadedPlan);
  const confirming = useHearthStore((state) => state.ui.pendingConfirm !== undefined);
  // A reading belongs to the image it was made from: a new image starts back at idle.
  const [reading, setReading] = useState<{ at?: number; status: Status }>({ status: { kind: "idle" } });
  const status: Status = reading.at === uploaded?.at ? reading.status : { kind: "idle" };
  const setStatus = (next: Status): void => setReading({ at: uploaded?.at, status: next });
  const [furnished, setFurnished] = useState(true);
  const [url, setUrl] = useState("");
  const [applying, setApplying] = useState(false);
  const abort = useRef<AbortController | undefined>(undefined);

  useEffect(() => () => abort.current?.abort(), []);

  const close = (): void => {
    abort.current?.abort();
    hearthStore.getState().setUi({ importSheetOpen: false });
  };

  const onFile = async (file: File): Promise<void> => {
    const result = await readPlanFile(file);
    if (!result.ok) {
      pushToast({ title: "That image cannot be used", detail: result.detail, tone: "warn" });
      return;
    }
    keepUploadedPlan(result.plan);
  };

  const read = async (): Promise<void> => {
    const request = url.trim() ? { url: url.trim() } : uploaded ? { image: uploaded.dataUrl } : undefined;
    if (!request) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStatus({ kind: "reading" });
    const result = await readPlan(request, controller.signal);
    if (controller.signal.aborted) return;
    if (!result.ok) {
      setStatus({ kind: "error", detail: result.detail });
      return;
    }
    try {
      setStatus({ kind: "ready", parsed: result.plan, build: planToScene(result.plan) });
    } catch (error) {
      setStatus({ kind: "error", detail: error instanceof Error ? error.message : "The plan could not be laid out." });
    }
  };

  const apply = async (): Promise<void> => {
    if (status.kind !== "ready" || applying) return;
    setApplying(true);
    try {
      const state = hearthStore.getState();
      const placed = state.scene.furniture.filter((item) => item.status === "placed").length;
      if (placed > 0) {
        const decision = await toolUi.confirmHuman(`Replace this home and its ${placed} placed items with the imported floor plan?`);
        if (!decision.accepted) return;
      }
      const scene = furnished ? { ...status.build.scene, furniture: starterFurniture(status.build.scene, state.catalog) } : status.build.scene;
      const label = url.trim() ? (status.parsed.title.trim() || "the plan image") : (uploaded?.name ?? "your plan");
      const marker = historyMarker();
      hearthStore.getState().applyImportedPlan("human", scene, label);
      pushToast({
        title: `Home built from ${label}`,
        detail: `${plural(scene.rooms.length, "room")} · ${plural(scene.openings.length, "opening")}${furnished ? ` · ${plural(scene.furniture.length, "item")}` : ""}`,
        tone: "success",
        action: { label: "Undo", run: () => undoTo(marker) },
      });
      close();
    } finally {
      setApplying(false);
    }
  };

  if (!open || confirming || typeof document === "undefined") return null;
  const canRead = (uploaded !== undefined || url.trim().length > 0) && status.kind !== "reading";

  return createPortal(
    <Sheet
      open={open}
      onClose={close}
      title="Import a floor plan"
      subtitle="Hearth reads the rooms and their printed sizes, then builds the home to scale."
      width={760}
      footer={
        <>
          <Chip active={furnished} icon={furnished ? IconCheck : undefined} onClick={() => setFurnished(!furnished)}>
            Furnished
          </Chip>
          <span className="flex-1" />
          {status.kind === "ready" ? (
            <Button variant="primary" icon={IconCheck} disabled={applying} data-plan-apply="" onClick={() => void apply()}>
              Build this home
            </Button>
          ) : (
            <Button variant="primary" icon={IconUpload} disabled={!canRead} data-plan-read="" onClick={() => void read()}>
              {status.kind === "reading" ? "Reading the plan…" : status.kind === "error" ? "Try again" : "Read the plan"}
            </Button>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2.5">
          <PlanPicker onFile={(file) => void onFile(file)} busy={status.kind === "reading"} />
          <Field
            label="Or paste an image URL"
            placeholder="https://…/floor-plan.png"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Enter" && canRead) void read(); }}
          />
          <AgentHandoff />
        </div>
        <div className="flex min-h-[220px] flex-col">
          {status.kind === "ready" ? (
            <PlanReading parsed={status.parsed} build={status.build} />
          ) : status.kind === "reading" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="status" aria-live="polite">
              <span className="h-1 w-40 overflow-hidden rounded-pill bg-charcoal/10">
                <span className="block h-full w-1/3 animate-pulse rounded-pill bg-terracotta" />
              </span>
              <p className="font-display text-[14px] italic text-ink-muted">Reading room names, sizes, doors and windows…</p>
              <p className="text-[11.5px] text-ink-faint">Usually 20 to 60 seconds.</p>
            </div>
          ) : status.kind === "error" ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center" role="alert">
              <Tag tone="amber">Could not read the plan</Tag>
              <p className="max-w-[34ch] text-[12.5px] leading-relaxed text-ink-muted">{status.detail}</p>
            </div>
          ) : (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
              <p className="font-display text-[14px] italic text-ink-muted">The rooms it finds will appear here.</p>
              <p className="max-w-[32ch] text-[11.5px] leading-relaxed text-ink-faint">
                Balconies and decks are left out; doors and windows go where the plan has them, and every room gets a way in.
              </p>
            </div>
          )}
        </div>
      </div>
    </Sheet>,
    document.body,
  );
}
