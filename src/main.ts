import { recordWebm, webmMimeType } from "./webm-export";
import { svgZip } from "./zip";
import { createPaper, type Pattern } from "./paper";
import { ThreePaperRenderer, type PaperSide } from "./renderer";
import "./style.css";
import exampleSvg from "./assets/studio-letter.svg?raw";
import { type PaperCameraView } from "./camera";
import { patterns } from "./patterns";

const root = document.querySelector<HTMLDivElement>("#app")!;
root.innerHTML = `
<header><a class="brand" href="./"><span class="brand-icon">⌑</span> letterfold<span class="version">LAB / 001</span></a><div class="header-right"><span class="status-dot"></span> An exploration in paper & motion <a href="https://github.com/mrdoob/three.js" target="_blank" rel="noreferrer" aria-label="Three.js on GitHub">↗</a></div></header>
<main><section class="intro"><div><p class="eyebrow">THE PAPER FOLDING LABORATORY</p><h1>A simple sheet.<br>A world of possibilities.</h1><p class="description">Explore the quiet mechanics of folding paper.<br>A real 3D mesh, shaped one crease at a time.</p></div><div class="intro-note"><span>01 — MATERIAL STUDY</span><p>From an open letter<br>to a small, folded keepsake.</p></div></section>
<div class="workspace"><section class="stage" aria-label="Paper simulation"><div class="stage-top"><span><i class="status-dot"></i> LIVE SIMULATION</span><span id="view-label">PERSPECTIVE VIEW</span></div><div id="viewer"></div><div class="view-buttons"><button id="home" title="Perspective view" aria-label="Perspective view">◇</button><button id="top" title="Top view" aria-label="Top view">▱</button><button id="fit" title="Fit paper in view" aria-label="Fit paper in view">⊡</button><button id="reset" title="Reset paper" aria-label="Reset paper">↺</button></div><div class="stage-bottom"><span>↔ Drag to orbit <b>·</b> Scroll to zoom</span><span id="sheet-size">210 × 297 mm <b>·</b> A4</span></div></section>
<aside><div class="panel-heading"><p class="eyebrow">FOLDING SEQUENCE</p><span id="pattern-number">01 / 03</span></div><h2>Give paper a little shape.</h2><label class="field-label" for="pattern">Fold pattern</label><select id="pattern">${Object.entries(
  patterns,
)
  .map(
    ([id, p]) =>
      `<option value="${id}" ${id === "letter" ? "selected" : ""}>${p.name}</option>`,
  )
  .join(
    "",
  )}</select><p id="pattern-description" class="small-text">Two inward folds. A familiar home for a handwritten letter.</p><div id="steps" class="steps"></div><div class="divider"></div><div class="label-row"><label for="thickness">Paper thickness</label><span id="thickness-value">0.12 mm</span></div><input id="thickness" type="range" min="6" max="80" value="12"/><div class="range-labels"><span>0.06 mm</span><span id="thickness-max">0.80 mm</span></div><div class="imperfection-control"><div class="label-row"><label for="imperfection">Fold imperfection</label><span id="imperfection-value">Off</span></div><input id="imperfection" type="range" min="0" max="200" value="0"/><div class="range-labels"><span>Precise</span><span>Crooked · ±2.0°</span></div><button id="reroll" class="reroll" disabled>↻ New variation</button><p class="small-text">A different slight tilt for each crease. Stays the same as you unfold and replay.</p></div><div class="artwork-import"><p class="field-label">Front design</p><div class="artwork-actions"><button id="import-svg">Import front SVG</button><button id="example-svg">Try SVG design</button></div><input id="svg-file" type="file" accept=".svg,image/svg+xml" hidden/><p id="svg-status" class="small-text" role="status">Add a design that folds with the paper. SVG · up to 2 MB.</p><button id="reset-artwork" class="reroll" hidden>Restore sample letter</button></div><div class="artwork-import"><p class="field-label">Back design</p><div class="artwork-actions"><button id="import-back-svg">Import back SVG</button><button id="example-back-svg">Try back design</button></div><input id="back-svg-file" type="file" accept=".svg,image/svg+xml" hidden/><p id="back-svg-status" class="small-text" role="status">Blank reverse side. SVG · up to 2 MB.</p><button id="reset-back-artwork" class="reroll" hidden>Clear back design</button></div><div class="toggles"><label><span>Letter artwork</span><input id="artwork" type="checkbox" checked/><span class="switch"></span></label><label><span>Crease guides</span><input id="creases" type="checkbox" checked/><span class="switch"></span></label><label><span>Black borders</span><input id="borders" type="checkbox"/><span class="switch"></span></label><div id="border-options"><div class="label-row"><label for="border-width">Border width</label><span id="border-width-value">2 px</span></div><input id="border-width" type="range" min="0.5" max="8" step="0.5" value="2"/></div><div class="label-row"><label for="lighting-contrast">Lighting contrast</label><span id="lighting-contrast-value">45%</span></div><input id="lighting-contrast" type="range" min="0" max="100" value="45"/><div class="label-row"><label for="shadow-softness">Shadow softness</label><span id="shadow-softness-value">70%</span></div><input id="shadow-softness" type="range" min="0" max="100" value="70"/><label><span>Wax seal on closed letter</span><input id="wax-seal" type="checkbox"/><span class="switch"></span></label><label><span>Simulation mesh</span><input id="mesh" type="checkbox"/><span class="switch"></span></label></div><div class="camera-editor"><p class="field-label">Camera per fold</p><label for="camera-step">View to edit</label><select id="camera-step"></select><div class="toggles"><label><span>Follow saved views</span><input id="camera-follow" type="checkbox"/><span class="switch"></span></label></div><p class="small-text">Angles are relative to the original sheet. Save an opening view and a view after each fold.</p><div id="camera-fields"></div><button id="camera-capture" class="reroll">Save current view here</button><p class="small-text">Turn following off to orbit freely, then save your view.</p><p id="camera-status" class="small-text" role="status"></p></div><div class="artwork-import"><p class="field-label">Export schematic SVG</p><p class="small-text">Standalone vector shapes, outlines and crease guides. Artwork and soft shadows are omitted.</p><label for="export-steps" class="field-label">Series frames</label><select id="export-steps"><option value="2">Open + halfway + end of every fold</option><option value="1">Open + end of every fold</option></select><div class="artwork-actions"><button id="export-current">Export current SVG</button><button id="export-series">Export series ZIP</button></div><p id="export-status" class="small-text" role="status">Uses your camera view, borders and guides. Transparent background.</p><img id="export-preview" alt="Latest exported schematic SVG" hidden style="width:100%;background:#f1efe7;border-radius:6px"/></div><div class="artwork-import"><p class="field-label">Export animation</p><p class="small-text">WebM video with artwork, lighting and camera views. Every frame rendered at 30 fps. Up to 1280 px.</p><label for="video-background">Video background</label><select id="video-background"><option value="transparent">Transparent</option><option value="cream">Cream</option></select><label for="video-motion">Motion</label><select id="video-motion"><option value="fold">Fold once</option><option value="loop">Fold and unfold loop</option></select><label for="video-speed">Seconds per fold</label><select id="video-speed"><option value="1">1 second</option><option value="2">2 seconds</option><option value="4" selected>4 seconds</option><option value="6">6 seconds</option></select><div class="artwork-actions"><button id="export-video">Export WebM</button><button id="cancel-video" hidden>Cancel export</button></div><p id="video-status" class="small-text" role="status">Renders every frame for smooth playback. Encoder loads on first export (~32 MB).</p><video id="video-preview" controls loop muted playsinline hidden style="width:100%;border-radius:6px;background:repeating-conic-gradient(#ddd 0% 25%, #fff 0% 50%) 0 / 20px 20px"></video></div><div class="physics-note"><span>↳</span><p>Folded in order, with room for every layer.<br><strong>Finite thickness · rounded creases</strong></p></div></aside>
</div><section class="transport"><button id="play" class="play" aria-label="Play folding animation">▶ <span>Fold the letter</span></button><button id="reverse" class="reverse" title="Reverse direction" aria-label="Reverse animation direction">⇄</button><div class="timeline"><div class="label-row"><label for="progress">FOLD PROGRESS</label><output id="progress-value">0%</output></div><input id="progress" type="range" min="0" max="1000" value="0"/><div class="range-labels"><span>Unfolded</span><span>Folded</span></div></div><span class="duration">SLOW DOWN.<br>WATCH IT TAKE SHAPE.</span></section><footer><span>A digital study of a very physical thing.</span><span>LAYER-AWARE FOLDS <b>·</b> <span id="layer-info">0.12 mm paper</span> <b>·</b> 180° CLOSURE</span></footer></main>`;
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const sim = createPaper();
let view: ThreePaperRenderer;
try {
  view = new ThreePaperRenderer(get("viewer"), sim);
} catch (error) {
  get("viewer").innerHTML =
    '<p class="webgl-error">The 3D viewer needs WebGL. Enable hardware acceleration in your browser and reload.</p>';
  throw error;
}
let playing = false,
  direction = 1,
  last = 0,
  accumulator = 0;
