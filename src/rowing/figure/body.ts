import * as THREE from 'three';
import { DARK, type Anthro } from './anthro';
import { Builder, Paint, paint, type Ring, type W } from './builder';
import { B, gripLocal, type Rig } from './rig';
import { ROWING_UNISUIT, type Outfit } from './outfit';

/** 'far' roughly halves the triangle count (traffic crews, distant figures). */
export type FigureLod = 'near' | 'far';

const lerp = THREE.MathUtils.lerp;
const clamp01 = (x: number) => THREE.MathUtils.clamp(x, 0, 1);
const ss = (e0: number, e1: number, x: number) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const G = (x: number) => Math.exp(-x * x);
const TAU = Math.PI * 2;
const dAng = (a: number, b: number) => {
  let d = (a - b) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
/** Gaussian bump around angle c (tube angle: 0 = +X, PI/2 = +Z). */
const bump = (ang: number, c: number, w: number) => G(dAng(ang, c) / w);
/** Smooth low-amplitude pattern in 0..1 for per-vertex tone variation. */
const noise = (x: number, y: number, z: number) =>
  clamp01(0.5 + 0.28 * Math.sin(x * 61.3 + Math.sin(z * 47.1) * 1.7) * Math.sin(y * 53.7 + x * 11.3) + 0.18 * Math.sin(z * 71.9 + y * 23.1));

/** Cubic Hermite (Catmull-Rom tangents) through xs (ascending) / vs. */
function curve(xs: number[], vs: number[]) {
  const n = xs.length;
  return (x: number) => {
    if (x <= xs[0]) return vs[0];
    if (x >= xs[n - 1]) return vs[n - 1];
    let k = 0;
    while (k < n - 2 && x > xs[k + 1]) k++;
    const h = xs[k + 1] - xs[k];
    const t = (x - xs[k]) / h;
    const p1 = vs[k];
    const p2 = vs[k + 1];
    const m1 = k > 0 ? ((p2 - vs[k - 1]) / (xs[k + 1] - xs[k - 1])) * h : p2 - p1;
    const m2 = k + 2 < n ? ((vs[k + 2] - p1) / (xs[k + 2] - xs[k])) * h : p2 - p1;
    const t2 = t * t;
    const t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * p1 + (t3 - 2 * t2 + t) * m1 + (-2 * t3 + 3 * t2) * p2 + (t3 - t2) * m2;
  };
}
function linear(xs: number[], vs: number[]) {
  return (x: number) => {
    if (x <= xs[0]) return vs[0];
    for (let k = 0; k < xs.length - 1; k++) if (x <= xs[k + 1]) return lerp(vs[k], vs[k + 1], (x - xs[k]) / (xs[k + 1] - xs[k]));
    return vs[vs.length - 1];
  };
}

/** Resample control rings smoothly at ~step spacing, always including the `extra` heights (hems). */
function resample(ctrl: Ring[], step: number, extra: number[] = []): Ring[] {
  const ys = ctrl.map((r) => r.y);
  const f = (k: 'rx' | 'rz' | 'ox' | 'oz') => curve(ys, ctrl.map((r) => r[k] ?? 0));
  const frx = f('rx');
  const frz = f('rz');
  const fox = f('ox');
  const foz = f('oz');
  const y0 = ys[0];
  const y1 = ys[ys.length - 1];
  const cand: number[] = [y0, y1];
  const n = Math.max(1, Math.round((y1 - y0) / step));
  for (let i = 1; i < n; i++) cand.push(y0 + ((y1 - y0) * i) / n);
  const fixed = extra.filter((y) => y > y0 && y < y1);
  const out: number[] = [];
  for (const y of [...cand].sort((p, q) => p - q)) {
    if (fixed.some((e) => Math.abs(e - y) < step * 0.3) && y !== y0 && y !== y1) continue;
    out.push(y);
  }
  out.push(...fixed);
  out.sort((p, q) => p - q);
  const dedup = out.filter((y, i) => i === 0 || y - out[i - 1] > 1e-4);
  return dedup.map((y) => ({ y, rx: Math.max(0.001, frx(y)), rz: Math.max(0.001, frz(y)), ox: fox(y), oz: foz(y) }));
}

// Surface response (absolute roughness, see FIGURE_MATERIAL).
const R_SKIN = 0.58;
const R_LIP = 0.34;
const R_HAIR = 0.6;
const ROUGH_TOP: Record<Outfit['topStyle'], number> = { unisuit: 0.4, tank: 0.48, tee: 0.84, longsleeve: 0.7, jacket: 0.46 };
const ROUGH_BOTTOM: Record<Outfit['bottomStyle'], number> = { unisuit: 0.4, shorts: 0.66, tights: 0.44, pants: 0.82 };
const THICK_TOP: Record<Outfit['topStyle'], number> = { unisuit: 0.0015, tank: 0.0025, tee: 0.006, longsleeve: 0.003, jacket: 0.011 };
const THICK_BOTTOM: Record<Outfit['bottomStyle'], number> = { unisuit: 0.0015, shorts: 0.007, tights: 0.0015, pants: 0.01 };

/** Skin tone with subtle variation, flushing and shading. */
class SkinTone {
  readonly base: THREE.Color;
  private readonly red: THREE.Color;
  private readonly deep: THREE.Color;
  private readonly palmC: THREE.Color;
  private readonly out = new Paint();
  private readonly tmp = new THREE.Color();
  constructor(hex: string) {
    this.base = new THREE.Color(hex);
    this.red = this.base.clone().multiply(new THREE.Color(1.06, 0.74, 0.7));
    this.deep = this.base.clone().multiplyScalar(0.62);
    const hsl = { h: 0, s: 0, l: 0 };
    this.base.getHSL(hsl);
    this.palmC = this.base.clone().lerp(new THREE.Color('#d6a088'), clamp01(0.75 - hsl.l * 1.2));
  }
  at(p: THREE.Vector3, red = 0, shade = 0, rough = R_SKIN, palm = 0) {
    const n = noise(p.x, p.y, p.z) - 0.5;
    this.tmp.copy(this.base).lerp(this.palmC, palm).lerp(this.red, clamp01(0.1 + red + n * 0.3)).multiplyScalar(1 + n * 0.07);
    this.tmp.lerp(this.deep, clamp01(shade));
    return this.out.paint(this.tmp, rough);
  }
}

interface Kit {
  outfit: Outfit;
  top: Paint;
  bottom: Paint;
  accent: Paint | null;
  accentB: Paint | null;
  topT: number;
  botT: number;
  /** Upper-arm sleeve end (fraction of upper arm, <0 = sleeveless) and forearm sleeve end (fraction). */
  sleeveU: number;
  sleeveF: number;
  /** Bottom coverage: thigh fraction, shin fraction (<0 = bare shin). */
  legTh: number;
  legSh: number;
}

function makeKit(o: Outfit): Kit {
  const top = paint(o.top, ROUGH_TOP[o.topStyle]);
  const bottom = paint(o.bottom, ROUGH_BOTTOM[o.bottomStyle]);
  const sleeved = o.topStyle === 'longsleeve' || o.topStyle === 'jacket';
  return {
    outfit: o,
    top,
    bottom,
    accent: o.accent ? paint(o.accent, ROUGH_TOP[o.topStyle]) : null,
    accentB: o.accent ? paint(o.accent, ROUGH_BOTTOM[o.bottomStyle]) : null,
    topT: THICK_TOP[o.topStyle],
    botT: THICK_BOTTOM[o.bottomStyle],
    sleeveU: o.topStyle === 'tee' ? 0.44 : sleeved ? 2 : -1,
    sleeveF: sleeved ? 0.95 : -1,
    legTh: o.bottomStyle === 'unisuit' ? 0.4 : o.bottomStyle === 'shorts' ? 0.5 : 2,
    legSh: o.bottomStyle === 'tights' ? 0.93 : o.bottomStyle === 'pants' ? 1.02 : -1,
  };
}

/** Garment thickness that steps at a hem (y < end is covered). */
const hemT = (y: number, end: number, t: number) => t * ss(end + 0.0025, end - 0.0025, y);

export function buildFigureGeometry(a: Anthro, rest: Rig, outfit: Outfit = ROWING_UNISUIT, lod: FigureLod = 'near'): THREE.BufferGeometry {
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < rest.p.length; i++) mats.push(new THREE.Matrix4().compose(rest.p[i], rest.q[i], new THREE.Vector3(1, 1, 1)));
  const b = new Builder(mats);
  const near = lod === 'near';
  const kit = makeKit(outfit);
  const skin = new SkinTone(a.skin);
  buildTorso(b, a, kit, skin, near);
  buildNeck(b, a, kit, skin, near);
  buildHead(b, a, skin, near);
  for (const L of [true, false]) buildArm(b, a, kit, skin, L, near);
  for (const L of [true, false]) buildLeg(b, a, kit, skin, L, near);
  if (outfit.pfd) buildPfd(b, a, new THREE.Color(outfit.pfd), near);
  return b.geometry();
}

