import * as THREE from "three";
type Point = [number, number, number];
const cross = (a: Point, b: Point, x: number, y: number) =>
  (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
/** Clip stroke centerlines before widening them. GPU wide-line quads alone can
 * pass through a nearer, sloping sheet even when their centerline is buried. */
export function visibleBorderSegments(
  lines: number[],
  geometries: THREE.BufferGeometry[],
  camera: THREE.Camera,
): number[] {
  camera.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(
      camera.projectionMatrix,
      camera.matrixWorldInverse,
    ),
    inverse = matrix.clone().invert();
  const planes = [
    (p: THREE.Vector4) => p.w + p.x,
    (p: THREE.Vector4) => p.w - p.x,
    (p: THREE.Vector4) => p.w + p.y,
    (p: THREE.Vector4) => p.w - p.y,
    (p: THREE.Vector4) => p.w + p.z,
    (p: THREE.Vector4) => p.w - p.z,
  ];
  const project = (p: THREE.Vector4): Point => [
    p.x / p.w,
    p.y / p.w,
    p.z / p.w,
  ];
  const triangles: { a: Point; b: Point; c: Point; area: number }[] = [],
    bins = new Map<string, number[]>(),
    cell = 0.1;
  const keys = (a: Point, b: Point, c?: Point) => {
    const result: string[] = [];
    for (
      let y = Math.floor(Math.min(a[1], b[1], c?.[1] ?? a[1]) / cell);
      y <= Math.floor(Math.max(a[1], b[1], c?.[1] ?? a[1]) / cell);
      y++
    )
      for (
        let x = Math.floor(Math.min(a[0], b[0], c?.[0] ?? a[0]) / cell);
        x <= Math.floor(Math.max(a[0], b[0], c?.[0] ?? a[0]) / cell);
        x++
      )
        result.push(`${x},${y}`);
    return result;
  };
  for (const geometry of geometries) {
    const position = geometry.getAttribute("position");
    if (!position) continue;
    const projected: THREE.Vector4[] = [];
    for (let i = 0; i < position.count; i++)
      projected.push(
        new THREE.Vector4(
          position.getX(i),
          position.getY(i),
          position.getZ(i),
          1,
        ).applyMatrix4(matrix),
      );
    const index = geometry.index,
      count = index?.count ?? position.count;
    for (let i = 0; i < count; i += 3) {
      let polygon = [0, 1, 2].map(
        (k) => projected[index ? index.getX(i + k) : i + k],
      );
      for (const plane of planes) {
        const next: THREE.Vector4[] = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j],
            b = polygon[(j + 1) % polygon.length],
            da = plane(a),
            db = plane(b);
          if (da >= 0) next.push(a);
          if (da >= 0 !== db >= 0) next.push(a.clone().lerp(b, da / (da - db)));
        }
        polygon = next;
        if (!polygon.length) break;
      }
      for (let j = 1; j + 1 < polygon.length; j++) {
        const a = project(polygon[0]),
          b = project(polygon[j]),
          c = project(polygon[j + 1]),
          area = cross(a, b, c[0], c[1]);
        if (Math.abs(area) < 1e-14) continue;
        const id = triangles.length;
        triangles.push({ a, b, c, area });
        for (const key of keys(a, b, c)) {
          const list = bins.get(key);
          if (list) list.push(id);
          else bins.set(key, [id]);
        }
      }
    }
  }
  const result: number[] = [];
  for (let i = 0; i + 5 < lines.length; i += 6) {
    let a = new THREE.Vector4(
        lines[i],
        lines[i + 1],
        lines[i + 2],
        1,
      ).applyMatrix4(matrix),
      b = new THREE.Vector4(
        lines[i + 3],
        lines[i + 4],
        lines[i + 5],
        1,
      ).applyMatrix4(matrix),
      visible = true;
    for (const plane of planes) {
      const da = plane(a),
        db = plane(b);
      if (da < 0 && db < 0) {
        visible = false;
        break;
      }
      if (da >= 0 !== db >= 0) {
        const p = a.clone().lerp(b, da / (da - db));
        if (da < 0) a = p;
        else b = p;
      }
    }
    if (!visible) continue;
    const p = project(a),
      q = project(b),
      dx = q[0] - p[0],
      dy = q[1] - p[1],
      dz = q[2] - p[2];
    const candidates = new Set<number>();
    for (const key of keys(p, q))
      for (const id of bins.get(key) ?? []) candidates.add(id);
    const hidden: [number, number][] = [];
    for (const id of candidates) {
      const face = triangles[id];
      let lo = 0,
        hi = 1;
      for (const [v, w] of [
        [face.a, face.b],
        [face.b, face.c],
        [face.c, face.a],
      ]) {
        const s = cross(v, w, p[0], p[1]) / face.area,
          e = cross(v, w, q[0], q[1]) / face.area;
        if (s < 0 && e < 0) {
          hi = -1;
          break;
        }
        if (s < 0) lo = Math.max(lo, s / (s - e));
        else if (e < 0) hi = Math.min(hi, s / (s - e));
      }
      if (hi <= lo) continue;
      const behind = (t: number) => {
        const x = p[0] + t * dx,
          y = p[1] + t * dy,
          u = cross(face.b, face.c, x, y) / face.area,
          v = cross(face.c, face.a, x, y) / face.area;
        return (
          p[2] +
          t * dz -
          (u * face.a[2] + v * face.b[2] + (1 - u - v) * face.c[2]) -
          1e-8
        );
      };
      const s = behind(lo),
        e = behind(hi);
      if (s <= 0 && e <= 0) continue;
      if (s <= 0) lo += ((hi - lo) * s) / (s - e);
      else if (e <= 0) hi = lo + ((hi - lo) * s) / (s - e);
      if (hi > lo) hidden.push([lo, hi]);
    }
    hidden.sort((a, b) => a[0] - b[0]);
    const emit = (lo: number, hi: number) => {
      if (hi - lo < 1e-8) return;
      for (const t of [lo, hi]) {
        const v = new THREE.Vector3(
          p[0] + dx * t,
          p[1] + dy * t,
          p[2] + dz * t,
        ).applyMatrix4(inverse);
        result.push(v.x, v.y, v.z);
      }
    };
    let cursor = 0;
    for (const [lo, hi] of hidden) {
      if (lo > cursor) emit(cursor, lo);
      cursor = Math.max(cursor, hi);
    }
    if (cursor < 1) emit(cursor, 1);
  }
  return result;
}
