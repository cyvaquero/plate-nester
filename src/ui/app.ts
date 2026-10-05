import { downloadBlob, plateFilename, plateSVG, zipPlates } from "../export/plate";
import { NestClient } from "../nest/client";
import type { DoneResponse } from "../nest/protocol";
import type { Layout } from "../nest/types";
import { toNestSettings, toWire } from "../nest/wire";
import { SAMPLES } from "../samples";
import { parseSVG, rescalePart } from "../svg/parse";
import type { Mode, Part, Settings } from "../types";
import { IN, fmt, fromDisp, toDisp } from "../units";
import { $, toast } from "./dom";
import { renderParts, updateCount } from "./parts";
import { renderLayout } from "./results";
import { loadSettings, saveSettings } from "./settings";

const LEN = ["plateW", "plateH", "kerf", "gap", "margin"] as const;
const SEARCH_MS = 4000,
  MORE_MS = 30000;

/** Hooks the Playwright tests use; only exposed in dev/test builds. */
export interface TestHook {
  getLayout(): Layout | null;
  getParts(): Part[];
  getSettings(): Settings;
  plateSVG(i: number, o?: { forceOriginal?: boolean }): string;
  /** Override search determinism (seed / iteration cap) for the next runs, then re-run. */
  configure(o: { seed?: number; maxIterations?: number; budgetMs?: number }): void;
  setSettings(patch: Partial<Settings>): void;
  rerun(): void;
}

