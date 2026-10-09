import { test } from "node:test";
import assert from "node:assert/strict";
import { sampleCameraSequence, validateCameraView } from "../src/camera";
const a = { azimuth: 170, elevation: 30, distance: 2, roll: 170 };
const b = { azimuth: -170, elevation: 70, distance: 1, roll: -170 };
test("camera endpoints and reverse seeking are deterministic", () => {
  assert.deepEqual(sampleCameraSequence([a, b, a], 0), a);
  assert.deepEqual(sampleCameraSequence([a, b, a], 0.5), b);
  assert.deepEqual(sampleCameraSequence([a, b, a], 1), a);
  const expected = sampleCameraSequence([a, b, a], 0.3);
  for (const p of [1, 0.7, 0, 0.3]) sampleCameraSequence([a, b, a], p);
  assert.deepEqual(sampleCameraSequence([a, b, a], 0.3), expected);
});
test("camera takes the short angular path and eases at fold boundaries", () => {
  const mid = sampleCameraSequence([a, b], 0.5);
  assert.equal(mid.azimuth, 180);
  assert.equal(mid.roll, 180);
  assert.equal(mid.distance, 1.5);
  assert.equal(mid.elevation, 50);
  assert.ok(
    Math.abs(sampleCameraSequence([a, b], 0.001).azimuth - a.azimuth) < 0.0001,
  );
});
test("camera validates settings and supports a single stationary view", () => {
  assert.deepEqual(sampleCameraSequence([a], 0.7), a);
  for (const patch of [
    { elevation: 90 },
    { distance: 0 },
    { azimuth: NaN },
    { roll: Infinity },
  ])
    assert.throws(() => validateCameraView({ ...a, ...patch }));
  assert.throws(() => sampleCameraSequence([], 0));
  assert.throws(() => sampleCameraSequence([a], NaN));
});
