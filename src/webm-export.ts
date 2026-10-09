/** Record rendered frames with the browser's encoder; no encoder dependency. */
export function webmMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find(
    (type) => MediaRecorder.isTypeSupported(type),
  );
}

export function animationProgress(
  seconds: number,
  foldSeconds: number,
  loop: boolean,
): number {
  if (seconds < 0.75) return 0;
  const time = seconds - 0.75;
  if (time <= foldSeconds) return time / foldSeconds;
  if (!loop || time <= foldSeconds + 1) return 1;
  return Math.max(0, 1 - (time - foldSeconds - 1) / foldSeconds);
}

export async function recordWebm(options: {
  source: HTMLCanvasElement;
  render: (progress: number) => void;
  foldSeconds: number;
  loop: boolean;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}): Promise<Blob> {
  const mimeType = webmMimeType();
  if (!mimeType || !HTMLCanvasElement.prototype.captureStream)
    throw new Error(
      "WebM recording is unavailable in this browser. Try Chrome or Firefox.",
    );
  if (!Number.isFinite(options.foldSeconds) || options.foldSeconds <= 0)
    throw new Error("Animation duration must be positive.");
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
  const draw = (time: number) => {
    options.render(animationProgress(time, options.foldSeconds, options.loop));
    context.fillStyle = "#f1efe7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(options.source, 0, 0, canvas.width, canvas.height);
  };
  draw(0);
  const stream = canvas.captureStream(30);
  try {
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 4_000_000,
    });
    return await new Promise<Blob>((resolve, reject) => {
      const chunks: Blob[] = [];
      let frame = 0;
      let failure: Error | undefined;
      const duration = 0.75 + options.foldSeconds * (options.loop ? 2 : 1) + 1;
      const stop = (error?: Error) => {
        failure ??= error;
        cancelAnimationFrame(frame);
        if (recorder.state !== "inactive") recorder.stop();
      };
      const abort = () => stop(new Error("Export cancelled."));
      const visibility = () => {
        if (document.hidden)
          stop(
            new Error(
              "Export stopped because the tab was hidden. Keep it visible while recording.",
            ),
          );
      };
      const cleanup = () => {
        cancelAnimationFrame(frame);
        options.signal?.removeEventListener("abort", abort);
        document.removeEventListener("visibilitychange", visibility);
      };
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => {
        const error = new Error("The browser could not encode this animation.");
        stop(error);
        cleanup();
        reject(error);
      };
      recorder.onstop = () => {
        cleanup();
        if (failure) reject(failure);
        else if (!chunks.length)
          reject(new Error("The browser produced an empty video."));
        else resolve(new Blob(chunks, { type: mimeType }));
      };
      try {
        recorder.start();
      } catch (error) {
        cleanup();
        reject(error);
        return;
      }
      options.signal?.addEventListener("abort", abort, { once: true });
      document.addEventListener("visibilitychange", visibility);
      if (options.signal?.aborted || document.hidden) {
        abort();
        return;
      }
      const start = performance.now();
      const tick = (now: number) => {
        try {
          const time = Math.min(duration, (now - start) / 1000);
          draw(time);
          options.onProgress?.(time / duration);
          if (time >= duration) stop();
          else frame = requestAnimationFrame(tick);
        } catch (error) {
          stop(error instanceof Error ? error : new Error("Rendering failed."));
        }
      };
      frame = requestAnimationFrame(tick);
    });
  } finally {
    stream.getTracks().forEach((track) => track.stop());
  }
}
