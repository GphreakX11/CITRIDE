// Architectural intent from the supplied DOCX and full-landscape PDF extract.
// This manifest is not an inventory of imported or connected dependencies.
export type IntegrationStatus =
  "Planned integration" | "Optional integration" | "Design reference";
export type ResourceRole =
  | "ontology"
  | "taxonomy"
  | "semantic mapping"
  | "design reference"
  | "exchange"
  | "storage"
  | "tool";

export interface BlueprintResource {
  id: string;
  name: string;
  role: ResourceRole;
  status: IntegrationStatus;
  description: string;
  scope?: string;
}

export interface Foundation {
  id: "bfo" | "cco";
  layer: "Layer 0" | "Layer 1";
  title: string;
  description: string;
  resource: BlueprintResource;
  concepts: readonly { name: string; description: string }[];
}

export interface DomainColumn {
  id: "infrastructure" | "cyber" | "consequence" | "decision";
  title: string;
  subtitle: string;
  description: string;
  ownership: "Imported / mapped target" | "Program-authored target";
  resources: readonly BlueprintResource[];
  classes: readonly string[];
  boundary: string;
}

export const foundations: readonly Foundation[] = [
  {
    id: "bfo",
    layer: "Layer 0",
    title: "BFO 2020 · shared foundation",
    description: "Separate what persists from what unfolds over time.",
    resource: {
      id: "bfo-2020",
      name: "BFO 2020",
      role: "ontology",
      status: "Planned integration",
      description:
        "Target upper ontology; not imported by the current Watershed slice.",
    },
    concepts: [
      { name: "Continuants", description: "Persistent facilities and assets" },
      { name: "Occurrents", description: "Events, cascades and decisions" },
    ],
  },
  {
    id: "cco",
    layer: "Layer 1",
    title: "CCO · selective common modules",
    description: "Reuse a focused vocabulary, not the entire module suite.",
    resource: {
      id: "cco",
      name: "Common Core Ontologies",
      role: "ontology",
      status: "Planned integration",
      description:
        "Selective target imports; no CCO import is claimed in the current service.",
    },
    concepts: [
      {
        name: "Agent & organization",
        description: "Operators and accountable organizations",
      },
      {
        name: "Artifact & facility",
        description: "Built assets and infrastructure",
      },
      { name: "Event & process", description: "Activity unfolding over time" },
      {
        name: "Information entity",
        description: "Records and information content",
      },
      {
        name: "Geospatial region",
        description: "Location and spatial context",
      },
      { name: "Time", description: "Temporal context" },
      {
        name: "Quality & disposition",
        description: "Characteristics and capabilities",
      },
    ],
  },
];

