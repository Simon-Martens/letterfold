import test from "node:test";
import assert from "node:assert/strict";
import {
  animationProgress,
  animationFrameTimes,
  webmMimeType,
} from "../src/webm-export";

test("video holds open and closed poses, then reverses for seamless loop", () => {
  assert.equal(animationProgress(0, 4, true), 0);
  assert.equal(animationProgress(0.75, 4, true), 0);
  assert.equal(animationProgress(2.75, 4, true), 0.5);
  assert.equal(animationProgress(4.75, 4, true), 1);
  assert.equal(animationProgress(5.5, 4, true), 1);
  assert.equal(animationProgress(7.75, 4, true), 0.5);
  assert.equal(animationProgress(9.75, 4, true), 0);
  assert.equal(animationProgress(7.75, 4, false), 1);
});
test("capability check is safe outside a browser", () => {
  assert.equal(webmMimeType(), undefined);
});

test("offline samples have uniform timing regardless of render cost", async () => {
  const times = animationFrameTimes(2, false);
  assert.equal(times.length, 113);
  const values = [];
  for (const i of [0, 23, 45, 82, 112]) {
    await new Promise((resolve) => setTimeout(resolve, i % 3));
    values.push(animationProgress(times[i], 2, false));
  }
  assert.deepEqual(values, [
    0,
    (23 / 30 - 0.75) / 2,
    0.375,
    (82 / 30 - 0.75) / 2,
    1,
  ]);
  for (let i = 1; i < times.length; i++)
    assert.ok(Math.abs(times[i] - times[i - 1] - 1 / 30) < 1e-12);
  const loop = animationFrameTimes(1, true);
  assert.ok(animationProgress(loop.at(-1)!, 1, true) < 1 / 30);
  for (const duration of [NaN, Infinity, 0, -1, 121])
    assert.throws(() => animationFrameTimes(duration, false));
});
