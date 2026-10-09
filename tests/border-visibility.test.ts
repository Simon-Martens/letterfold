import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { visibleBorderSegments } from "../src/border-visibility";
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);
function sheet() {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [-0.5, -0.5, 0.1, 0.5, -0.5, 0.3, 0.5, 0.5, 0.3, -0.5, 0.5, 0.1],
      3,
    ),
  );
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}
test("covered stroke centerline is removed behind an inclined sheet", () => {
  assert.deepEqual(
    visibleBorderSegments([-0.4, 0, 0, 0.4, 0, 0], [sheet()], camera),
    [],
  );
  assert.equal(
    visibleBorderSegments([-0.4, 0, 0.4, 0.4, 0, 0.4], [sheet()], camera)
      .length,
    6,
  );
});
test("partial occlusion keeps only two exposed border spans", () => {
  const result = visibleBorderSegments(
    [-0.8, 0, 0, 0.8, 0, 0],
    [sheet()],
    camera,
  );
  assert.equal(result.length, 12);
  for (const [i, v] of [
    [0, -0.8],
    [3, -0.5],
    [6, 0.5],
    [9, 0.8],
  ])
    assert.ok(Math.abs(result[i] - v) < 1e-6);
});
test("perspective clipping preserves original world-space endpoints", () => {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 10);
  camera.position.set(0.2, 0.3, 3);
  camera.lookAt(0, 0, 0);
  const line = [-0.2, -0.2, 0.1, 0.3, 0.4, 0.5];
  const result = visibleBorderSegments(line, [], camera);
  assert.equal(result.length, 6);
  result.forEach((v, i) => assert.ok(Math.abs(v - line[i]) < 1e-10));
  assert.deepEqual(visibleBorderSegments([0, 0, 5, 0, 0.2, 5], [], camera), []);
});
