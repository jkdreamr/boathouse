import * as THREE from 'three';

/** Bone/weight pairs: [bone, w, bone, w, ...] (up to 4 influences). */
export type W = number[];

export interface Ring {
  y: number;
  rx: number;
  rz: number;
  ox?: number;
  oz?: number;
}

export type ColorFn = (local: THREE.Vector3, y: number, ang: number) => THREE.Color;

/** Roughness FIGURE_MATERIAL is created with; the `figSurf` attribute stores offsets from it. */
export const BASE_ROUGHNESS = 0.62;

/** A vertex colour that also carries the surface response (roughness, metalness). */
export class Paint extends THREE.Color {
  rough = BASE_ROUGHNESS;
  metal = 0;
  paint(c: THREE.Color, rough: number, metal = 0) {
    this.copy(c);
    this.rough = rough;
    this.metal = metal;
    return this;
  }
}

export function paint(hex: string | THREE.Color, rough: number, metal = 0) {
  return new Paint().paint(hex instanceof THREE.Color ? hex : new THREE.Color(hex), rough, metal);
}

const _p = new THREE.Vector3();

/** Accumulates one skinned, vertex-coloured, indexed geometry built piecewise in bone-local frames. */
export class Builder {
  readonly pos: number[] = [];
  readonly col: number[] = [];
  readonly si: number[] = [];
  readonly sw: number[] = [];
  readonly idx: number[] = [];
  readonly surf: number[] = [];
  /** Surface response used for plain THREE.Color vertices. */
  rough = BASE_ROUGHNESS;
  metal = 0;
  private m = new THREE.Matrix4();
  private mirror = false;

  constructor(private readonly rest: THREE.Matrix4[]) {}

  /** Subsequent vertices are given in the rest frame of bone `b` (optionally mirrored in local z). */
  frame(b: number, mirrorZ = false) {
    this.m.copy(this.rest[b]);
    this.mirror = mirrorZ;
    return this;
  }

  vert(local: THREE.Vector3, c: THREE.Color, w: W) {
    _p.copy(local);
    if (this.mirror) _p.z = -_p.z;
    _p.applyMatrix4(this.m);
    this.pos.push(_p.x, _p.y, _p.z);
    this.col.push(c.r, c.g, c.b);
    if (c instanceof Paint) this.surf.push(c.rough - BASE_ROUGHNESS, c.metal);
    else this.surf.push(this.rough - BASE_ROUGHNESS, this.metal);
    let total = 0;
    for (let i = 1; i < w.length; i += 2) total += w[i];
    for (let k = 0; k < 4; k++) {
      const j = k * 2;
      if (j < w.length) {
        this.si.push(w[j]);
        this.sw.push(w[j + 1] / (total || 1));
      } else {
        this.si.push(0);
        this.sw.push(0);
      }
    }
    return this.pos.length / 3 - 1;
  }

  tri(a: number, b: number, c: number) {
    if (this.mirror) this.idx.push(a, c, b);
    else this.idx.push(a, b, c);
  }

  quad(a: number, b: number, c: number, d: number) {
    // a-b along the first edge, c-d the next one
    this.tri(a, c, b);
    this.tri(b, c, d);
  }

