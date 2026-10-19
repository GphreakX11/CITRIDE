import displayCatalog from "../../data/reference/display_catalog.json" with { type: "json" };
// Authored display aliases live in reference data, not incident-specific logic.
// Never rewrite API data, identifiers, custom text, raw evidence, or exports.
const referenceCopy: Readonly<Record<string, string>> = displayCatalog.copy;

export function displayText(value: string): string {
  return Object.hasOwn(referenceCopy, value) ? referenceCopy[value] : value;
}
