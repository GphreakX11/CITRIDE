import { useEffect, useState, type ReactNode } from "react";
import { api as apiGet } from "./api.ts";
import {
  consequenceNodeState,
  elapsedLabel,
  hours,
  initialConsequenceIncident,
  missing,
  windowTone,
  type ConsequenceProjection,
  type ConsequenceNode,
} from "./consequencesModel.ts";
import { clockLabel, useRealClock } from "./useRealClock.ts";
import type { CommandView } from "./commandTypes.ts";
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
}: {
  value: ConsequenceProjection;
  now: number;
  onAnalyst: () => void;
  onPartners: () => void;
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
  const [sector, setSector] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const { analysis, source } = value;
  const nodes = value.nodes
    .filter((n) => !sector || n.sector === sector || n.source || n.upstream)
    .sort(
      (a, b) =>
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity),
    );
  const focus = value.nodes.find((n) => n.id === selected);
  const risk = value.nodes
    .filter((n) => n.impactCount && !n.source)
    .sort(
      (a, b) =>
        (a.windowHours?.[0] ?? Infinity) - (b.windowHours?.[0] ?? Infinity),
    );
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
      "People in the modeled service area",
      "grey",
    ],
    [
      String(value.atRisk ?? 0),
      "Critical infrastructure at risk",
      [...new Set(risk.map((n) => n.type.replace(/([a-z])([A-Z])/g, "$1 $2")))]
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
              ? `${source.throughput.value} ${source.throughput.unit}`
              : missing}
          </strong>
          <span>{source?.throughput?.basis}</span>
        </div>
        <div>
          <small>WHO DEPENDS ON IT</small>
          <strong>
            {value.people == null
              ? "People not recorded"
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
      <div className="c4-columns">
        <Panel
          title={`${sector || "Sector"} dependencies · ${value.incident?.id}`}
        >
          <div className="c4-panel-actions">
            <span>Select a sector or asset to inspect its evidence</span>
            {sector && (
              <button
                onClick={() => {
                  setSector(null);
                  setSelected(null);
                }}
              >
                ← All sectors
              </button>
            )}
          </div>
          <CascadeGraph
            value={value}
            nodes={nodes}
            sector={sector}
            selected={selected}
            onSector={setSector}
            onSelect={setSelected}
          />
          <p className="c4-legend">
            Source · At risk before 4 h · At risk 4 h or later · Normal upstream
            · Dashed: not affected · Dotted: no dependency
          </p>
          {focus && (
            <section className="c4-evidence">
              <h3>Why it’s at risk · {focus.name}</h3>
              <p className="c4-idt">
                {focus.idtPath || focus.idt?.path || "IDT path not recorded"}
              </p>
              <p>
                {focus.impactCount
                  ? `${focus.name} depends on the recorded supply paths below. Service loss is conditional on the modeled scenario and available reserves.`
                  : consequenceNodeState(focus).label}
              </p>
              <dl>
                <dt>Could lose service in</dt>
                <dd className={`tone-${windowTone(focus.windowHours)}`}>
                  {hours(focus.windowHours)}
                </dd>
                <dt>{focus.reserveLabel}</dt>
                <dd>
                  {focus.reserves.length
                    ? focus.reserves.map((r) => hours(r)).join(" · ")
                    : missing}
                </dd>
                <dt>Dependency paths</dt>
                <dd>
                  {focus.paths.length
                    ? focus.paths
                        .map((p) =>
                          p
                            .map(
                              (id) =>
                                value.edges.find((e) => e.id === id)?.label ||
                                id,
                            )
                            .join(" → "),
                        )
                        .join("; ")
                    : "No modeled path recorded"}
                </dd>
                <dt>Sources</dt>
                <dd>
                  {focus.sourceRefs.length} recorded references
                  {focus.sourceRefs.length > 0 &&
                    ` · ${focus.sourceRefs.join(", ")}`}
                </dd>
              </dl>
            </section>
          )}
        </Panel>
        <Panel title="Timeline and thresholds">
          <p>Could lose service in · hours after the modeled loss</p>
          <div className="c4-axis">
            <span>0 h</span>
            <span>4 h</span>
            <span>8 h</span>
            <span>12 h</span>
          </div>
          {risk.map((n) => (
            <div className="c4-timeline" key={n.id}>
              <button
                onClick={() => {
                  setSelected(n.id);
                  setSector(n.sector);
                }}
              >
                {n.name}
              </button>
              <div className="c4-track">
                <i
                  className={`tone-${windowTone(n.windowHours)}`}
                  style={{
                    marginLeft: `${(Math.min(n.windowHours?.[0] || 0, 12) / 12) * 100}%`,
                    width: `${Math.max(3, (Math.min((n.windowHours?.[1] || 0) - (n.windowHours?.[0] || 0), 12) / 12) * 100)}%`,
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
            {(value.restoration?.hours?.[1] || 0) > 12 &&
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
      </div>
      <div className="c4-columns c4-bottom">
        <Panel title="By sector">
          <table>
            <thead>
              <tr>
                <th>Sector</th>
                <th>At risk</th>
                <th>Earliest window</th>
                <th>Spread</th>
              </tr>
            </thead>
            <tbody>
              {value.sectors.map((s) => (
                <tr key={s.label}>
                  <td>
                    <button
                      onClick={() => {
                        setSector(s.label);
                        setSelected(null);
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
                  <td>{s.atRisk}</td>
                  <td
                    className={`tone-${s.source ? "red" : windowTone(s.windowHours)}`}
                  >
                    {s.source
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
          </strong>{" "}
          · {value.confidence?.note || missing}
        </p>
      </footer>
    </>
  );
}
function CascadeGraph({
  value,
  nodes,
  sector,
  selected,
  onSector,
  onSelect,
}: {
  value: ConsequenceProjection;
  nodes: ConsequenceNode[];
  sector: string | null;
  selected: string | null;
  onSector: (s: string) => void;
  onSelect: (s: string) => void;
}) {
  const groups = sector
    ? nodes.map((n) => ({ id: n.id, name: n.name, node: n, ids: [n.id] }))
    : [
        ...nodes
          .filter((n) => n.source || n.upstream)
          .map((n) => ({ id: n.id, name: n.name, node: n, ids: [n.id] })),
        ...value.sectors
          .filter(
            (s) =>
              !s.source &&
              s.nodes.some((id) =>
                nodes.some((n) => n.id === id && !n.upstream),
              ),
          )
          .map((s) => ({
            id: s.label,
            name: s.label,
            node:
              nodes.find((n) => s.nodes.includes(n.id) && n.windowHours) ||
              nodes.find((n) => s.nodes.includes(n.id))!,
            ids: s.nodes,
          })),
      ];
  const positions = groups.map((g, i) => ({
    ...g,
    x: g.node.source ? 35 : g.node.upstream ? 13 : 76,
    y: g.node.source
      ? 50
      : g.node.upstream
        ? 16 + i * 18
        : 12 +
          (groups.filter(
            (_, j) =>
              j < i && !groups[j].node.source && !groups[j].node.upstream,
          ).length *
            76) /
            Math.max(
              1,
              groups.filter((g) => !g.node.source && !g.node.upstream).length -
                1,
            ),
  }));
  return (
    <div className="c4-graph">
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-label="Recorded dependency links"
      >
        {value.edges.map((e) => {
          const a = positions.find((g) => g.ids.includes(e.from)),
            b = positions.find((g) => g.ids.includes(e.to));
          if (!a || !b || a === b) return null;
          const state = consequenceNodeState(b.node);
          return (
            <g key={e.id}>
              <path
                className={`tone-${a.node.upstream ? "green" : state.tone}`}
                d={`M${a.x} ${a.y} L${b.x} ${b.y}`}
                strokeDasharray={state.line === "solid" ? undefined : "1 1"}
              />
              <text x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - 2}>
                {e.label}
              </text>
            </g>
          );
        })}
      </svg>
      {positions.map((g) => {
        const state = consequenceNodeState(g.node);
        return (
          <button
            key={g.id}
            className={`c4-node tone-${state.tone} ${selected === g.id ? "selected" : ""}`}
            style={{
              left: `${g.x}%`,
              top: `${g.y}%`,
              borderStyle: state.line as "solid" | "dashed" | "dotted",
            }}
            onClick={() =>
              sector || g.node.source || g.node.upstream
                ? onSelect(g.node.id)
                : onSector(g.name)
            }
          >
            <strong>{g.name}</strong>
            <small>
              {g.node.source
                ? value.analysis?.seed.lossType.replaceAll("_", " ") +
                  " · source"
                : state.label}
            </small>
          </button>
        );
      })}
    </div>
  );
}
export default function ConsequencesView({
  selectedId,
  onSelect,
  onOpenAnalyst,
  onNavigate,
}: {
  selectedId?: string | null;
  onSelect: (id: string) => void;
  onOpenAnalyst: (view: CommandView, caseId?: string | null) => void;
  onNavigate: (view: CommandView) => void;
}) {
  const [id, setId] = useState(() =>
    initialConsequenceIncident(window.location.search, selectedId),
  );
  const [value, setValue] = useState<ConsequenceProjection | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const now = useRealClock();
  useEffect(() => {
    let live = true;
    setValue(null);
    setError("");
    apiGet<ConsequenceProjection>(
      `/v1/command/consequences?incidentId=${encodeURIComponent(id)}`,
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
  useEffect(() => {
    const changed = () =>
      setId(initialConsequenceIncident(window.location.search));
    window.addEventListener("popstate", changed);
    return () => window.removeEventListener("popstate", changed);
  }, []);
  const choose = (next: string) => {
    setId(next);
    const url = new URL(window.location.href);
    url.searchParams.set("incidentId", next);
    url.searchParams.set("incident", next);
    window.history.replaceState(null, "", url);
    onSelect(next);
  };
  const analyst = () =>
    onOpenAnalyst(
      value?.incident?.caseId ? "case-file" : "command",
      value?.incident?.caseId,
    );
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
              <small>OPEN INCIDENTS · {value?.incidents.length ?? 0}</small>
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
          <button onClick={() => choose("TX-26-0412")}>
            Open default incident
          </button>
        </Panel>
      ) : value ? (
        <ConsequencesContent
          key={value.incident?.id}
          value={value}
          now={now}
          onAnalyst={analyst}
          onPartners={() => onNavigate("federation")}
        />
      ) : (
        <p role="status">Loading consequence records…</p>
      )}
    </div>
  );
}
