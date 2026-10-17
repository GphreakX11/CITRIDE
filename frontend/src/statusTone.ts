/** Presentation only: operational presence/completion is not evidence of safety. */
export type StatusTone = "red" | "amber" | "green" | "blue" | "grey";
export const STATUS_TONES: Readonly<Record<string, StatusTone>> = Object.freeze({
  under_attack: "red", compromised: "red", confirmed: "red", critical: "red",
  high: "red", late: "red", findings: "red", failed: "red", disrupted: "red", unavailable: "red",
  suspected: "amber", probed: "amber", probing_only: "amber", medium: "amber",
  waiting: "amber", needs_review: "amber", containment: "amber", recovering: "amber",
  degraded: "amber", deferred: "amber", attempted: "amber", waiting_on_chief: "amber",
  not_shared_no_consent: "amber",
  normal: "green", done: "green", reviewed: "green", no_findings: "green", completed: "green",
  at_risk: "red", queued: "blue", modeled: "blue", informational: "blue", open: "blue",
  monitoring: "amber", in_progress: "green", running: "blue", en_route: "amber",
  remote: "blue", on_site: "green", contacted: "green", engaged: "green", chosen: "blue", active: "blue",
  decided: "green", reached: "green", on_track: "green", published: "green",
  manipulated: "red", effect_observed: "red", attack_active: "red", source: "red", attacked: "red",
  possible: "amber", ongoing: "amber",
  not_affected: "grey", no_dependency: "grey", standing_by: "grey", low: "blue",
  closed: "grey", not_started: "grey", standby: "grey", on_standby: "grey", not_yet: "grey",
  not_chosen: "grey", none: "grey", draft: "grey", from_case: "grey",
  not_configured: "grey", not_evaluated: "grey", unknown: "grey", not_modeled: "grey", not_yet_modeled: "grey",
});
/** Normalize lookup keys, never caller-visible copy. Unknown/inherited names stay neutral. */
export function statusTone(status: string | null | undefined): StatusTone {
  const key = status?.trim().toLowerCase().replaceAll(/[\s-]+/g, "_") ?? "";
  return Object.prototype.hasOwnProperty.call(STATUS_TONES, key) ? STATUS_TONES[key] : "grey";
}
/** Earliest danger, never duration. Missing/invalid evidence remains neutral. */
export function windowTone(window: readonly [number, number] | null | undefined): "red" | "amber" | "grey" {
  if (!window || !window.every(Number.isFinite) || window[0] < 0 || window[1] < window[0]) return "grey";
  return window[0] < 4 ? "red" : "amber";
}
