/** Rasterize SVG locally into paper artwork. The SVG is never inserted into the page. */
export async function rasterizeSvg(
  svg: string,
  aspect: number,
): Promise<HTMLCanvasElement> {
  if (new Blob([svg]).size > 2 * 1024 * 1024)
    throw new Error("Choose an SVG smaller than 2 MB.");
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (
    document.querySelector("parsererror") ||
    document.documentElement.localName !== "svg"
  )
    throw new Error("This file is not a valid SVG.");
  const root = document.documentElement;
  root.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // Fold metadata is not artwork. Image-mode SVG does not execute scripts;
  // strip active/embedded HTML content as well before passing it to the decoder.
  root
    .querySelectorAll("#folds, script, foreignObject")
    .forEach((element) => element.remove());
  for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
    for (const attribute of Array.from(element.attributes)) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
      if (
        attribute.localName === "href" &&
        !attribute.value.startsWith("#") &&
        !/^data:image\/(png|jpeg|webp);base64,/i.test(attribute.value)
      )
        throw new Error(
          "Use a self-contained SVG: embed images and outline externally loaded fonts.",
        );
    }
  }
  const canvas = window.document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(Math.min(2048, 4096 * aspect)));
  canvas.height = Math.max(1, Math.round(canvas.width / aspect));
  const context = canvas.getContext("2d")!;
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(root)], {
      type: "image/svg+xml",
    }),
  );
  try {
    const image = new Image();
    image.src = url;
    try {
      await image.decode();
    } catch {
      throw new Error(
        "The browser could not render this SVG. Export it with explicit dimensions or a viewBox.",
      );
    }
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error("The SVG needs nonzero dimensions.");
    const scale = Math.min(
      canvas.width / image.naturalWidth,
      canvas.height / image.naturalHeight,
    );
    const width = image.naturalWidth * scale,
      height = image.naturalHeight * scale;
    context.fillStyle = "#fff9e9";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(
      image,
      (canvas.width - width) / 2,
      (canvas.height - height) / 2,
      width,
      height,
    );
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}