const slider = get<HTMLInputElement>("progress"),
  play = get<HTMLButtonElement>("play");
function updateControls() {
  slider.value = String(Math.round(sim.progress * 1000));
  get("progress-value").textContent = `${Math.round(sim.progress * 100)}%`;
  play.innerHTML = playing
    ? "Ⅱ <span>Pause folding</span>"
    : "▶ <span>Fold the letter</span>";
  play.setAttribute(
    "aria-label",
    playing ? "Pause folding animation" : "Play folding animation",
  );
  get("pattern-number").textContent =
    `0${Object.keys(patterns).indexOf(sim.pattern) + 1} / ${Object.keys(patterns).length.toString().padStart(2, "0")}`;
  get("reverse").classList.toggle("selected", direction === -1);
  const count = patterns[sim.pattern].steps.length;
  get("pattern-description").textContent = patterns[sim.pattern].description;
  get("sheet-size").textContent =
    sim.pattern === "lenz-1776"
      ? "Photo proportions · physical size unknown"
      : `${Math.round(sim.width * 1000)} × ${Math.round(sim.height * 1000)} mm`;
  get<HTMLInputElement>("thickness").max = String(
    Math.round(sim.maxThickness * 100000),
  );
  get<HTMLInputElement>("thickness").value = String(
    Math.round(sim.thickness * 100000),
  );
  get("thickness-value").textContent =
    `${(sim.thickness * 1000).toFixed(2)} mm`;
  get("layer-info").textContent =
    `${(sim.thickness * 1000).toFixed(2)} mm paper`;
  get("thickness-max").textContent =
    `${(sim.maxThickness * 1000).toFixed(2)} mm`;
  get("steps").innerHTML = Array.from({ length: count }, (_, i) => {
    const completed = sim.progress >= (i + 1) / count,
      active = sim.progress >= i / count;
    return `<div class="step ${active ? "active" : ""}"><span class="step-number">${completed ? "✓" : `0${i + 1}`}</span><div><strong>${patterns[sim.pattern].steps[i]}</strong><small>${sim.pattern === "lenz-1776" || (i === 1 && sim.pattern === "accordion") ? "Mountain" : "Valley"} fold · 180°</small></div><span class="step-mark">${completed ? "✓" : "↶"}</span></div>`;
  }).join("");
}
play.onclick = () => {
  if (
    !playing &&
    ((direction === 1 && sim.progress >= 1) ||
      (direction === -1 && sim.progress <= 0))
  ) {
    direction = sim.progress >= 1 ? -1 : 1;
  }
  playing = !playing;
  updateControls();
};
get("reverse").onclick = () => {
  direction *= -1;
  get("reverse").classList.toggle("selected", direction === -1);
  get("reverse").setAttribute(
    "aria-label",
    direction === -1
      ? "Direction: unfolding. Switch to folding."
      : "Direction: folding. Switch to unfolding.",
  );
};
slider.oninput = () => {
  playing = false;
  sim.setProgress(Number(slider.value) / 1000);
  updateControls();
};
get<HTMLSelectElement>("pattern").onchange = (event) => {
  playing = false;
  direction = 1;
  get("reverse").classList.remove("selected");
  const next = (event.target as HTMLSelectElement).value as Pattern;
  get<HTMLInputElement>("wax-seal").checked = next === "lenz-1776";
  const changeFormat = next === "lenz-1776" || sim.pattern === "lenz-1776";
  sim.reset(next);
  if (changeFormat)
    sim.setSize(
      next === "lenz-1776" ? 0.297 : 0.21,
      next === "lenz-1776" ? 0.2475 : 0.297,
    );
  if (next === "lenz-1776") {
    sim.setImperfection(0);
    get<HTMLInputElement>("imperfection").value = "0";
    updateImperfection();
    get<HTMLInputElement>("camera-follow").checked = true;
  }
  get("pattern-description").textContent =
    sim.pattern === "letter"
      ? "Two inward folds. A familiar home for a handwritten letter."
      : sim.pattern === "half"
        ? "One crease, two halves. The simplest place to begin."
        : "Two opposing folds. A small study in peaks and valleys.";
  view.setSeal(get<HTMLInputElement>("wax-seal").checked);
  setupCameraEditor();
  updateControls();
};
get<HTMLInputElement>("thickness").oninput = (event) => {
  sim.setThickness(Number((event.target as HTMLInputElement).value) / 100000);
  get("thickness-value").textContent =
    `${(sim.thickness * 1000).toFixed(2)} mm`;
  get("layer-info").textContent =
    `${(sim.thickness * 1000).toFixed(2)} mm paper`;
};
function updateImperfection() {
  get("imperfection-value").textContent =
    sim.imperfection === 0 ? "Off" : `±${sim.imperfection.toFixed(2)}°`;
  get<HTMLButtonElement>("reroll").disabled = sim.imperfection === 0;
}
get<HTMLInputElement>("imperfection").oninput = (event) => {
  sim.setImperfection(Number((event.target as HTMLInputElement).value) / 100);
  updateImperfection();
};
get("reroll").onclick = () => {
  const seed = crypto.getRandomValues(new Uint32Array(1))[0];
  sim.setImperfection(sim.imperfection, seed);
  updateImperfection();
};
const artworkRequests = { front: 0, back: 0 };
for (const side of ["front", "back"] as PaperSide[]) {
  const back = side === "back";
  const status = get(back ? "back-svg-status" : "svg-status");
  const reset = get(back ? "reset-back-artwork" : "reset-artwork");
  const input = get<HTMLInputElement>(back ? "back-svg-file" : "svg-file");
  async function importArtwork(svg: string, name: string, request: number) {
    status.textContent = "Rendering SVG…";
    try {
      await view.setSvgArtwork(svg, side);
      if (request !== artworkRequests[side]) return;
      view.setArtwork(true);
      get<HTMLInputElement>("artwork").checked = true;
      status.textContent = `${name} · ${side} design`;
      reset.hidden = false;
    } catch (error) {
      if (request === artworkRequests[side])
        status.textContent =
          error instanceof Error ? error.message : "Unable to load SVG.";
    }
  }
  get(back ? "import-back-svg" : "import-svg").onclick = () => input.click();
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    if (file.size > 2 * 1024 * 1024) {
      status.textContent = "Choose an SVG smaller than 2 MB.";
      return;
    }
    const request = ++artworkRequests[side];
    try {
      const svg = await file.text();
      if (request === artworkRequests[side])
        await importArtwork(svg, file.name, request);
    } catch {
      if (request === artworkRequests[side])
        status.textContent = "Could not read this file. Please try again.";
    }
  };
  get(back ? "example-back-svg" : "example-svg").onclick = () => {
    void importArtwork(exampleSvg, "Post / Script", ++artworkRequests[side]);
  };
  reset.onclick = () => {
    artworkRequests[side]++;
    view.resetArtwork(side);
    reset.hidden = true;
    status.textContent = back
      ? "Blank reverse side. SVG · up to 2 MB."
      : "Sample letter restored. SVG · up to 2 MB.";
  };
}
get<HTMLInputElement>("artwork").onchange = (e) =>
  view.setArtwork((e.target as HTMLInputElement).checked);
