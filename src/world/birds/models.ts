import * as THREE from 'three';
import type { Rig } from './material';

type C = THREE.ColorRepresentation;
type V = [number, number, number];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

/** Accumulates low-poly primitives into one non-indexed geometry with colour and rig attributes. */
class Builder {
  private pos: number[] = [];
  private nor: number[] = [];
  private col: number[] = [];
  private part: number[] = [];
  private side: number[] = [];

  add(src: THREE.BufferGeometry, color: C, part = 0, side = 0, m?: THREE.Matrix4) {
    const g = src.index ? src.toNonIndexed() : src;
    if (m) g.applyMatrix4(m);
    if (!g.getAttribute('normal')) g.computeVertexNormals();
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      this.pos.push(p.getX(i), p.getY(i), p.getZ(i));
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(_c.r, _c.g, _c.b);
      this.part.push(part);
      this.side.push(side);
    }
    src.dispose();
    if (g !== src) g.dispose();
  }

  ellipsoid(c: V, r: V, color: C, part = 0, rotZ = 0, seg: [number, number] = [10, 7]) {
    _m.compose(_v.set(...c), _q.setFromAxisAngle(_s.set(0, 0, 1), rotZ), _s.set(...r));
    this.add(new THREE.SphereGeometry(1, seg[0], seg[1]), color, part, 0, _m);
  }

  /** Mirrored pair (z and -z) of ellipsoids. */
  ellipsoidPair(c: V, r: V, color: C, part = 0, rotZ = 0) {
    this.ellipsoid(c, r, color, part, rotZ);
    this.ellipsoid([c[0], c[1], -c[2]], r, color, part, rotZ);
  }

  tube(a: V, b: V, ra: number, rb: number, color: C, part = 0, radial = 6) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const d = B.clone().sub(A);
    const len = d.length();
    _m.compose(A.add(B).multiplyScalar(0.5), _q.setFromUnitVectors(UP, d.normalize()), _s.set(1, 1, 1));
    this.add(new THREE.CylinderGeometry(rb, ra, len, radial, 1), color, part, 0, _m);
  }

  /** Flat polygon (fan from the first point), emitted as a thin double layer so it lights from both sides. */
  poly(pts: V[], color: C, part = 0, side = 0, under?: C) {
    const pos: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) pos.push(...pts[0], ...pts[i], ...pts[i + 1]);
    const top = new THREE.BufferGeometry();
    top.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    top.computeVertexNormals();
    const nUp = top.getAttribute('normal').getY(0) >= 0;
    if (!nUp) flip(top);
    this.add(top, color, part, side);
    const bot = new THREE.BufferGeometry();
    const p2 = pos.slice();
    for (let i = 1; i < p2.length; i += 3) p2[i] -= 0.002;
    bot.setAttribute('position', new THREE.Float32BufferAttribute(p2, 3));
    bot.computeVertexNormals();
    if (bot.getAttribute('normal').getY(0) > 0) flip(bot);
    this.add(bot, under ?? color, part, side);
  }

  /**
   * Wing planform as strips between spanwise stations. Each strip is split chordwise into a
   * covert band (front) and a flight-feather band (rear) so patterns like black tips stay crisp.
   */
  wing(w: WingSpec) {
    for (const sd of [1, -1]) {
      const st = w.st;
      const yAt = (u: number) => w.y + w.dihedral * (u - st[0].u);
      const tAt = (u: number) => w.thick * Math.max(0.15, 1 - (u - st[0].u) / (st[st.length - 1].u - st[0].u));
      for (let i = 0; i < st.length - 1; i++) {
        const a = st[i];
        const b = st[i + 1];
        const part = a.u >= w.wrist - 1e-6 ? 2 : 1;
        const ma = a.le + (a.te - a.le) * w.split;
        const mb = b.le + (b.te - b.le) * w.split;
        const c = w.colors[i];
        const ya = yAt(a.u);
        const yb = yAt(b.u);
        const ha = tAt(a.u) * 0.5;
        const hb = tAt(b.u) * 0.5;
        // top surface rises toward the leading edge (cambered); bottom is flat
        this.quad([a.le, ya + ha * 0.6, a.u], [ma, ya + ha, a.u], [mb, yb + hb, b.u], [b.le, yb + hb * 0.6, b.u], c[0], part, sd, true);
        this.quad([ma, ya + ha, a.u], [a.te, ya, a.u], [b.te, yb, b.u], [mb, yb + hb, b.u], c[1], part, sd, true);
        this.quad([a.le, ya - ha * 0.2, a.u], [ma, ya - ha * 0.4, a.u], [mb, yb - hb * 0.4, b.u], [b.le, yb - hb * 0.2, b.u], c[2], part, sd, false);
        this.quad([ma, ya - ha * 0.4, a.u], [a.te, ya - 0.002, a.u], [b.te, yb - 0.002, b.u], [mb, yb - hb * 0.4, b.u], c[3], part, sd, false);
      }
      if (w.fingers) {
        const t = st[st.length - 1];
        const y = yAt(t.u);
        const c = w.colors[w.colors.length - 1];
        const n = w.fingers.n;
        for (let j = 0; j < n; j++) {
          const f0 = j / n;
          const f1 = (j + 0.7) / n;
          const x0 = t.le + (t.te - t.le) * f0;
          const x1 = t.le + (t.te - t.le) * f1;
          const len = w.fingers.len * (1 - 0.35 * Math.abs(j - (n - 1) * 0.35) / n);
          const tip: V = [(x0 + x1) / 2 - len * (0.25 + 0.5 * f0), y - len * 0.08, t.u + len];
          this.triZ([x0, y, t.u], [x1, y, t.u], tip, c[1], c[3], sd);
        }
      }
    }
  }

  private quad(a: V, b: V, c: V, d: V, color: C, part: number, sd: number, up: boolean) {
    const m = (p: V): V => [p[0], p[1], p[2] * sd];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...m(a), ...m(b), ...m(c), ...m(a), ...m(c), ...m(d)], 3));
    g.computeVertexNormals();
    if (g.getAttribute('normal').getY(0) > 0 !== up) flip(g);
    this.add(g, color, part, sd);
  }

  private triZ(a: V, b: V, c: V, top: C, bot: C, sd: number) {
    const m = (p: V, dy = 0): V => [p[0], p[1] + dy, p[2] * sd];
    for (const [col, dy, up] of [
      [top, 0.002, true],
      [bot, 0, false],
    ] as [C, number, boolean][]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([...m(a, dy), ...m(b, dy), ...m(c, dy)], 3));
      g.computeVertexNormals();
      if (g.getAttribute('normal').getY(0) > 0 !== up) flip(g);
      this.add(g, col, 2, sd);
    }
  }

  build(scale = 1) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos.map((v) => v * scale), 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('aPart', new THREE.Float32BufferAttribute(this.part, 1));
    g.setAttribute('aSide', new THREE.Float32BufferAttribute(this.side, 1));
    g.computeBoundingSphere();
    return g;
  }
}

