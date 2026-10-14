# Texas infrastructure relationship map

## Problem
The COP's schematic rectangles have overlapping labels and conceal dependency relationships. Jake requests a recognizable Texas backdrop with infrastructure overlay, graph connections, and click-to-inspect neighbors.

## Requirements
- Locally vendored real Texas boundary, no map keys or runtime tiles.
- Existing providers, plants, power and facilities overlaid with actual directed dependencies and distinct structural relations.
- Click/keyboard node selection highlights its actual neighbors and opens an in-place incoming/outgoing relationship inspector.
- Inspector shows relation type, service/function and source references; traverse neighbors without leaving the map.
- Search, area filter, zoom/reset, pointer pan and accessible entity selector.
- Geography, containment/ownership and service dependencies remain distinct; no inferred links from proximity.
- Current reference locations remain clearly illustrative display positions; never overwrite source coordinates.

## Non-goals
No real addresses/geocoding, backend mutations, new approvals or automatic publication.

## Acceptance criteria
- All six seed dependencies have exact endpoint/direction parity; no service dependency invented for Facility Q.
- Utility A selection reveals healthcare dependents and treatment input; plant traversal reveals cyber/OT assets.
- Clear Texas silhouette and legible labels, desktop/mobile inspector with functional controls.
- Keyboard/search/filter/reset/traversal tests, frontend test/format/build and populated browser QA pass.
- Staged assets + read-only real production APIs preserve source, cases and runs; distinguish candidate from published version.
