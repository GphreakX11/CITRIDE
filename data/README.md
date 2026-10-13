# Fictional Watershed inputs

These files contain a completely synthetic local demonstration. They describe no actual utility, patient, credential, exposure assessment, or operational incident. All entities, rows, and assumptions carry `SIMULATED` handling and resolve to the source catalog in `scenario.json`.

Generate or verify the committed fixture from the repository root:

```bash
python scripts/generate_demo_data.py
python scripts/generate_demo_data.py --check
```

Generation uses a fixed seed (`250`), a fixed UTC incident origin (`2026-10-13T07:00:00Z`, 2 a.m. in America/Chicago for the fictional scenario), and Python's standard library. It makes no network requests. The check command compares exact generated contents without rewriting files. `--output-dir PATH` produces an independent copy for inspection.

| File | Contents |
| --- | --- |
| `scenario.json` | 58 entities, 12 service functions, 6 operational dependencies, 8 sources, 21 assumptions, 6 curated events, 1 prior assessment, and 3 independent scenario seeds |
| `telemetry/network.json` | 18 normal polling connections plus one completed inbound connection at A and probe attempts at B/C, using Zeek-shaped fields |
| `telemetry/controller.json` | Normal controller reads at A/B/C, followed by an invented authentication and dosing change at A |
| `telemetry/sensors.json` | 183 rows covering 2 hours before and 3 hours after the incident: quality drift at A, normal quality at B/C, stable pressure at all three, and tank levels |
| `telemetry/enterprise.json` | 12 quiet enterprise health-check events |

Each telemetry file is a stream object with `id`, `label`, `sourceRef`, and `records`. Curated graph events use `rawRef: {streamId, recordId, sourceRef}` to identify exact raw rows. Raw telemetry is retained outside the graph. Each graph relationship and parameter assumption identifies its sources.

The default `unsafe-water` scenario explicitly assumes Utility A's treated water becomes unsafe within scenario hours 0–1 and remains affected through hour 12. The sensor stream supplies an invented quality-drift storyline; it establishes no real safety threshold. The 12-hour effect is a separate authored assumption and extends beyond the three-hour raw post-incident series.

`low-pressure` replaces that seed with an independent pressure-loss assumption. It does not claim that the default stable-pressure telemetry observed such a loss. Fire flow depends on pressure or absence of water; it does not activate for unsafe water alone. The healthcare safe-water dependencies activate for unsafe water or no water, rather than pressure loss by itself.

`power-loss` begins at Electric Supply E. The directed chain is electricity loss → Plant A treatment unavailable → Utility A no water. Each service-loss conversion is explicitly authored in the dependency record. Water events cannot propagate upstream to imply a power outage.

Utility B/C probes support a shared-source campaign hypothesis. They establish no controller authentication, parameter change, compromise, or physical effect. Facility Q is inside a service polygon and has a safe-water support function, but no operational dependency; it remains a spatial candidate until an explicit dependency is created and promoted. Enterprise background activity is quiet, which is not a conclusion that enterprise IT is safe.

All IP addresses use IETF documentation ranges. GeoJSON polygons near the coordinate origin are schematic and do not represent an actual watershed. Fictional service-area population counts overlap facility occupants and must not be added to those occupants or treated as calculated impact totals. Dependency status `promoted_seed` means the local authored baseline is initialized at revision 1; it records no actual-world validation or approval.