function flip(g: THREE.BufferGeometry) {
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  g.computeVertexNormals();
}

interface Station {
  u: number;
  le: number;
  te: number;
}
interface WingSpec {
  y: number;
  dihedral: number;
  thick: number;
  wrist: number;
  split: number;
  st: Station[];
  /** per strip: [top covert, top flight feathers, under covert, under flight feathers] */
  colors: [C, C, C, C][];
  fingers?: { n: number; len: number };
}

export interface Model {
  geo: THREE.BufferGeometry;
  rig: Rig;
  /** hip height above the feet when the legs hang straight down (m) */
  legLen: number;
}

const rig = (sx: number, sy: number, sz: number, wrist: number, hip: [number, number], neck: [number, number], s = 1): Rig => ({
  shoulder: new THREE.Vector3(sx * s, sy * s, sz * s),
  wrist: wrist * s,
  hip: new THREE.Vector2(hip[0] * s, hip[1] * s),
  neck: new THREE.Vector2(neck[0] * s, neck[1] * s),
});

function feet(b: Builder, x: number, y: number, z: number, len: number, color: C, part: number) {
  for (const s of [1, -1]) b.poly([[x - 0.01, y, s * z], [x + len, y - 0.004, s * (z + len * 0.45)], [x + len * 1.1, y - 0.004, s * z], [x + len, y - 0.004, s * Math.max(0.001, z - len * 0.45)]], color, part);
}

