import type { Bootstrap, Dependency, Entity } from "./types.ts";
import type { CommandIncident } from "./commandTypes.ts";
import { consequenceModel, contextChain } from "./commandCenterModel.ts";
import { graphEdges, infrastructureIds, mapPositions } from "./texasGraph.ts";
import type { MapPosition } from "./texasGraph.ts";

export interface CommandMapImpact {
  caseId: string;
  caseTitle: string;
  modelVersion: string | null;
  capturedAt: string | null;
  entityLabel: string;
  functionLabel: string;
  state: string;
  windowHours: [number, number] | null;
  sourceRefs: string[];
  assumptions: string[];
}

export interface CommandMapNode {
  entity: Entity;
  context: boolean;
  capturedOnly: boolean;
  impacts: CommandMapImpact[];
  caseIds: string[];
  renamed: boolean;
}

export interface CommandMapEdge {
  id: string;
  source: string;
  target: string;
  label: string;
  caseIds: string[];
  reference: boolean;
  modeled: boolean;
  sourceRefs: string[];
}

function allowed(entity: Entity): boolean {
  return (
    !/Cyber/i.test(entity.type) &&
    entity.type !== "PhysicalITAsset" &&
    entity.type !== "PhysicalOTAsset"
  );
}

// Context/impacts may identify infrastructure without coordinates or a valid link.
// Abstract context is not promoted into a facility simply because it was captured.
function infrastructure(entity: Entity): boolean {
  return (
    allowed(entity) && !/Area|Organization|PopulationGroup/i.test(entity.type)
  );
}

function addCase(caseIds: string[], id: string): void {
  if (!caseIds.includes(id)) caseIds.push(id);
}

/** Object keys are order-insensitive; arrays and every saved field remain significant. */
function canonical(value: Dependency): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(
      Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
  });
}

/**
 * Reference inventory and immutable case layers never repair each other's gaps.
 * missingRecords counts each input dependency occurrence missing >=1 endpoint once,
 * plus each captured impact occurrence missing its entity once, before edge dedup.
 * Known excluded types, self-links, missing function labels/path IDs do not count.
 */