// ---------------------------------------------------------------- torso
function buildTorso(b: Builder, a: Anthro, kit: Kit, skin: SkinTone, near: boolean) {
  const s = a.H / 1.88;
  const wS = a.girth * s;
  const T = a.trunk;
  const f = a.female ? 1 : 0;
  const o = kit.outfit;
  const style = o.topStyle;
  const rows: [number, number, number, number][] = [
    // y/T, half depth, half width, x offset
    [-0.2, 0.04, 0.07 + 0.01 * f, -0.03],
    [-0.175, 0.09, 0.14 + 0.012 * f, -0.03],
    [-0.12, 0.118, 0.172 + 0.014 * f, -0.018],
    [-0.02, 0.118, 0.17 + 0.014 * f, -0.006],
    [0.12, 0.104, 0.152 + 0.008 * f, 0],
    [0.28, 0.096, 0.14 - 0.006 * f, 0.002],
    [0.45, 0.1, 0.15 - 0.01 * f, 0.004],
    [0.6, 0.11, 0.17 - 0.014 * f, 0.008],
    [0.74, 0.116, 0.186 - 0.018 * f, 0.008],
    [0.86, 0.104, 0.196 - 0.02 * f, 0.002],
    [0.95, 0.082, 0.182 - 0.018 * f, -0.006],
    [1.01, 0.068, 0.14 - 0.014 * f, -0.012],
    [1.06, 0.062, 0.09 - 0.006 * f, -0.016],
    [1.12, 0.054, 0.058, -0.016],
    [1.16, 0.046, 0.05, -0.016],
  ];
  const ctrl: Ring[] = rows.map(([t, d, w, ox]) => ({ y: t * T, rx: d * wS, rz: w * wS, ox: ox * wS }));
  const sep = style !== 'unisuit';
  const hem = style === 'jacket' ? -0.16 : style === 'tank' ? -0.04 : -0.1;
  const extra = sep ? [hem * T - 0.003, hem * T + 0.003] : [];
  const rings = resample(ctrl, (near ? 0.065 : 0.12) * T, extra);
  const sleeveless = style === 'unisuit' || style === 'tank';
  const strap = style === 'unisuit' ? 0.56 : 0.62;
  const covered = (v: THREE.Vector3, t: number, ang: number) => {
    const az = Math.abs(v.z) / (0.19 * wS);
    const c = Math.cos(ang);
    if (t > 1.03) return false;
    if (sleeveless) {
      if (t > 0.84 && az > strap) return false;
      if (t > 0.92 && c > 0.2 && Math.abs(v.z) < 0.048 * wS * (1 + 0.3 * ss(0.92, 1.0, t))) return false;
      if (t > 0.95 && c < -0.2 && Math.abs(v.z) < 0.05 * wS) return false;
      return true;
    }
    if (t > 0.97 && c > 0.3 && Math.abs(v.z) < 0.055 * wS) return false;
    return t <= 1.0;
  };
  const zip = new Paint().paint(new THREE.Color('#18181a'), 0.35);
  b.frame(B.pelvis).tube(
    rings,
    near ? 24 : 14,
    2.4,
    (v, y, ang) => {
      const t = y / T;
      const lat = Math.abs(Math.sin(ang));
      if (sep && t < hem) {
        if (kit.accentB && (o.bottomStyle === 'shorts' || o.bottomStyle === 'tights') && lat > 0.95) return kit.accentB;
        return kit.bottom;
      }
      if (!covered(v, t, ang)) return skin.at(v, 0.05 * ss(0.95, 1.1, t), 0);
      if (style === 'jacket' && Math.cos(ang) > 0 && Math.abs(v.z) < 0.004) return zip;
      if (kit.accent && (style === 'unisuit' || style === 'tank') && lat > 0.965 && t < 0.82) return kit.accent;
      if (kit.accent && style === 'jacket' && t > 0.84 && lat > 0.8) return kit.accent;
      return kit.top;
    },
    (y, ang) => {
      const t = y / T;
      const lat = Math.abs(Math.sin(ang));
      if (t < 0) return [B.pelvis, 1];
      if (t < 0.25) return [B.pelvis, 1 - t / 0.25, B.spine, t / 0.25];
      if (t < 0.55) return [B.spine, 1 - (t - 0.25) / 0.3, B.chest, (t - 0.25) / 0.3];
      if (t < 0.85) return [B.chest, 1];
      const k = ss(0.85, 1.0, t) * ss(0.45, 0.9, lat);
      const n = ss(0.98, 1.12, t);
      const clav = Math.sin(ang) < 0 ? B.clavL : B.clavR;
      return [B.chest, Math.max(0.01, 1 - 0.5 * k - n), clav, 0.5 * k, B.neck, n];
    },
    (y, ang) => {
      const t = y / T;
      let d = 0;
      const pecs = bump(ang, 0.6, 0.45) + bump(ang, -0.6, 0.45);
      d += (1 - f) * 0.011 * G((t - 0.74) / 0.08) * pecs * wS;
      d += f * 0.026 * G((t - 0.71) / 0.065) * (bump(ang, 0.5, 0.36) + bump(ang, -0.5, 0.36)) * wS;
      d += (1 - 0.4 * f) * 0.012 * G((t - 0.63) / 0.12) * (bump(ang, Math.PI / 2 + 0.5, 0.42) + bump(ang, -Math.PI / 2 - 0.5, 0.42)) * wS;
      d += 0.006 * G((t - 0.82) / 0.08) * (bump(ang, Math.PI - 0.45, 0.35) + bump(ang, Math.PI + 0.45, 0.35)) * wS;
      d -= 0.005 * G((t - 0.5) / 0.32) * bump(ang, Math.PI, 0.12);
      d += (1 - f) * 0.003 * G((t - 0.38) / 0.15) * (bump(ang, 0.2, 0.16) + bump(ang, -0.2, 0.16));
      d -= 0.002 * G((t - 0.42) / 0.2) * bump(ang, 0, 0.06);
      d += (0.016 + 0.006 * f) * G((t + 0.09) / 0.07) * (bump(ang, Math.PI - 0.55, 0.45) + bump(ang, Math.PI + 0.55, 0.45)) * wS;
      // trapezius slope from the neck to the shoulder
      d += 0.006 * G((t - 1.0) / 0.06) * (bump(ang, Math.PI / 2 + 0.4, 0.5) + bump(ang, -Math.PI / 2 - 0.4, 0.5));
      // garment
      if (sep) d += t < hem ? kit.botT : 0;
      const topCover = sep ? hemT(-y, -hem * T, kit.topT) : kit.topT;
      d += t < 1.0 ? topCover * (sleeveless && t > 0.85 ? 0.5 : 1) : 0;
      return d;
    },
  );
}

// ---------------------------------------------------------------- neck
function buildNeck(b: Builder, a: Anthro, kit: Kit, skin: SkinTone, near: boolean) {
  const wS = (a.girth * a.H) / 1.88;
  const nr = 0.06 * wS * (a.female ? 0.88 : 1);
  const N = a.neck;
  const male = a.female ? 0 : 1;
  b.frame(B.neck).tube(
    resample(
      [
        { y: -0.06, rx: nr * 1.04, rz: nr * 1.2, ox: -0.01 },
        { y: -0.02, rx: nr * 1.0, rz: nr * 1.06, ox: -0.004 },
        { y: N * 0.4, rx: nr, rz: nr * 0.98 },
        { y: N + 0.02, rx: nr * 0.95, rz: nr * 0.94, ox: -0.004 },
        { y: N + 0.06, rx: nr * 0.7, rz: nr * 0.75, ox: -0.012 },
      ],
      near ? 0.025 : 0.05,
    ),
    near ? 16 : 10,
    2.1,
    (v, y) => skin.at(v, 0.04, 0.08 * ss(N * 0.6, N + 0.02, y) * ss(0, 0.6, v.x / nr)),
    (y) => {
      const t = ss(-0.03, N + 0.02, y);
      if (y < 0.0) return [B.chest, 1 - ss(-0.07, 0, y) * 0.5, B.neck, ss(-0.07, 0, y) * 0.5];
      return [B.neck, 1 - t * 0.7, B.head, t * 0.7];
    },
    (y, ang) => {
      let d = male * 0.0065 * G((y - N * 0.42) / 0.012) * bump(ang, 0, 0.22);
      d += 0.004 * G((y - N * 0.35) / 0.04) * (bump(ang, 0.85, 0.3) + bump(ang, -0.85, 0.3));
      return d;
    },
  );
  if (kit.outfit.topStyle === 'jacket') {
    b.tube(
      [
        { y: -0.05, rx: nr * 1.35, rz: nr * 1.55, ox: -0.01 },
        { y: N * 0.15, rx: nr * 1.22, rz: nr * 1.25, ox: -0.006 },
        { y: N * 0.62, rx: nr * 1.2, rz: nr * 1.2, ox: -0.008 },
        { y: N * 0.66, rx: nr * 1.08, rz: nr * 1.08, ox: -0.008 },
      ],
      near ? 18 : 10,
      2.2,
      (v) => (Math.abs(v.z) < 0.004 && v.x > 0 ? new Paint().paint(new THREE.Color('#18181a'), 0.35) : kit.top),
      (y) => (y < 0 ? [B.chest, 0.6, B.neck, 0.4] : [B.neck, 1]),
    );
  }
}

