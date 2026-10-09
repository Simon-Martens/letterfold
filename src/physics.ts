/** A small, guided XPBD paper model. Coordinates are metres; time is seconds. */
export type Pattern = "letter" | "half" | "accordion";
type Edge = { a: number; b: number; length: number; lambda: number };
type Hinge = {
  ids: [number, number, number, number];
  target: number;
  lambda: number;
};
const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const wrap = (x: number) => Math.atan2(Math.sin(x), Math.cos(x));

/** Signed angle between the two faces sharing a directed edge. */
export function dihedral(p: Float64Array, ids: readonly number[]): number {
  const [a, b, c, d] = ids.map((i) => i * 3);
  const ex = p[b] - p[a],
    ey = p[b + 1] - p[a + 1],
    ez = p[b + 2] - p[a + 2];
  const cx = p[c] - p[a],
    cy = p[c + 1] - p[a + 1],
    cz = p[c + 2] - p[a + 2];
  const dx = p[d] - p[a],
    dy = p[d + 1] - p[a + 1],
    dz = p[d + 2] - p[a + 2];
  const ux = ey * cz - ez * cy,
    uy = ez * cx - ex * cz,
    uz = ex * cy - ey * cx;
  const vx = dy * ez - dz * ey,
    vy = dz * ex - dx * ez,
    vz = dx * ey - dy * ex;
  const el = Math.hypot(ex, ey, ez);
  return Math.atan2(
    ((uy * vz - uz * vy) * ex +
      (uz * vx - ux * vz) * ey +
      (ux * vy - uy * vx) * ez) /
      Math.max(el, 1e-12),
    ux * vx + uy * vy + uz * vz,
  );
}

export class PaperSimulation {
  readonly width = 0.21;
  readonly height = 0.297;
  readonly nx = 12;
  readonly ny = 18;
  readonly count = (this.nx + 1) * (this.ny + 1);
  readonly positions = new Float64Array(this.count * 3);
  readonly rest = new Float64Array(this.count * 3);
  readonly target = new Float64Array(this.count * 3);
  readonly velocities = new Float64Array(this.count * 3);
  readonly indices: number[] = [];
  readonly edges: Edge[] = [];
  readonly hinges: Hinge[] = [];
  readonly pinned = new Uint8Array(this.count);
  private previous = new Float64Array(this.count * 3);
  private gradient = new Float64Array(12);
  pattern: Pattern = "letter";
  progress = 0;
  stiffness = 0.75;
  gravity = 0;
  readonly maxAngle = (170 * Math.PI) / 180;

  constructor(pattern: Pattern = "letter") {
    for (let y = 0; y <= this.ny; y++)
      for (let x = 0; x <= this.nx; x++) {
        const i = (y * (this.nx + 1) + x) * 3;
        this.rest[i] = (x / this.nx - 0.5) * this.width;
        this.rest[i + 1] = (y / this.ny - 0.5) * this.height;
      }
    const adjacency = new Map<string, { a: number; b: number; c: number }>();
    const triangle = (a: number, b: number, c: number) => {
      this.indices.push(a, b, c);
      for (const [u, v, opposite] of [
        [a, b, c],
        [b, c, a],
        [c, a, b],
      ]) {
        const key = `${Math.min(u, v)}:${Math.max(u, v)}`;
        const other = adjacency.get(key);
        if (other)
          this.hinges.push({
            ids: [other.a, other.b, other.c, opposite],
            target: 0,
            lambda: 0,
          });
        else {
          adjacency.set(key, { a: u, b: v, c: opposite });
          this.edges.push({
            a: u,
            b: v,
            length: Math.hypot(
              this.rest[u * 3] - this.rest[v * 3],
              this.rest[u * 3 + 1] - this.rest[v * 3 + 1],
            ),
            lambda: 0,
          });
        }
      }
    };
    for (let y = 0; y < this.ny; y++)
      for (let x = 0; x < this.nx; x++) {
        const a = y * (this.nx + 1) + x,
          b = a + 1,
          c = a + this.nx + 1,
          d = c + 1;
        triangle(a, b, d);
        triangle(a, d, c);
      }
    this.reset(pattern);
  }

  reset(pattern: Pattern = this.pattern) {
    this.pattern = pattern;
    this.positions.set(this.rest);
    this.velocities.fill(0);
    this.setProgress(0);
  }

  /** Updates actuator targets. Call step() to physically relax towards them. */
  setProgress(progress: number) {
    if (!Number.isFinite(progress)) throw new Error("Progress must be finite.");
    this.progress = clamp(progress);
    this.target.set(this.rest);
    const smooth = (v: number) => {
      const t = clamp(v);
      return t * t * (3 - 2 * t);
    };
    const first =
      smooth(this.pattern === "half" ? this.progress : this.progress * 2) *
      this.maxAngle;
    const second = smooth(this.progress * 2 - 1) * this.maxAngle;
    for (let i = 0; i < this.count; i++) {
      const j = i * 3,
        y = this.rest[j + 1];
      let pivot = 0,
        angle = 0,
        moving = false;
      if (this.pattern === "half") {
        moving = y > 1e-9;
        angle = first;
      } else {
        if (y < -this.height / 6 - 1e-9) {
          pivot = -this.height / 6;
          angle = -first;
          moving = true;
        }
        if (y > this.height / 6 + 1e-9) {
          pivot = this.height / 6;
          angle = this.pattern === "accordion" ? -second : second;
          moving = true;
        }
      }
      this.pinned[i] = moving ? 0 : 1;
      if (moving) {
        this.target[j + 1] = pivot + (y - pivot) * Math.cos(angle);
        this.target[j + 2] = (y - pivot) * Math.sin(angle);
      }
    }
    for (const h of this.hinges) h.target = dihedral(this.target, h.ids);
  }

