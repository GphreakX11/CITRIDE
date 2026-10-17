export type InfrastructureKind =
  | "water"
  | "power"
  | "health"
  | "communications"
  | "government"
  | "transport"
  | "industry"
  | "gas"
  | "cyber"
  | "facility";

/** Compatible with incident records and inventory entities; no model mutation. */
export type InfrastructureIconItem = Readonly<{
  title?: string;
  name?: string;
  label?: string;
  type?: string;
  short?: string;
  incidentType?: string;
  sectors?: readonly string[];
}>;

// Subject fields only: summaries, locations, related notes and dependencies can
// describe other infrastructure and must never select this record's icon.
const subjectFields = [
  "title",
  "name",
  "label",
  "type",
  "short",
  "incidentType",
] as const;

function words(value: string | undefined): string {
  return (value ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .replace(/[^a-z0-9]+/gi, " ")
    .toLowerCase();
}

function subjectKind(subject: string): InfrastructureKind | null {
  // A hospital losing water is still a healthcare site. Cyber incident words
  // are deliberately handled later: ransomware is not an infrastructure type.
  if (
    /\b(hospitals?|healthcare|health care|dialysis|clinics?|medical|nursing home|care home)\b/.test(
      subject,
    )
  )
    return "health";
  if (/\b(water|wastewater|sewer|sewage|treatment plant)\b/.test(subject))
    return "water";
  if (
    /\b(power|electric|electricity|electrical|substation|powerplant)\b/.test(
      subject,
    )
  )
    return "power";
  if (/\b(gas|natural gas|lng)\b/.test(subject)) return "gas";
  if (
    /\b(telecom|telecommunications?|communications?|radio tower|broadband|emergency alert|public alert)\b/.test(
      subject,
    )
  )
    return "communications";
  if (
    /\b(government|municipal|city|county|state agency|federal agency|town hall|courthouse)\b/.test(
      subject,
    )
  )
    return "government";
  if (
    /\b(transport|transportation|highways?|roads?|rail|railway|railroad|airports?|aviation|transit|shipping|postal|ports?)\b/.test(
      subject,
    )
  )
    return "transport";
  if (
    /\b(factory|factories|manufacturing|industrial|industry|refinery)\b/.test(
      subject,
    )
  )
    return "industry";
  return null;
}

// Visual fallbacks from the pinned IDT sector IDs in idt.ts, not assignments or
// inferred dependencies. Energy is represented by a bolt; explicit gas wins.
// Emergency Services (6) is not Communications (8): alert subjects must match
// above; a bare sector 6 stays a generic facility.
const sectorKinds: Readonly<Partial<Record<string, InfrastructureKind>>> = {
  "3": "industry", // Chemical and Hazardous Materials Industry
  "4": "industry", // Defense Industrial Base
  "5": "power", // Energy
  "7": "cyber", // Information Technology
  "8": "communications", // Communications
  "9": "transport", // Postal and Shipping
  "10": "health", // Healthcare and Public Health
  "11": "transport", // Transportation
  "12": "water", // Water
  "15": "government", // Government Facilities
  "18": "industry", // Manufacturing
};

export function infrastructureKind(
  item: InfrastructureIconItem,
): InfrastructureKind {
  const subjects = subjectFields.map((field) => words(item[field]));
  for (const subject of subjects) {
    const kind = subjectKind(subject);
    if (kind) return kind;
  }
  for (const sector of item.sectors ?? []) {
    const kind = Object.hasOwn(sectorKinds, sector)
      ? sectorKinds[sector]
      : null;
    if (kind) return kind;
  }
  return subjects.some((subject) =>
    /\b(cyber|ransomware|phishing|malware|ddos|denial of service|it|information technology)\b/.test(
      subject,
    ),
  )
    ? "cyber"
    : "facility";
}

const labels: Readonly<Record<InfrastructureKind, string>> = {
  water: "Water",
  power: "Power",
  health: "Healthcare",
  communications: "Communications",
  government: "Government",
  transport: "Transportation",
  industry: "Industry",
  gas: "Gas",
  cyber: "Cybersecurity",
  facility: "Facility",
};

export function infrastructureLabel(kind: InfrastructureKind): string {
  return labels[kind];
}
