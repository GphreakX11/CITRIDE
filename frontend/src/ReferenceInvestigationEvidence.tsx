import type { ReferenceInvestigation } from "./referenceInvestigation";
import "./reference-investigation.css";

export default function ReferenceInvestigationEvidence({
  reference,
}: {
  reference: ReferenceInvestigation;
}) {
  return (
    <section
      className="reference-evidence"
      aria-label="Reference investigation evidence"
    >
      <header className="cc-panel">
        <span className="reference-kicker">SOURCE-ATTRIBUTED REFERENCE</span>
        <h2>Water utility / fuel terminal investigation</h2>
        <p className="cc-note">
          <strong>Source report only · PCAP not attached.</strong> Packet
          indices and outcomes below are reported claims, not independently
          verified findings.
        </p>
        <p>{reference.attribution}</p>
        <dl className="reference-provenance">
          <dt>Source document</dt>
          <dd>{reference.source.filename}</dd>
          <dt>Reported capture</dt>
          <dd>
            <time dateTime={reference.capture.reportedStart}>
              {reference.capture.reportedStart}
            </time>{" "}
            →{" "}
            <time dateTime={reference.capture.reportedEnd}>
              {reference.capture.reportedEnd}
            </time>
          </dd>
          <dt>Reported packets / seed</dt>
          <dd>
            {reference.capture.reportedPacketCount} /{" "}
            {reference.capture.reportedSeed}
          </dd>
          <dt>Referenced PCAP</dt>
          <dd>{reference.source.pcapFilename} · not supplied</dd>
          <dt>Original document SHA-256</dt>
          <dd>
            <code>{reference.source.sha256}</code>
          </dd>
        </dl>
        <p className="cc-muted">
          {reference.source.redactions.join(" ")} Reference hosts remain
          case-local: no geography, service dependencies, current outage or
          operational action has been assumed.
        </p>
      </header>
      <section className="cc-panel" aria-label="Reported assets and endpoints">
        <h2>{reference.assets.length} reported assets & endpoints</h2>
        <p className="cc-muted">
          Host reference from the supplied document. Third-party infrastructure
          is not automatically malicious; network traffic is not a modeled
          service dependency.
        </p>
        <div className="reference-assets">
          {reference.assets.map((asset) => (
            <article
              key={asset.id}
              className="reference-asset"
              data-reference-asset-id={asset.id}
            >
              <h3>
                <code>{asset.ip}</code>
              </h3>
              <p>{asset.hostname || "Hostname not reported"}</p>
              <p>{asset.role}</p>
              <span className="reference-kicker">REPORT ONLY</span>
            </article>
          ))}
        </div>
      </section>
      <section className="cc-panel" aria-label="Reported attack timeline">
        <h2>{reference.timeline.length}-phase reported timeline</h2>
        <p className="cc-muted">
          Packet references locate claims in the author's index; the underlying
          capture has not been examined.
        </p>
        <div className="reference-timeline">
          {reference.timeline.map((phase) => (
            <details key={phase.id} data-reference-phase={phase.phase}>
              <summary>
                <strong>
                  Phase {phase.phase} · {phase.title}
                </strong>
                <span>
                  {phase.relativeWindow} · packets {phase.reportedPackets}
                </span>
              </summary>
              <p>{phase.summary}</p>
              {phase.reportedFlow && (
                <p className="reference-flow">
                  Reported flow: {phase.reportedFlow}
                </p>
              )}
              <ul>
                {phase.reportedActivities.map((row, index) => (
                  <li key={index}>{row.join(" — ")}</li>
                ))}
              </ul>
              <p className="cc-note">
                {phase.corroboration ===
                "decryption_or_endpoint_evidence_required"
                  ? "Exact encrypted content requires decryption, supporting endpoint evidence, or documented exercise ground truth."
                  : "Validate packet and host evidence before accepting the reported outcome."}
              </p>
            </details>
          ))}
        </div>
      </section>
      <details
        className="cc-panel"
        aria-label="Evidence limitations and review issues"
      >
        <summary>Evidence limitations & review issues</summary>
        <ul>
          {reference.reviewLimits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </details>
    </section>
  );
}