/** Brown pelican, Pacific adult in non-breeding plumage: white neck, pale-yellow crown, silvery upperwing coverts. Span 2.0 m. */
export function pelican(): Model {
  const b = new Builder();
  b.ellipsoid([0, -0.01, 0], [0.33, 0.115, 0.135], '#4f4740');
  b.ellipsoid([-0.02, 0.025, 0], [0.29, 0.095, 0.125], '#9c978d');
  b.tube([-0.28, 0.0, 0], [-0.44, 0.015, 0], 0.07, 0.02, '#575049');
  b.poly([[-0.3, 0.03, 0.06], [-0.46, 0.03, 0.08], [-0.46, 0.03, -0.08], [-0.3, 0.03, -0.06]], '#544c45');
  b.tube([0.22, 0.03, 0], [0.36, 0.12, 0], 0.06, 0.045, '#eeeae1', 4);
  b.ellipsoid([0.4, 0.145, 0], [0.072, 0.055, 0.05], '#efe2ad', 4);
  b.ellipsoid([0.6, 0.12, 0], [0.205, 0.017, 0.032], '#c3a986', 4, -0.12);
  b.ellipsoid([0.57, 0.088, 0], [0.18, 0.03, 0.026], '#6a5244', 4, -0.12);
  b.ellipsoid([0.795, 0.093, 0], [0.018, 0.014, 0.014], '#d0764c', 4);
  b.ellipsoidPair([0.42, 0.16, 0.042], [0.009, 0.009, 0.006], '#e8e3d8', 4);
  for (const s of [1, -1]) b.tube([-0.05, -0.08, s * 0.05], [-0.05, -0.2, s * 0.05], 0.022, 0.016, '#3b3833', 3);
  feet(b, -0.05, -0.2, 0.05, 0.1, '#33302c', 3);
  b.wing({
    y: 0.05, dihedral: 0.0, thick: 0.035, wrist: 0.5, split: 0.48,
    st: [{ u: 0.11, le: 0.22, te: -0.17 }, { u: 0.3, le: 0.23, te: -0.18 }, { u: 0.5, le: 0.21, te: -0.15 }, { u: 0.72, le: 0.15, te: -0.09 }, { u: 0.9, le: 0.08, te: -0.03 }],
    colors: [
      ['#a9a499', '#3d342d', '#5b524a', '#3e362f'],
      ['#a49f94', '#3a322b', '#5b524a', '#3e362f'],
      ['#3f3730', '#2b241f', '#433a33', '#2f2823'],
      ['#2f2823', '#26201b', '#3b332d', '#2a241f'],
    ],
    fingers: { n: 5, len: 0.1 },
  });
  return { geo: b.build(), rig: rig(0.1, 0.05, 0.11, 0.5, [-0.05, -0.08], [0.22, 0.03]), legLen: 0.135 };
}

