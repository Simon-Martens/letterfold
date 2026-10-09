import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaper, type Pattern } from "../src/paper";

type Point = [number, number];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
function pointDistance(p: Point, a: Point, b: Point) {
  const d = sub(b, a),
    v = sub(p, a),
    t = Math.max(
      0,
      Math.min(1, (v[0] * d[0] + v[1] * d[1]) / (d[0] ** 2 + d[1] ** 2)),
    );
  return Math.hypot(v[0] - t * d[0], v[1] - t * d[1]);
}
function segmentDistance(a: Point, b: Point, c: Point, d: Point) {
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(c, a),
    den = cross(u, v);
  if (Math.abs(den) > 1e-10 * Math.hypot(...u) * Math.hypot(...v)) {
    const t = cross(w, v) / den,
      s = cross(w, u) / den;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return 0;
  }
  return Math.min(
    pointDistance(a, c, d),
    pointDistance(b, c, d),
    pointDistance(c, a, b),
    pointDistance(d, a, b),
  );
}

// The mesh is extruded along x; exact segment distances in its yz section
// therefore detect crossings between entire strips, not just particle overlap.
for (const pattern of ["letter", "half", "accordion"] as Pattern[])
  for (const thickness of [0.00006, 0.00012, 0.0008])
    test(`${pattern}, ${thickness * 1000} mm: strips remain separated throughout folding`, () => {
      const p = createPaper({ pattern, thickness });
      for (let frame = 0; frame <= 160; frame++) {
        p.setProgress(frame / 160);
        const section: Point[] = p.rows.map((_, row) => {
          const i = row * (p.nx + 1) * 3;
          return [p.positions[i + 1], p.positions[i + 2]];
        });
        for (let i = 0; i < section.length - 1; i++)
          for (let j = i + 2; j < section.length - 1; j++) {
            // Neighbours in the same continuous crease are not separate layers.
            if (p.rows[j] - p.rows[i + 1] < p.layerSpacing * Math.PI * 2)
              continue;
            const distance = segmentDistance(
              section[i],
              section[i + 1],
              section[j],
              section[j + 1],
            );
            assert.ok(
              distance >= thickness * 0.99,
              `frame ${frame}, strips ${i}/${j}, distance ${distance}, thickness ${thickness}`,
            );
          }
      }
    });
test("letter closes as centre, first flap, second flap at distinct heights", () => {
  const p = createPaper();
  p.setProgress(1);
  const z = (row: number) => p.positions[row * (p.nx + 1) * 3 + 2];
  assert.ok(Math.abs(z(0) - p.layerSpacing) < 1e-12);
  assert.ok(Math.abs(z(p.rows.length - 1) - 2 * p.layerSpacing) < 1e-12);
  const centre = p.rows.findIndex((y) => Math.abs(y) < 1e-12);
  assert.equal(z(centre), 0);
});
test("random seeking and reversal are independent of history", () => {
  const a = createPaper(),
    b = createPaper();
  for (const progress of [1, 0.82, 0.5, 0.01, 0, 0.73]) a.setProgress(progress);
  b.setProgress(0.73);
  assert.deepEqual(a.positions, b.positions);
  a.setProgress(0);
  assert.deepEqual(a.positions, a.rest);
});
test("thickness changes update the stack and topology without losing progress", () => {
  const p = createPaper();
  p.setProgress(1);
  p.setThickness(0.0005);
  assert.equal(p.progress, 1);
  assert.ok(Math.abs(p.positions[2] - 0.000575) < 1e-12);
  p.reset("half");
  assert.equal(p.creaseRows.length, 1);
  assert.deepEqual(p.positions, p.rest);
});
test("validates physical dimensions and thickness, clamps progress", () => {
  for (const thickness of [0, -1, NaN, Infinity, 0.02])
    assert.throws(() => createPaper({ thickness }));
  assert.throws(() => createPaper({ width: 0 }));
  assert.throws(() => createPaper({ height: Infinity }));
  const p = createPaper();
  assert.throws(() => p.setProgress(NaN));
  assert.throws(() => p.setThickness(-0.1));
  p.setProgress(2);
  assert.equal(p.progress, 1);
});

