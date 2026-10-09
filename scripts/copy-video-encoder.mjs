import { mkdir, copyFile, writeFile } from "node:fs/promises";
const target = new URL("../public/encoder/", import.meta.url);
await mkdir(target, { recursive: true });
for (const file of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  await copyFile(
    new URL(`../node_modules/@ffmpeg/core/dist/esm/${file}`, import.meta.url),
    new URL(file, target),
  );
}
await writeFile(
  new URL("NOTICE.txt", target),
  "@ffmpeg/core 0.12.10 — GPL-2.0-or-later\nSource and build instructions: https://github.com/ffmpegwasm/ffmpeg.wasm/tree/main/packages/core\n",
);
