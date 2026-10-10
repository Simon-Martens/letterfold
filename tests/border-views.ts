import { createPaper } from "../src/paper";
import { ThreePaperRenderer } from "../src/renderer";

const views = [
  [39, -55],
  [129, -35],
  [219, -55],
  [309, -35],
  [39, 55],
  [0, 89],
  [39, -5],
  [219, 5],
];
const button = document.querySelector<HTMLButtonElement>("#run")!;
button.onclick = async () => {
  button.disabled = true;
  const value = (id: string) =>
    Number(document.querySelector<HTMLSelectElement>(id)!.value);
  const paper = createPaper({
    pattern: "lenz-1776",
    imperfection: value("#crooked"),
    seed: 42,
  });
  const renderer = new ThreePaperRenderer(
    document.querySelector<HTMLDivElement>("#stage")!,
    paper,
    { borders: true, borderWidth: value("#width") },
  );
  renderer.setArtwork(false);
  const details = document.querySelector<HTMLInputElement>("#details")!.checked;
  renderer.setCreases(details);
  renderer.setSeal(details);
  const grid = document.querySelector("#grid")!;
  const status = document.querySelector("#status")!;
  grid.replaceChildren();
  try {
    paper.setProgress(value("#pose"));
    for (const [azimuth, elevation] of views) {
      renderer.setCameraSequence([
        {
          azimuth,
          elevation,
          distance: paper.progress === 0 ? 1.8 : 1.35,
          roll: 0,
        },
      ]);
      renderer.update();
      const figure = document.createElement("figure");
      const canvas = document.createElement("canvas");
      canvas.width = renderer.renderer.domElement.width;
      canvas.height = renderer.renderer.domElement.height;
      canvas.getContext("2d")!.drawImage(renderer.renderer.domElement, 0, 0);
      const caption = document.createElement("figcaption");
      caption.textContent = `Around ${azimuth}° / elevation ${elevation}° · ${paper.progress * 100}% folded · crooked ${paper.imperfection}° · border ${value("#width")}px`;
      figure.append(canvas, caption);
      grid.append(figure);
      status.textContent = `${grid.children.length} / ${views.length} views rendered`;
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    status.textContent = `Complete · ${views.length} views`;
  } catch (error) {
    status.textContent = String(error);
  } finally {
    renderer.dispose();
    button.disabled = false;
  }
};