// ---------------------------------------------------------------- head
function buildHead(b: Builder, a: Anthro, skin: SkinTone, near: boolean) {
  const hd = a.head;
  const F = a.face;
  const female = a.female;
  const C = new THREE.Vector3(0.012 * hd, 0.085 * hd, 0);
  const HW: W = [B.head, 1];
  b.frame(B.head);

  // Head-unit (average adult) cross-section tables, y ascending from below the chin to the vertex.
  const ty = [-0.123, -0.121, -0.117, -0.11, -0.1, -0.085, -0.068, -0.05, -0.03, -0.01, 0.005, 0.018, 0.03, 0.055, 0.08, 0.1, 0.112, 0.118];
  const jaw = F.jaw;
  const Fd = curve(ty, [0, 0.046, 0.074, 0.09, 0.0955, 0.097, 0.0995, 0.098, 0.095, 0.0935, 0.094, 0.0985, 0.098, 0.093, 0.082, 0.062, 0.035, 0]);
  const Wd = curve(ty, [0, 0.02 * jaw, 0.027 * jaw, 0.035 * jaw, 0.045 * jaw, 0.054 * jaw, 0.059 * jaw, 0.0635, 0.068, 0.071, 0.075, 0.077, 0.077, 0.074, 0.065, 0.05, 0.028, 0]);
  const Bd = curve(ty, [0, 0.01, 0.015, 0.02, 0.03, 0.045, 0.064, 0.081, 0.092, 0.097, 0.099, 0.1, 0.1, 0.095, 0.085, 0.066, 0.04, 0]);
  const nF = curve(ty, [2, 2, 2, 2, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.5, 2.4, 2.3, 2.2, 2.1, 2, 2, 2]);
  const ny = [-0.057, -0.053, -0.05, -0.047, -0.043, -0.039, -0.033, -0.025, -0.015, -0.005, 0.004, 0.011];
  const noseN = curve(ny, [0, 0.003, 0.0085, 0.0145, 0.019, 0.0205, 0.019, 0.0155, 0.0115, 0.0075, 0.003, 0]);
  const noseHW = curve([-0.055, -0.045, -0.038, -0.03, -0.015, 0.0, 0.011], [0.009, 0.0095, 0.009, 0.0075, 0.0063, 0.0063, 0.0085]);
  const eyeY = 0.0;
  const eyeZ = 0.032;
  const mW = 0.025 * (female ? 0.96 : 1);

  const features = (y: number, z: number) => {
    const az = Math.abs(z);
    let d = 0;
    d += F.brow * 0.0045 * G((y - 0.019) / 0.009) * G((az - 0.03) / 0.024);
    d += F.brow * 0.002 * G((y - 0.016) / 0.01) * G(z / 0.014);
    d -= 0.0035 * G((y - 0.006) / 0.008) * G(z / 0.013);
    d -= 0.017 * G((y - eyeY) / 0.0125) * G((az - eyeZ) / 0.0175);
    d -= 0.0035 * G((y - 0.009) / 0.008) * G((az - eyeZ) / 0.02);
    d += F.cheek * 0.006 * G((y + 0.02) / 0.016) * G((az - 0.047) / 0.017);
    d -= 0.0018 * G((y + 0.017) / 0.006) * G((az - 0.024) / 0.012);
    d -= 0.0035 * G((y + 0.062) / 0.02) * G((az - 0.05) / 0.013);
    const nw = noseHW(y) * F.noseW;
    d += F.nose * noseN(y) * Math.exp(-Math.pow(az / nw, 2.4));
    d += F.nose * 0.0085 * G((y + 0.046) / 0.0075) * G((az - 0.0125 * F.noseW) / 0.0065);
    d -= 0.0025 * G((y + 0.045) / 0.009) * G((az - 0.0205 * F.noseW) / 0.003);
    const lipZ = ss(mW, mW - 0.012, az);
    d += 0.0014 * G((y + 0.057) / 0.006) * G((az - 0.0055) / 0.0028);
    d += F.lips * 0.002 * G((y + 0.0655) / 0.0042) * lipZ;
    d += F.lips * 0.0026 * G((y + 0.0755) / 0.0048) * lipZ;
    d -= 0.0032 * G((y + 0.0705) / 0.0016) * ss(mW + 0.004, mW - 0.006, az);
    d -= 0.003 * G((az - mW) / 0.005) * G((y + 0.07) / 0.006);
    d -= 0.0032 * G((y + 0.0895) / 0.0055) * G(z / 0.022);
    d += F.chin * 0.0045 * G((y + 0.104) / 0.009) * G(z / 0.02);
    return d;
  };

  // hairline (y, head units) by |azimuth|; sideburn in front of the ear, nape at the back
  const hairline = female
    ? linear([0, 0.3, 0.6, 0.85, 1.1, 1.25, 1.36, 1.46, 1.6, 1.95, 2.25, 2.7, Math.PI], [0.07, 0.069, 0.064, 0.05, 0.032, 0.02, 0.014, 0.03, 0.036, 0.03, -0.025, -0.052, -0.058])
    : linear([0, 0.3, 0.6, 0.85, 1.05, 1.2, 1.32, 1.42, 1.56, 1.95, 2.2, 2.6, Math.PI], [0.072, 0.071, 0.066, 0.056, 0.04, 0.012, -0.002, 0.03, 0.035, 0.03, -0.022, -0.05, -0.058]);
  const style = a.hairStyle;
  const capY = (ph: number) => 0.024 + 0.022 * Math.cos(ph);
  const hairLine = (ph: number) => {
    const aph = Math.abs(ph);
    return hairline(aph) + a.recession * G((aph - 0.5) / 0.22);
  };
  const hairCov = (y: number, ph: number) => ss(hairLine(ph) - 0.002, hairLine(ph) + 0.005, y);
  const hairT = (y: number, ph: number) => {
    const line = hairLine(ph);
    const c = Math.cos(ph);
    let t = 0.0025;
    if (style === 'crop') t = 0.005 + 0.006 * ss(0.0, 0.09, y);
    else if (style === 'swept') t = 0.006 + 0.013 * ss(0.03, 0.1, y) * ss(-0.5, 0.6, c) + 0.004 * ss(0.05, 0.1, y);
    else if (style === 'pony' || style === 'bun') t = 0.0045 + 0.002 * ss(0.05, 0.11, y);
    t *= ss(line - 0.001, line + (style === 'buzz' ? 0.004 : 0.012), y);
    if (a.headwear === 'cap' && y > capY(ph) - 0.012) t = Math.min(t, 0.0035);
    return t;
  };
  const hairC = new THREE.Color(a.hair);
  const browC = hairC.clone().multiplyScalar(0.75);
  const lipC = skin.base.clone().multiply(new THREE.Color(0.9, 0.64, 0.64));
  const hairPaint = new Paint();
  const tmpC = new THREE.Color();
  const outP = new Paint();
  const dirV = new THREE.Vector3();

  let lastZ = 0;
  const point = (y: number, ph: number, out: THREE.Vector3, extra = 0, hair = true) => {
    const c = Math.cos(ph);
    const sn = Math.sin(ph);
    const front = c >= 0;
    const e = 2 / (front ? nF(y) : 2.1);
    let x = front ? Fd(y) * Math.pow(c, e) : -Bd(y) * Math.pow(-c, e);
    const z = Wd(y) * Math.sign(sn) * Math.pow(Math.abs(sn), e);
    lastZ = z;
    if (front) x += features(y, z) * ss(0.1, 0.55, c);
    const t = (hair ? hairT(y, ph) : 0) + extra;
    if (t > 0) {
      dirV.set(x, y + 0.025, z).normalize();
      x += dirV.x * t;
      out.set(x, y + dirV.y * t, z + dirV.z * t);
    } else out.set(x, y, z);
    return out.multiplyScalar(hd).add(C);
  };

  const color = (y: number, ph: number, z: number): THREE.Color => {
    const c = Math.cos(ph);
    const az = Math.abs(z);
    const front = ss(0.2, 0.6, c);
    let red = 0.22 * G((y + 0.03) / 0.02) * G((az - 0.045) / 0.018) * front * (female ? 1.2 : 1);
    red += 0.15 * G((y + 0.038) / 0.012) * G(az / 0.012) * front;
    red += 0.08 * G((y - 0.04) / 0.03) * front;
    let shade = 0.55 * G((y + 0.0495) / 0.0028) * G((az - 0.0075) / 0.0035) * front;
    shade += 0.45 * G((y + 0.0705) / 0.0013) * ss(mW, mW - 0.004, az) * front;
    shade += 0.08 * G((y - 0.006) / 0.01) * G((az - eyeZ) / 0.016) * front;
    dirV.set(y, ph, z);
    const sp = skin.at(dirV, red, shade, az < 0.03 && y > -0.05 && y < 0.07 ? 0.5 : R_SKIN);
    tmpC.copy(sp);
    let rough = sp.rough;
    // lips
    const vz = Math.sqrt(Math.max(0, 1 - (az / mW) ** 2));
    const yU = -0.0705 + (0.0078 + 0.0016 * G((az - 0.0062) / 0.004) - 0.0012 * G(az / 0.0028)) * vz;
    const yL = -0.0705 - 0.0098 * Math.pow(vz, 0.8);
    const lip = ss(yU + 0.0008, yU - 0.0008, y) * ss(yL - 0.0009, yL + 0.0009, y) * ss(mW - 0.001, mW - 0.005, az) * front;
    if (lip > 0) {
      tmpC.lerp(lipC, lip);
      if (y < -0.0705) tmpC.multiplyScalar(1 + 0.05 * lip);
      rough = lerp(rough, R_LIP, lip);
    }
    // stubble
    if (a.stubble > 0) {
      const beard = ss(-0.036, -0.056, y) * ss(1.45, 1.1, Math.abs(ph)) * (1 - lip) * (1 - 0.6 * G((y + 0.055) / 0.004) * G(az / 0.012));
      const mous = G((y + 0.058) / 0.004) * ss(0.028, 0.012, az) * front;
      tmpC.lerp(hairC, a.stubble * (0.22 * beard + 0.18 * mous));
    }
    // eyebrows
    const bl = clamp01((az - 0.012) / 0.044);
    const browY = 0.0185 + 0.0038 * Math.sin(bl * Math.PI) - 0.002 * bl;
    const tb = 0.0058 * (1 - 0.55 * bl) * (female ? 0.85 : 1);
    const brow = ss(tb, tb * 0.45, Math.abs(y - browY)) * ss(0.009, 0.014, az) * ss(0.059, 0.052, az) * front;
    tmpC.lerp(browC, 0.45 * brow);
    // hair
    const hc = hairCov(y, ph);
    if (hc > 0) {
      const strand = 0.8 + 0.4 * noise(ph * 7.0, y * 30.0, 0.3);
      tmpC.lerp(hairPaint.copy(hairC).multiplyScalar(strand), (style === 'buzz' ? 0.75 : 0.97) * hc);
      rough = lerp(rough, R_HAIR, hc);
    }
    return outP.paint(tmpC, rough);
  };

  // row heights: crown, then dense face rows with landmark rows (brow, nose, lips)
  const ys: number[] = [];
  const step = near ? 0.0068 : 0.013;
  for (let y = -0.118; y < 0.074; y += step) ys.push(y);
  for (const th of [0.8, 0.66, 0.52, 0.38, 0.24, 0.12]) ys.push(0.118 * Math.cos(th));
  if (near) ys.push(-0.0705, -0.062, -0.0795, -0.0525, -0.04, 0.018, 0.006);
  ys.push(-0.1205, -0.1225, -0.123, 0.118);
  ys.sort((p, q) => p - q);
  const rowsY = ys.filter((y, i) => i === 0 || y - ys[i - 1] > 0.0016);
  const nc = near ? 36 : 22;
  const phs: number[] = [];
  for (let j = 0; j < nc; j++) {
    const t = -1 + (2 * j) / nc;
    phs.push(Math.PI * t * (0.42 + 0.58 * t * t));
  }
  b.grid(
    rowsY.length - 1,
    nc,
    true,
    (i, j, out) => point(rowsY[i], phs[j], out),
    (i, j) => color(rowsY[i], phs[j], lastZ),
    () => HW,
  );

  const frontX = (y: number, z: number) => {
    const n = nF(y);
    const u = Math.min(1, Math.abs(z) / Wd(y));
    const c = Math.sqrt(Math.max(0, 1 - Math.pow(u, n)));
    return Fd(y) * Math.pow(1 - Math.pow(u, n), 1 / n) + features(y, z) * ss(0.1, 0.55, c);
  };
  // ---- lips: upper and lower vermilion rolls, and eyebrows, as thin swept volumes on the face
  const lipU = new Paint().paint(lipC, R_LIP);
  const lipL = new Paint().paint(lipC.clone().multiplyScalar(1.07), R_LIP);
  const ref = new THREE.Vector3(1, 0, 0);
  const lipN = near ? 10 : 6;
  for (const upper of [true, false]) {
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= lipN; k++) {
      const z = lerp(-mW * 0.97, mW * 0.97, k / lipN);
      const az = Math.abs(z);
      const vz = Math.sqrt(Math.max(0, 1 - (az / mW) ** 2));
      const rad = (upper ? 0.0025 + 0.0005 * G((az - 0.0062) / 0.004) : 0.0032) * F.lips * Math.sqrt(vz) + 0.0004;
      const y = -0.0705 + (upper ? 1 : -1) * (rad * 0.95) + (upper ? 0 : 0.0004);
      const x = frontX(y, z) - rad * 0.5;
      pts.push(new THREE.Vector3(x, y, z).multiplyScalar(hd).add(C));
      radii.push(rad * hd);
    }
    b.sweep(pts, radii, near ? 6 : 4, ref, upper ? lipU : lipL, HW, 0.62);
  }
  const browP = new Paint().paint(browC.clone().lerp(skin.base, 0.22), R_HAIR);
  for (const zs of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= 7; k++) {
      const bl = k / 7;
      const az = 0.011 + 0.045 * bl;
      const y = 0.0185 + 0.0038 * Math.sin(bl * Math.PI) - 0.002 * bl;
      const tb = 0.0034 * (1 - 0.5 * bl) * (female ? 0.85 : 1) * (0.7 + 0.3 * Math.sin(Math.min(1, bl * 4) * Math.PI * 0.5));
      pts.push(new THREE.Vector3(frontX(y, zs * az) - 0.0002, y, zs * az).multiplyScalar(hd).add(C));
      radii.push(tb * hd);
    }
    if (zs < 0) pts.reverse(), radii.reverse();
    b.sweep(pts, radii, near ? 5 : 4, ref, browP, HW, 0.3);
  }

  // ---- eyes: eyeball (iris axis +X) and lids
  const iris = new THREE.Color(a.eyes);
  const sclera = new THREE.Color('#ece6dc');
  const pupil = new THREE.Color('#0b0908');
  const er = 0.0122;
  const eyeRows = near ? [0, 0.17, 0.4, 0.47, 0.53, 0.85, 1.35, 2.1, Math.PI] : [0, 0.2, 0.5, 1.2, 2.2, Math.PI];
  const ecols = near ? 12 : 8;
  for (const zs of [-1, 1]) {
    const E = new THREE.Vector3(0.072, eyeY, zs * eyeZ);
    const ep = new Paint();
    b.grid(
      eyeRows.length - 1,
      ecols,
      true,
      (i, j, out) => {
        const th = eyeRows[i];
        const ph = (j / ecols) * TAU;
        const r = er + (th < 0.5 ? 0.0011 * Math.cos((th / 0.5) * Math.PI * 0.5) : 0);
        out.set(Math.cos(th), Math.sin(th) * Math.cos(ph), Math.sin(th) * Math.sin(ph)).multiplyScalar(r).add(E);
        return out.multiplyScalar(hd).add(C);
      },
      (i, j) => {
        const th = eyeRows[i];
        const ph = (j / ecols) * TAU;
        if (th < 0.12) return ep.paint(pupil, 0.08);
        if (th < 0.45) return ep.paint(tmpC.copy(iris).multiplyScalar(0.8 + 0.5 * ((j * 7) % 3) / 3), 0.08);
        if (th < 0.5) return ep.paint(tmpC.copy(iris).multiplyScalar(0.45), 0.08);
        const corner = Math.abs(Math.sin(ph));
        return ep.paint(tmpC.copy(sclera).lerp(new THREE.Color('#d9a49a'), 0.25 * corner * ss(0.6, 1.2, th)), 0.12);
      },
      () => HW,
    );
    // lids: sphere shells just outside the eyeball, margin forming an almond fissure
    const rl = er + 0.0016;
    const A = 1.24;
    const lidCols = near ? 9 : 6;
    const lidRows = near ? 4 : 3;
    const lash = skin.base.clone().lerp(new THREE.Color('#120d0a'), 0.85);
    const lp = new Paint();
    for (const upper of [true, false]) {
      b.grid(
        lidRows,
        lidCols,
        false,
        (i, j, out) => {
          const aa = upper ? lerp(-A, A, j / lidCols) : lerp(A, -A, j / lidCols);
          const lat = (aa * zs) / A;
          const k = Math.pow(Math.max(0, 1 - lat * lat), 0.75);
          const margin = upper ? 0.285 * k + 0.04 * lat : -(0.27 * k) + 0.04 * lat;
          const reach = upper ? 1.15 : -0.95;
          const fr = i / lidRows;
          const e = i === 0 ? margin : lerp(margin, reach, Math.pow((i - 0.6) / (lidRows - 0.6), 1.2));
          const r = i === 0 ? rl - 0.0006 : rl + (upper ? 0.0011 : 0.0007) * (1 - 0.3 * fr);
          out.set(Math.cos(e) * Math.cos(aa), Math.sin(e), Math.cos(e) * Math.sin(aa)).multiplyScalar(r).add(E);
          return out.multiplyScalar(hd).add(C);
        },
        (i) => {
          if (i <= 1) return lp.paint(upper ? lash : tmpC.copy(skin.base).lerp(lash, 0.35), 0.4);
          if (upper && i === 2) return lp.paint(tmpC.copy(skin.base).multiplyScalar(0.84), R_SKIN);
          return lp.paint(skin.base, 0.45);
        },
        () => HW,
      );
    }
  }

  // ---- ears
  for (const zs of [-1, 1]) {
    const root = point(-0.004, zs * 1.6, new THREE.Vector3(), 0, false);
    const ez = new THREE.Vector3(0, 0, zs);
    const ey = new THREE.Vector3(-0.27, 0.96, 0).normalize();
    const ex = new THREE.Vector3().crossVectors(ey, ez);
    const ax = 0.0175 * F.ear * hd;
    const ay = 0.031 * F.ear * hd;
    const ep = new Paint();
    const hO = (pb: number, py: number) => {
      const rho = Math.hypot(pb, py);
      let h = 0.003 + 0.011 * ss(-0.7, 1.0, pb) * (0.55 + 0.45 * ss(-0.8, 0.3, py));
      h += 0.0035 * ss(0.7, 0.93, rho) * ss(-0.55, -0.2, py);
      h -= 0.0075 * G((pb + 0.12) / 0.36) * G((py + 0.1) / 0.3);
      h += 0.002 * G((rho - 0.58) / 0.1) * ss(-0.35, 0.2, py);
      h += 0.0015 * ss(-0.5, -0.8, py);
      return h * F.ear;
    };
    b.blob(
      near ? 6 : 4,
      near ? 10 : 6,
      (u, out) => {
        const pb = zs > 0 ? -u.x : u.x;
        const narrow = 1 - 0.28 * ss(-0.3, -1, u.y);
        const h = hO(pb, u.y);
        const zz = u.z * zs > 0 ? h - 0.0015 * (1 - ss(0, 0.25, u.z * zs)) : h - 0.0015 - (h + 0.004) * ss(0, 0.5, -u.z * zs);
        out
          .copy(root)
          .addScaledVector(ex, u.x * ax * narrow)
          .addScaledVector(ey, u.y * ay)
          .addScaledVector(ez, zz * hd)
          .addScaledVector(ex, zs > 0 ? ax * 0.35 : -ax * 0.35);
      },
      (u) => {
        const pb = zs > 0 ? -u.x : u.x;
        const concha = G((pb + 0.12) / 0.36) * G((u.y + 0.1) / 0.3);
        return ep.copy(skin.at(u, 0.22, 0.3 * concha * ss(0, 0.6, u.z * zs)));
      },
      HW,
    );
  }

  // ---- ponytail / bun
  if (style === 'pony' || style === 'bun') {
    const hp = (p: THREE.Vector3, i: number) => hairPaint.paint(tmpC.copy(hairC).multiplyScalar(0.82 + 0.36 * noise(p.x * 3, p.y * 2 + i, p.z * 3)), R_HAIR);
    const baseY = a.headwear === 'cap' ? 0.004 : style === 'bun' ? 0.05 : 0.035;
    const base = point(baseY, Math.PI, new THREE.Vector3(), 0.002);
    const back = new THREE.Vector3(-1, 0, 0);
    if (style === 'bun') {
      const c = base.clone().addScaledVector(back, 0.018 * hd).add(new THREE.Vector3(0, 0.006, 0));
      b.blob(near ? 8 : 5, near ? 12 : 7, (u, out) => out.set(u.x * 0.03, u.y * 0.027, u.z * 0.032).multiplyScalar(hd * (1 + 0.06 * Math.sin(u.y * 9 + u.z * 7))).add(c), (u) => hp(u, 0), HW);
    } else {
      const P = [
        [0.006, 0],
        [-0.014, -0.006],
        [-0.03, -0.03],
        [-0.04, -0.07],
        [-0.043, -0.12],
        [-0.04, -0.17],
        [-0.034, -0.21],
      ].map(([dx, dy]) => base.clone().add(new THREE.Vector3(dx * hd, dy * hd, 0)));
      b.sweep(P, [0.014, 0.016, 0.019, 0.019, 0.016, 0.011, 0.004].map((r) => r * hd), near ? 10 : 6, new THREE.Vector3(0, 0, 1), hp, HW, 1.15);
      const tie = new Paint().paint(new THREE.Color('#141414'), 0.5);
      b.sweep([P[1].clone().lerp(P[0], 0.3), P[1].clone().lerp(P[2], 0.25)], [0.0175 * hd, 0.0175 * hd], near ? 10 : 6, new THREE.Vector3(0, 0, 1), tie, HW);
    }
  }

  // ---- cap / visor
  if (a.headwear !== 'none') {
    const cc = paint(a.headwearColor, 0.72);
    const seam = paint(new THREE.Color(a.headwearColor).multiplyScalar(0.82), 0.72);
    const capCols = near ? 28 : 16;
    const off = 0.004;
    if (a.headwear === 'cap') {
      const capRows = near ? 7 : 4;
      b.grid(
        capRows,
        capCols,
        true,
        (i, j, out) => {
          const ph = -Math.PI + (TAU * j) / capCols;
          const y = lerp(capY(ph), 0.118, Math.pow(i / capRows, 0.85));
          return point(y, ph, out, off * (1 - 0.3 * Math.pow(i / capRows, 3)));
        },
        (i, j) => {
          const ph = -Math.PI + (TAU * j) / capCols;
          const k = (((ph + Math.PI / 6) / (Math.PI / 3)) % 1 + 1) % 1;
          return i > 0 && i < capRows && (k < 0.06 || k > 0.94) ? seam : cc;
        },
        () => HW,
      );
      const top = point(0.118, 0, new THREE.Vector3(), off + 0.002);
      b.blob(3, 6, (u, out) => out.set(u.x * 0.006, Math.max(0, u.y) * 0.004, u.z * 0.006).multiplyScalar(hd).add(top), () => cc, HW);
    } else {
      b.grid(
        2,
        capCols,
        true,
        (i, j, out) => {
          const ph = -Math.PI + (TAU * j) / capCols;
          const y = capY(ph) + (i === 0 ? 0 : i === 1 ? 0.022 : 0.026);
          return point(y, ph, out, i === 2 ? 0.0015 : off);
        },
        () => cc,
        () => HW,
      );
    }
    const brimPhi = 0.98;
    const inner = new THREE.Vector3();
    const bc = near ? 14 : 8;
    b.sheet(
      3,
      bc,
      (i, j, side, out) => {
        const ph = -brimPhi + (2 * brimPhi * j) / bc;
        point(capY(ph) + 0.002, ph, inner, off + 0.001);
        const r = i / 3;
        const L = 0.07 * hd * Math.pow(Math.max(0, Math.cos((ph / brimPhi) * Math.PI * 0.5)), 0.5) + 0.002;
        out.set(Math.cos(ph), 0, Math.sin(ph) * 0.55).normalize().multiplyScalar(L * r).add(inner);
        out.y -= (0.012 * r * r + 0.01 * r * Math.abs(Math.sin(ph))) * hd + (side === 0 ? 0.0035 : 0);
      },
      cc,
      HW,
    );
  }

  // ---- wraparound sport sunglasses
  if (a.glasses) {
    const lensP = paint(a.lens, 0.06, 0.88);
    const frameP = paint(a.frame, 0.32, 0);
    const PH = 1.22;
    const lc = near ? 22 : 10;
    const lr = near ? 4 : 2;
    const lensPt = (ph: number, v: number, out: THREE.Vector3, d = 0) => {
      const ap = Math.abs(ph);
      const top = 0.02 - 0.007 * ((ap - 0.35) / 0.9) ** 2;
      const bot = -0.019 + 0.013 * ((ap - 0.45) / 0.8) ** 2 + 0.013 * G((ap - 0.05) / 0.13);
      const y = lerp(bot, top, v);
      const bow = 0.004 * ((y - 0.0) / 0.022) ** 2;
      const rx = 0.113 + d - bow;
      const rz = 0.087 + d - bow * 0.5;
      return out.set(rx * Math.cos(ph), y, rz * Math.sin(ph)).multiplyScalar(hd).add(C);
    };
    for (const zs of [-1, 1]) b.sheet(lr, lc >> 1, (i, j, side, out) => lensPt(zs * lerp(0.07, PH, j / (lc >> 1)), i / lr, out, side === 0 ? 0.0016 : 0), lensP, HW);
    const top: THREE.Vector3[] = [];
    for (let j = 0; j <= 12; j++) top.push(lensPt(-PH * 1.01 + (2.02 * PH * j) / 12, 1.02, new THREE.Vector3(), 0.0012));
    b.sweep(top, top.map(() => 0.0026 * hd), near ? 6 : 4, new THREE.Vector3(0, 1, 0), frameP, HW, 0.75);
    for (const zs of [-1, 1]) {
      const st = lensPt(zs * PH * 1.01, 0.82, new THREE.Vector3(), 0.0012);
      const pts = [st];
      for (const [x, y] of [
        [0.025, 0.014],
        [0.0, 0.012],
        [-0.022, 0.006],
        [-0.036, -0.006],
      ]) {
        const w = Wd(y) + (a.hairStyle === 'buzz' ? 0.006 : 0.01);
        pts.push(new THREE.Vector3(x, y, zs * w).multiplyScalar(hd).add(C));
      }
      b.sweep(pts, [0.0028, 0.0026, 0.0025, 0.0024, 0.0022].map((r) => r * hd), near ? 5 : 4, new THREE.Vector3(0, 0, 1), frameP, HW, 0.45);
    }
  }
}

