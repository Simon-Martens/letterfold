import * as THREE from "three";

export interface SchematicSvgOptions {
  /** Pixel sampling width; paths remain scalable vector geometry. */
  width?: number;
  height?: number;
  title?: string;
}
export interface SvgSurface {
  geometry: THREE.BufferGeometry;
  side: "front" | "back" | "both";
}
export interface SvgStroke {
  positions: number[];
  width: number;
  guide?: boolean;
}
const colors = [
  "#ffffff",
  "#f5f3ed",
  "#e9e6dd",
  "#ddd9ce",
  "#d2cec2",
  "#c6c2b5",
  "#161b18",
  "#9c7655",
];
const escapeXml = (s: string) =>
  s.replace(
    /[<>&"']/g,
    (c) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );

/** Resolve visibility with a software depth buffer, then trace the visible regions
 * into vector paths. No bitmap, artwork texture, script or WebGL is embedded. */
export function exportSchematicSvg(
  surfaces: SvgSurface[],
  strokes: SvgStroke[],
  camera: THREE.Camera,
  options: SchematicSvgOptions = {},
): string {
  const width = options.width ?? 1000,
    height = options.height ?? 1000;
  if (
    ![width, height].every((n) => Number.isInteger(n) && n >= 64 && n <= 2048)
  )
    throw new Error("SVG dimensions must be integers between 64 and 2048.");
  camera.updateMatrixWorld();
  const matrix = new THREE.Matrix4().multiplyMatrices(
    camera.projectionMatrix,
    camera.matrixWorldInverse,
  );
  const depth = new Float64Array(width * height).fill(Infinity);
  const pixels = new Uint8Array(width * height);
  const light = new THREE.Vector3(-0.3, 0.5, 0.8).normalize();
  type Point = [number, number, number];
  const screen = (p: THREE.Vector4): Point => [
    ((p.x / p.w + 1) * width) / 2,
    ((1 - p.y / p.w) * height) / 2,
    p.z / p.w,
  ];
  const cross = (a: Point, b: Point, x: number, y: number) =>
    (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
  const raster = (a: Point, b: Point, c: Point, color: number) => {
    const area = cross(a, b, c[0], c[1]);
    if (Math.abs(area) < 1e-10) return;
    const minX = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0]))),
      maxX = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const minY = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1]))),
      maxY = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = minY; y <= maxY; y++)
      for (let x = minX; x <= maxX; x++) {
        const u = cross(b, c, x + 0.5, y + 0.5) / area,
          v = cross(c, a, x + 0.5, y + 0.5) / area,
          w = 1 - u - v;
        if (u < -1e-9 || v < -1e-9 || w < -1e-9) continue;
        const z = u * a[2] + v * b[2] + w * c[2],
          i = y * width + x;
        if (z < depth[i]) {
          depth[i] = z;
          pixels[i] = color;
        }
      }
  };
  // Clip homogeneous coordinates before dividing, including the near plane.
  const planes = [
    (p: THREE.Vector4) => p.w + p.x,
    (p: THREE.Vector4) => p.w - p.x,
    (p: THREE.Vector4) => p.w + p.y,
    (p: THREE.Vector4) => p.w - p.y,
    (p: THREE.Vector4) => p.w + p.z,
    (p: THREE.Vector4) => p.w - p.z,
  ];
  const clip = (polygon: THREE.Vector4[]) => {
    for (const plane of planes) {
      const next: THREE.Vector4[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          da = plane(a),
          db = plane(b);
        if (da >= 0) next.push(a);
        if (da >= 0 !== db >= 0) next.push(a.clone().lerp(b, da / (da - db)));
      }
      polygon = next;
      if (!polygon.length) break;
    }
    return polygon;
  };
  for (const { geometry, side } of surfaces) {
    const position = geometry.getAttribute("position"),
      index = geometry.index;
    const projected: THREE.Vector4[] = [],
      world: THREE.Vector3[] = [];
    for (let i = 0; i < position.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(position, i);
      world.push(v);
      projected.push(new THREE.Vector4(v.x, v.y, v.z, 1).applyMatrix4(matrix));
    }
    const count = index?.count ?? position.count;
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(i + k) : i + k));
      const [a, b, c] = ids.map((id) => world[id]);
      const normal = new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize();
      const facing =
        normal.dot(new THREE.Vector3().subVectors(camera.position, a)) >= 0;
      if ((side === "front" && !facing) || (side === "back" && facing))
        continue;
      if (!facing) normal.negate();
      const shade =
        1 +
        Math.min(
          4,
          Math.round((1 - Math.max(0, normal.dot(light))) * 3) +
            (side === "back" ? 1 : 0),
        );
      const polygon = clip(ids.map((id) => projected[id]));
      for (let j = 1; j + 1 < polygon.length; j++)
        raster(
          screen(polygon[0]),
          screen(polygon[j]),
          screen(polygon[j + 1]),
          shade,
        );
    }
  }
  for (const stroke of strokes)
    for (let i = 0; i + 5 < stroke.positions.length; i += 6) {
      let a = new THREE.Vector4(
        ...(stroke.positions.slice(i, i + 3) as [number, number, number]),
        1,
      ).applyMatrix4(matrix);
      let b = new THREE.Vector4(
        ...(stroke.positions.slice(i + 3, i + 6) as [number, number, number]),
        1,
      ).applyMatrix4(matrix);
      let visible = true;
      for (const plane of planes) {
        const da = plane(a),
          db = plane(b);
        if (da < 0 && db < 0) {
          visible = false;
          break;
        }
        if (da >= 0 !== db >= 0) {
          const cut = a.clone().lerp(b, da / (da - db));
          if (da < 0) a = cut;
          else b = cut;
        }
      }
      if (!visible) continue;
      const p = screen(a),
        q = screen(b),
        dx = q[0] - p[0],
        dy = q[1] - p[1],
        len = dx * dx + dy * dy,
        r = Math.max(0.5, stroke.width / 2);
      for (
        let y = Math.max(0, Math.floor(Math.min(p[1], q[1]) - r));
        y <= Math.min(height - 1, Math.ceil(Math.max(p[1], q[1]) + r));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(Math.min(p[0], q[0]) - r));
          x <= Math.min(width - 1, Math.ceil(Math.max(p[0], q[0]) + r));
          x++
        ) {
          const t = len
            ? Math.max(
                0,
                Math.min(
                  1,
                  ((x + 0.5 - p[0]) * dx + (y + 0.5 - p[1]) * dy) / len,
                ),
              )
            : 0;
          if (Math.hypot(x + 0.5 - p[0] - t * dx, y + 0.5 - p[1] - t * dy) > r)
            continue;
          const z = p[2] + t * (q[2] - p[2]),
            id = y * width + x;
          if (z <= depth[id] + 1e-7) pixels[id] = stroke.guide ? 8 : 7;
        }
    }
  return traceSvg(pixels, width, height, options.title ?? "Folded letter");
}

