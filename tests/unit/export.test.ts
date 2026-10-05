import { describe, expect, it } from "vitest";
import { partMarkup, placeMatrix, slug, uniquifyIds } from "../../src/export/plate";
import type { FlatItem } from "../../src/types";

describe("uniquifyIds", () => {
  const svg =
    `<defs><linearGradient id="g"/><clipPath id="c"/></defs><style>#c{x:1} #cc{y:2} .k{fill:url(#g)}</style>` +
    `<rect id="r" fill="url( '#g' )" clip-path="url(#c)"/><use href="#r"/><use xlink:href='#r'/>`;
  it("prefixes ids and every reference to them", () => {
    const o = uniquifyIds(svg, "a_");
    expect(o).toContain('id="a_g"');
    expect(o).toContain('id="a_c"');
    expect(o).toContain('fill="url(#a_g)"');
    expect(o).toContain('clip-path="url(#a_c)"');
    expect(o).toContain('href="#a_r"');
    expect(o).toContain("href='#a_r'");
    expect(o).toContain("#a_c{x:1}");
    expect(o).toContain("#cc{y:2}"); // a different id sharing a prefix is untouched
    expect(o).toContain("url(#a_g)}");
  });
  it("two instances share no ids", () => {
    const ids = (m: string) => [...m.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
    const all = [...ids(uniquifyIds(svg, "a_")), ...ids(uniquifyIds(svg, "b_"))];
    expect(new Set(all).size).toBe(all.length);
  });
  it("leaves id-free markup alone", () => {
    expect(uniquifyIds('<path d="M0 0"/>', "a_")).toBe('<path d="M0 0"/>');
  });
});

describe("partMarkup", () => {
  const M = placeMatrix(10, 20, 0, 1, 1, 0, 0);
  const line = (d: number[], stroke = "#000"): FlatItem => ({
    segs: [
      ["M", d[0], d[1]],
      ["L", d[2], d[3]],
    ],
    fill: "none",
    stroke,
    sw: 0.2,
    evenodd: false,
    fo: 1,
    so: 1,
  });
  it("emits a single <path id> when every shape is an unfilled line of one stroke", () => {
    const m = partMarkup({ flat: [line([0, 0, 5, 0]), line([0, 1, 5, 1])], rootAttrs: "", inner: "" }, M, "p-1", "");
    expect(m.startsWith('<path id="p-1" ')).toBe(true);
    expect(m).toContain('d="M10 20L15 20M10 21L15 21"');
    expect(m).not.toContain("<g");
  });
  it("emits one <g id> of transform-free paths when styles differ", () => {
    const m = partMarkup(
      { flat: [line([0, 0, 5, 0]), line([0, 1, 5, 1], "#f00")], rootAttrs: "", inner: "" },
      M,
      "p-1",
      "",
    );
    expect(m.startsWith('<g id="p-1"><path ')).toBe(true);
    expect(m).not.toContain("transform");
  });
  it("falls back to a transformed group around the original markup", () => {
    const m = partMarkup({ flat: null, rootAttrs: 'fill="none"', inner: "<text/>" }, M, "p-1", "translate(1 2)");
    expect(m).toBe('<g id="p-1" transform="translate(1 2)"><g fill="none"><text/></g></g>');
  });
  it("rotates exactly for multiples of 90°", () => {
    const [a, b, c, d] = placeMatrix(0, 0, 90, 2, 3, 0, 0);
    expect([a, b, c, d]).toEqual([0, 2, -3, 0]);
  });
  it("slugs file names into valid ids", () => {
    expect(slug("My part (1).svg")).toBe("My-part-1");
    expect(slug("1star.svg")).toBe("p1star");
    expect(slug("***.svg")).toBe("part");
  });
});
