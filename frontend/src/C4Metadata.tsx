import { hours, windowTone, type ConsequenceProjection } from "./consequencesModel.ts";
import StatusChip from "./StatusChip.tsx";
import { statusTone } from "./statusTone.ts";
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
export function C4SectorDetails({value, sector, onSector}: {value: ConsequenceProjection; sector: string | null; onSector: (s: string | null) => void}) {
  const sectors = value.sectorViews?.flatMap(r => r.sectors) ?? [];
  if (!sectors.length) return null;
  return <section id="c4-sector-details" className="c4-panel" aria-label="Inside each sector" aria-live="polite">
    <h2>Inside each sector</h2>
    <nav className="c4-sector-tabs" aria-label="Sector detail selection">
      <button aria-pressed={!sector} onClick={() => onSector(null)}>All sectors</button>
      {sectors.map(s => <button key={s.sector} aria-pressed={sector === s.sector} onClick={() => onSector(s.sector)}>{s.sector}</button>)}
    </nav>
    <div className="c4-sector-cards">{sectors.filter(s => !sector || s.sector === sector).map(s => {
      const window = value.sectors.find(r => r.label === s.sector)?.windowHours;
      const score = sectorScore(value, s.sector);
      return <article className={`c4-sector-card tone-${windowTone(window)}`} key={s.sector}>
        <header><h3>{s.sector}</h3>{score != null && <span>Score {score}</span>}</header>
        {s.idt && <small>IDT {s.idt}</small>}
        {window && <p>{hours(window)}</p>}
        <ul>{s.items.map((item, i) => <li key={i}>
          <span>{item.label}{item.idt && <small>IDT {item.idt}</small>}{item.tag && <small>{item.tag}</small>}</span>
          <span className={`tone-${statusTone(item.status)}`}>
            <small>{item.score == null ? "Score not recorded" : `Score ${item.score}`}</small>
            <StatusChip status={item.status}>{item.status?.replaceAll("_", " ") || "Not recorded"}</StatusChip>
          </span>
        </li>)}</ul>
        {!!s.vessels?.length && <><h4>Vessels</h4><ul>{s.vessels.map((v, i) => <li key={i}>
          <span>{v.name}<small>{v.role}</small></span><StatusChip status={v.status}/>
        </li>)}</ul></>}
      </article>;
    })}</div>
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
