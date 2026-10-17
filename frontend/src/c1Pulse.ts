import type { CSSProperties } from "react";
/** Stable per-record phase; CSS animates independently without a JS timer. */
export function c1PulseStyle(id: string): CSSProperties {
  let phase = 0;
  for (const character of id) phase = (phase * 31 + character.charCodeAt(0)) >>> 0;
  return { "--c1-pulse-delay": `${-(phase % 1800) / 1000}s` } as CSSProperties;
}
