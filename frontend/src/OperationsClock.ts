import { createElement } from "react";
import { clockLabel, useRealClock } from "./useRealClock.ts";
export default function OperationsClock({ timeZone }: { timeZone?: string }) {
  const now = useRealClock();
  return createElement("time", { className: "operations-clock", dateTime: new Date(now).toISOString() }, clockLabel(now, timeZone));
}
