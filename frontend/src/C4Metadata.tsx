import { hours, windowTone, type ConsequenceProjection } from "./consequencesModel.ts";
import StatusChip from "./StatusChip.tsx";
import InfrastructureIcon from "./InfrastructureIcon.tsx";
import "./c4-metadata.css";

export function sectorScore(value: ConsequenceProjection, sector: string) {
  return value.consequenceScores?.flatMap(r => r.sectors).find(s => s.sector === sector)?.score
    ?? value.sectorViews?.flatMap(r => r.sectors).find(s => s.sector === sector)?.score
    ?? value.sectors.find(s => s.label === sector)?.score;
}
export function C4Functions({value}: {value: ConsequenceProjection}) {
  if (!value.criticalFunctions?.length) return null;
  return <section className="c4-panel c4-functions" aria-label="Critical functions at risk">
    <h2>Critical functions at risk · {value.criticalFunctions.length}</h2>
    {value.criticalFunctions.map((f, i) => <article key={i}>
      <StatusChip status={f.level}/><strong>{f.function}</strong>
      {f.idt && <small>IDT {f.idt}</small>}
      <span className={`tone-${windowTone(f.windowHours)}`}>{hours(f.windowHours)}</span>
      {f.note && <small>{f.note}</small>}
    </article>)}
  </section>;
}
export function C4WatchPosture({value, onSelect}: {value: ConsequenceProjection; onSelect: (id: string) => void}) {
  if (!value.watchAssets?.length) return null;
  return <section className="c4-panel c4-watch" aria-label="Watch posture">
    <h2>ON WATCH · SAME CAMPAIGN</h2>
    <p>Watch relationships are not service dependencies and do not propagate modeled impact.</p>
    <div className="c4-watch-list">{value.watchAssets.map((w, i) => {
      const node = value.nodes.find(n => n.id === w.entityId);
      return <article key={i}>
        <button onClick={() => onSelect(w.entityId)}>
          <InfrastructureIcon icon={w.entity?.icon || node?.icon || value.entityIcons?.[node?.type || w.entity?.type || ""]} size={20}/>
          {w.entity?.label || w.entity?.name || node?.name || w.entityId}
        </button>
        <StatusChip status={w.status}/><p>{w.reason}</p>
        <small>{w.inCascade ? `Also in cascade · ${hours(node?.windowHours)}` : "Watch-only · no modeled service loss"}</small>
      </article>;
    })}</div>
  </section>;
}
export function C4Scores({value}: {value: ConsequenceProjection}) {
  if (!value.consequenceScores?.length) return null;
  return <section className="c4-score-summary" aria-label="Supplied consequence scores">
    {value.consequenceScores.map((r, i) => <div key={i}>
      <p>{r.basis || "Consequence scores · 0–100"} · scores do not replace time windows</p>
      <ul>{r.sectors.map(s => <li className={`tone-${windowTone(value.sectors.find(v => v.label === s.sector)?.windowHours)}`} key={s.sector}>{s.sector}: {s.score == null ? "Not recorded" : `Score ${s.score}`}</li>)}</ul>
      {!!r.energySubsectors?.length && <><h3>Energy subsectors</h3><ul>{r.energySubsectors.map((s, j) => <li key={j}>{s.label}{s.idt && ` · IDT ${s.idt}`}: {s.score == null ? "Not recorded" : `Score ${s.score}`}</li>)}</ul></>}
    </div>)}
  </section>;
}
