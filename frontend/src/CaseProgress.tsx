import type { CommandIncident } from "./commandTypes";
import { caseProgress, caseStepLabels } from "./caseSteps";
export default function CaseProgress({
  incident,
  locked,
  onNavigate,
}: {
  incident: CommandIncident;
  locked: boolean;
  onNavigate?: (target: string) => void;
}) {
  const progress = caseProgress(incident);
  return (
    <section
      className="command-panel prototype-progress"
      aria-label="Case next step"
    >
      <ol>
        {caseStepLabels.map((label, index) => (
          <li
            key={label}
            aria-current={progress.current === index ? "step" : undefined}
          >
            <span>{progress.done[index] ? "✓" : index + 1}</span>
            {label}
            {index === 1 && !progress.impactApplicable && (
              <small>No linked service scenario</small>
            )}
          </li>
        ))}
      </ol>
      <div>
        <strong>{progress.label}</strong>
        <span>{progress.remainingTasks} checklist items remaining</span>
        {progress.current >= 0 && (
          <button
            className="button secondary"
            disabled={locked}
            onClick={() => {
              const target = document.querySelector<HTMLElement>(
                `[data-case-section="${progress.target}"]`,
              );
              if (!target) onNavigate?.(progress.target);
              target?.scrollIntoView({ behavior: "smooth", block: "center" });
              target
                ?.querySelector<HTMLElement>("button,input,textarea,select")
                ?.focus({ preventScroll: true });
            }}
          >
            Go to next step
          </button>
        )}
      </div>
    </section>
  );
}
