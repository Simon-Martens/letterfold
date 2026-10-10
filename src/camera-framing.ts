import { BufferGeometry, PerspectiveCamera, Vector3 } from "three";

/** Center the projected sheet without changing viewing angles, roll or depth. */
export function centerPaperInView(
  camera: PerspectiveCamera,
  geometries: readonly BufferGeometry[],
): Vector3 {
  camera.updateMatrixWorld();
  const points = new Float64Array(
    geometries.reduce(
      (count, geometry) => count + geometry.getAttribute("position").count * 3,
      0,
    ),
  );
  let cursor = 0;
  const point = new Vector3();
  for (const geometry of geometries) {
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      point
        .fromBufferAttribute(positions, i)
        .applyMatrix4(camera.matrixWorldInverse);
      // A close-up crossing the near plane has no finite full-sheet framing.
      if (point.z >= -camera.near) return new Vector3();
      points[cursor++] = point.x;
      points[cursor++] = point.y;
      points[cursor++] = -point.z;
    }
  }
  if (!points.length) return new Vector3();
  const shift = new Vector3();
  for (const axis of ["x", "y"] as const) {
    // Projected extrema are piecewise linear in a camera-plane translation.
    // Newton steps use the depths of the two current silhouette extrema.
    for (let iteration = 0; iteration < 16; iteration++) {
      let min = Infinity,
        max = -Infinity,
        minDepth = 1,
        maxDepth = 1;
      for (let i = 0; i < points.length; i += 3) {
        const depth = points[i + 2];
        const projected =
          (points[i + (axis === "x" ? 0 : 1)] - shift[axis]) / depth;
        if (projected < min) {
          min = projected;
          minDepth = depth;
        }
        if (projected > max) {
          max = projected;
          maxDepth = depth;
        }
      }
      const correction = (min + max) / (1 / minDepth + 1 / maxDepth);
      shift[axis] += correction;
      if (Math.abs(correction) < 1e-12) break;
    }
  }
  shift.applyQuaternion(camera.quaternion);
  camera.position.add(shift);
  camera.updateMatrixWorld();
  return shift;
}