get<HTMLInputElement>("creases").onchange = (e) =>
  view.setCreases((e.target as HTMLInputElement).checked);
get<HTMLInputElement>("borders").onchange = (e) => {
  const enabled = (e.target as HTMLInputElement).checked;
  view.setBorders(enabled);
};
get<HTMLInputElement>("border-width").oninput = (e) => {
  const width = Number((e.target as HTMLInputElement).value);
  view.setBorderWidth(width);
  view.setBorders(true);
  get<HTMLInputElement>("borders").checked = true;
  get("border-width-value").textContent = `${width} px`;
};
get<HTMLInputElement>("lighting-contrast").oninput = (e) => {
  const value = Number((e.target as HTMLInputElement).value);
  view.setLightingContrast(value / 100);
  get("lighting-contrast-value").textContent = `${value}%`;
};
get<HTMLInputElement>("shadow-softness").oninput = (e) => {
  const value = Number((e.target as HTMLInputElement).value);
  view.setShadowSoftness(value / 100);
  get("shadow-softness-value").textContent = `${value}%`;
};
get<HTMLInputElement>("wax-seal").onchange = () =>
  view.setSeal(get<HTMLInputElement>("wax-seal").checked);
get<HTMLInputElement>("mesh").onchange = (e) =>
  view.setWireframe((e.target as HTMLInputElement).checked);
