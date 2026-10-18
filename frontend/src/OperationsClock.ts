import { createElement } from "react";
import { clockLabel, useRealClock } from "./useRealClock.ts";
export default function OperationsClock({ timeZone = "America/Chicago" }: { timeZone?: string }) {
  const now = useRealClock();
  return createElement("time", { className: "story-clock", dateTime: new Date(now).toISOString() }, clockLabel(now, timeZone));
}
