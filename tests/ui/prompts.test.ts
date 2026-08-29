import { describe, expect, it } from "vitest";
import { promptSuggestions } from "../../src/ui/prompts";
import type { PromptContext } from "../../src/ui/prompts";

function context(patch: Partial<PromptContext> = {}): PromptContext {
  return {
    mode: "design",
    roomName: "Living Room",
    conflictKinds: [],
    cartLines: 0,
    variants: 0,
    accessibility: false,
    ...patch,
  };
}

describe("prompt suggestions", () => {
  it("always returns exactly four unique prompts", () => {
    for (const mode of ["build", "design", "shop"] as const) {
      const prompts = promptSuggestions(context({ mode }));
      expect(prompts).toHaveLength(4);
      expect(new Set(prompts).size).toBe(4);
    }
  });

  it("leads with the selection when the human has one", () => {
    const prompts = promptSuggestions(context({ selectionName: "Endre Sofa" }));
    expect(prompts[0]).toBe("Move the Endre Sofa 40 cm from the window");
  });

  it("leads with the worst conflict, named by kind and room", () => {
    const prompts = promptSuggestions(context({ conflictKinds: ["door_swing", "clearance"] }));
    expect(prompts[0]).toBe("Fix the door swing in the living room");
  });

  it("puts the selection before the conflict", () => {
    const prompts = promptSuggestions(context({ selectionName: "Nook Armchair", conflictKinds: ["traffic"] }));
    expect(prompts[0]).toContain("Nook Armchair");
    expect(prompts[1]).toBe("Fix the walkway in the living room");
  });

  it("offers shop prompts with a price and a fit in shop mode", () => {
    const prompts = promptSuggestions(context({ mode: "shop" }));
    expect(prompts).toContain("Find a sofa under $800 that fits the north wall");
    expect(prompts).toContain("Add a floor lamp to my cart");
  });

  it("offers checkout once the cart has a line", () => {
    const prompts = promptSuggestions(context({ mode: "shop", cartLines: 2 }));
    expect(prompts).toContain("Give me the checkout link");
    expect(prompts).not.toContain("Add a floor lamp to my cart");
  });

  it("offers opening prompts in build mode and names the room", () => {
    const prompts = promptSuggestions(context({ mode: "build", roomName: "Bedroom" }));
    expect(prompts[0]).toBe("Add a 120 cm window on the north wall");
    expect(prompts).toContain("Make the bedroom 40 cm wider");
  });

  it("offers compare once two variants exist", () => {
    expect(promptSuggestions(context({ variants: 2 }))).toContain("Compare my two saved layouts");
    expect(promptSuggestions(context({ variants: 1 }))).toContain("Save this layout as Cosy");
  });

  it("drops the accessibility prompt once accessibility mode is on", () => {
    const off = promptSuggestions(context({ mode: "design", variants: 2 }));
    const on = promptSuggestions(context({ mode: "design", variants: 2, accessibility: true }));
    expect(off).toContain("Make this room wheelchair friendly");
    expect(on).not.toContain("Make this room wheelchair friendly");
  });

  it("keeps every prompt short enough for a chip", () => {
    const all = [
      ...promptSuggestions(context({ mode: "shop", cartLines: 1 })),
      ...promptSuggestions(context({ mode: "build" })),
      ...promptSuggestions(context({ mode: "design", selectionName: "Endre Sofa", conflictKinds: ["clearance"] })),
    ];
    for (const prompt of all) expect(prompt.length).toBeLessThanOrEqual(48);
  });
});