get("home").onclick = () => {
  get<HTMLInputElement>("camera-follow").checked = false;
  view.home();
  get("view-label").textContent = "PERSPECTIVE VIEW";
};
get("top").onclick = () => {
  get<HTMLInputElement>("camera-follow").checked = false;
  view.home(true);
  get("view-label").textContent = "TOP VIEW";
};
get("fit").onclick = () => {
  get<HTMLInputElement>("camera-follow").checked = false;
  view.setCameraFollowing(false);
  view.fit();
};
get("reset").onclick = () => {
  sim.reset();
  playing = false;
  direction = 1;
  get("reverse").classList.remove("selected");
  updateControls();
};
const cameraViews = new Map<Pattern, PaperCameraView[]>();
const cameraFields = [
  ["azimuth", "Around paper", -180, 180, 1, "°"],
  ["elevation", "Above paper", -89, 89, 1, "°"],
  ["distance", "Camera distance", 0.2, 10, 0.01, "× sheet diagonal"],
  ["roll", "View rotation", -180, 180, 1, "°"],
] as const;
get("camera-fields").innerHTML = cameraFields
  .map(
    ([key, label, min, max, step]) =>
      `<div class="label-row"><label for="camera-${key}">${label}</label><output id="camera-${key}-value"></output></div><input id="camera-${key}" type="range" min="${min}" max="${max}" step="${step}"/>`,
  )
  .join("");