/** Western gull (dark slate mantle, pink legs) or California gull (mid-grey, yellow-green legs). Span 1.4 m / 1.3 m. */
export function gull(kind: 'western' | 'california'): Model {
  const mantle = kind === 'western' ? '#565a60' : '#949ca4';
  const legs = kind === 'western' ? '#e1a99f' : '#cfc95e';
  const s = kind === 'western' ? 1 : 0.93;
  const b = new Builder();
  b.ellipsoid([0, 0, 0], [0.19, 0.075, 0.08], '#f4f4f1');
  b.ellipsoid([-0.03, 0.028, 0], [0.155, 0.052, 0.074], mantle);
  b.poly([[-0.16, 0.012, 0.04], [-0.3, 0.012, 0.055], [-0.3, 0.012, -0.055], [-0.16, 0.012, -0.04]], '#f3f3f0');
  b.tube([0.13, 0.015, 0], [0.2, 0.045, 0], 0.05, 0.042, '#f4f4f1', 4);
  b.ellipsoid([0.225, 0.055, 0], [0.056, 0.048, 0.043], '#f6f6f3', 4);
  b.ellipsoid([0.3, 0.046, 0], [0.036, 0.011, 0.009], '#e8c23c', 4, -0.08);
  b.ellipsoid([0.315, 0.035, 0], [0.008, 0.006, 0.008], '#cf3a2a', 4);
  b.ellipsoidPair([0.245, 0.07, 0.034], [0.007, 0.007, 0.005], '#2a2520', 4);
  for (const z of [1, -1]) b.tube([-0.01, -0.05, z * 0.03], [-0.01, -0.17, z * 0.03], 0.009, 0.007, legs, 3, 5);
  feet(b, -0.01, -0.17, 0.03, 0.055, legs, 3);
  const k = '#18181a';
  b.wing({
    y: 0.03, dihedral: 0.02, thick: 0.025, wrist: 0.32, split: 0.78,
    st: [{ u: 0.065, le: 0.1, te: -0.1 }, { u: 0.2, le: 0.11, te: -0.09 }, { u: 0.32, le: 0.11, te: -0.075 }, { u: 0.45, le: 0.08, te: -0.06 }, { u: 0.57, le: 0.035, te: -0.07 }, { u: 0.7, le: -0.05, te: -0.09 }],
    colors: [
      [mantle, '#f2f2ee', '#f7f7f4', kind === 'western' ? '#8c8f93' : '#d9dbdc'],
      [mantle, '#f2f2ee', '#f7f7f4', kind === 'western' ? '#8c8f93' : '#d9dbdc'],
      [mantle, mantle, '#f4f4f1', kind === 'western' ? '#7a7d82' : '#cfd2d4'],
      [mantle, k, '#e6e7e6', '#3a3a3c'],
      [k, k, '#2d2d2f', '#2d2d2f'],
    ],
  });
  return { geo: b.build(s), rig: rig(0.06, 0.03, 0.065, 0.32, [-0.01, -0.05], [0.13, 0.015], s), legLen: 0.125 * s };
}

/** Forster's tern, breeding: black cap, black-tipped orange bill, frosty pale primaries, deeply forked tail. Span 0.8 m. */
export function tern(): Model {
  const b = new Builder();
  b.ellipsoid([0, 0, 0], [0.1, 0.034, 0.037], '#f6f6f4');
  b.ellipsoid([-0.012, 0.014, 0], [0.08, 0.024, 0.034], '#c9ced2');
  b.poly([[-0.08, 0.004, 0.022], [-0.27, 0.004, 0.06], [-0.14, 0.004, 0], [-0.27, 0.004, -0.06], [-0.08, 0.004, -0.022]], '#eef0f1');
  b.ellipsoid([0.115, 0.02, 0], [0.032, 0.027, 0.025], '#f6f6f4', 4);
  b.ellipsoid([0.11, 0.032, 0], [0.034, 0.019, 0.026], '#141414', 4);
  b.tube([0.14, 0.018, 0], [0.188, 0.014, 0], 0.0065, 0.004, '#e0582c', 4, 5);
  b.tube([0.188, 0.014, 0], [0.205, 0.012, 0], 0.004, 0.001, '#1a1a1a', 4, 5);
  for (const z of [1, -1]) b.tube([0, -0.028, z * 0.015], [0, -0.055, z * 0.015], 0.004, 0.004, '#d9502e', 3, 4);
  b.wing({
    y: 0.014, dihedral: 0.03, thick: 0.012, wrist: 0.17, split: 0.7,
    st: [{ u: 0.035, le: 0.06, te: -0.05 }, { u: 0.17, le: 0.07, te: -0.035 }, { u: 0.29, le: 0.035, te: -0.035 }, { u: 0.4, le: -0.05, te: -0.065 }],
    colors: [
      ['#c8cdd1', '#d3d7da', '#f7f7f5', '#eeeeec'],
      ['#e2e5e7', '#e8eaec', '#f4f4f2', '#e3e4e4'],
      ['#e6e8ea', '#9aa0a5', '#efefed', '#a8acaf'],
    ],
  });
  return { geo: b.build(), rig: rig(0.03, 0.014, 0.035, 0.17, [0, -0.028], [0.1, 0.012]), legLen: 0.03 };
}

