import { describe, expect, it } from "vitest";
import {
  areaM2, cm, colorwayHex, colorwayLabel, compactJson, confirmLabel, conflictLabel, conflictPhrase,
  dimsFull, dimsLine, maskSecret, modeLabel, plural, relativeTime, sourceLabel, splitNumerals,
  timeOfDayLabel, usd, viewLabel,
} from "../../src/ui/format";
import { palette } from "../../src/tokens";

describe("money and measurements", () => {
  it("formats USD with thousands separators and no cents", () => {
    expect(usd(1240)).toBe("$1,240");
    expect(usd(0)).toBe("$0");
    expect(usd(790.4)).toBe("$790");
    expect(usd(-120)).toBe("-$120");
  });

  it("always carries units", () => {
    expect(cm(240)).toBe("240 cm");
    expect(cm(239.6)).toBe("240 cm");
    expect(dimsLine({ w: 220, d: 95, h: 85 })).toBe("220 × 95 cm");
    expect(dimsFull({ w: 220, d: 95, h: 85 })).toBe("220 × 95 × 85 cm");
    expect(areaM2(229_000)).toBe("22.9 m²");
  });
});

describe("relative time", () => {
  const now = 1_700_000_000_000;
  it("reads as a receipt timestamp", () => {
    expect(relativeTime(now, now)).toBe("just now");
    expect(relativeTime(now - 4_000, now)).toBe("just now");
    expect(relativeTime(now - 12_000, now)).toBe("12 s ago");
    expect(relativeTime(now - 4 * 60_000, now)).toBe("4 min ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 h ago");
    expect(relativeTime(now - 3 * 86_400_000, now)).toBe("3 d ago");
  });

  it("falls back to a date beyond a week and never goes negative", () => {
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
    expect(relativeTime(now + 5_000, now)).toBe("just now");
  });
});

describe("labels", () => {
  it("names modes, views, times, sources and conflicts", () => {
    expect(modeLabel("design")).toBe("Design");
    expect(viewLabel("dollhouse")).toBe("Dollhouse");
    expect(timeOfDayLabel("golden")).toBe("Golden");
    expect(sourceLabel("agent")).toBe("Agent");
    expect(sourceLabel("human")).toBe("You");
    expect(conflictLabel("door_swing")).toBe("Door swing");
    expect(conflictPhrase("door_swing")).toBe("door swing");
  });

  it("resolves colorways from the palette and degrades gracefully", () => {
    expect(colorwayLabel("dusty-blue")).toBe("Dusty blue");
    expect(colorwayHex("terracotta")).toBe(palette.terracotta);
    expect(colorwayLabel("sea-green")).toBe("Sea green");
    expect(colorwayHex("sea-green")).toBe(palette.plaster);
  });

  it("pluralises and masks", () => {
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(3, "item")).toBe("3 items");
    expect(plural(2, "line")).toBe("2 lines");
    expect(maskSecret("hunter2")).toBe("•••••••");
    expect(maskSecret("ab")).toBe("••••");
    expect(maskSecret("a".repeat(40))).toBe("••••••••");
  });
});

describe("confirm labels", () => {
  it("answers the tool's own question", () => {
    expect(confirmLabel("Clear Living Room and remove 7 items?")).toBe("Yes, clear it");
    expect(confirmLabel("Replace the home with the 2BR template?")).toBe("Yes, replace it");
    expect(confirmLabel("Remove every opening?")).toBe("Yes, remove it");
    expect(confirmLabel("Continue?")).toBe("Yes, continue");
  });
});

describe("numeral runs", () => {
  it("splits measurements and prices out of a sentence", () => {
    expect(splitNumerals("You placed Endre Sofa · $790")).toEqual([
      { text: "You placed Endre Sofa · ", numeric: false },
      { text: "$790", numeric: true },
    ]);
    expect(splitNumerals("moved 40 cm east")).toEqual([
      { text: "moved ", numeric: false },
      { text: "40 cm", numeric: true },
      { text: " east", numeric: false },
    ]);
  });

  it("never splits inside a word", () => {
    expect(splitNumerals("the 2BR home")).toEqual([{ text: "the 2BR home", numeric: false }]);
    expect(splitNumerals("sofa-2 moved")).toEqual([{ text: "sofa-2 moved", numeric: false }]);
  });

  it("returns one plain run for text without numbers", () => {
    expect(splitNumerals("Agent arranged the room")).toEqual([{ text: "Agent arranged the room", numeric: false }]);
  });
});

describe("compact json", () => {
  it("pretty-prints and survives cycles", () => {
    expect(compactJson({ ok: true })).toBe('{\n  "ok": true\n}');
    expect(compactJson(undefined)).toBe("—");
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(compactJson(cyclic)).toBe("—");
  });
});
