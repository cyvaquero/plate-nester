import { rectFits } from "../nest/rect";
import type { Part, Settings } from "../types";
import { fmt } from "../units";
import { esc } from "../util";
import { $ } from "./dom";

const ICON_LOCK = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="7" width="10" height="7" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>`;
const ICON_X = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

export interface PartsView {
  parts: Part[];
  S: Settings;
  /** Parts the engine reported as too big for the plate (true-shape mode). */
  oversize: ReadonlySet<number>;
  onQty(p: Part): void;
  onLock(p: Part): void;
  onRemove(p: Part): void;
}

export function updateCount(parts: Part[]): void {
  const n = parts.reduce((a, p) => a + p.qty, 0);
  $("partCount").textContent = `${parts.length} file${parts.length === 1 ? "" : "s"} · ${n} part${n === 1 ? "" : "s"}`;
}

export function renderParts(v: PartsView): void {
  const box = $("parts");
  box.innerHTML = "";
  const unit = v.S.unit;
  for (const p of v.parts) {
    const fits = v.S.mode === "bbox" ? rectFits({ wMM: p.wMM, hMM: p.hMM, lock: p.lock }, v.S) : !v.oversize.has(p.uid);
    const row = document.createElement("div");
    row.className = "part";
    row.innerHTML = `<img alt="" src="${p.thumb}"><div style="min-width:0"><div class="nm" title="${esc(p.name)}">${esc(p.name)}</div><div class="sz${fits ? "" : " bad"}">${fmt(p.wMM, unit)} × ${fmt(p.hMM, unit)} ${unit}${fits ? "" : " · too big"}</div></div>
      <input type="number" min="0" step="1" value="${p.qty}" aria-label="Quantity of ${esc(p.name)}">
      <div class="acts"><button type="button" class="icon" aria-pressed="${p.lock}" title="Lock orientation (no rotation)" aria-label="Lock orientation">${ICON_LOCK}</button><button type="button" class="icon" title="Remove" aria-label="Remove ${esc(p.name)}">${ICON_X}</button></div>`;
    const q = row.querySelector("input")!;
    q.oninput = () => {
      const n = parseInt(q.value, 10);
      if (n >= 0) {
        p.qty = n;
        updateCount(v.parts);
        v.onQty(p);
      }
    };
    const [lk, rm] = row.querySelectorAll<HTMLButtonElement>(".acts button");
    lk.onclick = () => {
      p.lock = !p.lock;
      lk.setAttribute("aria-pressed", String(p.lock));
      v.onLock(p);
    };
    rm.onclick = () => v.onRemove(p);
    box.appendChild(row);
  }
  if (!v.parts.length) box.innerHTML = `<p class="note" style="margin:0">No parts yet. Add SVG files above.</p>`;
  $("sampleBadge").hidden = !v.parts.some((p) => p.sample);
  updateCount(v.parts);
}
