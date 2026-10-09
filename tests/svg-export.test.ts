import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { exportSchematicSvg } from "../src/svg-export";
import { svgZip } from "../src/zip";
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);
camera.updateMatrixWorld();
const surface = (z: number, reverse = false) => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.8, -0.8, z, 0.8, -0.8, z, 0, 0.8, z],
      3,
    ),
  );
  geometry.setIndex(reverse ? [2, 1, 0] : [0, 1, 2]);
  return { geometry, side: reverse ? ("back" as const) : ("front" as const) };
};
test("SVG removes covered surfaces and strokes independent of draw order", () => {
  const near = surface(0.5),
    far = surface(0, true),
    opts = { width: 128, height: 128 };
  const expected = exportSchematicSvg([near], [], camera, opts);
  assert.equal(exportSchematicSvg([far, near], [], camera, opts), expected);
  assert.equal(exportSchematicSvg([near, far], [], camera, opts), expected);
  assert.equal(
    exportSchematicSvg(
      [near],
      [{ positions: [-0.2, 0, 0, 0.2, 0, 0], width: 2 }],
      camera,
      opts,
    ),
    expected,
  );
  assert.notEqual(
    exportSchematicSvg(
      [near],
      [{ positions: [-0.2, 0, 0.6, 0.2, 0, 0.6], width: 2 }],
      camera,
      opts,
    ),
    expected,
  );
});
test("SVG contains vector paths and escaped titles, without runtime or image data", () => {
  const svg = exportSchematicSvg([surface(0)], [], camera, {
    width: 128,
    height: 128,
    title: "<script>&",
  });
  assert.match(svg, /<path /);
  assert.match(svg, /&lt;script&gt;&amp;/);
  assert.doesNotMatch(svg, /<image|<script|data:|NaN|Infinity/);
  assert.ok(svg.length < 5000);
  assert.throws(() => exportSchematicSvg([], [], camera, { width: 0 }));
});
test("SVG clips fully hidden geometry behind the camera", () => {
  const svg = exportSchematicSvg([surface(4)], [], camera, {
    width: 64,
    height: 64,
  });
  assert.doesNotMatch(svg, /<path /);
});
test("ZIP stores named SVGs and includes a central directory", async () => {
  const bytes = new Uint8Array(
    await svgZip([{ name: "01.svg", content: "<svg/>" }]).arrayBuffer(),
  );
  const data = new DataView(bytes.buffer);
  assert.equal(data.getUint32(0, true), 0x04034b50);
  assert.equal(data.getUint32(bytes.length - 22, true), 0x06054b50);
  assert.equal(data.getUint16(bytes.length - 12, true), 1);
  assert.match(new TextDecoder().decode(bytes), /01.svg/);
});

test("diagonal strokes retain subpixel vector endpoints instead of pixel outlines", () => {
  const svg = exportSchematicSvg(
    [],
    [{ positions: [-0.7, -0.3, 0, 0.65, 0.45, 0], width: 2 }],
    camera,
    { width: 128, height: 128 },
  );
  assert.match(svg, /fill="none" stroke=/);
  assert.match(svg, /stroke-linecap="round"/);
  assert.match(svg, /M19\.200 83\.200L105\.600 35\.200/);
});
test("a partly covered stroke is clipped into exactly two straight visible spans", () => {
  const svg = exportSchematicSvg(
    [surface(0.5)],
    [{ positions: [-0.9, 0, 0, 0.9, 0, 0], width: 2 }],
    camera,
    { width: 128, height: 128 },
  );
  const stroke = svg.match(/fill="none"[^>]* d="([^"]+)"/)![1];
  assert.equal((stroke.match(/M/g) ?? []).length, 2);
  assert.match(stroke, /M6\.400 64\.000L38\.400 64\.000/);
  assert.match(stroke, /M89\.600 64\.000L121\.600 64\.000/);
});