export const domainColumns: readonly DomainColumn[] = [
  {
    id: "infrastructure",
    title: "CI / Sector",
    subtitle: "Assets, services & dependencies",
    description:
      "Connect physical infrastructure to utility services, sector functions and geography.",
    ownership: "Imported / mapped target",
    classes: [],
    resources: [
      {
        id: "idt-owl",
        name: "IDT-OWL v0.1",
        role: "ontology",
        status: "Planned integration",
        scope: "Program-authored · IDT v4 mapping",
        description:
          "Ontology target derived from IDT v4; not a current import.",
      },
      {
        id: "saref4watr",
        name: "SAREF4WATR 2.1.1",
        role: "ontology",
        status: "Planned integration",
        description: "Water-domain vocabulary.",
      },
      {
        id: "uf-okn",
        name: "UF-OKN 2.1",
        role: "ontology",
        status: "Planned integration",
        description: "Utility connection context.",
      },
      {
        id: "cisa-water-ot",
        name: "CISA water OT taxonomy",
        role: "taxonomy",
        status: "Planned integration",
        description: "Water operational-technology classification.",
      },
      {
        id: "national-critical-functions",
        name: "National Critical Functions",
        role: "taxonomy",
        status: "Planned integration",
        description: "55-function roll-up for cross-sector context.",
      },
      {
        id: "geosparql",
        name: "GeoSPARQL",
        role: "ontology",
        status: "Planned integration",
        description:
          "Geospatial semantics; proximity alone does not establish dependency.",
      },
    ],
    boundary:
      "Target imports and mappings; geographic context is not evidence of a service dependency.",
  },
  {
    id: "cyber",
    title: "Cyber",
    subtitle: "Observations, threats & defenses",
    description:
      "Describe cyber activity and its asset context without inferring physical impact from an alert alone.",
    ownership: "Imported / mapped target",
    classes: [],
    resources: [
      {
        id: "c3o",
        name: "C3O · CUBRC",
        role: "ontology",
        status: "Planned integration",
        description: "Cyber ontology target.",
      },
      {
        id: "oasis-tac",
        name: "OASIS TAC",
        role: "semantic mapping",
        status: "Planned integration",
        description: "Threat-actor context.",
      },
      {
        id: "attack-ics",
        name: "ATT&CK for ICS",
        role: "taxonomy",
        status: "Planned integration",
        description: "Industrial-control tactics and techniques.",
      },
      {
        id: "d3fend",
        name: "D3FEND",
        role: "ontology",
        status: "Planned integration",
        description: "Defensive countermeasure vocabulary.",
      },
      {
        id: "grid-stix",
        name: "Grid-STIX",
        role: "semantic mapping",
        status: "Planned integration",
        description:
          "Energy-only mapping; license review required before adoption.",
        scope: "Energy only · license review required",
      },
      {
        id: "sepses",
        name: "SEPSES",
        role: "ontology",
        status: "Optional integration",
        description: "Optional cyber knowledge enrichment.",
      },
    ],
    boundary:
      "A cyber event is evidence of activity, not an automatic finding of service loss.",
  },
  {
    id: "consequence",
    title: "Consequence",
    subtitle: "Conditional impact & timing",
    description:
      "Represent dependency cascades and impact intervals with their explicit assumptions.",
    ownership: "Program-authored target",
    classes: ["Cascade Process", "Sector Impact", "Time-to-Impact Window"],
    resources: [
      {
        id: "cisiapro",
        name: "CISIApro 2.0",
        role: "design reference",
        status: "Design reference",
        description:
          "Cascade-modeling design reference only; not an installed module.",
      },
      {
        id: "cipcast",
        name: "CIPCast 5.0",
        role: "design reference",
        status: "Design reference",
        description:
          "Impact-modeling design reference only; not an installed module.",
      },
      {
        id: "diesis",
        name: "DIESIS",
        role: "design reference",
        status: "Design reference",
        description:
          "Interdependency design reference only; not an installed module.",
      },
    ],
    boundary:
      "Time-to-impact is an assumption-dependent interval, not a clock or a prediction of observed failure.",
  },
  {
    id: "decision",
    title: "Decision / Governance",
    subtitle: "Accountability & human review",
    description:
      "Carry evidence, options and authority context into a human-reviewed decision record.",
    ownership: "Program-authored target",
    classes: [
      "Incident",
      "DecisionCard",
      "AuthorityBasis",
      "Option",
      "DecisionRecord",
      "AITrace",
    ],
    resources: [
      {
        id: "prov-o",
        name: "PROV-O via CASE / UCO",
        role: "semantic mapping",
        status: "Planned integration",
        description:
          "Intended provenance fields; the complete mapping is not implemented.",
      },
    ],
    boundary:
      "AN01–04 definitions and formal G1–G5 policies are not supplied. No gate passes or authorization are asserted.",
  },
];

// External semantic targets only. Exchange formats and software tools stay separate.
export const targetStandards: readonly BlueprintResource[] = [
  ...foundations.map((foundation) => foundation.resource),
  ...domainColumns.flatMap((column) =>
    column.resources.filter((resource) => resource.role !== "design reference"),
  ),
];
export const designReferences: readonly BlueprintResource[] =
  domainColumns.flatMap((column) =>
    column.resources.filter((resource) => resource.role === "design reference"),
  );

export interface BlueprintBridge {
  id: string;
  from: DomainColumn["id"];
  to: DomainColumn["id"];
  relation: string;
  condition: string;
  mode: "structural" | "conditional" | "advisory";
}

export const bridges: readonly BlueprintBridge[] = [
  {
    id: "facility-cyber",
    from: "infrastructure",
    to: "cyber",
    relation: "Facility hosts cyber asset",
    condition:
      "An explicit hosting relationship links the physical and cyber contexts.",
    mode: "structural",
  },
  {
    id: "cyber-consequence",
    from: "cyber",
    to: "consequence",
    relation: "Cyber event has consequence",
    condition:
      "Conditional on explicit dependency, loss and timing assumptions; not automatic causal entailment.",
    mode: "conditional",
  },
  {
    id: "cascade-decision",
    from: "consequence",
    to: "decision",
    relation: "Cascade informs decision card",
    condition:
      "Advisory evidence for human review; does not authorize or execute a response.",
    mode: "advisory",
  },
];

export interface GraphRole {
  id:
    | "ontology"
    | "reference"
    | "customer-instance"
    | "staging"
    | "scenario-runs";
  name: string;
  description: string;
  status: "Target graph role";
}
export const graphRoles: readonly GraphRole[] = [
  {
    id: "ontology",
    name: "Ontology",
    description: "Versioned classes, relations and constraints",
    status: "Target graph role",
  },
  {
    id: "reference",
    name: "Reference",
    description: "Shared standards, taxonomies and mappings",
    status: "Target graph role",
  },
  {
    id: "customer-instance",
    name: "Customer instance",
    description: "Approved organization-specific assets and dependencies",
    status: "Target graph role",
  },
  {
    id: "staging",
    name: "Staging",
    description: "Candidate assertions awaiting validation and review",
    status: "Target graph role",
  },
  {
    id: "scenario-runs",
    name: "Scenario runs",
    description: "Captured inputs, assumptions and immutable results",
    status: "Target graph role",
  },
];

