import {
  Anchor, Building2, Container, Droplet, Droplets, Factory, Flame,
  FlaskConical, Fuel, Hospital, Landmark, RadioTower, Server, Shield,
  Ship, ShipWheel, Truck, Zap,
} from "lucide-react";
import type { InfrastructureKind } from "./infrastructureIcons.ts";

const icons = {
  water: Droplet, power: Zap, health: Hospital, communications: RadioTower,
  government: Landmark, transport: Truck, industry: Factory, gas: Flame,
  cyber: Shield, facility: Building2,
  Anchor, Building2, Container, Droplet, Droplets, Factory, Flame,
  FlaskConical, Fuel, Hospital, Landmark, RadioTower, Server, Shield,
  Ship, ShipWheel, Truck, Zap,
  // The reference vocabulary uses ShipCargo; lucide supplies Ship geometry.
  ShipCargo: Ship,
} as const;
export type InfrastructureIconProps = {
  kind?: InfrastructureKind;
  /** Token returned by iconFor; unknown reference icons safely use the kind. */
  icon?: string;
  severity?: string | null;
  size?: number;
  className?: string;
};
/** Local SVG geometry, also usable inside an SVG marker. Label the parent.
 * Critical styling never implies pulsing; callers own evidence-based animation.
 */
export function InfrastructureIcon({ kind = "facility", icon, severity, size = 24, className }: InfrastructureIconProps) {
  const token = icon && Object.hasOwn(icons, icon) ? icon as keyof typeof icons : kind;
  const Icon = icons[token];
  const critical = severity?.trim().toLowerCase() === "critical";
  const classes = ["infrastructure-icon", critical && "infrastructure-icon--critical", className].filter(Boolean).join(" ");
  if (critical) return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={classes} aria-hidden={true} focusable={false} data-infrastructure-icon={token}>
      <circle cx="16" cy="16" r="15" fill="#e5484d" stroke="#ffb3aa" strokeWidth="2" />
      <Icon x={6} y={6} size={20} color="#fff" />
    </svg>
  );
  return <Icon size={size} className={classes} aria-hidden={true} focusable={false} data-infrastructure-icon={token} />;
}
export default InfrastructureIcon;
