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
/** Intact decorative wax disk on a material point. */
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

/** Material-bound wax triangles, captured once when the seal is applied. */
export interface SealAttachment {
  vertices: {
    ids: number[];
    weights: number[];
    height: number;
    side: number;
  }[];
}
export interface PaperSealState {
  attachment: SealAttachment | null;
  broken: boolean;
}

/** Assign each small wax triangle to the nearest sheet below it at closure. */
export function attachSeal(
  paper: PaperMesh,
  options: PaperSealOptions,
): SealAttachment {
  const original = sealGeometry(paper, options);
  const wax = original.toNonIndexed();
  original.dispose();
  const positions = wax.getAttribute("position");
  const normals = wax.getAttribute("normal");
  const attachment: SealAttachment = { vertices: [] };
  const radius =
    (options.radius ?? 0.045) * Math.min(paper.width, paper.height);
  const sheet = Array.from({ length: paper.count }, (_, i) =>
    new THREE.Vector3().fromArray(paper.positions, i * 3),
  );
  for (let i = 0; i < positions.count; i += 3) {
    const points = [0, 1, 2].map((k) =>
      new THREE.Vector3().fromBufferAttribute(positions, i + k),
    );
    const center = points
      .reduce((sum, p) => sum.add(p), new THREE.Vector3())
      .multiplyScalar(1 / 3);
    const normal = new THREE.Vector3()
      .fromBufferAttribute(normals, i)
      .normalize();
    if (normal.lengthSq() < 0.5) continue;
    const ray = new THREE.Ray(
      center.clone().addScaledVector(normal, radius),
      normal.clone().negate(),
    );
    let closest = Infinity;
    let ids: number[] | undefined;
    for (let j = 0; j < paper.indices.length; j += 3) {
      const candidate = paper.indices.slice(j, j + 3);
      const hit = ray.intersectTriangle(
        sheet[candidate[0]],
        sheet[candidate[1]],
        sheet[candidate[2]],
        false,
        new THREE.Vector3(),
      );
      if (hit && hit.distanceToSquared(ray.origin) < closest) {
        closest = hit.distanceToSquared(ray.origin);
        ids = candidate;
      }
    }
    if (!ids) continue;
    const triangle = new THREE.Triangle(
      sheet[ids[0]],
      sheet[ids[1]],
      sheet[ids[2]],
    );
    const surfaceNormal = triangle.getNormal(new THREE.Vector3());
    const side = surfaceNormal.dot(normal) >= 0 ? 1 : -1;
    for (const point of points) {
      const weights = triangle.getBarycoord(point, new THREE.Vector3())!;
      attachment.vertices.push({
        ids,
        weights: weights.toArray(),
        side,
        height: Math.min(
          Math.abs(point.clone().sub(triangle.a).dot(surfaceNormal)),
          radius * 0.08 + (paper.thickness ?? 0) / 2,
        ),
      });
    }
  }
  wax.dispose();
  return attachment;
}

/** Reconstruct fragments on their original material triangles at any fold pose. */
export function brokenSealGeometry(
  paper: PaperMesh,
  attachment: SealAttachment,
): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const vertex of attachment.vertices) {
    const points = vertex.ids.map((id) =>
      new THREE.Vector3().fromArray(paper.positions, id * 3),
    );
    const normal = new THREE.Triangle(
      ...(points as [THREE.Vector3, THREE.Vector3, THREE.Vector3]),
    ).getNormal(new THREE.Vector3());
    const point = new THREE.Vector3();
    points.forEach((p, k) => point.addScaledVector(p, vertex.weights[k]));
    point.addScaledVector(normal, vertex.height * vertex.side);
    positions.push(point.x, point.y, point.z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.computeVertexNormals();
  return geometry;
}