  step(dt = 1 / 60) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.05)
      throw new Error("Use a fixed timestep in (0, 0.05].");
    const p = this.positions;
    this.previous.set(p);
    for (let i = 0; i < this.count; i++)
      for (let k = 0; k < 3; k++) {
        const j = i * 3 + k;
        if (this.pinned[i]) {
          p[j] = this.target[j];
          this.velocities[j] = 0;
        } else {
          this.velocities[j] *= 0.88;
          if (k === 2) this.velocities[j] -= this.gravity * dt;
          p[j] += this.velocities[j] * dt;
        }
      }
    for (const e of this.edges) e.lambda = 0;
    for (const h of this.hinges) h.lambda = 0;
    const bendAlpha = (1e-5 + (1 - clamp(this.stiffness)) * 5e-4) / (dt * dt);
    for (let iteration = 0; iteration < 5; iteration++) {
      // Distributed fold actuators provide a stable, reversible folding path.
      // These are soft guides, not direct assignments to the rendered mesh.
      for (let i = 0; i < this.count; i++)
        if (!this.pinned[i])
          for (let k = 0; k < 3; k++) {
            const j = i * 3 + k;
            p[j] += (this.target[j] - p[j]) * 0.055;
          }
      for (const h of this.hinges) {
        const error = wrap(dihedral(p, h.ids) - h.target);
        if (Math.abs(error) < 1e-5) continue;
        let norm = 0;
        for (let v = 0; v < 4; v++)
          for (let k = 0; k < 3; k++) {
            const index = h.ids[v] * 3 + k,
              gi = v * 3 + k;
            if (this.pinned[h.ids[v]]) {
              this.gradient[gi] = 0;
              continue;
            }
            const original = p[index],
              eps = 1e-6;
            p[index] = original + eps;
            const plus = dihedral(p, h.ids);
            p[index] = original - eps;
            const minus = dihedral(p, h.ids);
            p[index] = original;
            const g = wrap(plus - minus) / (2 * eps);
            this.gradient[gi] = g;
            norm += g * g;
          }
        if (norm < 1e-12) continue;
        const dl = (-error - bendAlpha * h.lambda) / (norm + bendAlpha);
        h.lambda += dl;
        for (let v = 0; v < 4; v++)
          for (let k = 0; k < 3; k++)
            p[h.ids[v] * 3 + k] += this.gradient[v * 3 + k] * dl;
      }
      // Several stretch passes preserve the paper metric after bending.
      for (let pass = 0; pass < 3; pass++)
        for (const e of this.edges) {
          const a = e.a * 3,
            b = e.b * 3,
            wa = 1 - this.pinned[e.a],
            wb = 1 - this.pinned[e.b];
          if (wa + wb === 0) continue;
          const dx = p[b] - p[a],
            dy = p[b + 1] - p[a + 1],
            dz = p[b + 2] - p[a + 2],
            len = Math.hypot(dx, dy, dz);
          if (len < 1e-12) continue;
          const alpha = 1e-9 / (dt * dt),
            dl = (-(len - e.length) - alpha * e.lambda) / (wa + wb + alpha);
          e.lambda += dl;
          for (let k = 0; k < 3; k++) {
            const g = [dx, dy, dz][k] / len;
            p[a + k] -= wa * g * dl;
            p[b + k] += wb * g * dl;
          }
        }
    }
    for (let i = 0; i < p.length; i++)
      this.velocities[i] = (p[i] - this.previous[i]) / dt;
  }

  /** Reproducible offline evaluation from the flat sheet at 60 fixed steps/s. */
  seek(progress: number) {
    if (!Number.isFinite(progress)) throw new Error("Progress must be finite.");
    const target = clamp(progress);
    this.reset();
    const frames = Math.ceil(target * 240);
    for (let frame = 1; frame <= frames; frame++) {
      this.setProgress((target * frame) / frames);
      this.step();
    }
    for (let frame = 0; frame < 60; frame++) this.step();
  }

  get maxStrain() {
    let max = 0;
    for (const e of this.edges) {
      const a = e.a * 3,
        b = e.b * 3;
      max = Math.max(
        max,
        Math.abs(
          Math.hypot(
            this.positions[b] - this.positions[a],
            this.positions[b + 1] - this.positions[a + 1],
            this.positions[b + 2] - this.positions[a + 2],
          ) /
            e.length -
            1,
        ),
      );
    }
    return max;
  }
}
