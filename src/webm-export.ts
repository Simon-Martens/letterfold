/** Capability check for the offline WebM exporter. Safe during SSR. */
export function webmMimeType(): string | undefined {
  return typeof document !== "undefined" &&
    typeof Worker !== "undefined" &&
    typeof WebAssembly !== "undefined"
    ? "video/webm"
    : undefined;
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

/** Exact sample times: independent of how long rendering each frame takes. */
export function animationFrameTimes(
  foldSeconds: number,
  loop: boolean,
  fps = 30,
): number[] {
  if (
    !Number.isFinite(foldSeconds) ||
    foldSeconds <= 0 ||
    foldSeconds > 120 ||
    ![30, 60].includes(fps)
  )
    throw new Error("Choose a duration up to 120 seconds and 30 or 60 fps.");
  const duration = 0.75 + foldSeconds * (loop ? 2 : 1) + 1;
  return Array.from({ length: Math.ceil(duration * fps) }, (_, i) => i / fps);
}

export interface WebmExportOptions {
  source: HTMLCanvasElement;
  render: (progress: number) => void;
  foldSeconds: number;
  loop: boolean;
  /** Preserve the canvas alpha channel. Defaults to true. */
  transparent?: boolean;
  /** URL containing the single-thread @ffmpeg/core ESM .js and .wasm files. */
  encoderBaseURL?: string;
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
  onStatus?: (message: string) => void;
}

export async function recordWebm(options: WebmExportOptions): Promise<Blob> {
  if (!webmMimeType())
    throw new Error(
      "Video export needs a browser with WebAssembly and workers.",
    );
  const times = animationFrameTimes(options.foldSeconds, options.loop);
  options.signal?.throwIfAborted();
  options.onStatus?.("Loading video encoder (about 32 MB on first export)…");
  const { encodeWebm } = await import("./webm-encoder");
  return encodeWebm(options, times);
}