// ---------------------------------------------------------------- arms and hands
function buildArm(b: Builder, a: Anthro, kit: Kit, skin: SkinTone, L: boolean, near: boolean) {
  const ua = L ? B.upArmL : B.upArmR;
  const fa = L ? B.foreArmL : B.foreArmR;
  const hd = L ? B.handL : B.handR;
  const clav = L ? B.clavL : B.clavR;
  const r = ((a.girth * a.H) / 1.88) * (a.female ? 0.88 : 1);
  const m = a.female ? 0.6 : 1;
  const U = a.upperArm;
  const F = a.foreArm;
  const sleeveU = kit.sleeveU * U;
  const sleeveF = kit.sleeveF * F;
  const sT = kit.outfit.topStyle === 'tee' ? 0.007 : kit.topT;
  const extraU = kit.sleeveU > 0 && kit.sleeveU < 1 ? [sleeveU - 0.003, sleeveU + 0.003] : [];
  b.frame(ua, !L).tube(
    resample(
      [
        { y: -0.06, rx: 0.03 * r, rz: 0.03 * r },
        { y: -0.035, rx: 0.05 * r, rz: 0.053 * r },
        { y: 0.02, rx: 0.054 * r, rz: 0.056 * r },
        { y: U * 0.3, rx: 0.047 * r, rz: 0.047 * r },
        { y: U * 0.55, rx: 0.045 * r, rz: 0.041 * r },
        { y: U * 0.8, rx: 0.04 * r, rz: 0.039 * r },
        { y: U - 0.005, rx: 0.036 * r, rz: 0.041 * r },
        { y: U + 0.022, rx: 0.028 * r, rz: 0.031 * r },
        { y: U + 0.038, rx: 0.01, rz: 0.012 },
      ],
      near ? 0.034 : 0.06,
      extraU,
    ),
    near ? 14 : 9,
    2.2,
    (v, y, ang) => {
      if (y < sleeveU) return kit.top;
      return skin.at(v, 0.12 * G((y - U) / 0.02) * bump(ang, Math.PI, 0.6), 0);
    },
    (y) => {
      if (y < 0.03) return [ua, 0.6 + 0.4 * ss(-0.06, 0.03, y), clav, 0.4 * (1 - ss(-0.06, 0.03, y))];
      const k = 0.5 * ss(U - 0.06, U, y) + 0.5 * ss(U, U + 0.035, y);
      return [ua, 1 - k, fa, k];
    },
    (y, ang) => {
      const t = y / U;
      let d = 0.008 * m * G((t - 0.12) / 0.18) * bump(ang, Math.PI / 2, 0.9);
      d += 0.004 * m * G((t - 0.05) / 0.15) * (bump(ang, 0.5, 0.5) + bump(ang, Math.PI - 0.4, 0.5));
      d += 0.007 * m * G((t - 0.58) / 0.2) * bump(ang, 0, 0.6);
      d += 0.007 * m * G((t - 0.42) / 0.22) * bump(ang, Math.PI, 0.7);
      d += 0.005 * G((y - U - 0.004) / 0.012) * bump(ang, Math.PI, 0.45);
      d += 0.003 * G((y - U) / 0.012) * (bump(ang, Math.PI / 2, 0.4) + bump(ang, -Math.PI / 2, 0.4));
      if (sleeveU > -0.1) d += hemT(y, sleeveU, sT) * (kit.outfit.topStyle === 'tee' ? 1 + 0.4 * ss(sleeveU - 0.06, sleeveU, y) : 1);
      return d;
    },
  );
  const extraF = kit.sleeveF > 0 ? [sleeveF - 0.003, sleeveF + 0.003] : [];
  b.frame(fa, !L).tube(
    resample(
      [
        { y: -0.035, rx: 0.016 * r, rz: 0.019 * r },
        { y: -0.012, rx: 0.031 * r, rz: 0.037 * r },
        { y: F * 0.2, rx: 0.036 * r, rz: 0.043 * r },
        { y: F * 0.5, rx: 0.03 * r, rz: 0.037 * r },
        { y: F * 0.8, rx: 0.021 * r, rz: 0.031 * r },
        { y: F - 0.005, rx: 0.018 * r, rz: 0.029 * r },
        { y: F + 0.015, rx: 0.016 * r, rz: 0.026 * r },
        { y: F + 0.03, rx: 0.008, rz: 0.014 },
      ],
      near ? 0.034 : 0.06,
      extraF,
    ),
    near ? 13 : 8,
    2.3,
    (v, y) => {
      if (y < sleeveF) return kit.accent && kit.outfit.topStyle === 'jacket' && y > sleeveF - 0.03 ? kit.accent : kit.top;
      return skin.at(v, 0.04, 0, R_SKIN, v.x > 0 ? 0.25 : 0);
    },
    (y) => {
      if (y < 0.05) return [fa, 0.5 + 0.5 * ss(-0.035, 0.05, y), ua, 0.5 * (1 - ss(-0.035, 0.05, y))];
      if (y > F - 0.03) return [fa, 1 - 0.6 * ss(F - 0.03, F + 0.02, y), hd, 0.6 * ss(F - 0.03, F + 0.02, y)];
      return [fa, 1];
    },
    (y, ang) => {
      const t = y / F;
      // brachioradialis / extensor mass on the radial-dorsal side, flexors on the volar side
      let d = 0.006 * m * G((t - 0.22) / 0.2) * bump(ang, Math.PI / 2 + 0.5, 0.6);
      d += 0.004 * m * G((t - 0.25) / 0.22) * bump(ang, -0.3, 0.7);
      d += 0.0025 * G((y - F + 0.005) / 0.01) * bump(ang, -Math.PI / 2, 0.4);
      if (sleeveF > 0) d += hemT(y, sleeveF, sT * 1.4);
      return d;
    },
  );
  buildHand(b, a, hd, L, skin, near);
}