export function startApp(): void {
  const S: Settings = loadSettings();
  const save = () => saveSettings(S);

  let parts: Part[] = [];
  let uid = 0;
  let geoVer = 0;
  let layout: Layout | null = null;
  let runParts = new Map<number, Part>(); // parts as of the run that produced `layout`
  let oversize = new Set<number>();
  let tried = 0;
  let last: DoneResponse | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const dbg: { seed?: number; maxIterations?: number; budgetMs?: number } = {};

  const client = new NestClient({
    onLayout(l) {
      layout = l;
      oversize = new Set(l.oversize);
      draw();
      drawParts();
    },
    onProgress(p) {
      tried = p.tried;
      setStatus(
        `Searching… ${(p.elapsedMs / 1000).toFixed(1)} of ${(p.budgetMs / 1000).toFixed(0)} s · ${p.tried} layouts tried`,
        true,
      );
    },
    onDone(d) {
      last = d;
      tried = d.tried;
      finish();
    },
    onError(e) {
      toast("Nesting stopped after an error: " + e.message);
      finish();
    },
  });

  /* ---------- status / run control ---------- */
  function setStatus(text: string, on: boolean): void {
    const el = $("status");
    el.dataset.state = on ? "running" : "idle";
    el.innerHTML = `<span class="dot${on ? " on" : ""}"></span>`;
    el.append(text);
  }
  function finish(): void {
    $("stop").hidden = true;
    $<HTMLButtonElement>("more").disabled = S.mode !== "shape" || !last || !last.bestPlates;
    const better = last && last.bestPlates > last.minPlates;
    setStatus(
      `${tried ? `Best of ${tried} layouts tried.` : "Ready."}${last?.canSearchMore && better ? " A longer search may save a plate." : ""}`,
      false,
    );
  }
  function startRun(budgetMs: number): void {
    runParts = new Map(parts.map((p) => [p.uid, p]));
    tried = 0;
    last = null;
    $("stop").hidden = S.mode !== "shape";
    $<HTMLButtonElement>("more").disabled = true;
    setStatus("Nesting…", true);
    client.run({
      mode: S.mode,
      parts: parts.map(toWire),
      settings: toNestSettings(S),
      geoVer,
      budgetMs: dbg.budgetMs ?? budgetMs,
      seed: dbg.seed,
      maxIterations: dbg.maxIterations,
    });
  }
  /** Re-run after a short pause (restarting cancels any run in flight). */
  function schedule(delay: number, rerender: boolean): void {
    clearTimeout(timer);
    client.stop();
    setStatus("Nesting…", true);
    timer = setTimeout(() => {
      if (rerender) drawParts();
      startRun(SEARCH_MS);
    }, delay);
  }
  const restart = () => schedule(250, true);

  $("stop").onclick = () => {
    client.stop();
    finish();
  };
  $("more").onclick = () => {
    $("stop").hidden = false;
    $<HTMLButtonElement>("more").disabled = true;
    setStatus("Nesting…", true);
    client.more(dbg.budgetMs ?? MORE_MS);
  };

  /* ---------- rendering ---------- */
  function draw(): void {
    if (layout) renderLayout({ S, layout, parts: runParts, hasParts: parts.length > 0, onExport: exportPlate });
  }
  function drawParts(): void {
    renderParts({
      parts,
      S,
      oversize,
      onQty: () => schedule(350, false),
      onLock: () => schedule(250, false),
      onRemove: (p) => {
        removeParts((x) => x === p);
        restart();
      },
    });
  }
  function removeParts(fn: (p: Part) => boolean): void {
    parts = parts.filter((p) => {
      if (fn(p)) {
        URL.revokeObjectURL(p.thumb);
        return false;
      }
      return true;
    });
  }

  /* ---------- controls ---------- */
  function fillInputs(): void {
    for (const k of LEN) {
      const dec = k === "kerf" ? (S.unit === "in" ? 4 : 3) : S.unit === "in" ? 3 : 2;
      $<HTMLInputElement>(k).value = String(+toDisp(S[k], S.unit).toFixed(dec));
      $<HTMLInputElement>(k).step = S.unit === "in" ? (k === "kerf" ? "0.001" : "0.125") : k === "kerf" ? "0.01" : "1";
    }
    $<HTMLSelectElement>("rotStep").value = String(S.rotStep);
    $<HTMLSelectElement>("prec").value = String(S.prec);
    $<HTMLSelectElement>("dpi").value = String(S.dpi);
    $<HTMLInputElement>("rotate90").checked = S.rotate90;
    $<HTMLInputElement>("outline").checked = S.outline;
    document.querySelectorAll(".u").forEach((e) => (e.textContent = S.unit));
    $("u-mm").setAttribute("aria-pressed", String(S.unit === "mm"));
    $("u-in").setAttribute("aria-pressed", String(S.unit === "in"));
    document.body.dataset.mode = S.mode;
    $("m-shape").setAttribute("aria-pressed", String(S.mode === "shape"));
    $("m-bbox").setAttribute("aria-pressed", String(S.mode === "bbox"));
  }
  function setUnit(u: "mm" | "in"): void {
    if (S.unit === u) return;
    const conv = (v: number) => (isNaN(v) ? "" : String(+(u === "in" ? v / IN : v * IN).toFixed(4)));
    const d = $<HTMLInputElement>("kDesign"),
      m = $<HTMLInputElement>("kMeasured");
    d.value = conv(parseFloat(d.value));
    m.value = conv(parseFloat(m.value));
    S.unit = u;
    save();
    fillInputs();
    kerfCalc();
    drawParts();
    draw();
  }
  function setMode(m: Mode): void {
    if (S.mode === m) return;
    S.mode = m;
    save();
    fillInputs();
    restart();
  }
  $("m-shape").onclick = () => setMode("shape");
  $("m-bbox").onclick = () => setMode("bbox");
  $("u-mm").onclick = () => setUnit("mm");
  $("u-in").onclick = () => setUnit("in");
  for (const k of LEN)
    $<HTMLInputElement>(k).addEventListener("input", () => {
      const v = parseFloat($<HTMLInputElement>(k).value);
      if (!isNaN(v) && v >= 0) {
        S[k] = fromDisp(v, S.unit);
        save();
        if (k === "kerf" || k === "gap") geoVer++;
        restart();
      }
    });
  $<HTMLSelectElement>("rotStep").onchange = (e) => {
    S.rotStep = +(e.target as HTMLSelectElement).value;
    save();
    restart();
  };
  $<HTMLSelectElement>("prec").onchange = (e) => {
    S.prec = +(e.target as HTMLSelectElement).value;
    save();
    geoVer++;
    restart();
  };
  $<HTMLInputElement>("rotate90").onchange = (e) => {
    S.rotate90 = (e.target as HTMLInputElement).checked;
    save();
    restart();
  };
  $<HTMLInputElement>("outline").onchange = (e) => {
    S.outline = (e.target as HTMLInputElement).checked;
    save();
  };
  $<HTMLSelectElement>("dpi").onchange = (e) => {
    S.dpi = +(e.target as HTMLSelectElement).value;
    save();
    parts.forEach((p) => rescalePart(p, S.dpi));
    geoVer++;
    restart();
  };

  /* kerf test-cut helper: kerf = designed − measured */
  function kerfCalc(): number | null {
    const d = parseFloat($<HTMLInputElement>("kDesign").value),
      m = parseFloat($<HTMLInputElement>("kMeasured").value);
    if (isNaN(d) || isNaN(m) || m > d) {
      $("kOut").textContent = "Kerf: –";
      $<HTMLButtonElement>("kUse").disabled = true;
      return null;
    }
    const k = fromDisp(d - m, S.unit);
    $("kOut").textContent = `Kerf: ${fmt(k, S.unit, S.unit === "in" ? 4 : 3)} ${S.unit}`;
    $<HTMLButtonElement>("kUse").disabled = false;
    return k;
  }
  $("kDesign").oninput = kerfCalc;
  $("kMeasured").oninput = kerfCalc;
  $("kUse").onclick = () => {
    const k = kerfCalc();
    if (k != null) {
      S.kerf = k;
      save();
      fillInputs();
      geoVer++;
      restart();
      toast("Kerf updated");
    }
  };

  /* ---------- files ---------- */
  const drop = $("drop"),
    file = $<HTMLInputElement>("file");
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
    if (e.dataTransfer) void addFiles(e.dataTransfer.files);
  };
  file.onchange = () => {
    if (file.files) void addFiles(file.files);
    file.value = "";
  };
  async function addFiles(list: FileList): Promise<void> {
    const files = [...list].filter((f) => /\.svg$/i.test(f.name) || f.type === "image/svg+xml");
    if (!files.length) {
      toast("Only .svg files can be added.");
      return;
    }
    if (parts.some((p) => p.sample)) removeParts((p) => !!p.sample);
    const errs: string[] = [];
    for (const f of files) {
      try {
        parts.push(parseSVG(await f.text(), f.name, ++uid, S.dpi));
      } catch (e) {
        errs.push((e as Error).message);
      }
    }
    if (errs.length) toast(errs.join(" "));
    restart();
  }
  $("clear").onclick = () => {
    removeParts(() => true);
    restart();
  };

  /* ---------- export ---------- */
  const exportOpts = () => ({ plateW: S.plateW, plateH: S.plateH, outline: S.outline });
  function exportPlate(i: number): void {
    if (!layout) return;
    const svg = plateSVG(layout.plates[i], runParts, exportOpts());
    const name = plateFilename(i, layout.plates.length);
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), name);
    toast(`Saved ${name}`);
  }
  $("dlAll").onclick = async () => {
    if (!layout) return;
    const blob = await zipPlates(layout.plates.map((pl) => plateSVG(pl, runParts, exportOpts())));
    downloadBlob(blob, "nested-plates.zip");
    toast("Saved nested-plates.zip");
  };

  /* ---------- start ---------- */
  $("version").textContent = `v${__APP_VERSION__}`;
  fillInputs();
  for (const [name, qty, text] of SAMPLES) {
    try {
      const p = parseSVG(text, name, ++uid, S.dpi);
      p.qty = qty;
      p.sample = true;
      parts.push(p);
    } catch (e) {
      console.error(e);
    }
  }
  drawParts();
  updateCount(parts);
  startRun(SEARCH_MS);

  if (import.meta.env.DEV || import.meta.env.MODE === "test") {
    const hook: TestHook = {
      getLayout: () => layout,
      getParts: () => parts,
      getSettings: () => S,
      plateSVG: (i, o = {}) => plateSVG(layout!.plates[i], runParts, { ...exportOpts(), ...o }),
      configure: (o) => Object.assign(dbg, o),
      setSettings: (patch) => {
        Object.assign(S, patch);
        save();
        fillInputs();
        geoVer++;
        restart();
      },
      rerun: () => restart(),
    };
    (window as unknown as { __plateNester: TestHook }).__plateNester = hook;
  }
}
