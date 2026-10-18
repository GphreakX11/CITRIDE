import { useEffect, useState } from "react";
import { formatTime } from "./displayTime.ts";
export function useRealClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
export function clockLabel(now: number, timeZone?: string) {
  return formatTime(new Date(now), timeZone);
}