/** Hand closed in a hook grip around the handle (axis = local Z). */
function buildHand(b: Builder, a: Anthro, hd: number, left: boolean, skin: SkinTone, near: boolean) {
  const s = a.hand / 0.2;
  const gl = gripLocal(a, new THREE.Vector3());
  const W1: W = [hd, 1];
  b.frame(hd, left);
  const pr = s * (a.female ? 0.92 : 1);
  b.tube(
    resample(
      [
        { y: -0.022, rx: 0.015 * pr, rz: 0.025 * pr },
        { y: 0.0, rx: 0.017 * pr, rz: 0.031 * pr },
        { y: 0.04 * s, rx: 0.016 * pr, rz: 0.039 * pr, ox: -0.001, oz: 0.002 },
        { y: 0.08 * s, rx: 0.014 * pr, rz: 0.042 * pr },
        { y: 0.094 * s, rx: 0.012 * pr, rz: 0.04 * pr },
        { y: 0.1 * s, rx: 0.007 * pr, rz: 0.032 * pr },
      ],
      near ? 0.018 : 0.03,
    ),
    near ? 10 : 7,
    2.6,
    (v, y) => (v.x > 0 ? skin.at(v, 0.3 * ss(0.06 * s, 0.09 * s, y), 0) : skin.at(v, 0.12, 0, R_SKIN, 0.85)),
    (y) => (y < 0.0 ? [hd, 0.7, left ? B.foreArmL : B.foreArmR, 0.3] : W1),
    (y, ang) => {
      let d = 0.007 * pr * G((y - 0.02 * s) / (0.022 * s)) * bump(ang, Math.PI - 0.9, 0.55);
      d += 0.004 * pr * G((y - 0.03 * s) / (0.03 * s)) * bump(ang, Math.PI + 0.9, 0.5);
      d += 0.0012 * G((y - 0.09 * s) / 0.006) * bump(ang, 0, 0.8);
      return d;
    },
  );
  const cx = gl.x;
  const cy = gl.y;
  const ref = new THREE.Vector3(0, 0, 1);
  const nail = new Paint();
  const fingers: [number, number, number][] = [
    // z, length factor, radius
    [0.028, 0.94, 0.0092],
    [0.0095, 1.0, 0.0095],
    [-0.009, 0.96, 0.009],
    [-0.026, 0.8, 0.0078],
  ];
  const n = near ? 6 : 4;
  for (const [fz, lf, fr] of fingers) {
    const z = fz * pr;
    const start = new THREE.Vector3(0.0, 0.086 * s, z);
    const a0 = Math.atan2(start.y - cy, start.x - cx);
    const r0 = Math.hypot(start.x - cx, start.y - cy);
    const r1 = 0.02 + fr * s * 1.02;
    const sweepA = 3.55 * lf;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const ang = a0 + sweepA * t;
      const rr = lerp(r0, r1, ss(0, 0.3, t));
      pts.push(new THREE.Vector3(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, z));
      const joint = 0.06 * (G((t - 0.42) / 0.07) + G((t - 0.72) / 0.06)) + 0.04 * G(t / 0.08);
      radii.push(fr * s * (1.04 - 0.13 * t + joint));
    }
    b.sweep(
      pts,
      radii,
      near ? 5 : 4,
      ref,
      (p, i) => {
        const t = i / n;
        const out = Math.hypot(p.x - cx, p.y - cy) > r1 + fr * s * 0.3;
        if (t > 0.82 && out) return nail.paint(skin.at(p, 0.05, 0, 0.3).clone().lerp(new THREE.Color('#f3d6cc'), 0.35), 0.3);
        return skin.at(p, out ? 0.28 * (G((t - 0.42) / 0.08) + G((t - 0.72) / 0.07)) + 0.06 : 0.1, 0, R_SKIN, out ? 0 : 0.8);
      },
      W1,
      1.06,
    );
  }
  // thumb: from the thenar eminence under the handle, alongside the index finger
  const th = [
    new THREE.Vector3(-0.01 * s, 0.018 * s, 0.03 * pr),
    new THREE.Vector3(-0.022 * s, 0.04 * s, 0.04 * pr),
    new THREE.Vector3(cx - 0.006, cy - 0.032 * s, 0.043 * pr),
    new THREE.Vector3(cx - 0.024, cy - 0.016 * s, 0.04 * pr),
    new THREE.Vector3(cx - 0.032, cy + 0.006 * s, 0.036 * pr),
  ];
  b.sweep(
    th,
    [0.016 * s, 0.013 * s, 0.0118 * s, 0.0108 * s, 0.009 * s],
    near ? 7 : 5,
    ref,
    (p, i) => (i >= 4 && p.x < cx - 0.035 ? nail.paint(skin.at(p, 0.05, 0, 0.3).clone().lerp(new THREE.Color('#f3d6cc'), 0.35), 0.3) : skin.at(p, i === 2 ? 0.2 : 0.1)),
    W1,
  );
  b.frame(hd, false);
}

