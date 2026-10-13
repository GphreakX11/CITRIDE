import { useEffect, useRef, useState } from "react";
import cytoscape from "cytoscape";
import type { Core, ElementDefinition } from "cytoscape";
import { Maximize2, Minus, Plus, Network } from "lucide-react";
import type { Bootstrap } from "./types";
import { humanize } from "./api";

interface Props {
  data: Bootstrap;
  selectedId: string | null;
  onSelect: (id: string) => void;
  impactedIds?: string[];
}

export default function Graph({
  data,
  selectedId,
  onSelect,
  impactedIds = [],
}: Props) {
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<Core | null>(null);
  const selectRef = useRef(onSelect);
  const [context, setContext] = useState(false);
  selectRef.current = onSelect;

  useEffect(() => {
    if (!container.current) return;
    const ids = new Set(data.entities.map((entity) => entity.id));
    const dependentIds = new Set(
      data.dependencies.map((link) => link.dependent),
    );
    const rootIds = [
      ...new Set(data.dependencies.map((link) => link.provider)),
    ].filter((id) => !dependentIds.has(id));
    const visible = context
      ? data.entities
      : data.entities.filter((entity) =>
          data.dependencies.some(
            (link) =>
              link.provider === entity.id || link.dependent === entity.id,
          ),
        );
    const elements: ElementDefinition[] = visible.map((entity) => ({
      data: { id: entity.id, label: entity.label, kind: entity.type },
      classes: /Plant|Treatment|Utility|Power|Electric|ServiceProvider/.test(
        entity.type,
      )
        ? "provider"
        : /Cyber|OTAsset|ITAsset|PLC|HMI|Sensor/.test(entity.type)
          ? "cyber"
          : "facility",
    }));
    for (const link of data.dependencies) {
      elements.push({
        data: {
          id: `edge-${link.id}`,
          source: link.provider,
          target: link.dependent,
          label: humanize(link.requiredService),
        },
        classes: "dependency",
      });
    }
    if (context) {
      for (const entity of data.entities) {
        for (const relation of [
          "partOf",
          "operatedBy",
          "locatedIn",
          "hostedBy",
          "hostsCyberAsset",
          "serves",
        ] as const) {
          const refs = entity[relation];
          for (const target of typeof refs === "string"
            ? [refs]
            : (refs ?? [])) {
            if (ids.has(target) && entity.id !== target)
              elements.push({
                data: {
                  id: `context-${entity.id}-${relation}-${target}`,
                  source: entity.id,
                  target,
                  label: humanize(relation),
                },
                classes:
                  relation === "locatedIn" || relation === "serves"
                    ? "spatial"
                    : "context",
              });
          }
        }
      }
    }
    const cy = cytoscape({
      container: container.current,
      elements,
      minZoom: 0.25,
      maxZoom: 2.4,
      wheelSensitivity: 0.2,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "#3b8292",
            label: "data(label)",
            color: "#173249",
            "font-size": 10,
            "font-family": "Arial, sans-serif",
            "text-valign": "bottom",
            "text-margin-y": 9,
            "text-wrap": "wrap",
            "text-max-width": "96px",
            width: 30,
            height: 30,
            "border-width": 6,
            "border-color": "#e5f2f5",
          },
        },
        {
          selector: ".provider",
          style: {
            "background-color": "#255cc5",
            "border-color": "#e0e9ff",
            shape: "round-rectangle",
            width: 36,
            height: 36,
          },
        },
        {
          selector: ".cyber",
          style: {
            "background-color": "#708198",
            "border-color": "#e7ebf0",
            width: 23,
            height: 23,
          },
        },
        {
          selector: "edge",
          style: {
            width: 1.8,
            "line-color": "#619aa7",
            "target-arrow-color": "#619aa7",
            "target-arrow-shape": "triangle",
            "curve-style": "bezier",
            "arrow-scale": 0.7,
          },
        },
        {
          selector: ".context",
          style: {
            width: 1,
            "line-style": "dashed",
            "line-color": "#b4bfcf",
            "target-arrow-color": "#b4bfcf",
          },
        },
        {
          selector: ".spatial",
          style: {
            width: 1,
            "line-style": "dotted",
            "line-color": "#caaf73",
            "target-arrow-color": "#caaf73",
          },
        },
        {
          selector: ".impacted",
          style: { "background-color": "#d27832", "border-color": "#f9e9d9" },
        },
        {
          selector: ".selected",
          style: {
            "border-color": "#233b6b",
            "border-width": 4,
            width: 40,
            height: 40,
          },
        },
        {
          selector: ".connected",
          style: {
            width: 3,
            "line-color": "#255cc5",
            "target-arrow-color": "#255cc5",
          },
        },
      ],
      layout: context
        ? {
            name: "cose",
            animate: false,
            nodeRepulsion: () => 13000,
            idealEdgeLength: () => 125,
            padding: 42,
            componentSpacing: 70,
          }
        : {
            name: "breadthfirst",
            directed: true,
            roots: rootIds,
            spacingFactor: 1.25,
            avoidOverlap: true,
            nodeDimensionsIncludeLabels: true,
            padding: 42,
            animate: false,
          },
    });
    cy.on("tap", "node", (event) => selectRef.current(event.target.id()));
    instance.current = cy;
    const resize = new ResizeObserver(() => {
      cy.resize();
      cy.fit(undefined, 42);
    });
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      cy.destroy();
      instance.current = null;
    };
  }, [data, context]);

  useEffect(() => {
    const cy = instance.current;
    if (!cy) return;
    cy.nodes().removeClass("selected impacted");
    cy.edges().removeClass("connected");
    impactedIds.forEach((id) => cy.getElementById(id).addClass("impacted"));
    if (selectedId) {
      const node = cy.getElementById(selectedId);
      node.addClass("selected");
      node.connectedEdges(".dependency").addClass("connected");
    }
  }, [selectedId, impactedIds, data, context]);

  return (
    <div className="graph-panel">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Live model</span>
          <h2>
            <Network size={18} /> Operational relationships
          </h2>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={context}
            onChange={(event) => setContext(event.target.checked)}
          />
          Show infrastructure context
        </label>
      </div>
      <div
        className="graph-canvas"
        ref={container}
        role="img"
        aria-label={`Interactive dependency graph with ${data.dependencies.length} operational links. Use the entity selector below for keyboard access.`}
      />
      <div className="graph-tools">
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom graph in"
          onClick={() => {
            const cy = instance.current;
            if (cy) cy.zoom(cy.zoom() * 1.2);
          }}
        >
          <Plus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Zoom graph out"
          onClick={() => {
            const cy = instance.current;
            if (cy) cy.zoom(cy.zoom() / 1.2);
          }}
        >
          <Minus size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Fit graph"
          onClick={() => instance.current?.fit(undefined, 42)}
        >
          <Maximize2 size={16} />
        </button>
      </div>
      <div className="graph-footer">
        <div className="legend">
          <span>
            <i className="legend-line" />
            Dependency
          </span>
          <span>
            <i className="legend-line context" />
            Structural
          </span>
          <span>
            <i className="legend-line spatial" />
            Spatial
          </span>
        </div>
        <label className="visually-hidden" htmlFor="entity-picker">
          Inspect entity
        </label>
        <select
          id="entity-picker"
          value={selectedId ?? ""}
          onChange={(event) => selectRef.current(event.target.value)}
        >
          <option value="">Inspect an entity…</option>
          {data.entities.map((entity) => (
            <option key={entity.id} value={entity.id}>
              {entity.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