/** Double-crested cormorant: black with a bronze-scaled back and orange facial skin; kinked neck in flight. Span 1.2 m. */
export function cormorant(): Model {
  const b = new Builder();
  b.ellipsoid([0, 0, 0], [0.27, 0.085, 0.09], '#1c1c1b');
  b.ellipsoid([-0.03, 0.03, 0], [0.21, 0.058, 0.08], '#2e2a23');
  b.poly([[-0.24, 0.01, 0.035], [-0.47, 0.01, 0.06], [-0.47, 0.01, -0.06], [-0.24, 0.01, -0.035]], '#151515');
  b.tube([0.2, 0.015, 0], [0.31, 0.03, 0], 0.05, 0.04, '#1c1c1b', 4);
  b.tube([0.31, 0.03, 0], [0.41, 0.06, 0], 0.04, 0.034, '#1c1c1b', 4);
  b.ellipsoid([0.445, 0.065, 0], [0.047, 0.035, 0.031], '#1d1d1c', 4);
  b.ellipsoid([0.465, 0.045, 0], [0.033, 0.02, 0.026], '#e08a2a', 4);
  b.tube([0.48, 0.062, 0], [0.555, 0.055, 0], 0.011, 0.005, '#4a4440', 4, 5);
  b.ellipsoid([0.556, 0.05, 0], [0.008, 0.008, 0.006], '#4a4440', 4);
  b.ellipsoidPair([0.452, 0.075, 0.028], [0.007, 0.007, 0.005], '#2e8a6a', 4);
  for (const z of [1, -1]) b.tube([-0.08, -0.06, z * 0.04], [-0.08, -0.17, z * 0.04], 0.014, 0.01, '#141414', 3, 5);
  feet(b, -0.08, -0.17, 0.04, 0.1, '#141414', 3);
  b.wing({
    y: 0.03, dihedral: 0.0, thick: 0.025, wrist: 0.28, split: 0.45,
    st: [{ u: 0.075, le: 0.12, te: -0.11 }, { u: 0.28, le: 0.13, te: -0.085 }, { u: 0.45, le: 0.09, te: -0.05 }, { u: 0.55, le: 0.035, te: -0.01 }],
    colors: [
      ['#3b352b', '#151515', '#262626', '#1c1c1c'],
      ['#1a1a1a', '#121212', '#242424', '#1a1a1a'],
      ['#151515', '#121212', '#202020', '#181818'],
    ],
    fingers: { n: 4, len: 0.06 },
  });
  return { geo: b.build(), rig: rig(0.06, 0.03, 0.075, 0.28, [-0.08, -0.06], [0.2, 0.015]), legLen: 0.12 };
}

export interface HeronColors {
  body: C;
  back: C;
  flight: C;
  neck: C;
  head: C;
  crown: C | null;
  bill: C;
  legs: C;
  feet: C;
  under: C;
  lores: C | null;
}

export const HERON_COLORS: Record<'heron' | 'egret' | 'snowy', HeronColors> = {
  heron: { body: '#66737f', back: '#73808d', flight: '#2d3239', neck: '#8f99a3', head: '#efefe9', crown: '#1c1c1e', bill: '#d1a33c', legs: '#4b4239', feet: '#4b4239', under: '#5b6672', lores: null },
  egret: { body: '#f4f4f0', back: '#f7f7f3', flight: '#eeeeea', neck: '#f6f6f2', head: '#f7f7f3', crown: null, bill: '#e6b52a', legs: '#1b1b1b', feet: '#1b1b1b', under: '#e9e9e5', lores: '#a7b84a' },
  snowy: { body: '#f6f6f2', back: '#f8f8f4', flight: '#efefeb', neck: '#f7f7f3', head: '#f8f8f4', crown: null, bill: '#1b1b1b', legs: '#1d1d1d', feet: '#e8c534', under: '#ebebe7', lores: '#e9c93a' },
};

