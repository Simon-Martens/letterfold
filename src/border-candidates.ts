import * as THREE from "three";
export interface OutlineEdge {
  a: number;
  b: number;
  faces: number[];
}
/** Silhouettes belong to the actual offset faces, not the paper's mid-surface. */
export function physicalBorderSegments(
  geometries: THREE.BufferGeometry[],
  edges: OutlineEdge[],
  camera: THREE.Camera,
): number[] {
  const lines: number[] = [];
  const eye = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
  for (const geometry of geometries) {
    const positions = geometry.getAttribute("position"),
      index = geometry.index!;
    const points = Array.from({ length: positions.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(positions, i),
    );
    const signs = new Int8Array(index.count / 3);
    for (let i = 0; i < index.count; i += 3) {
      const a = points[index.getX(i)],
        b = points[index.getX(i + 1)],
        c = points[index.getX(i + 2)];
      const normal = b.clone().sub(a).cross(c.clone().sub(a));
      signs[i / 3] =
        normal.lengthSq() < 1e-24
          ? 0
          : normal.dot(eye.clone().sub(a)) >= 0
            ? 1
            : -1;
    }
    for (const edge of edges) {
      const facing = edge.faces
        .map((face) => signs[face])
        .filter((sign) => sign !== 0);
      if (
        !facing.length ||
        points[edge.a].distanceToSquared(points[edge.b]) < 1e-20
      )
        continue;
      if (edge.faces.length > 1 && !(facing.includes(1) && facing.includes(-1)))
        continue;
      for (const id of [edge.a, edge.b]) {
        const point = points[id].clone();
        point.addScaledVector(eye.clone().sub(point).normalize(), 1e-8);
        lines.push(point.x, point.y, point.z);
      }
    }
  }
  return lines;
}
