import { patterns, packetAxes, type Pattern } from "./patterns";
export type { Pattern } from "./patterns";

export interface PaperOptions {
  /** Dimensions and thickness in metres. */
  width?: number;
  height?: number;
  thickness?: number;
  pattern?: Pattern;
  /** Maximum per-crease crookedness in degrees, from 0 to 2. */
  imperfection?: number;
  /** Unsigned 32-bit seed. Identical seeds reproduce identical crease angles. */
  seed?: number;
}

/** Data contract shared by the folding library and its optional renderer. */
export interface PaperMesh {
  readonly progress?: number;
  readonly width: number;
  readonly height: number;
  readonly nx: number;
  readonly count: number;
  readonly positions: Float64Array;
  readonly rest: Float64Array;
  readonly indices: number[];
  readonly pattern: Pattern;
  readonly normals?: Float64Array;
  readonly thickness?: number;
  readonly creaseRows?: number[];
  readonly creaseEdges?: number[];
  readonly revision?: number;
  readonly stateVersion?: number;
  readonly creaseSegments?: Float64Array;
  readonly creaseSegmentNormals?: Float64Array;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (v: number) => {
  const t = clamp(v);
  return t * t * (3 - 2 * t);
};

/**
 * Finite-thickness, inextensible fold geometry for simple parallel letter folds.
 * Rigid flaps join a circular bend, whose material length is radius * angle.
 * Layer order determines bend radius, so later folds wrap around earlier ones.
 * This is a constrained geometric model, not a general contact/force solver.
 */
export class LetterPaper implements PaperMesh {
  private _width: number;
  private _height: number;
  get width() {
    return this._width;
  }
  get height() {
    return this._height;
  }
  nx = 12;
  private _thickness: number;
  private _pattern: Pattern;
  private _progress = 0;
  private _imperfection = 0;
  private _seed = 1;
  get imperfection() {
    return this._imperfection;
  }
  get seed() {
    return this._seed;
  }
  get foldAngles() {
    let state = this.seed;
    return patterns[this.pattern].steps.map(() => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
      return (
        ((((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1) * this.imperfection
      );
    });
  }
  creaseSegments = new Float64Array(0);
  creaseSegmentNormals = new Float64Array(0);
  private guideWeights: { a: number; b: number; t: number }[] = [];
  setImperfection(degrees: number, seed: number = this.seed) {
    this.validateImperfection(degrees, seed);
    this._imperfection = degrees;
    this._seed = seed;
    this.rebuild();
  }
  private validateImperfection(degrees: number, seed: number) {
    if (!Number.isFinite(degrees) || degrees < 0 || degrees > 2)
      throw new Error("Imperfection must be between 0 and 2 degrees.");
    if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
      throw new Error("Seed must be an unsigned 32-bit integer.");
  }
  /** Mid-surface separation includes a small allowance for crease tessellation. */
  get layerSpacing() {
    return this._thickness * 1.15;
  }
  get thickness() {
    return this._thickness;
  }
  get pattern() {
    return this._pattern;
  }
  get progress() {
    return this._progress;
  }
  get count() {
    return this.rest.length / 3;
  }
  positions = new Float64Array(0);
  normals = new Float64Array(0);
  rest = new Float64Array(0);
  indices: number[] = [];
  creaseRows: number[] = [];
  creaseEdges: number[] = [];
  private packetFolds: { axis: 0 | 1; pivot: number; radius: number }[] = [];
  get maxThickness() {
    let limit = Math.min(
      Math.min(this.width, this.height) / 100,
      this.pattern === "fivefold"
        ? 0.0002
        : this.pattern === "double-cross"
          ? 0.0004
          : 0.0008,
    );
    if (this.pattern in packetAxes) {
      const counts = [0, 0];
      packetAxes[this.pattern as keyof typeof packetAxes].forEach((axis, i) => {
        const movingLength =
          (axis === 0 ? this.width : this.height) / 2 ** ++counts[axis];
        limit = Math.min(
          limit,
          (0.8 * movingLength) / (Math.PI * (2 ** i - 0.5) * 1.15),
        );
      });
    }
    return limit;
  }

  /** Original material coordinates, with extra samples inside each bend. */
  rows: number[] = [];
  revision = 0;
  stateVersion = 0;

  constructor(options: PaperOptions = {}) {
    this._width =
      options.width ?? (options.pattern === "lenz-1776" ? 0.297 : 0.21);
    this._height =
      options.height ?? (options.pattern === "lenz-1776" ? 0.2475 : 0.297);
    if (
      !Number.isFinite(this.width) ||
      this.width <= 0 ||
      !Number.isFinite(this.height) ||
      this.height <= 0
    )
      throw new Error("Paper dimensions must be finite and positive.");
    this._thickness = options.thickness ?? 0.00012;
    this._pattern = options.pattern ?? "letter";
    this.validateThickness(this._thickness);
    this.validatePattern(this._pattern);
    this.validateImperfection(options.imperfection ?? 0, options.seed ?? 1);
    this._imperfection = options.imperfection ?? 0;
    this._seed = options.seed ?? 1;
    this.rebuild();
  }
  private validateThickness(value: number) {
    if (!Number.isFinite(value) || value <= 0 || value > this.maxThickness)
      throw new Error(
        `Thickness must be positive and at most ${this.maxThickness * 1000} mm for this pattern.`,
      );
  }
  private validatePattern(value: Pattern) {
    if (!Object.hasOwn(patterns, value))
      throw new Error("Unsupported fold pattern.");
  }
  /** Resize the sheet without changing artwork UV coordinates or the current progress. */
  setSize(width: number, height: number) {
    if (![width, height].every((n) => Number.isFinite(n) && n > 0))
      throw new Error("Paper dimensions must be finite and positive.");
    this._width = width;
    this._height = height;
    this._thickness = Math.min(this._thickness, this.maxThickness);
    this.rebuild();
  }
  setThickness(value: number) {
    this.validateThickness(value);
    this._thickness = value;
    this.rebuild();
  }
  reset(pattern: Pattern = this.pattern) {
    this.validatePattern(pattern);
    this._pattern = pattern;
    this._thickness = Math.min(this._thickness, this.maxThickness);
    this._progress = 0;
    this.rebuild();
  }
  private get folds() {
    const radius = this.layerSpacing / 2;
    return this.pattern === "half"
      ? [{ pivot: 0, side: 1, direction: 1, radius }]
      : [
          { pivot: -this.height / 6, side: -1, direction: 1, radius },
          {
            pivot: this.height / 6,
            side: 1,
            direction: this.pattern === "accordion" ? -1 : 1,
            radius: this.pattern === "letter" ? radius * 2 : radius,
          },
        ];
  }
  private rebuild() {
    this.creaseSegments = new Float64Array(0);
    this.creaseSegmentNormals = new Float64Array(0);
    this.guideWeights = [];
    if (this.imperfection > 0 || this.pattern === "lenz-1776") {
      this.rebuildImperfect();
      return;
    }
    if (this.pattern in packetAxes) {
      this.rebuildPacket();
      return;
    }
    this.nx = 12;
    this.creaseEdges = [];
    const rows: number[] = [];
    for (let i = 0; i <= 18; i++) rows.push((i / 18 - 0.5) * this.height);
    for (const fold of this.folds) {
      rows.push(fold.pivot);
      // Fixed material samples: seeking never remeshes or changes UVs.
      for (let i = 1; i <= 32; i++)
        rows.push(fold.pivot + (fold.side * fold.radius * Math.PI * i) / 32);
    }
    this.rows = rows
      .sort((a, b) => a - b)
      .filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-12);
    this.creaseRows = this.folds.map((f) =>
      this.rows.findIndex((y) => Math.abs(y - f.pivot) < 1e-12),
    );
    this.rest = new Float64Array(this.rows.length * (this.nx + 1) * 3);
    for (let row = 0; row < this.rows.length; row++)
      for (let x = 0; x <= this.nx; x++) {
        const i = (row * (this.nx + 1) + x) * 3;
        this.rest[i] = (x / this.nx - 0.5) * this.width;
        this.rest[i + 1] = this.rows[row];
      }
    this.positions = this.rest.slice();
    this.normals = new Float64Array(this.rest.length);
    this.indices = [];
    for (let row = 0; row < this.rows.length - 1; row++)
      for (let x = 0; x < this.nx; x++) {
        const a = row * (this.nx + 1) + x,
          b = a + 1,
          c = a + this.nx + 1,
          d = c + 1;
        this.indices.push(a, b, d, a, d, c);
      }
    this.revision++;
    this.setProgress(this.progress);
  }
  /** Evaluate directly from material coordinates; seeking/reversing is exact. */
  setProgress(value: number) {
    if (!Number.isFinite(value)) throw new Error("Progress must be finite.");
    this._progress = clamp(value);
    this.stateVersion++;
    this.positions.set(this.rest);
    this.normals.fill(0);
    if (this.imperfection > 0 || this.pattern === "lenz-1776") {
      this.evaluateImperfect();
      return;
    }
    if (this.pattern in packetAxes) {
      this.evaluatePacket();
      return;
    }
    const folds = this.folds;
    for (let row = 0; row < this.rows.length; row++) {
      const y = this.rows[row];
      let py = y,
        pz = 0,
        ny = 0,
        nz = 1;
      for (let f = 0; f < folds.length; f++) {
        const fold = folds[f],
          distance = (y - fold.pivot) * fold.side;
        if (distance <= 0) continue;
        const angle = smooth(this.progress * folds.length - f) * Math.PI;
        if (angle === 0) continue;
        const arcAngle = Math.min(distance / fold.radius, angle);
        const straight = Math.max(0, distance - fold.radius * angle);
        py =
          fold.pivot +
          fold.side *
            (fold.radius * Math.sin(arcAngle) + straight * Math.cos(angle));
        pz =
          fold.direction *
          (fold.radius * (1 - Math.cos(arcAngle)) + straight * Math.sin(angle));
        ny = -fold.side * fold.direction * Math.sin(arcAngle);
        nz = Math.cos(arcAngle);
      }
      for (let x = 0; x <= this.nx; x++) {
        const i = (row * (this.nx + 1) + x) * 3;
        this.positions[i + 1] = py;
        this.positions[i + 2] = pz;
        this.normals[i + 1] = ny;
        this.normals[i + 2] = nz;
      }
    }
  }
  private rebuildPacket() {
    const axes = packetAxes[this.pattern as keyof typeof packetAxes];
    const low = [-this.width / 2, -this.height / 2],
      high = [this.width / 2, this.height / 2];
    this.packetFolds = axes.map((axis, i) => {
      const pivot = (low[axis] + high[axis]) / 2;
      const radius = (2 ** i - 0.5) * this.layerSpacing;
      if (radius * Math.PI >= (high[axis] - low[axis]) / 2)
        throw new Error(
          "This sheet is too small or thick for the selected sequence.",
        );
      high[axis] = pivot;
      return { axis, pivot, radius };
    });
    const coordinates: number[][] = [[], []];
    for (let axis = 0; axis < 2; axis++)
      for (let i = 0; i <= 18; i++)
        coordinates[axis].push(
          (i / 18 - 0.5) * (axis === 0 ? this.width : this.height),
        );
    const creaseCoordinates: number[][] = [[], []];
    this.packetFolds.forEach((fold, index) => {
      for (let sample = 0; sample <= 24; sample++) {
        let candidates = [fold.pivot + (fold.radius * Math.PI * sample) / 24];
        for (let previous = index - 1; previous >= 0; previous--) {
          const f = this.packetFolds[previous];
          if (f.axis !== fold.axis) continue;
          candidates = candidates.flatMap((q) => {
            const result: number[] = [];
            if (q <= f.pivot + 1e-12) result.push(q);
            const unfolded = 2 * f.pivot + f.radius * Math.PI - q;
            if (unfolded >= f.pivot + f.radius * Math.PI - 1e-12)
              result.push(unfolded);
            return result;
          });
        }
        const limit = (fold.axis === 0 ? this.width : this.height) / 2;
        for (const q of candidates)
          if (q >= -limit && q <= limit) {
            coordinates[fold.axis].push(q);
            if (sample === 0) creaseCoordinates[fold.axis].push(q);
          }
      }
    });
    const [xs, ys] = coordinates.map((a) =>
      a
        .sort((a, b) => a - b)
        .filter((v, i, a) => i === 0 || v - a[i - 1] > 1e-12),
    );
    this.nx = xs.length - 1;
    this.rows = ys;
    this.creaseRows = [];
    this.creaseEdges = [];
    this.rest = new Float64Array(xs.length * ys.length * 3);
    for (let y = 0; y < ys.length; y++)
      for (let x = 0; x < xs.length; x++) {
        const i = (y * xs.length + x) * 3;
        this.rest[i] = xs[x];
        this.rest[i + 1] = ys[y];
        if (
          x < this.nx &&
          creaseCoordinates[1].some((q) => Math.abs(q - ys[y]) < 1e-12)
        )
          this.creaseEdges.push(i / 3, i / 3 + 1);
        if (
          y < ys.length - 1 &&
          creaseCoordinates[0].some((q) => Math.abs(q - xs[x]) < 1e-12)
        )
          this.creaseEdges.push(i / 3, i / 3 + xs.length);
      }
    this.positions = this.rest.slice();
    this.normals = new Float64Array(this.rest.length);
    this.indices = [];
    for (let y = 0; y < ys.length - 1; y++)
      for (let x = 0; x < this.nx; x++) {
        const a = y * xs.length + x,
          b = a + 1,
          c = a + xs.length,
          d = c + 1;
        this.indices.push(a, b, d, a, d, c);
      }
    this.revision++;
    this.setProgress(this.progress);
  }
  private evaluatePacket() {
    for (let i = 2; i < this.normals.length; i += 3) this.normals[i] = 1;
    this.packetFolds.forEach((fold, step) => {
      const angle =
        smooth(this.progress * this.packetFolds.length - step) * Math.PI;
      if (angle === 0) return;
      for (let i = 0; i < this.positions.length; i += 3) {
        const q = this.positions[i + fold.axis] - fold.pivot;
        if (q <= 0) continue;
        const radius = fold.radius - this.positions[i + 2];
        const phi = Math.min(q / fold.radius, angle),
          tail = Math.max(0, q - fold.radius * angle);
        const sin = Math.sin(phi),
          cos = Math.cos(phi);
        this.positions[i + fold.axis] =
          fold.pivot + radius * sin + tail * Math.cos(angle);
        this.positions[i + 2] =
          fold.radius - radius * cos + tail * Math.sin(angle);
        // Inverse transpose of the bend Jacobian preserves surface normals.
        const n =
            this.normals[i + fold.axis] *
            (q < fold.radius * angle ? fold.radius / radius : 1),
          z = this.normals[i + 2];
        this.normals[i + fold.axis] = n * cos - z * sin;
        this.normals[i + 2] = n * sin + z * cos;
        const length = Math.hypot(
          this.normals[i],
          this.normals[i + 1],
          this.normals[i + 2],
        );
        for (let k = 0; k < 3; k++) this.normals[i + k] /= length;
      }
    });
  }
  /** Local crease frames, applied to the entire packet in sequence. */
  private imperfectFolds() {
    const angles = this.foldAngles;
    if (this.pattern === "lenz-1776") {
      // Positions estimated from the photographed sheet, not archival measurements.
      const frames = [
        { cx: -0.3 * this.width, cy: 0, nx: -1, ny: 0 },
        { cx: 0.22 * this.width, cy: 0, nx: 1, ny: 0 },
        { cx: -0.04 * this.width, cy: 0.12 * this.height, nx: 0, ny: 1 },
        { cx: -0.04 * this.width, cy: -0.29 * this.height, nx: 0, ny: -1 },
      ];
      return frames.map((f, i) => {
        const a = (angles[i] * Math.PI) / 180;
        return {
          ...f,
          nx: f.nx * Math.cos(a) - f.ny * Math.sin(a),
          ny: f.nx * Math.sin(a) + f.ny * Math.cos(a),
          radius: [0.5, 1.5, 3.5, 7.5][i] * this.layerSpacing,
          direction: -1,
        };
      });
    }
    if (this.pattern in packetAxes) {
      const low = [-this.width / 2, -this.height / 2],
        high = [this.width / 2, this.height / 2];
      return packetAxes[this.pattern as keyof typeof packetAxes].map(
        (axis, i) => {
          const center = [(low[0] + high[0]) / 2, (low[1] + high[1]) / 2];
          high[axis] = center[axis];
          const a = (angles[i] * Math.PI) / 180;
          return {
            cx: center[0],
            cy: center[1],
            nx: axis === 0 ? Math.cos(a) : -Math.sin(a),
            ny: axis === 0 ? Math.sin(a) : Math.cos(a),
            radius: (2 ** i - 0.5) * this.layerSpacing,
            direction: 1,
          };
        },
      );
    }
    return this.folds.map((f, i) => {
      const a = (angles[i] * Math.PI) / 180;
      return {
        cx: 0,
        cy: f.pivot,
        nx: -Math.sin(a) * f.side,
        ny: Math.cos(a) * f.side,
        radius:
          (this.pattern === "letter" && i === 1 ? 1.5 : 0.5) *
          this.layerSpacing,
        direction: f.direction,
      };
    });
  }
  private rebuildImperfect() {
    // Start coarse; split along each crease and its curved material band.
    this.nx = 18;
    const ny = 18;
    this.rows = Array.from(
      { length: ny + 1 },
      (_, i) => (i / ny - 0.5) * this.height,
    );
    this.creaseRows = [];
    this.creaseEdges = [];
    const material: number[] = [];
    for (let y = 0; y <= ny; y++)
      for (let x = 0; x <= this.nx; x++)
        material.push((x / this.nx - 0.5) * this.width, this.rows[y], 0);
    this.indices = [];
    for (let y = 0; y < ny; y++)
      for (let x = 0; x < this.nx; x++) {
        const a = y * (this.nx + 1) + x,
          b = a + 1,
          c = a + this.nx + 1,
          d = c + 1;
        this.indices.push(a, b, d, a, d, c);
      }
    const progress = this.progress,
      folds = this.imperfectFolds();
    const creaseCoordinates: number[][] = [];
    const sync = () => {
      this.rest = new Float64Array(material);
      this.positions = this.rest.slice();
      this.normals = new Float64Array(material.length);
    };
    for (let step = 0; step < folds.length; step++) {
      sync();
      this._progress = step / folds.length;
      this.evaluateImperfect();
      const f = folds[step];
      const q = Array.from(
        { length: this.count },
        (_, v) =>
          (this.positions[v * 3] - f.cx) * f.nx +
          (this.positions[v * 3 + 1] - f.cy) * f.ny,
      );
      creaseCoordinates.push(q);
      let polygons: number[][] = [];
      for (let i = 0; i < this.indices.length; i += 3)
        polygons.push(this.indices.slice(i, i + 3));
      for (let slice = 0; slice <= 32; slice++) {
        const level = (f.radius * Math.PI * slice) / 32;
        const intersections = new Map<string, number>();
        const splitEdge = (a: number, b: number) => {
          const key = `${Math.min(a, b)}:${Math.max(a, b)}`;
          const cached = intersections.get(key);
          if (cached !== undefined) return cached;
          const t = (level - q[a]) / (q[b] - q[a]),
            v = material.length / 3;
          for (let k = 0; k < 3; k++)
            material.push(
              material[a * 3 + k] * (1 - t) + material[b * 3 + k] * t,
            );
          for (const coordinates of creaseCoordinates)
            coordinates.push(coordinates[a] * (1 - t) + coordinates[b] * t);
          q[v] = level;
          intersections.set(key, v);
          return v;
        };
        const pieces: number[][] = [];
        for (const triangle of polygons) {
          if (
            !triangle.some((v) => q[v] < level - 1e-12) ||
            !triangle.some((v) => q[v] > level + 1e-12)
          ) {
            pieces.push(triangle);
            continue;
          }
          for (const side of [-1, 1]) {
            const polygon: number[] = [];
            for (let edge = 0; edge < triangle.length; edge++) {
              const a = triangle[edge],
                b = triangle[(edge + 1) % triangle.length],
                da = q[a] - level,
                db = q[b] - level;
              if (side * da >= -1e-12) polygon.push(a);
              if ((da < -1e-12 && db > 1e-12) || (da > 1e-12 && db < -1e-12))
                polygon.push(splitEdge(a, b));
            }
            pieces.push(polygon);
          }
        }
        polygons = pieces;
      }
      this.indices = [];
      for (const polygon of polygons)
        for (let j = 1; j + 1 < polygon.length; j++)
          this.indices.push(polygon[0], polygon[j], polygon[j + 1]);
    }
    // Guides use welded mesh edges, including subdivisions by later folds.
    const seen = new Set<string>();
    for (let i = 0; i < this.indices.length; i += 3)
      for (let edge = 0; edge < 3; edge++) {
        const a = this.indices[i + edge],
          b = this.indices[i + ((edge + 1) % 3)],
          key = `${Math.min(a, b)}:${Math.max(a, b)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (
          creaseCoordinates.some(
            (q) => Math.abs(q[a]) < 1e-11 && Math.abs(q[b]) < 1e-11,
          )
        )
          this.guideWeights.push({ a, b: a, t: 0 }, { a: b, b, t: 0 });
      }
    sync();
    this._progress = progress;
    this.revision++;
    this.setProgress(progress);
  }
  private evaluateImperfect() {
    for (let i = 2; i < this.normals.length; i += 3) this.normals[i] = 1;
    const folds = this.imperfectFolds();
    folds.forEach((f, step) => {
      const angle = smooth(this.progress * folds.length - step) * Math.PI;
      if (angle === 0) return;
      for (let i = 0; i < this.positions.length; i += 3) {
        const dx = this.positions[i] - f.cx,
          dy = this.positions[i + 1] - f.cy;
        const q = dx * f.nx + dy * f.ny;
        if (q <= 0) continue;
        const u = -dx * f.ny + dy * f.nx,
          z = this.positions[i + 2] * f.direction;
        const radius = f.radius - z,
          phi = Math.min(q / f.radius, angle),
          tail = Math.max(0, q - f.radius * angle);
        const sin = Math.sin(phi),
          cos = Math.cos(phi),
          bent = radius * sin + tail * Math.cos(angle);
        this.positions[i] = f.cx + bent * f.nx - u * f.ny;
        this.positions[i + 1] = f.cy + bent * f.ny + u * f.nx;
        this.positions[i + 2] =
          f.direction * (f.radius - radius * cos + tail * Math.sin(angle));
        const nq =
          (this.normals[i] * f.nx + this.normals[i + 1] * f.ny) *
          (q < f.radius * angle ? f.radius / radius : 1);
        const nu = -this.normals[i] * f.ny + this.normals[i + 1] * f.nx,
          nz = this.normals[i + 2] * f.direction;
        const rotated = nq * cos - nz * sin;
        this.normals[i] = rotated * f.nx - nu * f.ny;
        this.normals[i + 1] = rotated * f.ny + nu * f.nx;
        this.normals[i + 2] = f.direction * (nq * sin + nz * cos);
        const length = Math.hypot(
          this.normals[i],
          this.normals[i + 1],
          this.normals[i + 2],
        );
        for (let k = 0; k < 3; k++) this.normals[i + k] /= length;
      }
    });
    this.creaseSegments = new Float64Array(this.guideWeights.length * 3);
    this.creaseSegmentNormals = new Float64Array(this.guideWeights.length * 3);
    this.guideWeights.forEach(({ a, b, t }, v) => {
      for (let k = 0; k < 3; k++) {
        this.creaseSegments[v * 3 + k] =
          this.positions[a * 3 + k] * (1 - t) + this.positions[b * 3 + k] * t;
        this.creaseSegmentNormals[v * 3 + k] =
          this.normals[a * 3 + k] * (1 - t) + this.normals[b * 3 + k] * t;
      }
      const length = Math.hypot(
        ...this.creaseSegmentNormals.subarray(v * 3, v * 3 + 3),
      );
      if (length > 0)
        for (let k = 0; k < 3; k++)
          this.creaseSegmentNormals[v * 3 + k] /= length;
    });
  }
  seek(value: number) {
    this.setProgress(value);
  }
}

export function createPaper(options: PaperOptions = {}) {
  return new LetterPaper(options);
}
