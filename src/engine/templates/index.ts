import type { Scene, TemplateId } from "../types";
import { createOneBedroomTemplate } from "./1br";
import { createTwoBedroomTemplate } from "./2br";
import { createThreeBedroomTemplate } from "./3br";
import { createFourBedroomTemplate } from "./4br";
import { createFiveBedroomTemplate } from "./5br";
import { createLoftTemplate } from "./loft";
import { createStudioTemplate } from "./studio";

/** Creates a fresh deterministic template scene; unknown ids are rejected at compile time. */
export function createTemplate(id: TemplateId, opts: { furnished?: boolean } = {}): Scene {
  const furnished = opts.furnished ?? false;
  switch (id) {
    case "studio": return createStudioTemplate(furnished);
    case "1br": return createOneBedroomTemplate(furnished);
    case "2br": return createTwoBedroomTemplate(furnished);
    case "3br": return createThreeBedroomTemplate(furnished);
    case "4br": return createFourBedroomTemplate(furnished);
    case "5br": return createFiveBedroomTemplate(furnished);
    case "loft": return createLoftTemplate(furnished);
  }
}

export { createFiveBedroomTemplate } from "./5br";
export { createFourBedroomTemplate } from "./4br";
export { createLoftTemplate } from "./loft";
export { templateLabel, templateShortLabel } from "./labels";
export { createOneBedroomTemplate } from "./1br";
export { createStudioTemplate } from "./studio";
export { createThreeBedroomTemplate } from "./3br";
export { createTwoBedroomTemplate } from "./2br";
