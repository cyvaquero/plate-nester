import type { Part, Settings } from "../types";
import type { NestSettings, WirePart } from "./types";

/** Strip a main-thread Part down to the plain data the nesting engine needs. */
export const toWire = (p: Part): WirePart => ({
  uid: p.uid,
  name: p.name,
  qty: p.qty,
  lock: p.lock,
  outers: p.outers,
  areaMM: p.areaMM,
  wMM: p.wMM,
  hMM: p.hMM,
  center: [p.cx, p.cy],
  origin: [p.bbox.x, p.bbox.y],
});

export const toNestSettings = (s: Settings): NestSettings => ({
  plateW: s.plateW,
  plateH: s.plateH,
  kerf: s.kerf,
  gap: s.gap,
  margin: s.margin,
  rotStep: s.rotStep,
  prec: s.prec,
  rotate90: s.rotate90,
});
