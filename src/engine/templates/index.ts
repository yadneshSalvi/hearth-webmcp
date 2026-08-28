import type { Scene, TemplateId } from "../types";
import { createOneBedroomTemplate } from "./1br";
import { createTwoBedroomTemplate } from "./2br";
import { createLoftTemplate } from "./loft";
import { createStudioTemplate } from "./studio";

/** Creates a fresh deterministic template scene; unknown ids are rejected at compile time. */
export function createTemplate(id: TemplateId, opts: { furnished?: boolean } = {}): Scene {
  const furnished = opts.furnished ?? false;
  switch (id) {
    case "studio": return createStudioTemplate(furnished);
    case "1br": return createOneBedroomTemplate(furnished);
    case "2br": return createTwoBedroomTemplate(furnished);
    case "loft": return createLoftTemplate(furnished);
  }
}

export { createLoftTemplate } from "./loft";
export { createOneBedroomTemplate } from "./1br";
export { createStudioTemplate } from "./studio";
export { createTwoBedroomTemplate } from "./2br";
