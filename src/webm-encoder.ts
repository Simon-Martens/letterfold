import { FFmpeg } from "@ffmpeg/ffmpeg";
import classWorkerURL from "@ffmpeg/ffmpeg/worker?worker&url";
import { animationProgress, type WebmExportOptions } from "./webm-export";

export async function encodeWebm(
  options: WebmExportOptions,
  times: number[],
): Promise<Blob> {
  const encoder = new FFmpeg();
  const abort = () => encoder.terminate();
  const logs: string[] = [];
  encoder.on("log", ({ message }) => {
    logs.push(message);
    if (logs.length > 8) logs.shift();
  });
  const check = () => {
    if (options.signal?.aborted) throw new Error("Export cancelled.");
  };
  check();
  options.signal?.addEventListener("abort", abort, { once: true });
  const canvas = document.createElement("canvas");
  const scale = Math.min(
    1,
    1280 / Math.max(options.source.width, options.source.height),
  );
  canvas.width = Math.max(
    2,
    Math.round((options.source.width * scale) / 2) * 2,
  );
  canvas.height = Math.max(
    2,
    Math.round((options.source.height * scale) / 2) * 2,
  );
  const context = canvas.getContext("2d")!;
  try {
    const base = new URL(
      options.encoderBaseURL ?? "encoder/",
      document.baseURI,
    );
    await encoder.load({
      classWorkerURL,
      coreURL: new URL("ffmpeg-core.js", base).href,
      wasmURL: new URL("ffmpeg-core.wasm", base).href,
    });
    let storedBytes = 0;
    for (let i = 0; i < times.length; i++) {
      check();
      options.render(
        animationProgress(times[i], options.foldSeconds, options.loop),
      );
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (options.transparent === false) {
        context.fillStyle = "#f1efe7";
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Copy immediately after WebGL render, before its drawing buffer is cleared.
      context.drawImage(options.source, 0, 0, canvas.width, canvas.height);
      const png = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(blob)
              : reject(new Error("Could not capture a frame.")),
          "image/png",
        ),
      );
      check();
      storedBytes += png.size;
      if (storedBytes > 256 * 1024 * 1024)
        throw new Error(
          "This animation exceeds the export memory limit. Choose fewer seconds per fold.",
        );
      await encoder.writeFile(
        `frame${String(i).padStart(5, "0")}.png`,
        new Uint8Array(await png.arrayBuffer()),
      );
      options.onStatus?.(`Rendering frame ${i + 1} of ${times.length}…`);
      options.onProgress?.(((i + 1) / times.length) * 0.5);
      // Yield for the progress indicator and cancellation; elapsed time never changes the sample.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    check();
    options.onStatus?.("Encoding WebM…");
    encoder.on("progress", ({ time }) => {
      const fraction = Math.max(
        0,
        Math.min(1, time / 1_000_000 / (times.length / 30)),
      );
      options.onStatus?.(`Encoding WebM · ${Math.round(fraction * 100)}%`);
      options.onProgress?.(0.5 + fraction * 0.5);
    });
    const exit = await encoder.exec([
      "-framerate",
      "30",
      "-i",
      "frame%05d.png",
      "-an",
      // VP8 supports alpha and avoids the current wasm VP9 encoder crash.
      "-c:v",
      "libvpx",
      "-pix_fmt",
      options.transparent === false ? "yuv420p" : "yuva420p",
      "-b:v",
      "4M",
      "-crf",
      "10",
      "-deadline",
      "realtime",
      "-cpu-used",
      "8",
      "-auto-alt-ref",
      "0",
      "-threads",
      "1",
      "animation.webm",
    ]);
    check();
    if (exit !== 0)
      throw new Error("WebM encoding failed. Try a shorter animation.");
    const data = await encoder.readFile("animation.webm");
    if (typeof data === "string" || !data.length)
      throw new Error("The encoder produced an empty video.");
    return new Blob([new Uint8Array(data)], { type: "video/webm" });
  } catch (error) {
    check();
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n${logs.join("\n")}`,
    );
  } finally {
    options.signal?.removeEventListener("abort", abort);
    encoder.terminate();
    canvas.width = canvas.height = 0;
  }
}