// ---------------------------------------------------------------- legs and feet
function buildLeg(b: Builder, a: Anthro, kit: Kit, skin: SkinTone, L: boolean, near: boolean) {
  const th = L ? B.thighL : B.thighR;
  const sh = L ? B.shinL : B.shinR;
  const ft = L ? B.footL : B.footR;
  const Th = a.thigh;
  const S = a.shin;
  const r = (a.girth * a.H) / 1.88;
  const m = a.female ? 0.65 : 1;
  const o = kit.outfit;
  const legEnd = kit.legTh * Th;
  const shinEnd = kit.legSh * S;
  const loose = o.bottomStyle === 'pants' ? 1 : 0;
  const accentLeg = kit.accentB && o.bottomStyle !== 'pants';
  const extraT = kit.legTh < 1 ? [legEnd - 0.003, legEnd + 0.003] : [];
  b.frame(th, !L).tube(
    resample(
      [
        { y: -0.075, rx: 0.068 * r, rz: 0.072 * r, ox: -0.01 },
        { y: 0.0, rx: 0.086 * r, rz: 0.088 * r },
        { y: Th * 0.3, rx: 0.08 * r, rz: 0.077 * r, ox: 0.004 },
        { y: Th * 0.6, rx: 0.069 * r, rz: 0.064 * r, ox: 0.006 },
        { y: Th * 0.85, rx: 0.055 * r, rz: 0.053 * r, ox: 0.002 },
        { y: Th, rx: 0.05 * r, rz: 0.052 * r, ox: 0.002 },
        { y: Th + 0.026, rx: 0.043 * r, rz: 0.045 * r },
        { y: Th + 0.044, rx: 0.026 * r, rz: 0.03 * r },
        { y: Th + 0.052, rx: 0.006, rz: 0.008 },
      ],
      near ? 0.055 : 0.09,
      extraT,
    ),
    near ? 16 : 9,
    2.2,
    (v, y, ang) => {
      if (y < legEnd) return accentLeg && Math.abs(dAng(ang, Math.PI / 2)) < 0.22 ? kit.accentB! : kit.bottom;
      return skin.at(v, 0.3 * G((y - Th) / 0.03) * bump(ang, 0, 0.8), 0);
    },
    (y) => {
      if (y < 0.06) return [th, 0.5 + 0.5 * ss(-0.075, 0.06, y), B.pelvis, 0.5 * (1 - ss(-0.075, 0.06, y))];
      const k = 0.5 * ss(Th - 0.07, Th, y) + 0.5 * ss(Th, Th + 0.05, y);
      return [th, 1 - k, sh, k];
    },
    (y, ang) => {
      const t = y / Th;
      let d = 0.008 * m * G((t - 0.45) / 0.25) * bump(ang, 0.15, 0.7);
      d += 0.009 * m * G((t - 0.82) / 0.09) * bump(ang, -0.75, 0.45);
      d += 0.005 * m * G((t - 0.5) / 0.25) * bump(ang, Math.PI / 2 - 0.4, 0.5);
      d += 0.004 * G((t - 0.5) / 0.3) * bump(ang, Math.PI, 0.8);
      d += 0.005 * G((y - Th + 0.008) / 0.024) * bump(ang, 0, 0.6);
      if (kit.legTh > 0) d += hemT(y, legEnd, kit.botT * (o.bottomStyle === 'shorts' ? 1 + 0.5 * ss(legEnd - 0.1, legEnd, y) : 1));
      return d;
    },
  );
  const extraS = kit.legSh > 0 && kit.legSh < 1 ? [shinEnd - 0.003, shinEnd + 0.003] : [];
  b.frame(sh, !L).tube(
    resample(
      [
        { y: -0.05, rx: 0.028 * r, rz: 0.032 * r },
        { y: -0.028, rx: 0.045 * r, rz: 0.048 * r },
        { y: 0.0, rx: 0.05 * r, rz: 0.05 * r },
        { y: 0.08, rx: 0.048 * r, rz: 0.046 * r, ox: -0.006 * r },
        { y: S * 0.27, rx: 0.051 * r, rz: 0.048 * r, ox: -0.013 * r },
        { y: S * 0.55, rx: 0.04 * r, rz: 0.038 * r, ox: -0.006 * r },
        { y: S * 0.8, rx: 0.029 * r, rz: 0.029 * r, ox: -0.002 },
        { y: S * 0.95, rx: 0.027 * r, rz: 0.031 * r },
        { y: S + 0.018, rx: 0.024 * r, rz: 0.027 * r },
        { y: S + 0.034, rx: 0.008, rz: 0.01 },
      ],
      near ? 0.055 : 0.09,
      extraS,
    ),
    near ? 14 : 9,
    2.2,
    (v, y, ang) => {
      if (y < shinEnd) return accentLeg && Math.abs(dAng(ang, Math.PI / 2)) < 0.25 ? kit.accentB! : kit.bottom;
      return skin.at(v, 0.28 * G((y + 0.005) / 0.04) * bump(ang, 0, 0.8), 0);
    },
    (y) => (y < 0.06 ? [sh, 0.5 + 0.5 * ss(-0.05, 0.06, y), th, 0.5 * (1 - ss(-0.05, 0.06, y))] : [sh, 1]),
    (y, ang) => {
      const t = y / S;
      let d = 0.01 * m * G((t - 0.3) / 0.14) * bump(ang, Math.PI - 0.45, 0.55);
      d += 0.007 * m * G((t - 0.26) / 0.13) * bump(ang, Math.PI + 0.45, 0.5);
      d += 0.0025 * bump(ang, 0, 0.3) * ss(0.1, 0.3, t);
      d += 0.006 * G((y - S + 0.004) / 0.01) * bump(ang, Math.PI / 2, 0.45);
      d += 0.005 * G((y - S + 0.014) / 0.01) * bump(ang, -Math.PI / 2, 0.45);
      d += 0.002 * G((y + 0.01) / 0.025) * bump(ang, 0, 0.6);
      if (kit.legSh > 0) d += hemT(y, shinEnd, loose ? 0.014 + 0.016 * ss(0.3 * S, S, y) : kit.botT);
      if (kit.legTh > 1 && y < 0) d += loose ? 0.012 : kit.botT;
      return d;
    },
  );
  buildFoot(b, a, ft, !L, skin, near);
  if (o.shoe) buildShoe(b, a, ft, !L, new THREE.Color(o.shoe), [ft, 1], near);
  else {
    // the boat's fixed shoes ride on the stretcher bone (scale it to ~0 to hide them)
    buildShoe(b, a, ft, !L, new THREE.Color(a.shoe), [B.stretcher, 1], near);
    if (L) b.frame(B.stretcher).box(-0.018, 0.12, 0, 0.006, 0.19, 0.19, paint('#1b1c1e', 0.6), [B.stretcher, 1]);
  }
}

