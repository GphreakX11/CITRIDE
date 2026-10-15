import type { PcapEvidence } from "./pcapEvidence";
export default function PcapEvidencePanel({
  evidence,
}: {
  evidence: PcapEvidence;
}) {
  return (
    <section className="command-panel" aria-label="Corelight packet evidence">
      <span className="command-source-tag">
        Corelight-provided PCAP · offline review
      </span>
      <h2>Packet-backed observations</h2>
      <p>{evidence.source.method}</p>
      <div className="command-metrics">
        <article>
          <strong>{evidence.capture.packet_count}</strong>
          <span>captured packets</span>
        </article>
        <article>
          <strong>{evidence.tcpFlowCount}</strong>
          <span>TCP flows</span>
        </article>
        <article>
          <strong>{evidence.httpRequestCount}</strong>
          <span>decoded HTTP requests</span>
        </article>
        <article>
          <strong>{evidence.tlsSniCount}</strong>
          <span>visible TLS names</span>
        </article>
      </div>
      <p>
        Capture time (UTC): {evidence.capture.first_packet_utc} →{" "}
        {evidence.capture.last_packet_utc}
      </p>
      <details>
        <summary>Source fingerprint and redaction</summary>
        <p>{evidence.source.filename}</p>
        <code className="prototype-hash">{evidence.source.sha256}</code>
        <ul>
          {evidence.redactions.map((text) => (
            <li key={text}>{text}</li>
          ))}
        </ul>
        <p>
          Delivery attributed by Jake. Collector identity and operational
          authenticity are not independently attested by classic PCAP metadata.
        </p>
      </details>
      <div className="command-boundary">
        <strong>Not established by this capture</strong>
        <p>{evidence.notEstablished.join(" · ")}</p>
        <p>
          Supplemental scenario records and modeled service effects are separate
          from these packet observations.
        </p>
      </div>
      <div className="prototype-observations">
        {evidence.observations.map((row) => (
          <details key={row.id}>
            <summary>
              <span>
                Packet {row.packet} · {row.kind}
              </span>
              <strong>{row.summary}</strong>
            </summary>
            <p>
              {row.source} → {row.destination}
            </p>
            <small>Flow start (UTC): {row.timeUtc}</small>
            <p>{row.detail}</p>
            <p className="cc-muted">{row.boundary}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
