import "../src/ui/theme";
import { SAMPLE_PARTS, downloadBlob, nest, plateFilename, plateSVG } from "../src/lib";
import type { NestInput, NestResult } from "../src/lib";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => parseFloat($<HTMLInputElement>(id).value);
const n4 = (v: number) => +v.toFixed(4);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

let mode: "shape" | "bbox" = "shape";
let uploads: NestInput[] = [];
let urls: string[] = [];
let current: NestResult | null = null;
let ctrl: AbortController | null = null;

/* ---------- ui helpers ---------- */
let toastT: ReturnType<typeof setTimeout> | undefined;
function toast(text: string): void {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastT);
  toastT = setTimeout(() => (el.hidden = true), 3500);
}
function setStatus(text: string, running: boolean): void {
  const el = $("status");
  el.dataset.state = running ? "running" : "idle";
  el.innerHTML = `<span class="dot${running ? " on" : ""}"></span>`;
  el.append(text);
  $<HTMLButtonElement>("run").disabled = running;
  $("stop").hidden = !running;
}
function setMode(m: "shape" | "bbox"): void {
  mode = m;
  document.body.dataset.mode = m;
  $("m-shape").setAttribute("aria-pressed", String(m === "shape"));
  $("m-bbox").setAttribute("aria-pressed", String(m === "bbox"));
  void run();
}