/** Heron/egret in flight: neck folded back into an S, legs trailing straight behind, broad fingered wings. Span 1.8 m at scale 1. */
export function heronFly(c: HeronColors, s: number): Model {
  const b = new Builder();
  b.ellipsoid([0, 0, 0], [0.25, 0.095, 0.1], c.body);
  b.ellipsoid([-0.02, 0.03, 0], [0.2, 0.06, 0.09], c.back);
  b.ellipsoid([0.19, -0.035, 0], [0.09, 0.07, 0.06], c.neck, 4);
  b.ellipsoid([0.27, 0.06, 0], [0.06, 0.04, 0.038], c.head, 4);
  if (c.crown) b.ellipsoid([0.255, 0.085, 0], [0.05, 0.015, 0.034], c.crown, 4);
  b.tube([0.31, 0.058, 0], [0.47, 0.048, 0], 0.016, 0.002, c.bill, 4, 5);
  b.poly([[-0.22, 0.01, 0.04], [-0.33, 0.01, 0.05], [-0.33, 0.01, -0.05], [-0.22, 0.01, -0.04]], c.back);
  for (const z of [1, -1]) {
    b.tube([-0.12, -0.06, z * 0.03], [-0.38, -0.05, z * 0.03], 0.022, 0.013, c.legs, 0, 5);
    b.tube([-0.38, -0.05, z * 0.03], [-0.68, -0.04, z * 0.025], 0.012, 0.01, c.legs, 0, 5);
    b.tube([-0.68, -0.04, z * 0.025], [-0.77, -0.04, z * 0.025], 0.01, 0.004, c.feet, 0, 4);
  }
  b.wing({
    y: 0.04, dihedral: 0, thick: 0.03, wrist: 0.42, split: 0.5,
    st: [{ u: 0.09, le: 0.18, te: -0.18 }, { u: 0.25, le: 0.19, te: -0.185 }, { u: 0.42, le: 0.18, te: -0.165 }, { u: 0.62, le: 0.14, te: -0.12 }, { u: 0.8, le: 0.08, te: -0.05 }],
    colors: [
      [c.back, c.flight, c.under, c.under],
      [c.back, c.flight, c.under, c.under],
      [c.flight, c.flight, c.under, c.flight],
      [c.flight, c.flight, c.flight, c.flight],
    ],
    fingers: { n: 5, len: 0.1 },
  });
  return { geo: b.build(s), rig: rig(0.08, 0.04, 0.09, 0.42, [-0.12, -0.06], [0.14, -0.02], s), legLen: 0 };
}

/** Heron/egret standing in the hunched-forward foraging posture; origin at the feet. About 1.15 m tall at scale 1. */
export function heronStand(c: HeronColors, s: number, slender = 0): Model {
  const b = new Builder();
  b.ellipsoid([0, 0.73, 0], [0.24, 0.105 - slender * 0.01, 0.105], c.body, 0, 0.42);
  b.ellipsoid([-0.03, 0.75, 0], [0.25, 0.095, 0.115], c.back, 0, 0.38);
  b.ellipsoid([-0.2, 0.66, 0], [0.13, 0.045, 0.09], c.flight, 0, 0.3);
  b.ellipsoid([0.13, 0.72, 0], [0.06, 0.085, 0.06], c.under, 0, 0.2);
  b.ellipsoidPair([0.015, 0.62, 0.042], [0.022, 0.05, 0.02], c === HERON_COLORS.heron ? '#8a6248' : c.body);
  const n = (y: number) => y + slender * (y - 0.82) * 0.25;
  b.tube([0.17, 0.8, 0], [0.25, n(1.0), 0], 0.05, 0.034, c.neck, 4);
  b.tube([0.25, n(1.0), 0], [0.19, n(1.085), 0], 0.034, 0.032, c.neck, 4);
  b.tube([0.19, n(1.085), 0], [0.22, n(1.15), 0], 0.032, 0.032, c.neck, 4);
  b.ellipsoid([0.25, n(1.17), 0], [0.058, 0.04, 0.034], c.head, 4);
  if (c.crown) {
    b.ellipsoid([0.235, n(1.195), 0], [0.05, 0.014, 0.036], c.crown, 4);
    b.tube([0.2, n(1.19), 0], [0.07, n(1.165), 0], 0.007, 0.002, c.crown, 4, 4);
  }
  if (c.lores) b.ellipsoidPair([0.29, n(1.172), 0.018], [0.02, 0.012, 0.012], c.lores, 4);
  b.ellipsoidPair([0.27, n(1.18), 0.03], [0.007, 0.007, 0.005], '#e8c234', 4);
  b.tube([0.29, n(1.165), 0], [0.45, n(1.135), 0], 0.017, 0.002, c.bill, 4, 5);
  for (const z of [1, -1]) {
    b.tube([0.01, 0.62, z * 0.045], [0.04, 0.31, z * 0.045], 0.016, 0.012, c.legs, 0, 5);
    b.tube([0.04, 0.31, z * 0.045], [0.0, 0.01, z * 0.045], 0.012, 0.011, c.legs, 0, 5);
    for (const a of [-0.45, 0, 0.45]) b.tube([0, 0.008, z * 0.045], [0.1 * Math.cos(a), 0.004, z * 0.045 + 0.1 * Math.sin(a)], 0.006, 0.004, c.feet, 0, 4);
    b.tube([0, 0.008, z * 0.045], [-0.06, 0.004, z * 0.045], 0.006, 0.004, c.feet, 0, 4);
  }
  return { geo: b.build(s), rig: rig(0, 0, 0, 0, [0, 0], [0.17, 0.8], s), legLen: 0 };
}