function selectedCamera() {
  return cameraViews.get(sim.pattern)![
    Number(get<HTMLSelectElement>("camera-step").value)
  ];
}
function syncCameraFields() {
  const pose = selectedCamera();
  for (const [key, , , , , unit] of cameraFields) {
    get<HTMLInputElement>(`camera-${key}`).value = String(pose[key]);
    get(`camera-${key}-value`).textContent =
      `${pose[key].toFixed(key === "distance" ? 2 : 0)}${unit}`;
  }
}
function applyCameraViews() {
  view.setCameraSequence(cameraViews.get(sim.pattern)!);
  view.setCameraFollowing(get<HTMLInputElement>("camera-follow").checked);
  get("view-label").textContent = get<HTMLInputElement>("camera-follow").checked
    ? "SAVED CAMERA VIEWS"
    : "FREE CAMERA";
}
function setupCameraEditor() {
  if (!cameraViews.has(sim.pattern))
    cameraViews.set(
      sim.pattern,
      Array.from({ length: patterns[sim.pattern].steps.length + 1 }, () => ({
        azimuth: 39,
        elevation: sim.pattern === "lenz-1776" ? -55 : 51,
        distance: 1.7,
        roll: sim.pattern === "lenz-1776" ? 180 : 0,
      })),
    );
  get("camera-step").innerHTML = [
    "Open sheet",
    ...patterns[sim.pattern].steps.map(
      (name, i) => `After fold ${i + 1} · ${name}`,
    ),
  ]
    .map((label, i) => `<option value="${i}">${label}</option>`)
    .join("");
  syncCameraFields();
  applyCameraViews();
}
get<HTMLSelectElement>("camera-step").onchange = () => {
  playing = false;
  sim.setProgress(
    Number(get<HTMLSelectElement>("camera-step").value) /
      patterns[sim.pattern].steps.length,
  );
  get<HTMLInputElement>("camera-follow").checked = true;
  syncCameraFields();
  applyCameraViews();
  updateControls();
};
for (const [key] of cameraFields)
  get<HTMLInputElement>(`camera-${key}`).oninput = (event) => {
    playing = false;
    selectedCamera()[key] = Number((event.target as HTMLInputElement).value);
    sim.setProgress(
      Number(get<HTMLSelectElement>("camera-step").value) /
        patterns[sim.pattern].steps.length,
    );
    get<HTMLInputElement>("camera-follow").checked = true;
    syncCameraFields();
    applyCameraViews();
    updateControls();
  };