  /**
   * Superelliptic tube along local +Y. Rings must be ordered by y. Ends are closed
   * with a fan to the ring centre (callers taper the last rings for a rounded cap).
   */
  tube(rings: Ring[], seg: number, n: number, color: ColorFn, weight: (y: number, ang: number) => W, push?: (y: number, ang: number) => number) {
    const e = 2 / n;
    const v = new THREE.Vector3();
    const start = this.pos.length / 3;
    for (const r of rings) {
      for (let j = 0; j < seg; j++) {
        const ang = (j / seg) * Math.PI * 2;
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const k = push ? push(r.y, ang) : 0;
        v.set((r.ox ?? 0) + (r.rx + k) * Math.sign(c) * Math.pow(Math.abs(c), e), r.y, (r.oz ?? 0) + (r.rz + k) * Math.sign(s) * Math.pow(Math.abs(s), e));
        this.vert(v, color(v, r.y, ang), weight(r.y, ang));
      }
    }
    for (let i = 0; i < rings.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = start + i * seg + j;
        const b = start + i * seg + ((j + 1) % seg);
        // outward normals: (i,j) (i+1,j) (i,j+1)
        this.tri(a, a + seg, b);
        this.tri(b, a + seg, b + seg);
      }
    }
    const capEnd = (ri: number, flip: boolean) => {
      const r = rings[ri];
      v.set(r.ox ?? 0, r.y, r.oz ?? 0);
      const c0 = this.vert(v, color(v, r.y, 0), weight(r.y, 0));
      for (let j = 0; j < seg; j++) {
        const a = start + ri * seg + j;
        const b = start + ri * seg + ((j + 1) % seg);
        if (flip) this.tri(a, b, c0);
        else this.tri(b, a, c0);
      }
    };
    capEnd(0, true);
    capEnd(rings.length - 1, false);
  }

  /** Tube swept along a polyline (fingers, nose). `ref` sets the ring orientation. */
  sweep(
    pts: THREE.Vector3[],
    radii: number[],
    seg: number,
    ref: THREE.Vector3,
    color: THREE.Color | ((p: THREE.Vector3, i: number) => THREE.Color),
    w: W,
    flat = 1,
  ) {
    const col = (p: THREE.Vector3, i: number) => (typeof color === 'function' ? color(p, i) : color);
    const start = this.pos.length / 3;
    const t = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const bb = new THREE.Vector3();
    const v = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(b, a).normalize();
      nn.crossVectors(ref, t).normalize();
      bb.crossVectors(t, nn);
      for (let j = 0; j < seg; j++) {
        const ang = (j / seg) * Math.PI * 2;
        v.copy(pts[i])
          .addScaledVector(nn, Math.cos(ang) * radii[i])
          .addScaledVector(bb, Math.sin(ang) * radii[i] * flat);
        this.vert(v, col(v, i), w);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < seg; j++) {
        const a = start + i * seg + j;
        const b = start + i * seg + ((j + 1) % seg);
        this.tri(a, b, a + seg);
        this.tri(b, b + seg, a + seg);
      }
    }
    const cap = (i: number, flip: boolean, push: number) => {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(pts.length - 1, i + 1)];
      t.subVectors(b, a).normalize();
      v.copy(pts[i]).addScaledVector(t, push * radii[i] * 0.8);
      const c0 = this.vert(v, col(v, i), w);
      for (let j = 0; j < seg; j++) {
        const p = start + i * seg + j;
        const q = start + i * seg + ((j + 1) % seg);
        if (flip) this.tri(q, p, c0);
        else this.tri(p, q, c0);
      }
    };
    cap(0, true, -1);
    cap(pts.length - 1, false, 1);
  }

  /**
   * Lat-long surface around the local origin. shape(u, out, f) maps a unit direction to a point
   * (f = row fraction). `range` limits the polar angle per azimuth; keep(u) can drop quads.
   */
  blob(
    nLat: number,
    nLon: number,
    shape: (u: THREE.Vector3, out: THREE.Vector3, f: number) => void,
    color: (u: THREE.Vector3) => THREE.Color,
    w: W | ((u: THREE.Vector3) => W),
    range?: (ph: number) => [number, number],
    keep?: (u: THREE.Vector3) => boolean,
  ) {
    const start = this.pos.length / 3;
    const u = new THREE.Vector3();
    const v = new THREE.Vector3();
    const ok: boolean[] = [];
    let top = true;
    let bottom = true;
    for (let i = 0; i <= nLat; i++) {
      for (let j = 0; j <= nLon; j++) {
        const ph = (j / nLon) * Math.PI * 2;
        const [a, b] = range ? range(ph) : [0, Math.PI];
        if (a > 1e-6) top = false;
        if (b < Math.PI - 1e-6) bottom = false;
        const th = a + ((b - a) * i) / nLat;
        u.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        shape(u, v, i / nLat);
        ok.push(keep ? keep(u) : true);
        this.vert(v, color(u), typeof w === 'function' ? w(u) : w);
      }
    }
    const row = nLon + 1;
    for (let i = 0; i < nLat; i++) {
      for (let j = 0; j < nLon; j++) {
        const a = i * row + j;
        if (!(ok[a] && ok[a + 1] && ok[a + row] && ok[a + row + 1])) continue;
        if (!(top && i === 0)) this.tri(start + a, start + a + 1, start + a + row);
        if (!(bottom && i === nLat - 1)) this.tri(start + a + 1, start + a + row + 1, start + a + row);
      }
    }
  }

  /** Thin two-sided sheet: point(i, j, side) for an (rows+1) x (cols+1) grid. */
  sheet(rows: number, cols: number, point: (i: number, j: number, side: 0 | 1, out: THREE.Vector3) => void, c: THREE.Color, w: W) {
    const v = new THREE.Vector3();
    for (const side of [0, 1] as const) {
      const start = this.pos.length / 3;
      for (let i = 0; i <= rows; i++)
        for (let j = 0; j <= cols; j++) {
          point(i, j, side, v);
          this.vert(v, c, w);
        }
      const row = cols + 1;
      for (let i = 0; i < rows; i++)
        for (let j = 0; j < cols; j++) {
          const a = start + i * row + j;
          if (side === 0) this.quad(a, a + 1, a + row, a + row + 1);
          else this.quad(a, a + row, a + 1, a + row + 1);
        }
    }
  }

  box(cx: number, cy: number, cz: number, hx: number, hy: number, hz: number, c: THREE.Color, w: W) {
    const v = new THREE.Vector3();
    const faces: [number, number, number][] = [
      [0, 1, 2],
      [1, 2, 0],
      [2, 0, 1],
    ];
    const h = [hx, hy, hz];
    const ctr = [cx, cy, cz];
    for (const [a, b, n] of faces) {
      for (const sgn of [-1, 1]) {
        const ids: number[] = [];
        for (const [sa, sb] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          const p = [0, 0, 0];
          p[a] = ctr[a] + sa * h[a];
          p[b] = ctr[b] + sb * h[b];
          p[n] = ctr[n] + sgn * h[n];
          v.set(p[0], p[1], p[2]);
          ids.push(this.vert(v, c, w));
        }
        // axes (a, b, n) are cyclic, so a x b = n
        if (sgn > 0) this.quad(ids[0], ids[2], ids[1], ids[3]);
        else this.quad(ids[0], ids[1], ids[2], ids[3]);
      }
    }
  }

  /**
   * Parametric grid: point(i, j, out) for i in 0..rows, j in 0..cols. With wrap, column `cols`
   * reuses column 0 (closed ring). Faces wind so (d/di x d/dj) is the outward normal.
   */
  grid(
    rows: number,
    cols: number,
    wrap: boolean,
    point: (i: number, j: number, out: THREE.Vector3) => void,
    color: (i: number, j: number, p: THREE.Vector3) => THREE.Color,
    weight: (i: number, j: number, p: THREE.Vector3) => W,
  ) {
    const start = this.pos.length / 3;
    const v = new THREE.Vector3();
    const nc = wrap ? cols : cols + 1;
    for (let i = 0; i <= rows; i++)
      for (let j = 0; j < nc; j++) {
        point(i, j, v);
        this.vert(v, color(i, j, v), weight(i, j, v));
      }
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < cols; j++) {
        const a = start + i * nc + j;
        const b = start + i * nc + ((j + 1) % nc);
        this.tri(a, a + nc, b);
        this.tri(b, a + nc, b + nc);
      }
    return start;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.sw, 4));
    g.setAttribute('figSurf', new THREE.Float32BufferAttribute(this.surf, 2));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    return g;
  }
}