/** Willet: plain grey-brown at rest; in flight a bold white stripe across black flight feathers. Span 0.7 m. */
export function willet(): Model {
  const b = new Builder();
  b.ellipsoid([0, 0, 0], [0.11, 0.05, 0.05], '#9b9385');
  b.ellipsoid([0.01, -0.016, 0], [0.1, 0.037, 0.046], '#ebe8e0');
  b.poly([[-0.09, 0.008, 0.025], [-0.16, 0.008, 0.035], [-0.16, 0.008, -0.035], [-0.09, 0.008, -0.025]], '#f0efe9');
  b.ellipsoid([0.115, 0.03, 0], [0.034, 0.03, 0.028], '#a39b8d', 4);
  b.tube([0.145, 0.026, 0], [0.215, 0.02, 0], 0.0065, 0.0025, '#3b3b3a', 4, 5);
  b.ellipsoidPair([0.125, 0.04, 0.024], [0.006, 0.006, 0.004], '#1d1b19', 4);
  for (const z of [1, -1]) b.tube([0, -0.035, z * 0.018], [0, -0.17, z * 0.018], 0.0055, 0.0045, '#8a949c', 3, 4);
  feet(b, 0, -0.17, 0.018, 0.035, '#8a949c', 3);
  b.wing({
    y: 0.015, dihedral: 0.02, thick: 0.012, wrist: 0.16, split: 0.45,
    st: [{ u: 0.04, le: 0.05, te: -0.05 }, { u: 0.16, le: 0.055, te: -0.04 }, { u: 0.26, le: 0.035, te: -0.035 }, { u: 0.35, le: -0.03, te: -0.05 }],
    colors: [
      ['#8d8577', '#f2f1ec', '#1f1f1f', '#f0efea'],
      ['#1d1d1d', '#f2f1ec', '#1f1f1f', '#f0efea'],
      ['#1b1b1b', '#1b1b1b', '#262626', '#2a2a2a'],
    ],
  });
  return { geo: b.build(), rig: rig(0.03, 0.015, 0.04, 0.16, [0, -0.035], [0.1, 0.02]), legLen: 0.14 };
}

/** Weathered timber piling stubs, one merged geometry. */
export function pilingGeometry(spots: { x: number; z: number; top: number; r: number; lean: number }[]) {
  const b = new Builder();
  for (const p of spots) {
    const len = p.top + 4;
    const tx = p.x + Math.sin(p.lean) * 0.3;
    b.tube([p.x, p.top - len, p.z], [tx, p.top, p.z], p.r * 1.05, p.r, '#5e554b', 0, 9);
    b.ellipsoid([tx, p.top, p.z], [p.r * 0.98, 0.015, p.r * 0.98], '#8a8174', 0, 0, [9, 3]);
  }
  return b.build();
}
