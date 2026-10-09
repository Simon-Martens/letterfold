import { test } from "node:test";
import assert from "node:assert/strict";
import { PaperSimulation, type Pattern } from "../src/physics";

test("flat mesh stays flat and preserves its metric", () => {
  const paper = new PaperSimulation();
  for (let i = 0; i < 30; i++) paper.step();
  assert.ok(paper.maxStrain < 1e-8);
  assert.ok(
    paper.positions.every((x, i) => Math.abs(x - paper.rest[i]) < 1e-9),
  );
  assert.equal(paper.indices.length, 12 * 18 * 6);
});
for (const pattern of ["half", "letter", "accordion"] as Pattern[])
  test(`${pattern}: finite, constrained 3D folding and reversible unfolding`, () => {
    const paper = new PaperSimulation(pattern);
    for (let i = 1; i <= 180; i++) {
      paper.setProgress(i / 180);
      paper.step();
    }
    for (let i = 0; i < 60; i++) paper.step();
    assert.ok(paper.positions.every(Number.isFinite));
    assert.ok(
      paper.positions.some((v, i) => i % 3 === 2 && Math.abs(v) > 0.01),
    );
    assert.ok(paper.maxStrain < 0.035, `strain ${paper.maxStrain}`);
    let rms = 0;
    for (let i = 0; i < paper.positions.length; i++)
      rms += (paper.positions[i] - paper.target[i]) ** 2;
    assert.ok(
      Math.sqrt(rms / paper.positions.length) < 0.008,
      `target RMS ${Math.sqrt(rms / paper.positions.length)}`,
    );
    for (let i = 1; i <= 180; i++) {
      paper.setProgress(1 - i / 180);
      paper.step();
    }
    for (let i = 0; i < 60; i++) paper.step();
    assert.ok(
      paper.positions.every((v, i) => Math.abs(v - paper.rest[i]) < 0.002),
    );
  });
test("reset, clamping and invalid inputs", () => {
  const paper = new PaperSimulation();
  paper.setProgress(4);
  assert.equal(paper.progress, 1);
  paper.setProgress(-2);
  assert.equal(paper.progress, 0);
  assert.throws(() => paper.setProgress(NaN));
  assert.throws(() => paper.step(0));
  assert.throws(() => paper.step(Infinity));
  paper.reset("half");
  assert.deepEqual(paper.positions, paper.rest);
});
test("offline seek is deterministic", () => {
  const paper = new PaperSimulation("half");
  paper.seek(0.4);
  const result = paper.positions.slice();
  paper.seek(0.4);
  assert.deepEqual(paper.positions, result);
});
