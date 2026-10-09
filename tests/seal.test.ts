import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPaper } from "../src/paper";
import { sealGeometry, attachSeal, brokenSealGeometry } from "../src/seal";
import { exportSchematicSvg } from "../src/svg-export";
test("short lower flap closes outside the long upper flap", () => {
  const p = createPaper({ pattern: "lenz-1776" });
  const low = Array.from({ length: p.count }, (_, i) => i).filter(
    (i) =>
      Math.abs(p.rest[i * 3]) < p.width * 0.04 &&
      p.rest[i * 3 + 1] < -p.height * 0.44,
  );
  p.setProgress(0.75);
  assert.ok(low.every((i) => Math.abs(p.positions[i * 3 + 2]) < 1e-12));
  p.setProgress(1);
  assert.ok(low.every((i) => p.positions[i * 3 + 2] < -p.layerSpacing * 10));
});
test("seal attaches to the closing flap, stays finite with crooked folds and exports as wax color", () => {
  for (const imperfection of [0, 2]) {
    const p = createPaper({ pattern: "lenz-1776", imperfection, seed: 42 });
    p.setProgress(1);
    const geometry = sealGeometry(p, {}),
      coords = geometry.getAttribute("position");
    assert.ok(Array.from(coords.array).every(Number.isFinite));
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    assert.ok(box.max.z < 0);
    assert.ok(box.max.y - box.min.y > p.height * 0.06);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 3);
    camera.position.set(0, 0, -0.5);
    camera.lookAt(0, 0, 0);
    const svg = exportSchematicSvg(
      [{ geometry, side: "both", color: "#992c26" }],
      [],
      camera,
      { width: 128, height: 128 },
    );
    assert.match(svg, /#992c26/);
    geometry.dispose();
    assert.throws(() => sealGeometry(p, { u: 2 }));
  }
});

test("broken wax follows two different material flaps after reopening", () => {
  for (const imperfection of [0, 2]) {
    const p = createPaper({ pattern: "lenz-1776", imperfection, seed: 42 });
    p.setProgress(1);
    const attachment = attachSeal(p, {});
    assert.ok(attachment.vertices.length > 300);
    p.setProgress(0);
    const geometry = brokenSealGeometry(p, attachment);
    const positions = geometry.getAttribute("position");
    const ys = Array.from({ length: positions.count }, (_, i) =>
      positions.getY(i),
    );
    assert.ok(
      ys.some((y) => y < -p.height * 0.4),
      "wax remains on short lower flap",
    );
    assert.ok(
      ys.some((y) => y > p.height * 0.1),
      "wax remains on long upper flap",
    );
    assert.ok(Array.from(positions.array).every(Number.isFinite));
    for (let i = 0; i < positions.count; i += 3) {
      const y = ys.slice(i, i + 3);
      assert.ok(
        Math.max(...y) - Math.min(...y) < p.height * 0.1,
        "no wax triangle bridges the two separated flaps",
      );
    }
    const before = Array.from(positions.array);
    p.setProgress(0.9);
    p.setProgress(0);
    const repeated = brokenSealGeometry(p, attachment);
    assert.deepEqual(
      Array.from(repeated.getAttribute("position").array),
      before,
    );
    geometry.dispose();
    repeated.dispose();
  }
});