for (const pattern of ["cross", "double-cross", "fivefold"] as Pattern[])
  test(`${pattern}: carries the stack through perpendicular folds and reverses`, () => {
    const p = createPaper({ pattern });
    const steps = pattern === "cross" ? 2 : pattern === "double-cross" ? 4 : 5;
    const rest = p.rest.slice();
    for (let frame = 0; frame <= steps * 20; frame++) {
      p.setProgress(frame / (steps * 20));
      assert.ok(p.positions.every(Number.isFinite));
      for (let i = 0; i < p.normals.length; i += 3)
        assert.ok(
          Math.abs(Math.hypot(...p.normals.subarray(i, i + 3)) - 1) < 1e-10,
        );
    }
    const bounds = [0, 1, 2].map((axis) => {
      let low = Infinity,
        high = -Infinity;
      for (let i = axis; i < p.positions.length; i += 3) {
        low = Math.min(low, p.positions[i]);
        high = Math.max(high, p.positions[i]);
      }
      return [low, high];
    });
    const expectedWidth = p.width / 2 ** Math.ceil(steps / 2),
      expectedHeight = p.height / 2 ** Math.floor(steps / 2);
    assert.ok(bounds[0][1] - bounds[0][0] < expectedWidth * 1.12);
    assert.ok(bounds[1][1] - bounds[1][0] < expectedHeight * 1.12);
    assert.ok(
      Math.abs(bounds[2][1] - (2 ** steps - 1) * p.layerSpacing) < 1e-9,
    );
    const folded = p.positions.slice();
    p.setProgress(0.37);
    p.setProgress(1);
    assert.deepEqual(p.positions, folded);
    p.setProgress(0);
    assert.deepEqual(p.positions, rest);
    assert.ok(p.creaseEdges.length > 0);
  });

test("changing from a thick letter to a small packet applies its thickness limit", () => {
  const p = createPaper({ thickness: 0.0008 });
  p.reset("fivefold");
  assert.equal(p.thickness, 0.0002);
  p.setProgress(1);
  assert.ok(p.positions.every(Number.isFinite));
  assert.throws(() => p.setThickness(0.0008));
});

test("crooked folds are seeded, bounded, and stable across seeking", () => {
  const a = createPaper({ imperfection: 0.3, seed: 123 }),
    b = createPaper({ imperfection: 0.3, seed: 123 });
  assert.deepEqual(a.foldAngles, b.foldAngles);
  assert.ok(a.foldAngles.every((v) => Math.abs(v) <= 0.3));
  assert.notEqual(a.foldAngles[0], a.foldAngles[1]);
  a.setProgress(1);
  a.setProgress(0.72);
  b.setProgress(0.72);
  assert.deepEqual(a.positions, b.positions);
  const result = a.positions.slice();
  a.reset();
  a.setProgress(0.72);
  assert.deepEqual(a.positions, result);
  b.setImperfection(0.3, 124);
  assert.notDeepEqual(a.positions, b.positions);
  assert.equal(b.progress, 0.72);
  a.setImperfection(0);
  const precise = createPaper();
  precise.setProgress(0.72);
  assert.deepEqual(a.positions, precise.positions);
});
for (const pattern of [
  "letter",
  "half",
  "accordion",
  "cross",
  "double-cross",
  "fivefold",
] as Pattern[])
  test(`${pattern}: imperfect folds stay finite and unfold to the rectangular sheet`, () => {
    const p = createPaper({ pattern, imperfection: 2, seed: 42 });
    for (const progress of [0, 0.1, 0.4, 0.59, 0.8, 1, 0.6, 0]) {
      p.setProgress(progress);
      assert.ok(p.positions.every(Number.isFinite));
      assert.ok(p.normals.every(Number.isFinite));
      for (let i = 0; i < p.normals.length; i += 3)
        assert.ok(
          Math.abs(Math.hypot(...p.normals.subarray(i, i + 3)) - 1) < 1e-9,
        );
    }
    assert.deepEqual(p.positions, p.rest);
    assert.ok(p.creaseSegments.length > 0);
    assert.equal(p.rest[0], -p.width / 2);
    assert.ok(p.rest.some((v, i) => i % 3 === 1 && v === p.height / 2));
  });
