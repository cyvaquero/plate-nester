import type { Layout, NestSettings, WirePart } from "./types";
import type { Mode } from "../types";

export interface RunRequest {
  type: "run";
  id: number;
  mode: Mode;
  parts: WirePart[];
  settings: NestSettings;
  /** Bumped by the main thread whenever part geometry changes (kerf, gap, precision, scale, part set). */
  geoVer: number;
  budgetMs: number;
  seed?: number;
  maxIterations?: number;
}
export interface MoreRequest {
  type: "more";
  id: number;
  budgetMs: number;
}
export interface StopRequest {
  type: "stop";
}
export type Request = RunRequest | MoreRequest | StopRequest;

export interface LayoutResponse {
  type: "layout";
  id: number;
  layout: Layout;
}
export interface ProgressResponse {
  type: "progress";
  id: number;
  tried: number;
  elapsedMs: number;
  budgetMs: number;
}
export interface DoneResponse {
  type: "done";
  id: number;
  tried: number;
  /** Plate count of the best layout, and whether a longer search could still help. */
  bestPlates: number;
  minPlates: number;
  canSearchMore: boolean;
}
export interface ErrorResponse {
  type: "error";
  id: number;
  message: string;
}
export type Response = LayoutResponse | ProgressResponse | DoneResponse | ErrorResponse;
