import type { CommandIncident } from "./commandTypes";
import type { Entity } from "./types";
import { displayText } from "./presentation";
import {
  ArrowLeft,
  MapPin,
  FileText,
  ListChecks,
  GitBranch,
} from "lucide-react";
import "./investigation-context.css";
export type InvestigationStep = "cop" | "evidence" | "consequence" | "uctf";
interface Props {
  entity: Entity | undefined;
  selectedCase: CommandIncident | null;
  cases: CommandIncident[];
  view: string;
  locked: boolean;
  onSelectCase: (id: string | null) => void;
  onNavigate: (view: InvestigationStep) => void;
}
export default function InvestigationBar({
  entity,
  selectedCase,
  cases,
  view,
  locked,
  onSelectCase,
  onNavigate,
}: Props) {
  if (!entity && !selectedCase) return null;
  return (
    <section
      className="investigation-bar"
      aria-label="Current investigation"
      data-entity-id={entity?.id ?? ""}
      data-case-id={selectedCase?.id ?? ""}
    >
      <div className="investigation-identity">
        <div>
          <span className="investigation-kicker">CURRENT INVESTIGATION</span>
          <strong>
            {entity ? displayText(entity.label) : "Captured case context"}
          </strong>
        </div>
        <label>
          <span>Saved case</span>
          <select
            aria-label="Investigation case"
            disabled={locked}
            value={selectedCase?.id ?? ""}
            onChange={(event) => onSelectCase(event.target.value || null)}
          >
            <option value="">
              {entity ? "No linked saved case" : "Choose a saved case"}
            </option>
            {cases.map((record) => (
              <option key={record.id} value={record.id}>
                {record.title}
                {record.status === "closed" ? " · closed" : ""}
              </option>
            ))}
          </select>
        </label>
      </div>
      <nav className="investigation-steps" aria-label="Investigation steps">
        {(
          [
            { id: "cop", label: "Map", icon: MapPin },
            { id: "evidence", label: "Evidence", icon: FileText },
            { id: "consequence", label: "Service impacts", icon: GitBranch },
            { id: "uctf", label: "Tasks", icon: ListChecks },
          ] as const
        ).map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            className={view === id ? "active" : ""}
            aria-current={view === id ? "page" : undefined}
            disabled={
              locked ||
              ((id === "consequence" || id === "uctf") && !selectedCase)
            }
            onClick={() => onNavigate(id)}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
        {view !== "cop" && (
          <button
            className="investigation-back"
            disabled={locked}
            onClick={() => onNavigate("cop")}
          >
            <ArrowLeft size={16} />
            Back to map
          </button>
        )}
      </nav>
      {!selectedCase && (
        <p className="investigation-empty">
          No saved case is linked to this entity. Evidence and map exploration
          remain available; no impacts or tasks have been assumed.
        </p>
      )}
    </section>
  );
}
