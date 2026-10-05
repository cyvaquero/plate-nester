import { plateSVG } from "../export/plate";
import type { Layout } from "../nest/types";
import type { Part, Settings } from "../types";
import { fmt } from "../units";
import { esc, n4 } from "../util";
import { $ } from "./dom";

let plateURLs: string[] = [];

export interface ResultsView {
  S: Settings;
  layout: Layout;
  parts: ReadonlyMap<number, Part>;
  hasParts: boolean;
  onExport(i: number): void;
}

/** Summary stats, warnings and one preview card per plate (preview image + dashed spacing envelopes). */
export function renderLayout(v: ResultsView): void {
  plateURLs.forEach((u) => URL.revokeObjectURL(u));
  plateURLs = [];
  const { S, layout: L } = v;
  const box = $("plates"),
    msgs = $("msgs");
  box.innerHTML = "";
  msgs.innerHTML = "";
  const plateA = S.plateW * S.plateH;
  const placed = L.plates.reduce((a, b) => a + b.placements.length, 0);
  $("sPlates").textContent = String(L.plates.length || "–");
  $("sMin").textContent = String(L.minPlates || "–");
  $("sFill").textContent = L.plates.length
    ? Math.round((100 * L.plates.reduce((a, b) => a + b.area, 0)) / (plateA * L.plates.length)) + "%"
    : "–";
  $("sParts").textContent = String(placed);
  const msg = (t: string) => {
    const m = document.createElement("div");
    m.className = "msg";
    m.textContent = t;
    msgs.appendChild(m);
  };
  const rot = S.mode === "bbox" ? S.rotate90 : !!S.rotStep;
  for (const uid of L.oversize) {
    const p = v.parts.get(uid);
    if (!p) continue;
    msg(
      S.mode === "bbox"
        ? `${p.name} (${fmt(p.wMM, S.unit)} × ${fmt(p.hMM, S.unit)} ${S.unit}) doesn't fit inside the plate's margins${!p.lock && rot ? " in either orientation" : ""}. It was left out.`
        : `${p.name} (${fmt(p.wMM, S.unit)} × ${fmt(p.hMM, S.unit)} ${S.unit}) doesn't fit inside the plate's margins${!p.lock && rot ? " at any allowed rotation" : ""}. It was left out.`,
    );
  }
  if (L.noArea) msg("The edge margin leaves no usable area on the plate.");
  if (!L.plates.length)
    box.innerHTML = `<p class="note">${v.hasParts ? "Set a quantity above zero to place parts." : "Add SVG files to see them nested on plates."}</p>`;
  const opts = { plateW: S.plateW, plateH: S.plateH, outline: S.outline, preview: true };
  L.plates.forEach((pl, i) => {
    const url = URL.createObjectURL(new Blob([plateSVG(pl, v.parts, opts)], { type: "image/svg+xml" }));
    plateURLs.push(url);
    const fill = Math.round((100 * pl.area) / plateA);
    const env = pl.placements
      .map((it) =>
        it.env
          .map(
            (q) =>
              `<polygon points="${q.map(([x, y]) => `${n4(x)},${n4(y)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" opacity=".65"><title>${esc(v.parts.get(it.partId)?.name ?? "")}${it.ang ? ` (rotated ${it.ang}°)` : ""}</title></polygon>`,
          )
          .join(""),
      )
      .join("");
    const mg =
      S.margin > 0
        ? `<rect x="${n4(S.margin)}" y="${n4(S.margin)}" width="${n4(S.plateW - 2 * S.margin)}" height="${n4(S.plateH - 2 * S.margin)}" fill="none" stroke="var(--plate-edge)" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/>`
        : "";
    const card = document.createElement("article");
    card.className = "plate";
    card.dataset.plate = String(i);
    card.innerHTML = `<div class="hd"><div><div class="t">Plate ${i + 1} of ${L.plates.length}</div><div class="m">${pl.placements.length} parts · ${fill}% fill · ${fmt(S.plateW, S.unit)} × ${fmt(S.plateH, S.unit)} ${S.unit}</div></div><button type="button" class="btn small">Download SVG</button></div>
      <div class="sheet" style="aspect-ratio:${S.plateW}/${S.plateH}"><img alt="Plate ${i + 1} layout" src="${url}"><svg viewBox="0 0 ${n4(S.plateW)} ${n4(S.plateH)}" preserveAspectRatio="none" aria-hidden="true">${mg}${env}</svg></div>
      <div class="bar" aria-hidden="true"><i style="width:${fill}%"></i></div>`;
    card.querySelector("button")!.onclick = () => v.onExport(i);
    box.appendChild(card);
  });
  $("dlAll").hidden = !(L.plates.length > 1);
}