test("imperfection inputs are validated before changing the model", () => {
  for (const imperfection of [-0.1, 2.01, NaN, Infinity])
    assert.throws(() => createPaper({ imperfection }));
  for (const seed of [-1, 0.5, NaN, 2 ** 32])
    assert.throws(() => createPaper({ seed }));
  const p = createPaper({ imperfection: 0.2, seed: 0 });
  assert.throws(() => p.setImperfection(2.01));
  assert.equal(p.imperfection, 0.2);
  assert.equal(p.seed, 0);
  p.setImperfection(2);
  assert.equal(p.imperfection, 2);
  assert.ok(p.foldAngles.every((angle) => Math.abs(angle) <= 2));
});

test("half-fold crease follows its seeded angle in material coordinates", () => {
  const p = createPaper({ pattern: "half", imperfection: 0.5, seed: 7 });
  const slope = Math.tan((p.foldAngles[0] * Math.PI) / 180);
  assert.ok(Math.abs(slope) > 1e-5);
  for (let i = 0; i < p.creaseSegments.length; i += 3)
    assert.ok(
      Math.abs(p.creaseSegments[i + 1] - slope * p.creaseSegments[i]) < 1e-10,
    );
  p.setProgress(0.5);
  const farCorner = p.rest.findIndex(
    (v, i) =>
      i % 3 === 0 && v === p.width / 2 && p.rest[i + 1] === p.height / 2,
  );
  assert.ok(
    Math.abs(p.positions[farCorner] - p.rest[farCorner]) > 1e-5,
    "the flap rotates about a tilted hinge, not just a horizontal one",
  );
});

for (const pattern of ["half", "letter", "fivefold"] as Pattern[])
  test(`${pattern}: tilted creases form a welded sheet without internal boundary edges`, () => {
    const p = createPaper({ pattern, imperfection: 2, seed: 42 });
    const edges = new Map<string, { a: number; b: number; count: number }>();
    let area = 0;
    for (let i = 0; i < p.indices.length; i += 3) {
      const [a, b, c] = p.indices.slice(i, i + 3).map((v) => v * 3);
      const signed =
        ((p.rest[b] - p.rest[a]) * (p.rest[c + 1] - p.rest[a + 1]) -
          (p.rest[b + 1] - p.rest[a + 1]) * (p.rest[c] - p.rest[a])) /
        2;
      assert.ok(signed > 0, "triangles retain positive material area");
      area += signed;
      for (let k = 0; k < 3; k++) {
        const a = p.indices[i + k],
          b = p.indices[i + ((k + 1) % 3)],
          key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        const edge = edges.get(key);
        if (edge) edge.count++;
        else edges.set(key, { a, b, count: 1 });
      }
    }
    assert.ok(Math.abs(area - p.width * p.height) < 1e-10);
    for (const { a, b, count } of edges.values()) {
      assert.ok(count === 1 || count === 2);
      if (count === 1)
        assert.ok(
          [0, 1].some(
            (axis) =>
              Math.abs(p.rest[a * 3 + axis] - p.rest[b * 3 + axis]) < 1e-10 &&
              Math.abs(
                Math.abs(p.rest[a * 3 + axis]) -
                  (axis === 0 ? p.width : p.height) / 2,
              ) < 1e-10,
          ),
          "open edges must lie on original paper perimeter",
        );
    }
  });
test("a tilted half fold resolves the bend instead of bridging opposite normals", () => {
  const p = createPaper({ pattern: "half", imperfection: 0.5, seed: 7 });
  for (const progress of [0.25, 0.5, 0.75, 1]) {
    p.setProgress(progress);
    for (let i = 0; i < p.indices.length; i += 3)
      for (let k = 0; k < 3; k++) {
        const a = p.indices[i + k] * 3,
          b = p.indices[i + ((k + 1) % 3)] * 3;
        const dot =
          p.normals[a] * p.normals[b] +
          p.normals[a + 1] * p.normals[b + 1] +
          p.normals[a + 2] * p.normals[b + 2];
        assert.ok(
          dot > Math.cos(Math.PI / 31),
          "each edge spans at most one small bend segment",
        );
      }
  }
});