export function commandInfrastructureModel(
  data: Bootstrap,
  incidents: readonly CommandIncident[],
  selected: CommandIncident | null,
): {
  nodes: CommandMapNode[];
  edges: CommandMapEdge[];
  positions: Map<string, MapPosition>;
  missingRecords: number;
  scopeLabel: string;
  captured: boolean;
} {
  const current = new Map(data.entities.map((entity) => [entity.id, entity]));
  const nodes = new Map<string, CommandMapNode>();
  const edges = new Map<string, CommandMapEdge>();
  let missingRecords = 0;

  const addNode = (saved: Entity, captured: boolean) => {
    if (!allowed(saved)) return;
    // All-active view retains today's inventory record, while impact cards below
    // always retain the saved label/function. Selected view never substitutes it.
    const reference = current.get(saved.id);
    const chosen = !selected && reference ? reference : saved;
    if (!allowed(chosen)) return;
    let node = nodes.get(saved.id);
    if (!node) {
      node = {
        entity: structuredClone(chosen),
        context: false,
        capturedOnly: !reference,
        impacts: [],
        caseIds: [],
        renamed: false,
      };
      nodes.set(saved.id, node);
    }
    if (
      captured &&
      reference &&
      (reference.label !== saved.label || reference.type !== saved.type)
    )
      node.renamed = true;
    return node;
  };

  const addDependencies = (
    layer: Bootstrap,
    incident: CommandIncident | null,
    modeledIds: ReadonlySet<string>,
  ) => {
    const inventory = new Map(
      layer.entities.map((entity) => [entity.id, entity]),
    );
    for (const dependency of layer.dependencies) {
      const provider = inventory.get(dependency.provider);
      const dependent = inventory.get(dependency.dependent);
      if (incident) {
        // An existing endpoint still belongs to the case even if its partner is
        // absent; the absent endpoint is not resolved from a different layer.
        for (const entity of [provider, dependent]) {
          if (!entity || !allowed(entity)) continue;
          const node = nodes.get(entity.id);
          if (node) addCase(node.caseIds, incident.id);
        }
      }
      if (!provider || !dependent) {
        missingRecords++;
        continue;
      }
      if (
        !nodes.has(provider.id) ||
        !nodes.has(dependent.id) ||
        !allowed(provider) ||
        !allowed(dependent)
      )
        continue;
      // One record at a time deliberately avoids graphEdges' ID-level dedup,
      // which otherwise collapses distinct historical revisions of the same ID.
      const graphEdge = graphEdges({
        ...layer,
        dependencies: [dependency],
      }).find((edge) => edge.kind === "dependency");
      if (!graphEdge) continue;
      const key = canonical(dependency);
      let edge = edges.get(key);
      if (!edge) {
        edge = {
          // Canonical record identity is collision-free and stable across layers,
          // key insertion order and unrelated dependency additions/removals.
          id: `${graphEdge.id}:record:${encodeURIComponent(key)}`,
          source: graphEdge.source,
          target: graphEdge.target,
          label: graphEdge.label,
          caseIds: [],
          reference: false,
          modeled: false,
          sourceRefs: [...graphEdge.sourceRefs],
        };
        edges.set(key, edge);
      }
      if (incident) {
        addCase(edge.caseIds, incident.id);
        edge.modeled ||= modeledIds.has(dependency.id);
      } else edge.reference = true;
    }
  };

  if (!selected) {
    const ids = new Set(infrastructureIds(data));
    for (const entity of data.entities)
      if (ids.has(entity.id)) addNode(entity, false);
    addDependencies(data, null, new Set());
  }

  const applicable = selected
    ? [selected]
    : incidents.filter((incident) => incident.status !== "closed");
  for (const incident of applicable) {
    const model = consequenceModel(incident);
    const chain = contextChain(incident);
    const inventory = new Map(
      model.captured.entities.map((entity) => [entity.id, entity]),
    );
    // A run's inventory wins over older context, including labels and types.
    // Only no-run cases may use downstream dependent snapshots as inventory.
    const contextEntities = model.run
      ? chain
      : [
          ...chain,
          ...incident.contextSnapshot.downstreamDependencies.map(
            (item) => item.dependent,
          ),
        ];
    for (const entity of contextEntities)
      if (entity && !inventory.has(entity.id)) inventory.set(entity.id, entity);
    const dependencies = model.run
      ? model.captured.dependencies
      : incident.contextSnapshot.downstreamDependencies.map(
          (item) => item.dependency,
        );
    // The graph helpers read entities/dependencies only. No current inventory or
    // current dependency is present in this layer, even for incomplete snapshots.
    const layer: Bootstrap = {
      baselineRevision:
        model.run?.baselineRevision ?? incident.baselineRevision,
      modelVersion: model.run?.modelVersion ?? "",
      entities: [...inventory.values()],
      dependencies,
      serviceFunctions: model.captured.serviceFunctions,
      sources: model.captured.sources,
      assumptions: [],
      events: [incident.eventSnapshot],
      assessments: [],
      scenarios: [],
      defaultScenarioId: "",
    };
    const ids = new Set(infrastructureIds(layer));
    const extraIds = new Set([
      ...contextEntities.map((entity) => entity.id),
      ...model.rows.map((row) => row.entityId),
      ...(model.run ? [model.run.seed.provider] : []),
    ]);
    for (const entity of inventory.values())
      if (
        ids.has(entity.id) ||
        (extraIds.has(entity.id) && infrastructure(entity))
      )
        addNode(entity, true);

    for (const entity of chain) {
      // Match membership to the winning saved record, not a differing context type.
      const captured = inventory.get(entity.id);
      const node =
        captured && allowed(captured) ? nodes.get(entity.id) : undefined;
      if (node) {
        node.context = true;
        addCase(node.caseIds, incident.id);
      }
    }
    for (const row of model.rows) {
      const entity = inventory.get(row.entityId);
      if (!entity) {
        missingRecords++;
        continue;
      }
      const node = allowed(entity) ? nodes.get(entity.id) : undefined;
      if (!node) continue;
      addCase(node.caseIds, incident.id);
      node.impacts.push({
        caseId: incident.id,
        caseTitle: incident.title,
        modelVersion: model.run?.modelVersion ?? null,
        capturedAt: model.run?.createdAt ?? null,
        entityLabel: entity.label,
        functionLabel: row.functionLabel,
        state: row.state,
        windowHours: row.windowHours ? [...row.windowHours] : null,
        sourceRefs: [...row.sourceRefs],
        assumptions: [...row.assumptions],
      });
    }
    const modeledIds = new Set(model.rows.flatMap((row) => row.paths.flat()));
    addDependencies(layer, incident, modeledIds);
  }

  const chosen = [...nodes.values()];
  return {
    nodes: chosen,
    edges: [...edges.values()],
    positions: mapPositions(chosen.map((node) => node.entity)),
    missingRecords,
    scopeLabel: selected?.title ?? "All active incidents",
    captured: !!selected,
  };
}
