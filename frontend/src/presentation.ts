// Presentation aliases for known Watershed reference records only.
// Do not rewrite API data, identifiers, custom text, raw evidence, or exports.
const referenceCopy: Readonly<Record<string, string>> = {
  SIMULATED: "Reference data",
  '["SIMULATED"]': "Reference data",
  synthetic_index: "Relative index",
  "synthetic-campaign-01": "Campaign 01",
  "Simulated completed connection at A.": "Completed connection at A.",
  "Invented demonstration parameter, not a measured or clinical planning value.":
    "Scenario parameter, not a measured or clinical planning value.",
  "citride-demo-interval-v1": "interval-v1",
  "Fictional Service Area A": "Service Area A",
  "Fictional Service Area B": "Service Area B",
  "Fictional Service Area C": "Service Area C",
  "Fictional Electricity Operator E": "Electricity Operator E",
  "Synthetic infrastructure inventory": "Infrastructure inventory",
  "Synthetic dependency assumptions": "Dependency assumptions",
  "Fictional prior OT assessment": "Prior OT assessment",
  "Synthetic Zeek-shaped connection stream": "Network connection records",
  "Synthetic controller audit stream": "Controller audit records",
  "Synthetic sensor time series": "Sensor time series",
  "Synthetic enterprise background stream": "Enterprise background records",
  "Invented authentication and dosing parameter changes, using fictional users and assets.":
    "Reference authentication and dosing-parameter records for the Watershed environment.",
  "A completed simulated connection to the previously exposed controller.":
    "A completed connection to the previously exposed controller.",
  "Simulated successful controller authentication from the unusual source.":
    "Successful controller authentication from the unusual source.",
  "Synthetic quality indicator drifts after the change while pressure remains stable.":
    "Water-quality indicator drifts after the change while pressure remains stable.",
  "Shared source supports linking the probe to the simulated campaign. No compromise or operational loss is established at B.":
    "Shared source links the probe to the campaign. No compromise or operational loss is established at B.",
  "Shared source supports linking the probe to the simulated campaign. No compromise or operational loss is established at C.":
    "Shared source links the probe to the campaign. No compromise or operational loss is established at C.",
  "Illustrative unsafe treated-water effect at Utility A, supported by synthetic control-change and sensor events. Stable pressure means no fire-flow loss is inferred.":
    "Configured unsafe-water effect at Utility A, supported by control-change and sensor records. Stable pressure means no fire-flow loss is inferred.",
  "Synthetic link and parameters initialized in local baseline version 1. No real-world verification or authority approval is implied. Output loss conversion, where present, is an explicit scenario assumption.":
    "Scenario link and parameters initialized in baseline version 1. No real-world verification or authority approval is implied. Output loss conversion, where present, is an explicit scenario assumption.",
};

export function displayText(value: string): string {
  return Object.hasOwn(referenceCopy, value) ? referenceCopy[value] : value;
}
