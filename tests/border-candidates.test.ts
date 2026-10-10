import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { createPaper } from "../src/paper";
import {
  physicalBorderSegments,
  type OutlineEdge,
} from "../src/border-candidates";
import { visibleBorderSegments } from "../src/border-visibility";

test("historical wrapper outlines reach every exposed silhouette extremum from front, back and grazing views", () => {
  for (const imperfection of [0, 2]) {
    const paper = createPaper({ pattern: "lenz-1776", imperfection, seed: 42 });
    paper.setProgress(1);
    const edges = new Map<string, OutlineEdge>();
    for (let f = 0; f < paper.indices.length / 3; f++)
      for (let k = 0; k < 3; k++) {
        const a = paper.indices[f * 3 + k],
          b = paper.indices[f * 3 + ((k + 1) % 3)],
          key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (edges.has(key)) edges.get(key)!.faces.push(f);
        else edges.set(key, { a, b, faces: [f] });
      }
    const surfaces = [1, -1].map((side) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute(
        "position",
        new THREE.Float32BufferAttribute(
          Array.from(
            paper.positions,
            (p, i) => p + (side * paper.normals[i] * paper.thickness) / 2,
          ),
          3,
        ),
      );
      geometry.setIndex(paper.indices);
      return geometry;
    });
    for (const elevation of [-89, -55, -5, 5, 55, 89])
      for (const azimuth of [39, 129, 219, 309]) {
        const camera = new THREE.PerspectiveCamera(36, 1, 0.01, 3);
        const az = (azimuth * Math.PI) / 180,
          el = (elevation * Math.PI) / 180;
        const box = new THREE.Box3().setFromBufferAttribute(
          surfaces[0].getAttribute("position") as THREE.BufferAttribute,
        );
        const target = box.getCenter(new THREE.Vector3());
        camera.position
          .set(
            Math.sin(az) * Math.cos(el),
            -Math.cos(az) * Math.cos(el),
            Math.sin(el),
          )
          .multiplyScalar(0.55)
          .add(target);
        camera.up.set(0, 0, 1);
        camera.lookAt(target);
        camera.updateMatrixWorld();
        const lines = visibleBorderSegments(
          physicalBorderSegments(surfaces, [...edges.values()], camera),
          surfaces,
          camera,
        );
        assert.ok(lines.length > 0);
        const outline = new THREE.Box2();
        for (let i = 0; i < lines.length; i += 3) {
          const p = new THREE.Vector3().fromArray(lines, i).project(camera);
          outline.expandByPoint(new THREE.Vector2(p.x, p.y));
        }
        const silhouette = new THREE.Box2();
        for (const surface of surfaces) {
          const p = surface.getAttribute("position");
          for (let i = 0; i < p.count; i++) {
            const q = new THREE.Vector3()
              .fromBufferAttribute(p, i)
              .project(camera);
            silhouette.expandByPoint(new THREE.Vector2(q.x, q.y));
          }
        }
        for (const key of ["min", "max"] as const)
          assert.ok(
            outline[key].distanceTo(silhouette[key]) < 1e-5,
            `${imperfection} degrees / azimuth ${azimuth} / elevation ${elevation}: missing outer border`,
          );
      }
    surfaces.forEach((g) => g.dispose());
  }
});

test("degenerate flat triangles do not turn internal mesh edges into ink dots", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], 3),
  );
  geometry.setIndex([0, 1, 2, 0, 3, 2]);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, -3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const lines = physicalBorderSegments(
    [geometry],
    [
      { a: 0, b: 2, faces: [0, 1] },
      { a: 0, b: 3, faces: [1] },
    ],
    camera,
  );
  assert.deepEqual(lines, []);
  geometry.dispose();
});
