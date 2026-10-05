import type { Path } from "clipper-lib";
import type { Unit } from "./units";

export type Mode = "shape" | "bbox";

export interface Settings {
  mode: Mode;
  unit: Unit;
  /** All lengths below are millimetres. */
  plateW: number;
  plateH: number;
  kerf: number;
  gap: number;
  margin: number;
  /** Shape mode: rotation step in degrees, 0 = none. */
  rotStep: number;
  /** Shape mode: outline precision in mm. */
  prec: number;
  /** Bounding-box mode: allow 90° rotation. */
  rotate90: boolean;
  outline: boolean;
  /** px per inch for unitless SVG files. */
  dpi: number;
}

export const DEFAULTS: Settings = {
  mode: "shape",
  unit: "mm",
  plateW: 300,
  plateH: 300,
  kerf: 0.1,
  gap: 1,
  margin: 3,
  rotStep: 90,
  prec: 0.25,
  rotate90: true,
  outline: false,
  dpi: 96,
};

/** Absolute path segment: ["M",x,y] ["L",x,y] ["C",x1,y1,x2,y2,x,y] ["Z"]. */
export type Seg = [string, ...number[]];

/** One drawable shape, flattened to absolute path segments in the part's user units. */
export interface FlatItem {
  segs: Seg[];
  fill: string;
  stroke: string;
  /** Stroke width in the part's user units (after the CTM scale). */
  sw: number;
  evenodd: boolean;
  fo: number;
  so: number;
}

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A sampled polyline in the part's user units. */
export interface Ring {
  closed: boolean;
  pts: [number, number][];
}

/** A part as the main thread holds it: everything needed to preview, export and send to the worker. */
export interface Part {
  uid: number;
  name: string;
  /** Sanitized, id-prefixed child markup of the original <svg>. */
  inner: string;
  /** Presentation attributes copied from the root <svg>, ready to splice into a tag. */
  rootAttrs: string;
  vb: number[] | null;
  wAttr: string | null;
  hAttr: string | null;
  bbox: BBox;
  /** Bounding-box centre in user units. */
  cx: number;
  cy: number;
  /** mm per user unit. */
  kx: number;
  ky: number;
  wMM: number;
  hMM: number;
  /** Flattened shapes, or null when the original markup must be kept. */
  flat: FlatItem[] | null;
  rings: Ring[];
  /** Outer contours in integer clipper units (mm × SC), centred on the bbox centre. */
  outers: Path[];
  areaMM: number;
  thumb: string;
  qty: number;
  lock: boolean;
  sample?: boolean;
}