get<HTMLInputElement>("camera-follow").onchange = applyCameraViews;
get("camera-capture").onclick = () => {
  Object.assign(selectedCamera(), view.captureCameraView());
  syncCameraFields();
  applyCameraViews();
  get("camera-status").textContent = "Current view saved for this fold.";
};
let exportPreviewUrl = "";
function downloadExport(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob),
    anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function previewExport(svg: string) {
  if (exportPreviewUrl) URL.revokeObjectURL(exportPreviewUrl);
  exportPreviewUrl = URL.createObjectURL(
    new Blob([svg], { type: "image/svg+xml" }),
  );
  const image = get<HTMLImageElement>("export-preview");
  image.src = exportPreviewUrl;
  image.hidden = false;
}
get("export-current").onclick = () => {
  playing = false;
  updateControls();
  try {
    const svg = view.exportSvg({
      title: `${patterns[sim.pattern].name} · ${Math.round(sim.progress * 100)}%`,
    });
    downloadExport(
      new Blob([svg], { type: "image/svg+xml" }),
      `${sim.pattern}-${Math.round(sim.progress * 100)}.svg`,
    );
    previewExport(svg);
    get("export-status").textContent =
      `Current view exported · ${Math.round(new Blob([svg]).size / 1024)} KB`;
  } catch (error) {
    get("export-status").textContent =
      error instanceof Error ? error.message : "Export failed.";
  }
};
get("export-series").onclick = async () => {
  playing = false;
  updateControls();
  const button = get<HTMLButtonElement>("export-series");
  button.disabled = true;
  const currentButton = get<HTMLButtonElement>("export-current");
  currentButton.disabled = true;
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;left:-10000px;top:0;width:${get("viewer").clientWidth}px;height:${get("viewer").clientHeight}px;pointer-events:none;`;
  document.body.append(host);
  let exporter: ThreePaperRenderer | undefined;
  try {
    const pattern = sim.pattern,
      count = patterns[pattern].steps.length;
    const subdivisions = Number(get<HTMLSelectElement>("export-steps").value),
      total = count * subdivisions;
    const paper = createPaper({
      pattern,
      width: sim.width,
      height: sim.height,
      thickness: sim.thickness,
      imperfection: sim.imperfection,
      seed: sim.seed,
    });
    const poses = get<HTMLInputElement>("camera-follow").checked
      ? cameraViews.get(pattern)!.map((p) => ({ ...p }))
      : [view.captureCameraView()];
    exporter = new ThreePaperRenderer(host, paper, {
      borders: get<HTMLInputElement>("borders").checked,
      borderWidth: Number(get<HTMLInputElement>("border-width").value),
    });
    exporter.setSeal(get<HTMLInputElement>("wax-seal").checked);
    exporter.setCreases(get<HTMLInputElement>("creases").checked);
    exporter.setCameraSequence(poses);
    const files: { name: string; content: string }[] = [];
    for (let step = 0; step <= total; step++) {
      get("export-status").textContent =
        `Exporting frame ${step + 1} of ${total + 1}…`;
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      const progress = step / total;
      paper.setProgress(progress);
      exporter.setCameraProgress(progress);
      const svg = exporter.exportSvg({
        title: `${patterns[pattern].name} · ${Math.round(progress * 100)}%`,
      });
      files.push({
        name: `${String(step).padStart(2, "0")}-${pattern}-${Math.round(progress * 100)}.svg`,
        content: svg,
      });
    }
    files.push({
      name: "sequence.json",
      content: JSON.stringify(
        {
          pattern,
          imperfection: paper.imperfection,
          seed: paper.seed,
          cameraViews: poses,
          frames: files.map((file, i) => ({
            file: file.name,
            progress: i / total,
          })),
        },
        null,
        2,
      ),
    });
    downloadExport(svgZip(files), `${pattern}-svg-series.zip`);
    previewExport(files[total].content);
    get("export-status").textContent =
      `${total + 1} SVGs exported in one ZIP. Your current fold is unchanged.`;
  } catch (error) {
    get("export-status").textContent =
      error instanceof Error ? error.message : "Export failed.";
  } finally {
    exporter?.dispose();
    host.remove();
    button.disabled = false;
    currentButton.disabled = false;
  }
};
let recording = false;
let videoPreviewUrl = "";
get("export-video").onclick = async () => {
  playing = false;
  updateControls();
  const progress = sim.progress;
  const cameraPosition = view.camera.position.clone();
  const cameraQuaternion = view.camera.quaternion.clone();
  const cameraTarget = view.controls.target.clone();
  const controlsEnabled = view.controls.enabled;
  const disabled = Array.from(
    root.querySelectorAll<
      HTMLInputElement | HTMLButtonElement | HTMLSelectElement
    >("input, button, select"),
  ).map((element) => ({ element, disabled: element.disabled }));
  disabled.forEach(({ element }) => {
    element.disabled = true;
  });
  const cancel = get<HTMLButtonElement>("cancel-video");
  const controller = new AbortController();
  cancel.hidden = false;
  cancel.disabled = false;
  cancel.onclick = () => controller.abort();
  recording = true;
  view.controls.enabled = false;
  try {
    const blob = await recordWebm({
      source: view.renderer.domElement,
      transparent:
        get<HTMLSelectElement>("video-background").value === "transparent",
      foldSeconds:
        Number(get<HTMLSelectElement>("video-speed").value) *
        patterns[sim.pattern].steps.length,
      loop: get<HTMLSelectElement>("video-motion").value === "loop",
      signal: controller.signal,
      render: (value) => {
        sim.setProgress(value);
        view.setCameraProgress(value);
        view.update();
      },
      onStatus: (message) => {
        get("video-status").textContent = message;
      },
    });
    downloadExport(blob, `${sim.pattern}-animation.webm`);
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl);
    videoPreviewUrl = URL.createObjectURL(blob);
    const preview = get<HTMLVideoElement>("video-preview");
    preview.src = videoPreviewUrl;
    preview.hidden = false;
    get("video-status").textContent =
      `WebM exported · ${(blob.size / 1024 / 1024).toFixed(2)} MB. Embed with a standard video element.`;
  } catch (error) {
    get("video-status").textContent =
      error instanceof Error ? error.message : "Video export failed.";
  } finally {
    recording = false;
    sim.setProgress(progress);
    view.setCameraProgress(progress);
    view.camera.position.copy(cameraPosition);
    view.camera.quaternion.copy(cameraQuaternion);
    view.controls.target.copy(cameraTarget);
    view.controls.enabled = controlsEnabled;
    view.update();
    disabled.forEach(({ element, disabled }) => {
      element.disabled = disabled;
    });
    cancel.hidden = true;
    updateControls();
    last = 0;
  }
};
if (!webmMimeType()) {
  get<HTMLButtonElement>("export-video").disabled = true;
  get("video-status").textContent =
    "Video export needs a browser with WebAssembly and workers.";
}
setupCameraEditor();
updateControls();
function animate(now: number) {
  if (recording) {
    requestAnimationFrame(animate);
    return;
  }
  accumulator += Math.min((now - (last || now)) / 1000, 0.05);
  last = now;
  while (accumulator >= 1 / 60) {
    if (playing) {
      sim.setProgress(
        sim.progress + direction / (240 * patterns[sim.pattern].steps.length),
      );
      if (sim.progress === 0 || sim.progress === 1) playing = false;
      updateControls();
    }
    accumulator -= 1 / 60;
  }
  view.setCameraProgress(sim.progress);
  view.update();
  requestAnimationFrame(animate);
}
requestAnimationFrame(animate);
