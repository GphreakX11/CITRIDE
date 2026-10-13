import { useEffect, useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Building2,
  ChevronDown,
  Database,
  FileText,
  GitBranch,
  Layers3,
  Loader2,
  Network,
  RefreshCw,
  Scale,
  Shield,
} from "lucide-react";
import { api } from "./api";
import type { OntologyMetadata } from "./types";
import {
  bridges,
  domainColumns,
  exchangeFormats,
  foundations,
  graphRoles,
  policyBoundary,
  runtimeProfile,
  sourceCaveat,
  sourceDocuments,
  tooling,
} from "./ontologyBlueprint";
import type { BlueprintResource, DomainColumn } from "./ontologyBlueprint";
import "./ontology-blueprint.css";

const domainIcons = {
  infrastructure: Building2,
  cyber: Shield,
  consequence: GitBranch,
  decision: Scale,
};

function ResourceList({
  resources,
}: {
  resources: readonly BlueprintResource[];
}) {
  return (
    <ul className="ob-resource-list">
      {resources.map((resource) => (
        <li key={resource.id}>
          <span className="ob-resource-name">{resource.name}</span>
          <span className="ob-resource-status" data-status={resource.status}>
            {resource.status}
          </span>
          {resource.scope && (
            <span className="ob-resource-scope">{resource.scope}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function DomainCard({ column }: { column: DomainColumn }) {
  const Icon = domainIcons[column.id];
  return (
    <article className={`card ob-domain ob-domain--${column.id}`}>
      <div className="ob-domain-top">
        <span className="ob-domain-icon">
          <Icon size={20} aria-hidden="true" />
        </span>
        <span className="ob-ownership">{column.ownership}</span>
      </div>
      <h3>{column.title}</h3>
      <p className="ob-domain-subtitle">{column.subtitle}</p>
      <p className="ob-domain-description">{column.description}</p>
      {column.classes.length > 0 && (
        <div className="ob-authored">
          <p className="ob-mini-label">Target classes · program-owned</p>
          <ul className="ob-class-list">
            {column.classes.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
        </div>
      )}
      <ResourceList resources={column.resources} />
      <div className="ob-domain-boundary">{column.boundary}</div>
      <details className="ob-domain-notes">
        <summary>
          Vocabulary & mapping notes{" "}
          <ChevronDown size={14} aria-hidden="true" />
        </summary>
        <dl>
          {column.resources.map((resource) => (
            <div key={resource.id}>
              <dt>
                {resource.name} <span>· {resource.role}</span>
              </dt>
              <dd>{resource.description}</dd>
            </div>
          ))}
        </dl>
      </details>
    </article>
  );
}

export default function OntologyBlueprint({
  onOpenReasoning,
}: {
  onOpenReasoning: () => void;
}) {
  const [metadata, setMetadata] = useState<OntologyMetadata | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setMetadata(null);
    setError("");
    api<OntologyMetadata>("/v1/ontology")
      .then((result) => {
        if (active) setMetadata(result);
      })
      .catch((failure: unknown) => {
        if (active)
          setError(
            failure instanceof Error ? failure.message : String(failure),
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [reloadKey]);

  return (
    <div className="ontology-blueprint">
      <header className="ob-hero">
        <div>
          <p className="ob-eyebrow">
            <Layers3 size={15} aria-hidden="true" /> Architecture / semantic
            blueprint
          </p>
          <h2>
            One foundation.
            <br />
            <span>Four connected domains.</span>
          </h2>
          <p className="ob-hero-description">
            A source-backed map from infrastructure and cyber context to
            conditional consequences and accountable decisions.
          </p>
          <div className="ob-hero-tags">
            <span className="badge ob-target-badge">Target architecture</span>
            <span>
              <FileText size={13} aria-hidden="true" /> DOCX + full landscape
              PDF
            </span>
          </div>
        </div>
        <div className="ob-hero-aside">
          <span className="ob-hero-symbol">
            <Network size={37} strokeWidth={1.3} aria-hidden="true" />
          </span>
          <p>
            Standards provide context.
            <br />
            <strong>People retain authority.</strong>
          </p>
          <button
            className="button primary"
            type="button"
            onClick={onOpenReasoning}
          >
            Open OWL reasoning <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="card ob-runtime" aria-labelledby="ob-runtime-title">
        <div className="panel-heading">
          <div>
            <p className="ob-mini-label">Implementation boundary</p>
            <h2 id="ob-runtime-title">
              <Database size={17} aria-hidden="true" /> Current local ontology
            </h2>
          </div>
          <button
            className="button secondary small-button"
            type="button"
            disabled={loading}
            onClick={() => setReloadKey((key) => key + 1)}
            aria-label="Refresh ontology metadata"
          >
            <RefreshCw size={13} aria-hidden="true" /> Refresh
          </button>
        </div>
        <div className="ob-runtime-body">
          <p className="ob-runtime-description">
            {runtimeProfile.ontology} is a locally authored{" "}
            <code>{runtimeProfile.namespace}</code> slice. BFO, CCO, IDT and C3O
            are not imported. The target dependencies below are not an
            installed-module inventory.
          </p>
          <div className="ob-metadata" aria-live="polite" aria-busy={loading}>
            {loading ? (
              <p className="ob-loading" role="status">
                <Loader2 className="ob-spinner" size={17} aria-hidden="true" />{" "}
                Loading metadata from the ontology service…
              </p>
            ) : error ? (
              <div className="ob-metadata-error" role="alert">
                <div>
                  <strong>Ontology metadata unavailable</strong>
                  <p>{error}</p>
                </div>
                <button
                  className="button secondary small-button"
                  type="button"
                  onClick={() => setReloadKey((key) => key + 1)}
                >
                  Retry metadata
                </button>
              </div>
            ) : metadata ? (
              <dl className="ob-metadata-grid">
                <div>
                  <dt>Ontology ID</dt>
                  <dd>
                    <code>{metadata.id || "Not reported"}</code>
                  </dd>
                </div>
                <div>
                  <dt>Version</dt>
                  <dd>{metadata.version || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Profile</dt>
                  <dd>{metadata.profile || "Not reported"}</dd>
                </div>
                <div>
                  <dt>Reasoner</dt>
                  <dd>
                    {metadata.engine?.name || "Not reported"}
                    {metadata.engine?.version
                      ? ` · ${metadata.engine.version}`
                      : ""}
                  </dd>
                </div>
                <div className="ob-metadata-hash">
                  <dt>Ontology SHA-256</dt>
                  <dd>
                    <code>{metadata.sha256 || "Not reported"}</code>
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="ob-loading">
                The service did not return ontology metadata. Use Refresh to try
                again.
              </p>
            )}
          </div>
          <ul className="ob-runtime-evidence">
            {runtimeProfile.evidence.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          {metadata?.limitations && metadata.limitations.length > 0 && (
            <details className="ob-service-notes">
              <summary>
                Service-reported reasoning scope{" "}
                <ChevronDown size={14} aria-hidden="true" />
              </summary>
              <ul>
                {metadata.limitations.map((item, index) => (
                  <li key={`${index}-${item}`}>{item}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </section>

      <section
        className="ob-foundations"
        aria-labelledby="ob-foundations-title"
      >
        <div className="ob-section-heading">
          <div>
            <p className="ob-mini-label">Layers 0–1 / foundations</p>
            <h2 id="ob-foundations-title">A common semantic spine</h2>
          </div>
          <span className="ob-section-note">
            Planned integration · selective reuse
          </span>
        </div>
        {foundations.map((foundation) => (
          <article
            key={foundation.id}
            className={`ob-foundation ob-foundation--${foundation.id}`}
          >
            <div className="ob-layer-marker">{foundation.layer}</div>
            <div className="ob-foundation-copy">
              <h3>{foundation.title}</h3>
              <p>{foundation.description}</p>
            </div>
            <ul className="ob-concept-list">
              {foundation.concepts.map((concept) => (
                <li key={concept.name}>
                  <strong>{concept.name}</strong>
                  {foundation.id === "bfo" && (
                    <span>{concept.description}</span>
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section aria-labelledby="ob-domains-title">
        <div className="ob-section-heading">
          <div>
            <p className="ob-mini-label">Layer 2 / domain semantics</p>
            <h2 id="ob-domains-title">
              Distinct responsibilities. Explicit connections.
            </h2>
          </div>
          <span className="ob-section-note">
            Import / map standards · author program semantics
          </span>
        </div>
        <div className="ob-domain-grid">
          {domainColumns.map((column) => (
            <DomainCard key={column.id} column={column} />
          ))}
        </div>
      </section>

      <section className="ob-bridges" aria-labelledby="ob-bridges-title">
        <div className="ob-section-heading">
          <div>
            <p className="ob-mini-label">Layer 2b / cross-domain bridges</p>
            <h2 id="ob-bridges-title">
              Context is linked. Causality is conditional.
            </h2>
          </div>
        </div>
        <div className="ob-bridge-grid">
          {bridges.map((bridge) => (
            <article
              key={bridge.id}
              className={`ob-bridge ob-bridge--${bridge.mode}`}
            >
              <div className="ob-bridge-route">
                <span>
                  {
                    domainColumns.find((column) => column.id === bridge.from)
                      ?.title
                  }
                </span>
                <ArrowRight size={15} aria-hidden="true" />
                <span>
                  {
                    domainColumns.find((column) => column.id === bridge.to)
                      ?.title
                  }
                </span>
              </div>
              <h3>{bridge.relation}</h3>
              <span className="ob-bridge-mode">
                {bridge.mode === "conditional"
                  ? "Explicit assumptions required"
                  : bridge.mode === "advisory"
                    ? "Human review required"
                    : "Explicit structural relation"}
              </span>
              <p>{bridge.condition}</p>
            </article>
          ))}
        </div>
        <div className="ob-policy-note">
          <Scale size={18} aria-hidden="true" />
          <p>
            <strong>{policyBoundary.decisionMode}.</strong> AN01–04 definitions
            and formal G1–G5 policy definitions were not supplied. This
            blueprint does not assert gate passes, compliance or response
            authority.
          </p>
        </div>
      </section>

      <section className="card ob-exchange" aria-labelledby="ob-exchange-title">
        <div className="panel-heading">
          <div>
            <p className="ob-mini-label">Layer 3 / exchange & persistence</p>
            <h2 id="ob-exchange-title">
              Connect systems without conflating semantics
            </h2>
          </div>
        </div>
        <div className="ob-exchange-body">
          <p>
            Exchange formats, interfaces and storage are separate from the
            ontology classes above. Entries describe target integration scope;
            the current service already uses RDF and REST / JSON.
          </p>
          <ResourceList resources={exchangeFormats} />
        </div>
      </section>

      <section className="card ob-graphs" aria-labelledby="ob-graphs-title">
        <div className="panel-heading">
          <div>
            <p className="ob-mini-label">Target graph organization</p>
            <h2 id="ob-graphs-title">
              <Database size={17} aria-hidden="true" /> Five roles. Clear
              provenance boundaries.
            </h2>
          </div>
          <span className="badge ob-planned-badge">Target graph roles</span>
        </div>
        <ol className="ob-graph-grid">
          {graphRoles.map((graph, index) => (
            <li key={graph.id}>
              <span className="ob-graph-number">0{index + 1}</span>
              <h3>{graph.name}</h3>
              <p>{graph.description}</p>
            </li>
          ))}
        </ol>
        <div className="ob-store-note">
          <Database size={17} aria-hidden="true" />
          <p>
            <strong>
              {runtimeProfile.targetStore.name} · planned integration, not
              connected.
            </strong>{" "}
            The current application supports RDF named graphs with file or
            Postgres persistence; the five-role layout above is the target
            organization, not a claim of customer isolation already deployed.
          </p>
        </div>
      </section>

      <details className="card ob-expandable">
        <summary>
          <span>
            <BookOpen size={18} aria-hidden="true" />
            <span>
              <strong>Build path & source notes</strong>
              <small>
                Tooling, optional advisory extraction and document coverage
              </small>
            </span>
          </span>
          <ChevronDown size={18} aria-hidden="true" />
        </summary>
        <div className="ob-expandable-body">
          <div>
            <h3>Target authoring & validation toolchain</h3>
            <p className="ob-tool-intro">
              A planned build path, not a statement that each tool is installed.
              pySHACL proposal checks already exist in the current service.
            </p>
            <ResourceList resources={tooling} />
          </div>
          <div className="ob-source-notes">
            <h3>Architecture source notes</h3>
            <ul>
              {sourceDocuments.map((source) => (
                <li key={source.id}>
                  <strong>{source.name}</strong>
                  <p>{source.coverage}</p>
                </li>
              ))}
            </ul>
            <p>{sourceCaveat}</p>
            <p className="ob-source-boundary">
              CISIApro, CIPCast and DIESIS are design references only. No source
              documents or external modules are loaded by this view.
            </p>
          </div>
        </div>
      </details>
    </div>
  );
}
