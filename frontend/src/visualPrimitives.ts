import type { HTMLAttributes } from "react";
import { jsx } from "react/jsx-runtime";
import { statusTone, windowTone } from "./statusTone.ts";

export interface ToneProps extends HTMLAttributes<HTMLSpanElement> {
  status?: string | null;
  window?: readonly [number, number] | null;
}
/** Text and chips share semantics; caller copy and attributes remain unchanged. */
export function Tone({ status, window, children, className = "", ...props }: ToneProps) {
  const tone = window !== undefined ? windowTone(window) : statusTone(status);
  return jsx("span", { ...props, className: `tone-${tone} ${className}`.trim(), children });
}

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  status?: string | null;
  descriptive?: boolean;
}
/** One implementation shared by JSX screens and Node-native behavior harnesses. */
export function StatusChip({
  status,
  children,
  className = "",
  descriptive = false,
  ...props
}: StatusChipProps) {
  return jsx("span", {
    ...props,
    className:
      `status-chip status-chip--${statusTone(status)} ${descriptive ? "status-chip--description " : ""}${className}`.trim(),
    children: children ?? status ?? "unknown",
  });
}
export interface TechniqueChipProps extends HTMLAttributes<HTMLSpanElement> {
  id: string;
  name: string;
  tactic?: string;
}
export function TechniqueChip({
  id,
  name,
  tactic,
  children,
  className = "",
  title,
  ...props
}: TechniqueChipProps) {
  return jsx("span", {
    ...props,
    title: title ?? tactic,
    className: `technique-chip chip-mono ${className}`.trim(),
    children: children ?? [id, " · ", name],
  });
}
export interface VisualCardProps extends HTMLAttributes<HTMLElement> {
  as?: "section" | "article" | "div" | "aside";
}
export function VisualCard({
  as: element = "section",
  className = "",
  children,
  ...props
}: VisualCardProps) {
  return jsx(element, {
    ...props,
    className: `visual-card ${className}`.trim(),
    children,
  });
}
export function SummaryTile({
  className = "",
  children,
  ...props
}: HTMLAttributes<HTMLElement>) {
  return jsx("article", {
    ...props,
    className: `summary-tile ${className}`.trim(),
    children,
  });
}
