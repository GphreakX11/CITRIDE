import type {
  InferenceFact,
  InferenceRun,
  InferenceRunSummary,
  OntologyMetadata,
} from "./types";

const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

/** Inline coded assignments only; no reference/seed/parent classification fallback. */
export function idtSectorIri(entity: {
  id: string;
  idt?: unknown;
}): string | null {
  const assignment = entity.idt;
  if (!assignment || typeof assignment !== "object") return null;
  const { status, path } = assignment as Record<string, unknown>;
  if (
    status !== "coded" ||
    typeof path !== "string" ||
    !/^[1-9]\d*(?:\.[1-9]\d*)*$/.test(path)
  )
    return null;
  return `urn:citride:IDT_${path.split(".")[0]}`;
}

/** Choosing a real sector conclusion lets the proof API replay the entire lineage. */
export function idtConclusion(
  entity: { id: string; idt?: unknown },
  run: InferenceRun,
): InferenceFact | null {
  const iri = idtSectorIri(entity);
  if (!iri) return null;
  return (
    [...run.inferredFacts, ...run.assertedFacts].find(
      (fact) =>
        fact.subject.id === entity.id &&
        fact.predicate.iri === RDF_TYPE &&
        fact.object.iri === iri,
    ) ?? null
  );
}

/** A summary/run ID alone cannot establish current-baseline + ontology identity. */
export function isCurrentInferenceRun(
  run: InferenceRun,
  baselineRevision: number,
  metadata: OntologyMetadata | null,
): boolean {
  return Boolean(
    metadata?.sha256 &&
    run.ontology.sha256 === metadata.sha256 &&
    run.baselineRevision === baselineRevision &&
    !run.stale &&
    !run.staleReasons?.baselineRevision &&
    !run.staleReasons?.ontology,
  );
}

/** GET-only lookup. Never creates a run or treats an old snapshot as current proof. */
export async function currentInferenceRun(
  get: <T>(path: string) => Promise<T>,
  baselineRevision: number,
  metadata: OntologyMetadata,
  summaries: InferenceRunSummary[],
): Promise<InferenceRun | null> {
  for (const summary of summaries) {
    if (
      summary.baselineRevision !== baselineRevision ||
      summary.stale ||
      summary.staleReasons?.baselineRevision ||
      summary.staleReasons?.ontology
    )
      continue;
    const run = await get<InferenceRun>(
      `/v1/inference-runs/${encodeURIComponent(summary.id)}`,
    );
    if (isCurrentInferenceRun(run, baselineRevision, metadata)) return run;
  }
  return null;
}
