import type { Paths } from "clipper-lib";

/** One part instance on a plate, in plate millimetres. Mode-agnostic so export and preview share it. */
export interface Placement {
  partId: number;
  /** Translation of the anchor point (see rx/ry) onto the plate, mm. */
  x: number;
  y: number;
  /** Rotation in degrees about the anchor, applied after scaling. */
  ang: number;
  /** Anchor point in the part's user units: bbox centre (true shape) or bbox origin (bounding box). */
  rx: number;
  ry: number;
  /** Preview outline(s) in plate mm: the spacing envelope (true shape) or the part's box (bounding box). */
  env: [number, number][][];
}

export interface PlateLayout {
  placements: Placement[];
  /** Sum of the true part areas on this plate, mm². */
  area: number;
}

export interface Layout {
  plates: PlateLayout[];
  /** uids of parts that do not fit the plate at any allowed rotation. */
  oversize: number[];
  minPlates: number;
  /** The edge margin leaves no usable area. */
  noArea?: boolean;
}

/** A part as the nesting engine sees it: plain data only, safe to postMessage. */
export interface WirePart {
  uid: number;
  name: string;
  qty: number;
  lock: boolean;
  /** Outer contours, integer units (mm × 1000), centred on the bbox centre. */
  outers: Paths;
  areaMM: number;
  wMM: number;
  hMM: number;
  /** Anchor for true-shape placement (bbox centre) and bounding-box placement (bbox origin), user units. */
  center: [number, number];
  origin: [number, number];
}

export interface NestSettings {
  plateW: number;
  plateH: number;
  kerf: number;
  gap: number;
  margin: number;
  rotStep: number;
  prec: number;
  rotate90: boolean;
}
