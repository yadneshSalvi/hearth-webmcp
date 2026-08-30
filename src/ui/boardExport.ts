"use client";
/**
 * Composing the design board: photograph the room twice (dollhouse and plan), build the model and
 * paint the PNG. The plan shot needs the camera, so the view is switched *quietly* — a board export
 * is not something the human did to the home, so it leaves no receipt and no undo step.
 */
import type { StoreApi } from "zustand";
import { createCatalog } from "../engine/catalog";
import type { View } from "../engine/types";
import type { StudioApi } from "../scene/Studio";
import type { HearthStore } from "../state/types";
import { motion } from "../tokens";
import { boardModel } from "./boardCompose";
import { captureFrame, fromFramedShot } from "./capture";
import type { BoardModel } from "./boardCompose";
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
