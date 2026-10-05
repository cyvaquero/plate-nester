/* Minimal typings for the parts of clipper-lib 6.4.2 this project uses. */
declare module "clipper-lib" {
  export interface IntPoint {
    X: number;
    Y: number;
  }
  export type Path = IntPoint[];
  export type Paths = Path[];
  export class PolyNode {
    Contour(): Path;
    Childs(): PolyNode[];
  }
  export class PolyTree extends PolyNode {}
  const ClipperLib: {
    Paths: new () => Paths;
    PolyTree: new () => PolyTree;
    Clipper: {
      new (): {
        AddPath(p: Path, t: number, closed: boolean): boolean;
        AddPaths(p: Paths, t: number, closed: boolean): boolean;
        Execute(type: number, solution: Paths | PolyTree, subjFill: number, clipFill: number): boolean;
      };
      Area(p: Path): number;
      Orientation(p: Path): boolean;
      PointInPolygon(pt: IntPoint, path: Path): number;
    };
    ClipperOffset: new (
      miterLimit?: number,
      arcTolerance?: number,
    ) => {
      AddPaths(p: Paths, join: number, end: number): void;
      Execute(solution: Paths, delta: number): void;
    };
    PolyType: { ptSubject: number; ptClip: number };
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: {
      etOpenSquare: number;
      etOpenRound: number;
      etOpenButt: number;
      etClosedPolygon: number;
      etClosedLine: number;
    };
  };
  export default ClipperLib;
}
