import { useEffect, useState, type ReactNode } from "react";
import { api as apiGet } from "./api.ts";
import {
  elapsedLabel,
  hours,
  initialConsequenceIncident,
  missing,
  windowTone,
  type ConsequenceProjection,
} from "./consequencesModel.ts";
import { clockLabel, useRealClock } from "./useRealClock.ts";
import type { CommandView } from "./commandTypes.ts";
import { C4Functions, C4WatchPosture, C4Scores, sectorScore } from "./C4Metadata.tsx";
import AssetConsequenceView from "./AssetConsequenceView/AssetConsequenceView.tsx";
import { useConsequenceSelection, writeConsequenceSelection } from "./consequenceSelection.ts";
import "./consequences-view.css";
function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="c4-panel">
      <h2>{title}</h2>
      {children}
    </section>
  );
}
function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}
export function ConsequencesContent({
  value,
  now,
  onAnalyst,
  onPartners,
  onEntity,
}: {
  value: ConsequenceProjection;
  now: number;
  onAnalyst: () => void;
  onPartners: () => void;
  onEntity?: (view: CommandView, entityId?: string | null) => void;
}) {
  value = {
    ...value,
    source: value.source
      ? {
          ...value.source,
          name: value.source.label || value.source.name || value.source.id,
        }
      : undefined,
    nodes: value.nodes.map((n) => ({ ...n, name: n.label || n.name || n.id })),
  };
  const [selection] = useConsequenceSelection();
  const setSector = (sector: string | null) => writeConsequenceSelection({incidentId:value.incident?.id ?? null,sector:sector || "all",entityId:null});
  const setSelected = (entityId: string | null) => { const node=value.nodes.find(n=>n.id===entityId); writeConsequenceSelection({incidentId:value.incident?.id ?? null,entityId,sector:node?.sector.toLowerCase() || selection.sector}); };

  const { analysis, source } = value;
  const hasSectorMap = !!value.sectorViews?.some(r => r.sectors.length);
  const displayedSectors = value.sectors;
  const infrastructureCount = value.infrastructureCount ?? value.atRisk;
  const countDetail = value.cascadeCount != null && value.watchOnlyCount != null
    ? `${value.cascadeCount} in the cascade · ${value.watchOnlyCount} watch-only (same campaign)` : null;
  const risk = value.nodes
    .filter((n) => n.impactCount && !n.source)
    .sort(
      (a, b) =>
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity),
    );
  const timelineHours = Math.max(1, analysis?.request?.horizonHours ?? 12);
  if (!analysis)
    return (
      <Panel title="Consequence view for this incident type is in development">
        <p>Not yet modeled</p>
        <button onClick={onAnalyst}>Alerts in Analyst ↗</button>
      </Panel>
    );
  const time = analysis.computedAt || analysis.createdAt;
  const reviewed = analysis.kind === "reviewed";
  const tiles = [
    [
      value.serviceAffected
        ? `${value.serviceAffected.value.toLocaleString("en-US")} ${value.serviceAffected.unit}`
        : value.people == null
          ? missing
          : value.people.toLocaleString("en-US"),
      value.serviceAffected ? "Service affected" : "People affected",
      value.serviceAffected ? value.serviceAffected.note || "As reported in the supplied reference scenario" : "People in the modeled service area",
      "grey",
    ],
    [
      infrastructureCount == null ? "Not recorded" : String(infrastructureCount),
      "Critical infrastructure at risk",
      countDetail || [...new Set(risk.map((n) => n.type.replace(/([a-z])([A-Z])/g, "$1 $2")))]
        .slice(0, 3)
        .join(" · "),
      value.atRisk ? "red" : "grey",
    ],
    [
      hours(value.earliestWindow),
      "Earliest window",
      risk[0]?.name || missing,
      windowTone(value.earliestWindow),
    ],
    [
      hours(value.restoration?.hours),
      "Expected outage",
      [value.restoration?.note, value.restoration?.basis]
        .filter(Boolean)
        .join(" · ") || missing,
      "amber",
    ],
    [
      value.economic ? value.economic.dailyUsd.map(money).join("–") : missing,
      "Economic impact per day",
      value.economic?.basis || missing,
      "amber",
    ],
    [
      value.publicAction?.action || "None recommended",
      "Recommended public action",
      value.publicAction
        ? `possible · ${value.publicAction.decidedBy} decide`
        : "No matching recommendation recorded",
      value.publicAction ? "amber" : "grey",
    ],
  ];
  return (
    <>
      <section className="c4-phone-brief" aria-label="Impact and next action">
        <small>Modeled · not observed outages</small>
        <strong>
          {infrastructureCount == null
            ? "Impact count not recorded"
            : `${infrastructureCount} infrastructure ${infrastructureCount === 1 ? "asset" : "assets"} at risk`}
        </strong>
        {countDetail && <small>{countDetail}</small>}
        <span>Earliest modeled window: {hours(value.earliestWindow)}</span>
        <small>
          {reviewed ? "Analyst reviewed" : analysis.kind === "reference_preview"
            ? "Reference projection · not saved or analyst reviewed"
            : "Preliminary · not analyst reviewed"}
        </small>
        <button type="button" className="analyst-link" onClick={onAnalyst}>
          {reviewed ? "Open in Analyst ↗" : "Review in Analyst ↗"}
        </button>
      </section>
      <div className={`c4-banner ${reviewed ? "reviewed" : ""}`}>
        <strong>
          {reviewed ? "ANALYSIS REVIEWED" : analysis.kind === "reference_preview" ? "READ-ONLY REFERENCE PROJECTION" : "PRELIMINARY ESTIMATE"}
        </strong>
        <span>
          {reviewed ? "Captured" : analysis.kind === "reference_preview" ? "Computed now · not saved case analysis" : "Run automatically by CITRIDE"}{" "}
          {elapsedLabel(time, now)} ·{" "}
          {clockLabel(Date.parse(time), value.operationsTimeZone)}
          {!reviewed && <em> · not yet reviewed by an analyst</em>}
        </span>
        <button onClick={onAnalyst}>
          {reviewed ? "Open" : "Review"} in Analyst ↗
        </button>
      </div>
      <section className="c4-asset" aria-label="Asset">
        <div>
          <small>ASSET</small>
          <strong>{source?.name || missing}</strong>
          <span>
            {source?.type} · IDT {source?.idt?.path || "Not recorded"}
          </span>
        </div>
        <div>
          <small>WHAT IT DOES</small>
          <strong>
            {source?.throughput
              ? typeof source.throughput.value === "string" ? source.throughput.value : `${source.throughput.value} ${source.throughput.unit}`
              : missing}
          </strong>
          <span>{source?.throughput?.basis}</span>
        </div>
        <div>
          <small>WHO DEPENDS ON IT</small>
          <strong>
            {value.people == null
              ? value.sectors.filter(s => s.atRisk > 0).map(s => s.label).join(" · ") || "Dependents not recorded"
              : `${value.people.toLocaleString("en-US")} people`}
          </strong>
          <span>
            {value.nodes.filter((n) => n.connected && !n.source).length}{" "}
            connected infrastructure assets · not all are at risk
          </span>
        </div>
        <div>
          <small>ALTERNATIVES</small>
          <strong>
            {value.alternatives?.length
              ? `${value.alternatives.length} recorded workarounds`
              : missing}
          </strong>
          <span>Capacity and availability require verification</span>
        </div>
        <div>
          <small>SPREAD</small>
          <strong>{source?.spread?.level || missing}</strong>
          <span>{source?.spread?.note}</span>
        </div>
      </section>
      <section className="c4-tiles" aria-label="Consequence measures">
        {tiles.map(([v, l, n, t]) => (
          <article key={l} className={`c4-tile tone-${t}`}>
            <strong>{v}</strong>
            <b>{l}</b>
            <small>{n}</small>
          </article>
        ))}
      </section>
      <C4Functions value={value}/>
      <AssetConsequenceView value={value} onAnalyst={onEntity ?? (() => onAnalyst())}/>
      <C4WatchPosture value={value} onSelect={setSelected}/>
      <Panel title="Timeline and thresholds">
          <p>Could lose service in · hours after the modeled loss</p>
          <div className="c4-axis">
            <span>0 h</span>
            <span>{timelineHours / 3} h</span>
            <span>{timelineHours * 2 / 3} h</span>
            <span>{timelineHours} h</span>
          </div>
          {risk.map((n) => (
            <div className="c4-timeline" key={n.id}>
              <button
                onClick={() => {
                  writeConsequenceSelection({incidentId:value.incident?.id ?? null,entityId:n.id,sector:n.sector.toLowerCase()});
                }}
              >
                {n.name}
              </button>
              <div className="c4-track">
                <i
                  className={`tone-${windowTone(n.windowHours)}`}
                  style={{
                    marginLeft: `${(Math.min(n.windowHours?.[0] || 0, timelineHours) / timelineHours) * 100}%`,
                    width: `${Math.max(1, ((Math.min(n.windowHours?.[1] || 0, timelineHours) - Math.min(n.windowHours?.[0] || 0, timelineHours)) / timelineHours) * 100)}%`,
                  }}
                />
              </div>
              <b className={`tone-${windowTone(n.windowHours)}`}>
                {hours(n.windowHours)}
              </b>
            </div>
          ))}
          <p className="c4-restoration">
            {source?.name} restored: {hours(value.restoration?.hours)}
            {(value.restoration?.hours?.[1] || 0) > timelineHours &&
              " · beyond this view →"}{" "}
            · planning estimate
          </p>
          <h3>Thresholds: what happens if service is not back</h3>
          {value.thresholds?.length ? (
            value.thresholds.map((t, i) => (
              <p className="c4-row" key={i}>
                <b className={`tone-${t.hours < 4 ? "red" : "amber"}`}>
                  {t.hours} h
                </b>
                <span>
                  {t.text}
                  <small>{t.basis}</small>
                </span>
              </p>
            ))
          ) : (
            <p>{missing}</p>
          )}
      </Panel>
      <div className="c4-columns c4-bottom">
        <Panel title="By sector">
          <table>
            <thead>
              <tr>
                <th>Sector</th>
                {!!value.consequenceScores?.length && <th>Score</th>}
                <th>At risk</th>
                <th>Earliest window</th>
                <th>Spread</th>
              </tr>
            </thead>
            <tbody>
              {displayedSectors.map((s) => (
                <tr key={s.label}>
                  <td>
                    <button
                      onClick={() => {
                        setSector(s.label);
                      }}
                    >
                      {s.label}
                    </button>
                    {!s.atRisk && !s.source && (
                      <small>
                        {s.nodes.some(
                          (id) =>
                            value.nodes.find((n) => n.id === id)?.notAffected,
                        )
                          ? "Not affected by this scenario"
                          : "No modeled service loss"}
                      </small>
                    )}
                  </td>
                  {!!value.consequenceScores?.length && <td className={`tone-${windowTone(s.windowHours)}`}>{sectorScore(value, s.label) ?? "Not recorded"}</td>}
                  <td>{s.atRisk}</td>
                  <td
                    className={`tone-${s.source && !hasSectorMap ? "red" : windowTone(s.windowHours)}`}
                  >
                    {s.source && !hasSectorMap
                      ? "Now"
                      : s.windowHours
                        ? hours(s.windowHours)
                        : "—"}
                  </td>
                  <td>
                    {s.order == null ? "—" : `${s.order} order`} ·{" "}
                    {s.spread?.level || "Not recorded"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Workarounds">
          {value.alternatives?.length ? (
            value.alternatives.map((a, i) => (
              <article className="c4-workaround" key={i}>
                <strong>{a.label}</strong>
                <span
                  className={`tone-${a.checkFirst || a.status === "check_first" ? "amber" : ["available", "on_site"].includes(a.status) ? "green" : "grey"}`}
                >
                  {a.checkFirst ? "Check first" : a.status.replaceAll("_", " ")}
                </span>
                <p>{a.covers || missing}</p>
                {a.note && <small>{a.note}</small>}
              </article>
            ))
          ) : (
            <p>{missing}</p>
          )}
        </Panel>
      </div>
      <Panel title="Who owns the response">
        <div className="c4-owners">
          {value.responseOwners?.length ? (
            value.responseOwners.map((o, i) => (
              <article key={i}>
                <small>{o.role}</small>
                <strong>{o.who}</strong>
                <span>{o.does}</span>
              </article>
            ))
          ) : (
            <p>{missing}</p>
          )}
        </div>
        <button onClick={onPartners}>
          Partner and stakeholder coordination · C7 →
        </button>
      </Panel>
      <footer>
        Consequence model: {analysis.modelVersion} ·{" "}
        {reviewed
          ? "reviewed analysis"
          : "preliminary estimate · default scenario assumptions · not yet reviewed"}{" "}
        · {elapsedLabel(time, now)}
        <p>
          <strong>
            Confidence: {value.confidence?.level || "Not recorded"}
            {value.confidence?.value != null && ` (cascade confidence ${Math.round(value.confidence.value * 100)}%)`}
          </strong>{" "}
          · {value.confidence?.note || missing}
        </p>
        <C4Scores value={value}/>
      </footer>
    </>
  );
}
export default function ConsequencesView({
  selectedId,
  records,
  captured: capturedCase,
  onSelect,
  onClearSelection,
  onOpenAnalyst,
  onNavigate,
}: {
  selectedId?: string | null;
  records?: import("./incidentSelection.ts").IncidentSelectionRecords;
  captured?: ReactNode;
  onSelect: (id: string) => void;
  onClearSelection?: () => void;
  onOpenAnalyst: (view: CommandView, caseId?: string | null, entityId?: string | null) => void;
  onNavigate: (view: CommandView) => void;
}) {
  const [selection] = useConsequenceSelection();
  const [id, setId] = useState(() =>
    initialConsequenceIncident(typeof window === "undefined" ? "" : window.location.search, selectedId, records),
  );
  const [value, setValue] = useState<ConsequenceProjection | null>(null);
  const captured = id === selectedId ? capturedCase : null;
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const now = useRealClock();
  useEffect(() => {
    let live = true;
    setValue(null);
    setError("");
    apiGet<ConsequenceProjection>(
      `/v1/command/consequences${id ? `?incidentId=${encodeURIComponent(id)}` : ""}`,
    )
      .then((v) => {
        if (live) setValue(v);
      })
      .catch((e) => {
        if (live)
          setError(
            e instanceof Error ? e.message : "Unable to load consequences",
          );
      });
    return () => {
      live = false;
    };
  }, [id]);
  useEffect(() => { setId(selection.incidentId ?? initialConsequenceIncident("", selectedId, records)); }, [selection.incidentId, selectedId, records]);
  const choose = (next: string) => {
    setId(next);
    const selectedCase = value?.incidents.find((incident) => incident.id === next)?.caseId;
    if (selectedCase) onSelect(selectedCase); else onClearSelection?.();
    writeConsequenceSelection({incidentId:next,sector:"all",entityId:null});
  };
  const analyst = (view: CommandView = "consequence", entityId?: string | null) => {
    const incidentId = value?.incident?.id ?? id;
    const caseId = value?.incident?.caseId ?? null;
    onOpenAnalyst(caseId ? view : "command", caseId, entityId);
    writeConsequenceSelection({incidentId,sector:selection.sector,entityId:entityId ?? selection.entityId},true);
  };
  return (
    <div className="c4-view">
      <header className="c4-heading">
        <div>
          <h1>C4 · Consequences</h1>
          <details className="c4-picker">
            <summary>
              {value?.incident?.id || id} ·{" "}
              {value?.incident?.title || "Loading incident"} · change incident ▾
            </summary>
            <div>
              <label>
                Search incidents
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ID, name or place"
                />
              </label>
              <small>INCIDENTS &amp; REFERENCE SCENARIOS · {value?.incidents.length ?? 0}</small>
              {value?.incidents
                .filter((i) =>
                  `${i.id} ${i.title}`
                    .toLowerCase()
                    .includes(search.toLowerCase()),
                )
                .map((i) => (
                  <button
                    key={i.id}
                    onClick={(e) => {
                      choose(i.id);
                      e.currentTarget
                        .closest("details")
                        ?.removeAttribute("open");
                    }}
                  >
                    <b>{i.id}</b> {i.title} · {i.severity}
                    {i.referenceOnly ? " · reference scenario" : ""}
                    {i.id === id ? " · showing" : ""}
                  </button>
                ))}
            </div>
          </details>
        </div>
        <div>
          <time dateTime={new Date(now).toISOString()}>
            {clockLabel(now, value?.operationsTimeZone)}
          </time>
          <span className="c4-badge">Modeled · not observed outages</span>
        </div>
      </header>
      {error ? (
        <Panel title="Consequence data unavailable">
          <p role="alert">{error}</p>
          <button onClick={() => {
            const next = initialConsequenceIncident("", null, records);
            if (next) choose(next);
            else {
              const url = new URL(window.location.href);
              url.searchParams.delete("incidentId");
              url.searchParams.delete("incident");
              url.searchParams.delete("case");
              window.history.replaceState(null, "", url);
              setId(null);
            }
          }}>
            Open default incident
          </button>
        </Panel>
      ) : value ? (
        <ConsequencesContent
          key={value.incident?.id}
          value={value}
          now={now}
          onAnalyst={() => analyst()}
          onEntity={(view,entityId) => analyst(view,entityId)}
          onPartners={() => { onNavigate("federation"); writeConsequenceSelection({incidentId:value.incident?.id ?? id,sector:selection.sector,entityId:selection.entityId},true); }}
        />
      ) : (
        captured ?? <p role="status">Loading consequence records…</p>
      )}
      {captured && (value || error) && <details open={!value}><summary>Captured case analysis · immutable snapshot and matching what-if</summary>{captured}</details>}
    </div>
  );
}
