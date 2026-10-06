import * as THREE from 'three';
import { CARDINAL, DARK, WHITE, type Anthro } from './anthro';
import { Builder, type Ring, type W } from './builder';
import { B, gripLocal, type Rig } from './rig';

const ss = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const G = (x: number) => Math.exp(-x * x);

const C_CARD = new THREE.Color(CARDINAL);
const C_WHITE = new THREE.Color(WHITE);
const C_DARK = new THREE.Color(DARK);
const C_LIP = new THREE.Color('#8e4440');
const C_SOLE = new THREE.Color('#3a3a3c');
const C_PLATE = new THREE.Color('#1b1c1e');
const C_LENS = new THREE.Color('#141820');
const C_IRIS = new THREE.Color('#2b1d14');
const C_SCLERA = new THREE.Color('#e6e1d8');
const C_TIE = new THREE.Color('#1a1a1a');

function mix(a: THREE.Color, b: THREE.Color, t: number) {
  return a.clone().lerp(b, THREE.MathUtils.clamp(t, 0, 1));
}

/** Head surface, hair and headwear helpers in the head-bone frame (X face, Y up, Z right). */
class HeadShape {
  readonly hd: number;
  readonly cx: number;
  readonly cy: number;
  constructor(private readonly a: Anthro) {
    this.hd = a.head;
    this.cx = 0.012 * this.hd;
    this.cy = 0.085 * this.hd;
  }

  /** Hairline coverage 0..1 */
  hair(u: THREE.Vector3) {
    const a = this.a;
    let line = THREE.MathUtils.lerp(-0.55, 0.62, Math.pow(ss(-0.6, 0.9, u.x), 1.2));
    const ear = G(u.x / 0.45) * ss(0.7, 0.95, Math.abs(u.z));
    line = THREE.MathUtils.lerp(line, 0.16, ear);
    if (a.hairStyle === 'pony' || a.hairStyle === 'bun') line -= 0.05;
    return ss(line - 0.04, line + 0.04, u.y);
  }

  hairThickness(u: THREE.Vector3) {
    const a = this.a;
    const h = this.hair(u);
    let t = 0.003;
    if (a.hairStyle === 'crop') t = 0.009;
    else if (a.hairStyle === 'swept') t = 0.008 + 0.014 * ss(0.2, 0.9, u.y) * ss(-0.3, 0.7, u.x);
    else if (a.hairStyle === 'pony' || a.hairStyle === 'bun') t = 0.006;
    return t * h;
  }

  surf(u: THREE.Vector3, out: THREE.Vector3, extra = 0) {
    let x = u.x * 0.098;
    let y = u.y * 0.118;
    let z = u.z * 0.077;
    const front = ss(0.2, 0.9, u.x);
    const jaw = ss(0.0, -0.9, u.y);
    z *= 1 - 0.27 * jaw * (0.7 + 0.3 * front);
    const occ = ss(-0.2, -0.9, u.y) * ss(0.3, -0.5, u.x);
    x *= 1 - 0.3 * occ;
    y *= 1 - 0.22 * occ;
    x *= 1 - 0.05 * front;
    const az = Math.abs(u.z);
    x += 0.008 * G((u.y - 0.29) / 0.07) * front * G(u.z / 0.5);
    x -= 0.009 * G((u.y - 0.15) / 0.07) * G((az - 0.36) / 0.11) * front;
    z *= 1 + 0.06 * G((u.y + 0.05) / 0.2) * ss(0.0, 0.6, u.x);
    const chin = G((u.y + 0.86) / 0.13) * front * G(u.z / 0.35);
    x += 0.012 * chin;
    y -= 0.006 * chin;
    x += 0.004 * G((u.y + 0.57) / 0.06) * front * G(u.z / 0.25);
    const hd = this.hd;
    const th = this.hairThickness(u) + extra;
    return out.set(x * hd + this.cx + u.x * th, y * hd + this.cy + u.y * th, z * hd + u.z * th);
  }

  /** Point on the face midline at direction height uy. */
  mid(uy: number, out: THREE.Vector3) {
    const u = new THREE.Vector3(Math.sqrt(1 - uy * uy), uy, 0);
    return this.surf(u, out);
  }

  capLine(ph: number) {
    const ux = Math.cos(ph);
    return THREE.MathUtils.lerp(0.02, 0.5, ss(-0.8, 0.9, ux));
  }