function buildFoot(b: Builder, a: Anthro, ft: number, mirror: boolean, skin: SkinTone, near: boolean) {
  const Fl = a.foot;
  const ah = a.ankleH;
  const sole = -ah;
  const heel = -0.27 * Fl;
  const ring = (y: number, top: number, hw: number, oz = 0): Ring => ({ y, rx: (top - sole) / 2, rz: hw, ox: (top + sole) / 2, oz });
  b.frame(ft, mirror).tube(
    [
      ring(heel - 0.006, sole + 0.03, 0.018),
      ring(heel + 0.012, -ah + 0.06, 0.03),
      ring(heel + 0.04, -ah + 0.075, 0.033),
      ring(0.0, 0.026, 0.034),
      ring(0.25 * Fl, -ah + 0.056, 0.039, 0.003),
      ring(0.5 * Fl, -ah + 0.04, 0.044, 0.002),
      ring(0.62 * Fl, -ah + 0.03, 0.047, -0.002),
      ring(0.7 * Fl, -ah + 0.022, 0.043, -0.004),
      ring(0.76 * Fl, -ah + 0.015, 0.034, -0.006),
      ring(0.78 * Fl, -ah + 0.01, 0.018, -0.008),
    ],
    near ? 8 : 6,
    2.4,
    (v, y) => {
      const toe = ss(0.66 * Fl, 0.7 * Fl, y);
      const crease = toe * G(Math.sin((v.z + 0.004) * 95) * 1.6) * 0.25;
      return skin.at(v, 0.12 + 0.12 * toe, crease, R_SKIN, v.x < sole + 0.01 ? 0.6 : 0);
    },
    (y) => (y < 0.03 ? [ft, 0.75 + 0.25 * ss(-0.02, 0.03, y), mirror ? B.shinR : B.shinL, 0.25 * (1 - ss(-0.02, 0.03, y))] : [ft, 1]),
  );
}

