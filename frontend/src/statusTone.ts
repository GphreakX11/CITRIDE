/** Presentation only: operational presence/completion is not evidence of safety. */
export type StatusTone = "red" | "amber" | "green" | "blue" | "grey";
export const STATUS_TONES: Readonly<Record<string, StatusTone>> = Object.freeze(
  {
    under_attack: "red",
    compromised: "red",
    confirmed: "red",
    critical: "red",
    high: "red",
    late: "red",
    findings: "red",
    failed: "red",
    disrupted: "red",
    unavailable: "red",
    suspected: "amber",
    probed: "amber",
    probing_only: "amber",
    medium: "amber",
    waiting: "amber",
    needs_review: "amber",
    containment: "amber",
    recovering: "amber",
    degraded: "amber",
    deferred: "amber",
    attempted: "amber",
    waiting_on_chief: "amber",
    not_shared_no_consent: "amber",
    normal: "green",
    done: "green",
    reviewed: "green",
    no_findings: "green",
    completed: "green",
    at_risk: "blue",
    queued: "blue",
    modeled: "blue",
    informational: "blue",
    open: "blue",
    monitoring: "blue",
    in_progress: "blue",
    running: "blue",
    en_route: "blue",
    remote: "blue",
    on_site: "blue",
    contacted: "blue",
    engaged: "blue",
    chosen: "blue",
    active: "blue",
    not_affected: "grey",
    no_dependency: "grey",
    standing_by: "grey",
    low: "grey",
    closed: "grey",
    not_started: "grey",
    standby: "grey",
    on_standby: "grey",
    not_yet: "grey",
    not_chosen: "grey",
    none: "grey",
    draft: "grey",
    from_case: "grey",
    not_configured: "grey",
    not_evaluated: "grey",
    unknown: "grey",
    not_modeled: "grey",
    not_yet_modeled: "grey",
  },
);
/** Normalize lookup keys, never caller-visible copy. Unknown/inherited names stay neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  const key =
    status
      ?.trim()
      .toLowerCase()
      .replaceAll(/[\s-]+/g, "_") ?? "";
  return Object.prototype.hasOwnProperty.call(STATUS_TONES, key)
    ? STATUS_TONES[key]
    : "grey";
}