/* ---------- parts ---------- */
function inputs(): NestInput[] {
  const qty = Math.max(1, Math.round(num("qty")) || 1);
  const list = uploads.length ? uploads.map((u) => ({ ...u, qty })) : SAMPLE_PARTS;
  $("sampleBadge").hidden = uploads.length > 0;
  $("partsNote").textContent = uploads.length
    ? `${uploads.length} file${uploads.length === 1 ? "" : "s"} × ${qty}: ${uploads.map((u) => u.name).join(", ")}`
    : `${SAMPLE_PARTS.length} sample parts: ${SAMPLE_PARTS.map((s) => `${s.name} × ${s.qty}`).join(", ")}`;
  return list;
}
async function addFiles(list: FileList | null): Promise<void> {
  const files = [...(list ?? [])].filter((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");
  if (!files.length) return toast("Only .svg files can be added.");
  uploads = await Promise.all(files.map(async (f) => ({ name: f.name, svg: await f.text() })));
  void run();
}

/* ---------- results ---------- */
function show(r: NestResult): void {
  current = r;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const { settings: S, stats, layout: L } = r;
  $("sPlates").textContent = String(stats.plates || "–");
  $("sMin").textContent = String(stats.minPlates || "–");
  $("sFill").textContent = stats.plates ? Math.round(stats.fill * 100) + "%" : "–";
  $("sParts").textContent = String(stats.placed);
  $("zip").hidden = stats.plates < 2;

  const msgs = r.rejected.map((x) => x.error);
  for (const uid of L.oversize) {
    const p = r.parts.get(uid)!;
    msgs.push(
      `${p.name} (${+p.wMM.toFixed(1)} × ${+p.hMM.toFixed(1)} mm) doesn't fit inside the plate's margins. It was left out.`,
    );
  }
  if (L.noArea) msgs.push("The edge margin leaves no usable area on the plate.");
  $("msgs").replaceChildren(
    ...msgs.map((t) => Object.assign(document.createElement("div"), { className: "msg", textContent: t })),
  );

  const box = $("plates");
  box.innerHTML = "";
  if (!stats.plates) box.innerHTML = `<p class="note">Nothing to place yet.</p>`;
  const exports = r.plates();
  const plateA = S.plateW * S.plateH;
  L.plates.forEach((pl, i) => {
    const preview = plateSVG(pl, r.parts, { plateW: S.plateW, plateH: S.plateH, outline: false, preview: true });
    const url = URL.createObjectURL(new Blob([preview], { type: "image/svg+xml" }));
    urls.push(url);
    const fill = Math.round((100 * pl.area) / plateA);
    const env = pl.placements
      .flatMap((it) =>
        it.env.map(
          (q) =>
            `<polygon points="${q.map(([x, y]) => `${n4(x)},${n4(y)}`).join(" ")}" fill="none" stroke="var(--accent)" stroke-width="1" stroke-dasharray="3 2" vector-effect="non-scaling-stroke" opacity=".65"><title>${esc(r.parts.get(it.partId)!.name)}${it.ang ? ` (rotated ${it.ang}°)` : ""}</title></polygon>`,
        ),
      )
      .join("");
    const mg =
      S.margin > 0
        ? `<rect x="${n4(S.margin)}" y="${n4(S.margin)}" width="${n4(S.plateW - 2 * S.margin)}" height="${n4(S.plateH - 2 * S.margin)}" fill="none" stroke="var(--plate-edge)" stroke-width="1" stroke-dasharray="1 3" vector-effect="non-scaling-stroke"/>`
        : "";
    const card = document.createElement("article");
    card.className = "plate";
    card.innerHTML = `<div class="hd"><div><div class="t">Plate ${i + 1} of ${stats.plates}</div><div class="m">${pl.placements.length} parts · ${fill}% fill · ${S.plateW} × ${S.plateH} mm</div></div><button type="button" class="btn small">Download SVG</button></div>
      <div class="sheet" style="aspect-ratio:${S.plateW}/${S.plateH}"><img alt="Plate ${i + 1} layout" src="${url}"><svg viewBox="0 0 ${n4(S.plateW)} ${n4(S.plateH)}" preserveAspectRatio="none" aria-hidden="true">${mg}${env}</svg></div>
      <div class="bar" aria-hidden="true"><i style="width:${fill}%"></i></div>`;
    card.querySelector("button")!.onclick = () => {
      const name = plateFilename(i, stats.plates);
      downloadBlob(new Blob([exports[i]], { type: "image/svg+xml" }), name);
      toast(`Saved ${name}`);
    };
    box.appendChild(card);
  });
}

/* ---------- run ---------- */
async function run(): Promise<void> {
  ctrl?.abort();
  const mine = (ctrl = new AbortController());
  setStatus("Nesting…", true);
  try {
    const r = await nest(inputs(), {
      mode,
      plateW: num("plateW"),
      plateH: num("plateH"),
      kerf: num("kerf"),
      gap: num("gap"),
      margin: num("margin"),
      rotStep: +$<HTMLSelectElement>("rotStep").value,
      rotate90: $<HTMLInputElement>("rotate90").checked,
      outline: $<HTMLInputElement>("outline").checked,
      budgetMs: num("budget") * 1000,
      signal: mine.signal,
      onLayout: (l) => {
        if (mine === ctrl) show(l);
      },
      onProgress: (p) => {
        if (mine === ctrl)
          setStatus(
            `Searching… ${(p.elapsedMs / 1000).toFixed(1)} of ${(p.budgetMs / 1000).toFixed(0)} s · ${p.tried} layouts tried`,
            true,
          );
      },
    });
    if (mine !== ctrl) return; // superseded by a newer run
    show(r);
    setStatus(r.tried ? `Done: best of ${r.tried} layouts tried.` : "Done.", false);
  } catch (e) {
    if (mine === ctrl) setStatus(`Error: ${(e as Error).message}`, false);
  }
}

/* ---------- wiring ---------- */
$("m-shape").onclick = () => setMode("shape");
$("m-bbox").onclick = () => setMode("bbox");
$("run").onclick = () => void run();
$("stop").onclick = () => ctrl?.abort();
$("useSamples").onclick = () => {
  uploads = [];
  void run();
};
$("zip").onclick = async () => {
  if (!current) return;
  downloadBlob(await current.zip(), "nested-plates.zip");
  toast("Saved nested-plates.zip");
};
const drop = $("drop"),
  file = $<HTMLInputElement>("files");
drop.onclick = () => file.click();
drop.onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    file.click();
  }
};
drop.ondragover = (e) => {
  e.preventDefault();
  drop.classList.add("over");
};
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  void addFiles(e.dataTransfer?.files ?? null);
};
file.onchange = () => {
  void addFiles(file.files);
  file.value = "";
};
void run();