function buildShoe(b: Builder, a: Anthro, ft: number, mirror: boolean, shoe: THREE.Color, w: W, near: boolean) {
  const Fl = a.foot;
  const ah = a.ankleH;
  const sole = -ah - 0.014;
  const heel = -0.27 * Fl;
  const ring = (y: number, top: number, hw: number): Ring => ({ y, rx: (top - sole) / 2, rz: hw, ox: (top + sole) / 2 });
  const upper = paint(shoe, 0.6);
  const solep = paint('#e9e7e1', 0.85);
  const dark = paint(DARK, 0.6);
  const lum = shoe.r + shoe.g + shoe.b;
  b.frame(ft, mirror).tube(
    [
      ring(heel - 0.014, sole + 0.042, 0.024),
      ring(heel, 0.046, 0.037),
      ring(heel + 0.04, 0.05, 0.041),
      ring(0.06 * Fl, 0.034, 0.045),
      ring(0.3 * Fl, -ah + 0.068, 0.049),
      ring(0.52 * Fl, -ah + 0.053, 0.053),
      ring(0.66 * Fl, -ah + 0.042, 0.05),
      ring(0.75 * Fl, -ah + 0.03, 0.038),
      ring(0.785 * Fl, -ah + 0.012, 0.02),
    ],
    near ? 10 : 7,
    3,
    (v, y) => {
      if (v.x < sole + 0.012) return lum > 1.5 ? dark : solep;
      if (Math.abs(y - 0.2 * Fl) < 0.06 && Math.abs(v.z) < 0.02 && v.x > -ah + 0.04) return lum > 1.5 ? dark : solep;
      if (y < heel + 0.03 && v.x > sole + 0.03) return dark;
      return upper;
    },
    () => w,
  );
}

// ---------------------------------------------------------------- PFD
function buildPfd(b: Builder, a: Anthro, c: THREE.Color, near: boolean) {
  const s = a.H / 1.88;
  const wS = a.girth * s;
  const T = a.trunk;
  const f = a.female ? 1 : 0;
  const foam = new Paint().paint(c, 0.72);
  const strap = paint('#1a1a1c', 0.5);
  const rows: [number, number, number][] = [
    [0.2, 0.128, 0.168],
    [0.24, 0.14, 0.18],
    [0.45, 0.142, 0.182 - 0.01 * f],
    [0.62, 0.15 + 0.02 * f, 0.192 - 0.012 * f],
    [0.76, 0.152 + 0.02 * f, 0.2 - 0.016 * f],
    [0.84, 0.14, 0.198 - 0.016 * f],
    [0.88, 0.1, 0.17],
  ];
  b.frame(B.pelvis).tube(
    rows.map(([t, d, w]) => ({ y: t * T, rx: d * wS, rz: w * wS, ox: 0.008 * wS })),
    near ? 24 : 12,
    3,
    (v, y) => {
      const t = y / T;
      if (Math.abs(t - 0.38) < 0.025 || Math.abs(t - 0.62) < 0.025) return strap;
      if (v.x > 0 && Math.abs(v.z) < 0.006) return strap;
      return foam;
    },
    (y) => {
      const t = y / T;
      if (t < 0.25) return [B.pelvis, 1 - t / 0.25, B.spine, t / 0.25];
      if (t < 0.55) return [B.spine, 1 - (t - 0.25) / 0.3, B.chest, (t - 0.25) / 0.3];
      return [B.chest, 1];
    },
  );
  // shoulder straps over the trapezius
  for (const zs of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const ang = (k / 6) * Math.PI;
      pts.push(new THREE.Vector3(Math.cos(ang) * 0.1 * wS, 0.86 * T + Math.sin(ang) * 0.17 * T, zs * 0.115 * wS));
    }
    b.frame(B.chest);
    const toChest = new THREE.Vector3(0, -0.55 * T, 0);
    b.sweep(
      pts.map((p) => p.add(toChest)),
      pts.map(() => 0.02 * wS),
      near ? 6 : 4,
      new THREE.Vector3(0, 0, 1),
      foam,
      [B.chest, 1],
      0.45,
    );
  }
}
