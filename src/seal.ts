import * as THREE from "three";
import type { PaperMesh } from "./paper";
export interface PaperSealOptions {
  /** Material coordinates on the unfolded sheet, 0–1 (v=0 is the bottom). */
  u?: number;
  v?: number;
  /** Radius as a fraction of the shorter sheet dimension. */
  radius?: number;
  side?: "front" | "back";
}
/** Decorative wax on a material point; appears only on the fully closed sheet. */
export function sealGeometry(
  paper: PaperMesh,
  options: PaperSealOptions,
): THREE.BufferGeometry {
  const u = options.u ?? 0.46,
    v = options.v ?? 0.01,
    radius = options.radius ?? 0.045;
  if (
    ![u, v, radius].every(Number.isFinite) ||
    u < 0 ||
    u > 1 ||
    v < 0 ||
    v > 1 ||
    radius <= 0 ||
    radius > 0.2
  )
    throw new Error(
      "Seal coordinates must be 0–1 and radius greater than 0 up to 0.2.",
    );
  const x = (u - 0.5) * paper.width,
    y = (v - 0.5) * paper.height;
  const center = new THREE.Vector3(),
    normal = new THREE.Vector3(),
    tangent = new THREE.Vector3();
  let found = false;
  for (let i = 0; i < paper.indices.length; i += 3) {
    const ids = paper.indices.slice(i, i + 3),
      [a, b, c] = ids.map((id) =>
        new THREE.Vector3().fromArray(paper.rest, id * 3),
      );
    const denom = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
    if (Math.abs(denom) < 1e-18) continue;
    const wa = ((b.y - c.y) * (x - c.x) + (c.x - b.x) * (y - c.y)) / denom;
    const wb = ((c.y - a.y) * (x - c.x) + (a.x - c.x) * (y - c.y)) / denom,
      wc = 1 - wa - wb;
    if (Math.min(wa, wb, wc) < -1e-8) continue;
    const points = ids.map((id) =>
      new THREE.Vector3().fromArray(paper.positions, id * 3),
    );
    [wa, wb, wc].forEach((weight, k) => {
      center.addScaledVector(points[k], weight);
      if (paper.normals)
        normal.addScaledVector(
          new THREE.Vector3().fromArray(paper.normals, ids[k] * 3),
          weight,
        );
    });
    if (!paper.normals)
      normal
        .subVectors(points[1], points[0])
        .cross(new THREE.Vector3().subVectors(points[2], points[0]));
    normal.normalize().multiplyScalar(options.side === "back" ? -1 : 1);
    tangent.subVectors(points[1], points[0]).normalize();
    found = true;
    break;
  }
  if (!found) throw new Error("Seal anchor is outside the paper.");
  tangent.addScaledVector(normal, -tangent.dot(normal)).normalize();
  const bitangent = new THREE.Vector3()
    .crossVectors(normal, tangent)
    .normalize();
  const r = radius * Math.min(paper.width, paper.height),
    lift = (paper.thickness ?? 0) / 2 + r * 0.02;
  center.addScaledVector(normal, lift);
  const positions: number[] = [],
    indices: number[] = [],
    segments = 64;
  // A low relief wax disk with a slightly irregular rim and stamped central ring.
  for (const [scale, height] of [
    [0, 0.025],
    [0.65, 0.025],
    [0.73, 0.055],
    [0.82, 0.035],
    [1, 0],
  ]) {
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2,
        irregular =
          scale === 1
            ? 1 + 0.035 * Math.sin(angle * 7) + 0.02 * Math.cos(angle * 11)
            : 1;
      const point = center
        .clone()
        .addScaledVector(tangent, Math.cos(angle) * r * scale * irregular)
        .addScaledVector(bitangent, Math.sin(angle) * r * scale * irregular)
        .addScaledVector(normal, height * r);
      positions.push(point.x, point.y, point.z);
    }
  }
  for (let ring = 0; ring < 4; ring++)
    for (let i = 0; i < segments; i++) {
      const a = ring * segments + i,
        b = ring * segments + ((i + 1) % segments),
        c = a + segments,
        d = b + segments;
      indices.push(a, c, d, a, d, b);
    }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