  color(u: THREE.Vector3, skin: THREE.Color, hairC: THREE.Color) {
    const front = ss(0.3, 0.9, u.x);
    const az = Math.abs(u.z);
    let c = skin.clone();
    const brow = G((u.y - 0.27) / 0.03) * G((az - 0.34) / 0.1) * front;
    const lip = G((u.y + 0.57) / 0.035) * G(u.z / 0.22) * front;
    const socket = G((u.y - 0.15) / 0.08) * G((az - 0.36) / 0.12) * front;
    c.lerp(C_DARK, 0.12 * socket);
    c.lerp(C_LIP, 0.45 * lip);
    c.lerp(hairC, Math.max(0.85 * brow, this.hair(u)));
    return c;
  }
}

export function buildFigureGeometry(a: Anthro, rest: Rig): THREE.BufferGeometry {
  const mats: THREE.Matrix4[] = [];
  for (let i = 0; i < rest.p.length; i++) mats.push(new THREE.Matrix4().compose(rest.p[i], rest.q[i], new THREE.Vector3(1, 1, 1)));
  const b = new Builder(mats);
  const s = a.H / 1.88;
  const g = a.girth;
  const T = a.trunk;
  const skin = new THREE.Color(a.skin);
  const hairC = new THREE.Color(a.hair);
  const shoe = new THREE.Color(a.shoe);

  // ---- torso (pelvis frame: X anterior, Y up, Z right) ----
  const f = a.female ? 1 : 0;
  const wS = g * s;
  const rows: [number, number, number, number][] = [
    // y/T, half depth, half width, x offset
    [-0.19, 0.05, 0.09 + 0.01 * f, -0.03],
    [-0.165, 0.1, 0.155 + 0.01 * f, -0.025],
    [-0.08, 0.12, 0.175 + 0.012 * f, -0.012],
    [0.05, 0.115, 0.165 + 0.01 * f, -0.005],
    [0.2, 0.1, 0.148, 0],
    [0.35, 0.095, 0.138 - 0.01 * f, 0.002],
    [0.5, 0.104, 0.152 - 0.008 * f, 0.006],
    [0.65, 0.114 + 0.012 * f, 0.168 - 0.012 * f, 0.012 + 0.01 * f],
    [0.78, 0.112, 0.183 - 0.014 * f, 0.008],
    [0.9, 0.088, 0.19 - 0.016 * f, 0],
    [0.98, 0.07, 0.168 - 0.014 * f, -0.006],
    [1.03, 0.064, 0.125 - 0.01 * f, -0.012],
    [1.09, 0.058, 0.075, -0.016],
    [1.14, 0.05, 0.052, -0.016],
  ];
  const torsoRings: Ring[] = rows.map(([t, d, w, ox]) => ({ y: t * T, rx: d * wS, rz: w * wS, ox: ox * wS }));
  b.frame(B.pelvis).tube(
    torsoRings,
    24,
    2.5,
    (v, y) => {
      const t = y / T;
      const az = Math.abs(v.z) / (0.19 * wS);
      if (t > 1.02) return skin;
      if (t > 0.88 && az > 0.55) return skin; // bare shoulders (tank cut)
      if (t > 0.9 && v.x > 0 && Math.abs(v.z) < 0.07 * wS) return skin; // scoop neck
      if (t > 0.85 && t < 0.89 && az > 0.4) return C_WHITE; // armhole trim
      return C_CARD;
    },
    (y, ang) => {
      const t = y / T;
      const lat = Math.abs(Math.sin(ang));
      if (t < 0) return [B.pelvis, 1];
      if (t < 0.25) return [B.pelvis, 1 - t / 0.25, B.spine, t / 0.25];
      if (t < 0.55) return [B.spine, 1 - (t - 0.25) / 0.3, B.chest, (t - 0.25) / 0.3];
      if (t < 0.85) return [B.chest, 1];
      const k = ss(0.85, 1.0, t) * ss(0.45, 0.9, lat);
      const n = ss(0.98, 1.1, t);
      const clav = Math.sin(ang) < 0 ? B.clavL : B.clavR;
      return [B.chest, Math.max(0.01, 1 - 0.5 * k - n), clav, 0.5 * k, B.neck, n];
    },
  );

  // ---- neck ----
  const nr = 0.061 * wS * (a.female ? 0.9 : 1);
  b.frame(B.neck).tube(
    [
      { y: -0.06, rx: nr * 1.1, rz: nr * 1.3, ox: -0.01 },
      { y: 0.0, rx: nr, rz: nr * 1.05 },
      { y: a.neck * 0.5, rx: nr * 0.95, rz: nr * 0.95 },
      { y: a.neck + 0.02, rx: nr * 0.95, rz: nr * 0.95, ox: -0.005 },
      { y: a.neck + 0.05, rx: nr * 0.6, rz: nr * 0.6, ox: -0.01 },
    ],
    16,
    2.2,
    () => skin,
    (y) => {
      const t = ss(-0.04, a.neck + 0.01, y);
      if (y < 0.0) return [B.chest, 1 - ss(-0.06, 0, y) * 0.5, B.neck, ss(-0.06, 0, y) * 0.5];
      return [B.neck, 1 - t, B.head, t];
    },
  );

  // ---- head ----
  const hs = new HeadShape(a);
  const HW: W = [B.head, 1];
  const v = new THREE.Vector3();
  const u = new THREE.Vector3();
  b.frame(B.head).blob(
    16,
    22,
    (uu, out) => hs.surf(uu, out),
    (uu) => hs.color(uu, skin, hairC),
    HW,
  );
  // nose
  const np = [0.17, 0.05, -0.12, -0.27, -0.35].map((y) => hs.mid(y, new THREE.Vector3()));
  const nOut = [0.0, 0.006, 0.013, 0.017, 0.006].map((x) => x * a.head);
  np.forEach((p, i) => (p.x += nOut[i] - 0.004));
  b.sweep(np, [0.006, 0.0075, 0.009, 0.0105, 0.006].map((r) => r * a.head), 8, new THREE.Vector3(0, 0, 1), mix(skin, C_LIP, 0.06), HW, 1.15);
  for (const zs of [-1, 1]) {
    const c = np[3].clone().add(new THREE.Vector3(-0.007, -0.004, zs * 0.0125).multiplyScalar(a.head));
    b.blob(4, 6, (uu, out) => out.set(c.x + uu.x * 0.0085, c.y + uu.y * 0.0075, c.z + uu.z * 0.008), () => skin, HW);
    // eye
    u.set(0.92, 0.15, zs * 0.4).normalize();
    const e = hs.surf(u, new THREE.Vector3(), 0);
    e.x -= 0.006 * a.head;
    const er = 0.0115 * a.head;
    b.blob(5, 8, (uu, out) => out.copy(e).addScaledVector(uu, er), (uu) => (uu.x > 0.82 ? C_IRIS : C_SCLERA), HW);
    // ear
    u.set(-0.08, 0.0, zs).normalize();
    const ec = hs.surf(u, new THREE.Vector3(), 0);
    ec.z += zs * 0.003;
    b.blob(
      6,
      8,
      (uu, out) => out.set(ec.x + uu.x * 0.024 * a.head - uu.y * 0.004, ec.y + uu.y * 0.031 * a.head, ec.z + uu.z * 0.009),
      () => mix(skin, C_DARK, 0.08),
      HW,
    );
  }
  // ponytail / bun
  if (a.hairStyle === 'pony' || a.hairStyle === 'bun') {
    u.set(-0.85, 0.42, 0).normalize();
    const base = hs.surf(u, new THREE.Vector3(), 0);
    if (a.hairStyle === 'bun') {
      const c = base.clone().add(new THREE.Vector3(-0.022, 0.01, 0));
      b.blob(7, 10, (uu, out) => out.copy(c).addScaledVector(uu, 0.034 * a.head), () => hairC, HW);
    } else {
      const pts = [
        base.clone().add(new THREE.Vector3(0.006, 0, 0)),
        base.clone().add(new THREE.Vector3(-0.016, -0.012, 0)),
        base.clone().add(new THREE.Vector3(-0.034, -0.06, 0)),
        base.clone().add(new THREE.Vector3(-0.04, -0.13, 0)),
        base.clone().add(new THREE.Vector3(-0.036, -0.2, 0)),
      ];
      b.sweep(pts, [0.016, 0.017, 0.02, 0.015, 0.006], 8, new THREE.Vector3(0, 0, 1), hairC, HW, 1.1);
      b.sweep([pts[1].clone().add(new THREE.Vector3(0.004, 0.004, 0)), pts[1].clone().add(new THREE.Vector3(-0.004, -0.004, 0))], [0.0185, 0.0185], 8, new THREE.Vector3(0, 0, 1), C_TIE, HW);
    }
  }
  // cap / visor
  if (a.headwear !== 'none') {
    const cc = new THREE.Color(a.headwearColor);
    const edgeTh = (ph: number) => Math.acos(hs.capLine(ph));
    if (a.headwear === 'cap') {
      b.blob(
        9,
        24,
        (uu, out, fr) => hs.surf(uu, out, THREE.MathUtils.lerp(0.009, 0.0035, Math.pow(fr, 4))),
        () => cc,
        HW,
        (ph) => [0, edgeTh(ph)],
      );
    } else {
      b.blob(
        2,
        24,
        (uu, out) => hs.surf(uu, out, 0.0045),
        () => cc,
        HW,
        (ph) => [edgeTh(ph) - 0.2, edgeTh(ph)],
      );
    }
    const brimPhi = 1.05;
    const inner = new THREE.Vector3();
    b.sheet(
      3,
      14,
      (i, j, side, out) => {
        const ph = -brimPhi + (2 * brimPhi * j) / 14;
        const th = edgeTh(ph) - 0.03;
        u.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
        hs.surf(u, inner, 0.006);
        const r = i / 3;
        const L = 0.07 * a.head * Math.pow(Math.cos(ph / brimPhi * 1.35), 0.6);
        out.set(Math.cos(ph), 0, Math.sin(ph)).multiplyScalar(L * r).add(inner);
        out.y -= 0.016 * r * r + (side === 0 ? 0.0035 : 0);
      },
      cc,
      HW,
    );
  }
  if (a.glasses) {
    const PH = 1.6;
    const cols = 26;
    b.sheet(
      3,
      cols,
      (i, j, side, out) => {
        const ph = -PH + (2 * PH * j) / cols;
        const temple = ss(1.05, 1.25, Math.abs(ph));
        const half = THREE.MathUtils.lerp(0.1, 0.025, temple);
        const vy = 0.15 + 0.03 * temple + (-half + (2 * half * i) / 3) * (1 - 0.15 * Math.abs(ph));
        const th = Math.acos(vy);
        u.set(Math.sin(th) * Math.cos(ph), vy, Math.sin(th) * Math.sin(ph));
        const off = THREE.MathUtils.lerp(0.011, 0.004, temple) + (side === 0 ? 0.002 : 0);
        hs.surf(u, out, off);
        if (Math.abs(ph) < 1.05) out.addScaledVector(v.set(1, 0, 0), 0.006 * (1 - Math.abs(ph)));
      },
      C_LENS,
      HW,
    );
  }

  // ---- arms ----
  for (const L of [true, false]) {
    const ua = L ? B.upArmL : B.upArmR;
    const fa = L ? B.foreArmL : B.foreArmR;
    const hd = L ? B.handL : B.handR;
    const clav = L ? B.clavL : B.clavR;
    const r = wS * (a.female ? 0.9 : 1);
    const U = a.upperArm;
    b.frame(ua).tube(
      [
        { y: -0.055, rx: 0.03 * r, rz: 0.03 * r },
        { y: -0.035, rx: 0.052 * r, rz: 0.054 * r },
        { y: 0.04, rx: 0.054 * r, rz: 0.05 * r },
        { y: U * 0.4, rx: 0.046 * r, rz: 0.043 * r, ox: 0.006 * r },
        { y: U * 0.7, rx: 0.042 * r, rz: 0.04 * r, ox: 0.004 * r },
        { y: U * 0.92, rx: 0.034 * r, rz: 0.038 * r },
        { y: U + 0.02, rx: 0.03 * r, rz: 0.034 * r, ox: -0.006 },
        { y: U + 0.035, rx: 0.015, rz: 0.02 },
      ],
      14,
      2.2,
      () => skin,
      (y) => {
        if (y < 0.03) return [ua, 0.55 + 0.45 * ss(-0.05, 0.03, y), clav, 0.45 * (1 - ss(-0.05, 0.03, y))];
        if (y > U - 0.04) return [ua, 1 - 0.5 * ss(U - 0.04, U + 0.02, y), fa, 0.5 * ss(U - 0.04, U + 0.02, y)];
        return [ua, 1];
      },
    );
    const F = a.foreArm;
    b.frame(fa).tube(
      [
        { y: -0.035, rx: 0.02 * r, rz: 0.024 * r },
        { y: -0.015, rx: 0.036 * r, rz: 0.038 * r },
        { y: F * 0.25, rx: 0.038 * r, rz: 0.042 * r },
        { y: F * 0.6, rx: 0.028 * r, rz: 0.034 * r },
        { y: F * 0.92, rx: 0.019 * r, rz: 0.029 * r },
        { y: F + 0.015, rx: 0.016 * r, rz: 0.027 * r },
        { y: F + 0.03, rx: 0.01, rz: 0.016 },
      ],
      12,
      2.2,
      () => skin,
      (y) => {
        if (y < 0.03) return [fa, 0.5 + 0.5 * ss(-0.03, 0.03, y), ua, 0.5 * (1 - ss(-0.03, 0.03, y))];
        if (y > F - 0.03) return [fa, 1 - 0.6 * ss(F - 0.03, F + 0.02, y), hd, 0.6 * ss(F - 0.03, F + 0.02, y)];
        return [fa, 1];
      },
    );
    buildHand(b, a, hd, L, skin);
  }

  // ---- legs ----
  for (const L of [true, false]) {
    const th = L ? B.thighL : B.thighR;
    const sh = L ? B.shinL : B.shinR;
    const ft = L ? B.footL : B.footR;
    const Th = a.thigh;
    const r = wS;
    const shortEnd = Th * 0.42;
    b.frame(th).tube(
      [
        { y: -0.07, rx: 0.07 * r, rz: 0.075 * r, ox: -0.01 },
        { y: 0.0, rx: 0.088 * r, rz: 0.087 * r },
        { y: Th * 0.3, rx: 0.08 * r, rz: 0.078 * r, ox: 0.006 },
        { y: shortEnd - 0.012, rx: 0.075 * r, rz: 0.073 * r, ox: 0.006 },
        { y: shortEnd, rx: 0.073 * r, rz: 0.071 * r, ox: 0.006 },
        { y: shortEnd + 0.012, rx: 0.071 * r, rz: 0.069 * r, ox: 0.006 },
        { y: Th * 0.65, rx: 0.066 * r, rz: 0.062 * r, ox: 0.006 },
        { y: Th * 0.88, rx: 0.052 * r, rz: 0.05 * r },
        { y: Th, rx: 0.05 * r, rz: 0.05 * r, ox: 0.004 },
        { y: Th + 0.035, rx: 0.03, rz: 0.035 },
      ],
      16,
      2.2,
      (_v, y) => (y < shortEnd - 0.006 ? C_CARD : y < shortEnd + 0.006 ? C_WHITE : skin),
      (y) => {
        if (y < 0.06) return [th, 0.5 + 0.5 * ss(-0.07, 0.06, y), B.pelvis, 0.5 * (1 - ss(-0.07, 0.06, y))];
        if (y > Th - 0.05) return [th, 1 - 0.5 * ss(Th - 0.05, Th + 0.03, y), sh, 0.5 * ss(Th - 0.05, Th + 0.03, y)];
        return [th, 1];
      },
    );
    const S = a.shin;
    b.frame(sh).tube(
      [
        { y: -0.04, rx: 0.03, rz: 0.035 },
        { y: -0.01, rx: 0.05 * r, rz: 0.05 * r },
        { y: S * 0.22, rx: 0.054 * r, rz: 0.052 * r, ox: -0.014 * r },
        { y: S * 0.5, rx: 0.044 * r, rz: 0.042 * r, ox: -0.008 * r },
        { y: S * 0.8, rx: 0.03 * r, rz: 0.03 * r, ox: -0.002 },
        { y: S, rx: 0.028, rz: 0.032 },
        { y: S + 0.025, rx: 0.02, rz: 0.024 },
      ],
      14,
      2.2,
      () => skin,
      (y) => {
        if (y < 0.04) return [sh, 0.5 + 0.5 * ss(-0.04, 0.04, y), th, 0.5 * (1 - ss(-0.04, 0.04, y))];
        if (y > S - 0.05) return [sh, 1 - 0.6 * ss(S - 0.05, S, y), ft, 0.6 * ss(S - 0.05, S, y)];
        return [sh, 1];
      },
    );
    buildShoe(b, a, ft, shoe);
  }

  // ---- foot stretcher plate (rigid, on the stretcher bone) ----
  b.frame(B.stretcher).box(-0.018, 0.12, 0, 0.006, 0.19, 0.19, C_PLATE, [B.stretcher, 1]);

  return b.geometry();
}