function simplify(points: number[][], tolerance = 0.65): number[][] {
  if (points.length <= 3) return points;
  const keep = new Set([0, points.length - 1]),
    stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!,
      [ax, ay] = points[a],
      [bx, by] = points[b],
      dx = bx - ax,
      dy = by - ay,
      len = dx * dx + dy * dy;
    let max = tolerance * tolerance,
      at = -1;
    for (let i = a + 1; i < b; i++) {
      const [x, y] = points[i],
        t = len
          ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / len))
          : 0;
      const d = (x - ax - t * dx) ** 2 + (y - ay - t * dy) ** 2;
      if (d > max) {
        max = d;
        at = i;
      }
    }
    if (at >= 0) {
      keep.add(at);
      stack.push([a, at], [at, b]);
    }
  }
  return [...keep].sort((a, b) => a - b).map((i) => points[i]);
}
function traceSvg(
  pixels: Uint8Array,
  width: number,
  height: number,
  title: string,
) {
  const paths: string[] = [];
  for (let color = 1; color <= 8; color++) {
    const edges = new Map<number, number[]>(),
      stride = width + 1;
    const edge = (a: number, b: number) => {
      const e = edges.get(a);
      if (e) e.push(b);
      else edges.set(a, [b]);
    };
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        if (pixels[i] !== color) continue;
        const a = y * stride + x,
          b = a + 1,
          c = b + stride,
          d = a + stride;
        if (y === 0 || pixels[i - width] !== color) edge(a, b);
        if (x === width - 1 || pixels[i + 1] !== color) edge(b, c);
        if (y === height - 1 || pixels[i + width] !== color) edge(c, d);
        if (x === 0 || pixels[i - 1] !== color) edge(d, a);
      }
    const contours: string[] = [];
    while (edges.size) {
      const start = edges.keys().next().value!,
        points: number[][] = [];
      let current = start;
      do {
        points.push([current % stride, Math.floor(current / stride)]);
        const next = edges.get(current);
        if (!next) break;
        const to = next.pop()!;
        if (!next.length) edges.delete(current);
        current = to;
      } while (current !== start);
      points.push(points[0]);
      const mid = Math.floor(points.length / 2);
      const simple = [
        ...simplify(points.slice(0, mid + 1)),
        ...simplify(points.slice(mid)).slice(1),
      ];
      if (simple.length >= 4)
        contours.push(`M${simple.map((p) => p.join(" ")).join("L")}Z`);
    }
    if (contours.length)
      paths.push(
        `<path fill="${colors[color - 1]}" fill-rule="evenodd" d="${contours.join("")}"/>`,
      );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>${escapeXml(title)}</title>${paths.join("")}</svg>`;
}
