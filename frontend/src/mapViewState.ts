export type RelationshipDirection = "all" | "suppliers" | "dependents";
export interface MapViewState {
  areaId: string;
  query: string;
  focusOnly: boolean;
  structural: boolean;
  zoom: number;
  center: { x: number; y: number };
  direction: RelationshipDirection;
}
export function initialMapView(): MapViewState {
  return {
    areaId: "all",
    query: "",
    focusOnly: false,
    structural: false,
    zoom: 1,
    center: { x: 480, y: 360 },
    direction: "all",
  };
}