function buildShoe(b: Builder, a: Anthro, ft: number, shoe: THREE.Color) {
  const Fl = a.foot;
  const ah = a.ankleH;
  const sole = -ah - 0.012;
  const heel = -0.27 * Fl;
  const ring = (y: number, top: number, hw: number): Ring => ({ y, rx: (top - sole) / 2, rz: hw, ox: (top + sole) / 2 });
  b.frame(ft).tube(
    [
      ring(heel - 0.012, sole + 0.04, 0.022),
      ring(heel, 0.04, 0.034),
      ring(heel + 0.04, 0.045, 0.038),
      ring(0.06 * Fl, 0.03, 0.042),
      ring(0.3 * Fl, 0.0, 0.046),
      ring(0.52 * Fl, -ah + 0.05, 0.05),
      ring(0.66 * Fl, -ah + 0.04, 0.047),
      ring(0.74 * Fl, -ah + 0.028, 0.034),
      ring(0.76 * Fl, -ah + 0.012, 0.016),
    ],
    14,
    3,
    (v, y) => {
      if (v.x < sole + 0.008) return C_SOLE;
      if (Math.abs(y - 0.22 * Fl) < 0.022 && v.x > -ah + 0.01) return C_DARK;
      return shoe;
    },
    () => [ft, 1],
  );
}

