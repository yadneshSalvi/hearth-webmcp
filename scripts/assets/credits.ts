import { assetMappings } from "./mapping";
import { creditsPath } from "./paths";
import { sourceCollections } from "./sources";
import { atomicWrite } from "./fs";

export async function writeCredits(): Promise<void> {
  const usedKeys = new Set(assetMappings.map((mapping) => mapping.sourceKey));
  const sections = Object.values(sourceCollections)
    .filter((source) => usedKeys.has(source.key))
    .map((source) => [
      `### ${source.label}`,
      "",
      `- Creator: ${source.author}`,
      `- Source: [project or bundle page](${source.pageUrl})`,
      `- Licence: [Creative Commons Zero 1.0 Universal](${source.licenseUrl}) (CC0 / public domain)`,
      "archive" in source ? "- Licence evidence is also included in the downloaded source archive." : "- Each linked poly.pizza model page identifies the model as Public Domain (CC0).",
    ].join("\n"));

  const table = assetMappings.map((mapping) => {
    const source = sourceCollections[mapping.sourceKey];
    const escapedModel = mapping.sourceModel.replaceAll("|", "\\|");
    return `| \`${mapping.id}.glb\` | ${escapedModel} | [${source.label}](${source.pageUrl}) | ${source.author} | [CC0](${source.licenseUrl}) |`;
  });

  const markdown = [
    "# Hearth 3D asset credits",
    "",
    "All shipped models are dedicated to the public domain under CC0. No CC-BY or otherwise restricted assets are included. Attribution is not legally required by CC0, but source provenance is retained here for verification and thanks.",
    "",
    "## Licence evidence by source",
    "",
    ...sections.flatMap((section) => [section, ""]),
    "## Per-file provenance",
    "",
    "| File | Source model | Collection | Author | Licence |",
    "|---|---|---|---|---|",
    ...table,
    "",
  ].join("\n");
  await atomicWrite(creditsPath, markdown);
}