export const exchangeFormats: readonly BlueprintResource[] = [
  {
    id: "ocsf-uco",
    name: "OCSF / UCO",
    role: "exchange",
    status: "Planned integration",
    description: "Normalized observation exchange.",
  },
  {
    id: "stix",
    name: "STIX 2.1",
    role: "exchange",
    status: "Planned integration",
    description: "Threat-intelligence interchange.",
  },
  {
    id: "rdf-jsonld",
    name: "RDF / JSON-LD",
    role: "exchange",
    status: "Planned integration",
    description:
      "Graph serialization target; RDF named graphs are already used locally.",
  },
  {
    id: "delta-s3",
    name: "Delta Lake / S3",
    role: "storage",
    status: "Planned integration",
    description: "Target durable exchange and audit storage.",
  },
  {
    id: "rest-json",
    name: "REST / JSON",
    role: "exchange",
    status: "Planned integration",
    description:
      "Target exchange contract; the current service already exposes a REST / JSON API.",
  },
];

export const tooling: readonly BlueprintResource[] = [
  {
    id: "protege",
    name: "Protégé",
    role: "tool",
    status: "Planned integration",
    description: "Ontology authoring.",
  },
  {
    id: "robot-odk",
    name: "ROBOT / ODK",
    role: "tool",
    status: "Planned integration",
    description: "Repeatable ontology builds and release packaging.",
  },
  {
    id: "elk",
    name: "ELK",
    role: "tool",
    status: "Planned integration",
    description:
      "Target profile-specific reasoning; distinct from current OWL 2 RL entailment.",
  },
  {
    id: "pyshacl",
    name: "pySHACL",
    role: "tool",
    status: "Planned integration",
    description:
      "Broader target validation; current service already performs pySHACL proposal checks.",
  },
  {
    id: "linkml",
    name: "LinkML",
    role: "tool",
    status: "Planned integration",
    description: "Schema and data-model contracts.",
  },
  {
    id: "ontologx",
    name: "OntoLogX staging patterns",
    role: "tool",
    status: "Optional integration",
    description: "Optional reviewed staging workflow patterns.",
  },
  {
    id: "ontogpt-spires",
    name: "OntoGPT / SPIRES",
    role: "tool",
    status: "Optional integration",
    description:
      "Advisory extraction after beta; candidates remain subject to validation and human review.",
    scope: "After beta · advisory only",
  },
];

export const runtimeProfile = {
  ownership: "Locally authored",
  namespace: "urn:citride:",
  ontology: "Watershed",
  profile: "OWL 2 RL",
  engine: "owlrl",
  importedOntologies: [] as readonly string[],
  importedAlignmentClaimed: false,
  evidence: [
    "Local RDF named graphs with pySHACL proposal checks",
    "Conditional interval consequence engine, separate from OWL entailment",
    "Immutable scenario snapshots",
    "REST / JSON service with file and Postgres persistence adapters",
  ],
  targetStore: {
    name: "Amazon Neptune",
    status: "Planned integration",
    connected: false,
  },
} as const;

export const policyBoundary = {
  analysisDefinitions: "AN01–04",
  gateDefinitions: "G1–G5",
  definitionsProvided: false,
  gatePassesClaimed: false,
  decisionMode: "Advisory · human review required",
} as const;

export const sourceDocuments = [
  {
    id: "docx",
    name: "CITRIDE Ontology Standards and Open-Source Resources.docx",
    filename: "CITRIDE Ontology Standards and Open-Source Resources.docx",
    coverage:
      "Standards guide and architecture decisions reviewed from the supplied DOCX, dated October 13, 2026.",
  },
  {
    id: "landscape-pdf",
    name: "CITRIDE_Ontology_Layer2.pdf",
    filename: "CITRIDE_Ontology_Layer2.pdf",
    coverage:
      "Full landscape matrix in the supplied source extract, including all four domain columns.",
  },
  {
    id: "portrait-pdf",
    name: "CITRIDE_Ontology_Layer.pdf",
    filename: "CITRIDE_Ontology_Layer.pdf",
    coverage:
      "Reviewed portrait export; right-side content is clipped. The full landscape version governs the complete domain matrix.",
  },
] as const;
export const sourceCaveat =
  "The portrait diagram is clipped and is not treated as a complete domain matrix. Source documents describe architectural intent, not installed integrations.";
