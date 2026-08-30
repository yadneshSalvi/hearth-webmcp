"use client";
/**
 * Composing the design board: photograph the room twice (dollhouse and plan), build the model and
 * paint the PNG. The plan shot needs the camera, so the view is switched *quietly* — a board export
 * is not something the human did to the home, so it leaves no receipt and no undo step.
 */
import type { StoreApi } from "zustand";
import { createCatalog } from "../engine/catalog";
import { polyBBox } from "../engine/geometry";
import { WALL_T } from "../scene/math";
import type { Room, View } from "../engine/types";
import type { StudioApi } from "../scene/Studio";
import type { HearthStore } from "../state/types";
import { motion } from "../tokens";
import { boardModel } from "./boardCompose";
import { captureFrame, fromFramedShot } from "./capture";
import type { BoardCrop, BoardModel } from "./boardCompose";
import { renderBoard } from "./boardRender";
import type { BoardImages } from "./boardRender";

/** The camera tween plus a beat, so the plan shot is never taken mid-swing. */
const SETTLE_MS = motion.cameraTweenMs + 140;

export interface ComposedBoard {
  blob: Blob;
  model: BoardModel;
  filename: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** A little air around the room so its walls are not flush with the tile's edge. */
const CROP_MARGIN = 0.03;

/**
 * Where the room sits in the plan capture, 0–1 of the frame — its polygon plus the wall thickness
 * the walls extrude outward by, projected through the camera that is about to be photographed.
 *
 * Without this the board cropped the *window*, and a wide room lost its southern wall to a tile that
 * is a different shape from the viewport. Undefined when the camera cannot answer (a capture taken
 * before the first frame), in which case the whole frame is used as before.
 */
function planCrop(studio: StudioApi, room: Room): BoardCrop | undefined {
  const box = polyBBox(room.poly);
  const corners = [
    { x: room.origin.x + box.minX - WALL_T, y: room.origin.y + box.minY - WALL_T },
    { x: room.origin.x + box.maxX + WALL_T, y: room.origin.y + box.minY - WALL_T },
    { x: room.origin.x + box.maxX + WALL_T, y: room.origin.y + box.maxY + WALL_T },
    { x: room.origin.x + box.minX - WALL_T, y: room.origin.y + box.maxY + WALL_T },
  ];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of corners) {
    const point = studio.projectNormalized(corner);
    if (!point) return undefined;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  const margin = Math.max(maxX - minX, maxY - minY) * CROP_MARGIN;
  const clamp = (value: number): number => Math.min(1, Math.max(0, value));
  const crop = {
    x: clamp(minX - margin),
    y: clamp(minY - margin),
    w: clamp(maxX + margin) - clamp(minX - margin),
    h: clamp(maxY + margin) - clamp(minY - margin),
  };
  return crop.w > 0.02 && crop.h > 0.02 ? crop : undefined;
}

type BoardImage = BoardImages["dollhouse"];

async function toImage(blob: Blob): Promise<BoardImage> {
  if (typeof createImageBitmap === "function") return createImageBitmap(blob);
  const url = URL.createObjectURL(blob);
  const image = new Image();
  image.src = url;
  await image.decode();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return image;
}

function release(image: BoardImage): void {
  if (image instanceof ImageBitmap) image.close();
}

/** Slugs the board title for the download name. */
export function boardFilename(title: string, roomId: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || roomId;
  return `hearth-${slug}.png`;
}

/**
 * Captures both views and returns the finished PNG. The original view is always restored, even when
 * a capture fails, so a failed export never leaves the studio pointing somewhere the human did not
 * ask for.
 */
export async function composeBoard(
  studio: StudioApi,
  store: StoreApi<HearthStore>,
  input: { roomId: string; title: string },
): Promise<ComposedBoard> {
  const state = store.getState();
  const room = state.scene.rooms.find((candidate) => candidate.id === input.roomId);
  if (!room) throw new Error(`Room ${input.roomId} is not part of this home`);

  const startView = state.scene.meta.view;
  const shots: Partial<Record<View, Blob>> = {};
  let crop: BoardCrop | undefined;
  // Both shots from the framed shot, and the human's orbit, zoom and pan handed back once the view
  // is home again — the plan half of the board resets the orbit on its way in (`setCameraPlanView`),
  // so restoring per capture would lose it (see `fromFramedShot`).
  await fromFramedShot(async () => {
    let current: View = startView;
    try {
      for (const view of ["dollhouse", "plan"] as const) {
        if (current !== view) {
          store.getState().setView("system", { view }, { quiet: true });
          current = view;
          await wait(SETTLE_MS);
        }
        // Measured from the same camera the shutter is about to use, one line before it fires.
        if (view === "plan") crop = planCrop(studio, room);
        shots[view] = await captureFrame(studio);
      }
    } finally {
      if (current !== startView) store.getState().setView("system", { view: startView }, { quiet: true });
    }
  }, room.id);

  const dollhouseBlob = shots.dollhouse;
  const planBlob = shots.plan;
  if (!dollhouseBlob || !planBlob) throw new Error("The studio frame could not be captured");

  const images: BoardImages = {
    dollhouse: await toImage(dollhouseBlob),
    plan: await toImage(planBlob),
    ...(crop ? { planCrop: crop } : {}),
  };
  try {
    const latest = store.getState();
    const catalog = createCatalog(latest.catalog);
    const items = latest.scene.furniture.filter((item) => item.roomId === room.id && item.status === "placed");
    const model = boardModel({
      title: input.title,
      room,
      items,
      byId: (id) => catalog.byId(id),
      paletteId: latest.scene.meta.paletteId,
      timeOfDay: latest.scene.meta.timeOfDay,
    });
    return { blob: await renderBoard(model, images), model, filename: boardFilename(input.title, room.id) };
  } finally {
    release(images.dollhouse);
    release(images.plan);
  }
}
