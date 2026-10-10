import { test } from "node:test";
import assert from "node:assert/strict";
import {
  Box3,
  BufferGeometry,
  Float32BufferAttribute,
  PerspectiveCamera,
  Vector3,
} from "three";
import { createPaper } from "../src/paper";
import { centerPaperInView } from "../src/camera-framing";

test("rotating and folding keeps projected paper centered without changing angles or scale", () => {
  const paper = createPaper({
    pattern: "lenz-1776",
    imperfection: 2,
    seed: 42,
  });
  const camera = new PerspectiveCamera(36, 600 / 440, 0.01, 3);
  const geometry = new BufferGeometry();
  let worstBefore = 0;
  for (const progress of [0, 0.375, 0.625, 0.875, 1, 0.625]) {
    paper.setProgress(progress);
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(paper.positions, 3),
    );
    geometry.computeBoundingBox();
    const target = geometry.boundingBox!.getCenter(new Vector3());
    for (const elevation of [-55, -5, 55, 89]) {
      for (let azimuth = 0; azimuth < 360; azimuth += 30) {
        const az = (azimuth * Math.PI) / 180,
          el = (elevation * Math.PI) / 180;
        camera.position
          .set(
            Math.sin(az) * Math.cos(el),
            -Math.cos(az) * Math.cos(el),
            Math.sin(el),
          )
          .multiplyScalar(0.65)
          .add(target);
        camera.up.set(
          -Math.sin(az) * Math.sin(el),
          Math.cos(az) * Math.sin(el),
          Math.cos(el),
        );
        camera.lookAt(target);
        camera.rotateZ(az / 2);
        camera.updateMatrixWorld();
        const bounds = () => {
          const box = new Box3();
          const point = new Vector3();
          const positions = geometry.getAttribute("position");
          for (let i = 0; i < positions.count; i++)
            box.expandByPoint(
              point.fromBufferAttribute(positions, i).project(camera),
            );
          return box;
        };
        const before = bounds();
        worstBefore = Math.max(
          worstBefore,
          before.getCenter(new Vector3()).setZ(0).length(),
        );
        const orientation = camera.quaternion.clone();
        centerPaperInView(camera, [geometry]);
        const after = bounds();
        assert.ok(Math.abs(after.min.x + after.max.x) < 1e-9);
        assert.ok(Math.abs(after.min.y + after.max.y) < 1e-9);
        assert.ok(camera.quaternion.equals(orientation));
        assert.ok(Math.abs(after.min.z - before.min.z) < 1e-12);
        assert.ok(Math.abs(after.max.z - before.max.z) < 1e-12);
        assert.ok(centerPaperInView(camera, [geometry]).length() < 1e-10);
      }
    }
  }
  assert.ok(worstBefore > 0.05, "exercise views with visible pre-fix drift");
  geometry.dispose();
});
