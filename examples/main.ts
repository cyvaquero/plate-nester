import { downloadBlob, nest, plateFilename } from "../src/lib";
import type { NestInput, NestResult } from "../src/lib";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => parseFloat($<HTMLInputElement>(id).value);

const STROKE = 'fill="none" stroke="#000" stroke-width="0.2"';
const SAMPLES: NestInput[] = [
  {
    name: "star.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="67mm" viewBox="0 0 70 67"><polygon points="35,0.5 43.2,24.6 69.2,25.1 48.6,40.8 56.1,65.9 35,51 13.9,65.9 21.4,40.8 0.8,25.1 26.8,24.6" ${STROKE}/></svg>`,
  },
  {
    name: "bracket.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="80mm" height="60mm" viewBox="0 0 80 60"><polygon points="0,0 80,0 80,16 16,16 16,60 0,60" ${STROKE}/><circle cx="8" cy="50" r="2.5" ${STROKE}/></svg>`,
  },
  {
    name: "moon.svg",
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="34mm" height="60mm" viewBox="0 0 34 60"><path d="M30 0 A30 30 0 0 0 30 60 A36 36 0 0 1 30 0 Z" ${STROKE}/></svg>`,
  },
];

let urls: string[] = [];
let current: NestResult | null = null;
let ctrl: AbortController | null = null;

async function inputs(): Promise<NestInput[]> {
  const files = [...($<HTMLInputElement>("files").files ?? [])];
  const qty = Math.max(1, Math.round(num("qty")) || 1);
  const list = files.length
    ? await Promise.all(files.map(async (f) => ({ name: f.name, svg: await f.text() })))
    : SAMPLES;
  $("partsNote").textContent = files.length
    ? `${files.length} file(s) × ${qty}`
    : `Using ${SAMPLES.length} sample parts × ${qty}: ${SAMPLES.map((s) => s.name).join(", ")}`;
  return list.map((it) => ({ ...it, qty }));
}

function show(r: NestResult): void {
  current = r;
  urls.forEach((u) => URL.revokeObjectURL(u));
  urls = [];
  const s = r.stats;
  $("stats").innerHTML =
    `<div><b>${s.plates}</b>plates</div><div><b>${s.minPlates}</b>area minimum</div>` +
    `<div><b>${Math.round(s.fill * 100)}%</b>average fill</div><div><b>${s.placed}</b>parts placed</div>`;
  const warn: string[] = r.rejected.map((x) => x.error);
  for (const uid of r.layout.oversize)
    warn.push(`${r.parts.get(uid)?.name} doesn't fit on the plate and was left out.`);
  if (r.layout.noArea) warn.push("The edge margin leaves no usable area.");
  $("warnings").replaceChildren(
    ...warn.map((w) => Object.assign(document.createElement("p"), { className: "warn", textContent: w })),
  );
  const box = $("plates");
  box.innerHTML = "";
  r.plates().forEach((svg, i) => {
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    urls.push(url);
    const fig = document.createElement("figure");
    fig.innerHTML = `<img alt="Plate ${i + 1}" src="${url}"><figcaption><span>Plate ${i + 1} · ${r.layout.plates[i].placements.length} parts</span><button>SVG</button></figcaption>`;
    fig.querySelector("button")!.onclick = () =>
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), plateFilename(i, s.plates));
    box.appendChild(fig);
  });
  $<HTMLButtonElement>("zip").disabled = !s.plates;
}

function setStatus(text: string, running: boolean): void {
  $("status").textContent = text;
  $("status").dataset.state = running ? "running" : "idle";
  $<HTMLButtonElement>("run").disabled = running;
  $<HTMLButtonElement>("stop").disabled = !running;
}

async function run(): Promise<void> {
  ctrl = new AbortController();
  setStatus("Nesting…", true);
  try {
    const r = await nest(await inputs(), {
      mode: $<HTMLSelectElement>("mode").value as "shape" | "bbox",
      plateW: num("plateW"),
      plateH: num("plateH"),
      kerf: num("kerf"),
      gap: num("gap"),
      margin: num("margin"),
      rotStep: +$<HTMLSelectElement>("rotStep").value,
      rotate90: $<HTMLSelectElement>("rotStep").value !== "0",
      budgetMs: num("budget") * 1000,
      signal: ctrl.signal,
      onLayout: show,
      onProgress: (p) => setStatus(`Searching… ${(p.elapsedMs / 1000).toFixed(1)} s · ${p.tried} layouts tried`, true),
    });
    show(r);
    setStatus(`Done${r.tried ? `: best of ${r.tried} layouts` : ""}.`, false);
  } catch (e) {
    setStatus(`Error: ${(e as Error).message}`, false);
  }
}

$("run").onclick = () => void run();
$("stop").onclick = () => ctrl?.abort();
$("zip").onclick = async () => {
  if (current) downloadBlob(await current.zip(), "nested-plates.zip");
};
void run();
