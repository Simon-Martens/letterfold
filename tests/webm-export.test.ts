import test from "node:test";
import assert from "node:assert/strict";
import { animationProgress, webmMimeType } from "../src/webm-export";

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