/** Hand closed in a hook grip around the handle (axis = local Z). */
function buildHand(b: Builder, a: Anthro, hd: number, left: boolean, skin: THREE.Color) {
  const s = a.hand / 0.2;
  const gl = gripLocal(a, new THREE.Vector3());
  const W1: W = [hd, 1];
  b.frame(hd, left);
  const pr = s * (a.female ? 0.92 : 1);
  b.tube(
    [
      { y: -0.02, rx: 0.015 * pr, rz: 0.026 * pr },
      { y: 0.0, rx: 0.017 * pr, rz: 0.032 * pr, ox: 0.0 },
      { y: 0.045 * s, rx: 0.016 * pr, rz: 0.04 * pr, ox: -0.002, oz: 0.002 },
      { y: 0.088 * s, rx: 0.013 * pr, rz: 0.042 * pr, ox: 0.0 },
      { y: 0.097 * s, rx: 0.009 * pr, rz: 0.036 * pr, ox: 0.0 },
    ],
    12,
    2.6,
    () => skin,
    (y) => (y < 0.0 ? [hd, 0.7, left ? B.foreArmL : B.foreArmR, 0.3] : W1),
  );
  const cx = gl.x;
  const cy = gl.y;
  const ref = new THREE.Vector3(0, 0, 1);
  const fingers: [number, number, number][] = [
    // z, length factor, radius
    [0.027, 0.94, 0.0092],
    [0.009, 1.0, 0.0095],
    [-0.009, 0.96, 0.009],
    [-0.026, 0.8, 0.008],
  ];
  for (const [fz, lf, fr] of fingers) {
    const z = fz * pr;
    const start = new THREE.Vector3(0.003 * s, 0.09 * s, z);
    const a0 = Math.atan2(start.y - cy, start.x - cx);
    const r0 = Math.hypot(start.x - cx, start.y - cy);
    const r1 = 0.02 + fr * s * 1.05;
    const sweepA = 3.6 * lf;
    const pts: THREE.Vector3[] = [];
    const radii: number[] = [];
    const n = 5;
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const ang = a0 + sweepA * t;
      const rr = THREE.MathUtils.lerp(r0, r1, ss(0, 0.35, t));
      pts.push(new THREE.Vector3(cx + Math.cos(ang) * rr, cy + Math.sin(ang) * rr, z));
      radii.push(fr * s * (1 - 0.18 * t));
    }
    b.sweep(pts, radii, 6, ref, skin, W1, 0.92);
  }
  // thumb: from the thenar eminence under the handle, alongside the index finger
  const th = [
    new THREE.Vector3(-0.01 * s, 0.018 * s, 0.03 * pr),
    new THREE.Vector3(-0.022 * s, 0.04 * s, 0.04 * pr),
    new THREE.Vector3(cx - 0.006, cy - 0.032 * s, 0.043 * pr),
    new THREE.Vector3(cx - 0.024, cy - 0.016 * s, 0.04 * pr),
    new THREE.Vector3(cx - 0.032, cy + 0.006 * s, 0.036 * pr),
  ];
  b.sweep(th, [0.016 * s, 0.013 * s, 0.0115 * s, 0.0105 * s, 0.009 * s], 6, ref, skin, W1);
  b.frame(hd, false);
}
