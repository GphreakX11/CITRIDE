import {
  Building2,
  Droplet,
  Factory,
  Flame,
  Hospital,
  Landmark,
  RadioTower,
  Shield,
  Truck,
  Zap,
} from "lucide-react";
import type { InfrastructureKind } from "./infrastructureIcons.ts";

const icons = {
  water: Droplet,
  power: Zap,
  health: Hospital,
  communications: RadioTower,
  government: Landmark,
  transport: Truck,
  industry: Factory,
  gas: Flame,
  cyber: Shield,
  facility: Building2,
} as const;

export type InfrastructureIconProps = {
  kind: InfrastructureKind;
  size?: number;
  className?: string;
};

/** Local SVG geometry, also usable inside an SVG marker. Label the parent. */
export function InfrastructureIcon({
  kind,
  size = 24,
  className,
}: InfrastructureIconProps) {
  const Icon = icons[kind];
  return (
    <Icon
      size={size}
      className={["infrastructure-icon", className].filter(Boolean).join(" ")}
      aria-hidden={true}
      focusable={false}
      data-infrastructure-icon={kind}
    />
  );
}

export default InfrastructureIcon;
