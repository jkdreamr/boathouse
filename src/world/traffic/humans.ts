import * as THREE from 'three';
import { type Anthro, CARDINAL, DARK, type HairStyle, type Headwear, makeAnthro, SKIN_TONES, WHITE } from '../../rowing/figure/anthro';
import { buildFigureGeometry } from '../../rowing/figure/body';
import type { Outfit } from '../../rowing/figure/outfit';
import { B, BONE_COUNT, gripLocal, makeRig, type Rig } from '../../rowing/figure/rig';
import { FIGURE_MATERIAL } from '../../rowing/rower';
import type { Look } from './people';

/**
 * Skinned people for the small traffic craft (kayaks, SUPs, OC6, dinghies, launch, motorboat).
 *
 * Everything is in craft-local coordinates (+x bow, y up, +z starboard). Bone frames follow rig.ts:
 * X anterior, Y along the bone, Z toward the body's right. A pose is described by where the hips are,
 * how the trunk is tilted and twisted, where the hands grip and where the feet are planted; the solver
 * below turns that into the 21 bone transforms with two-bone IK for the limbs.
 */

export interface FootPlant {
  /** Bottom-back corner of the sole (where the heel touches the deck). */
  heel: THREE.Vector3;
  /** Heel → toe (unit). */
  toe: THREE.Vector3;
  /** Sole normal, pointing up out of the shoe (unit). */
  sole: THREE.Vector3;
}

export interface HumanPose {
  /** Hip-joint centre (pelvis bone origin). */
  hip: THREE.Vector3;
  /** Facing of the hips about +y (0 = toward the bow, + turns toward port). */
  yaw: number;
  /** Trunk axis, unit. */
  up: THREE.Vector3;
  /** Shoulder rotation relative to the hips, + brings the right shoulder back. */
  twist: number;
  /** Grip centres and the direction each thumb points along the held object. */
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  thumbL: THREE.Vector3;
  thumbR: THREE.Vector3;
  /** Elbow pole in chest frame (x fwd, y up, z right of the body); left is mirrored. */
  elbow: THREE.Vector3;
  footL: FootPlant;
  footR: FootPlant;
  /** Knee pole (craft-local direction) and how far the knees splay outward (m). */
  knee: THREE.Vector3;
  kneeOut: number;
  /** Point the head looks at. */
  gaze: THREE.Vector3;
  /** Draw legs on the far-LOD proxy (false where the hull hides them). */
  legs: boolean;
}

const v = () => new THREE.Vector3();
const plant = (): FootPlant => ({ heel: v(), toe: new THREE.Vector3(1, 0, 0), sole: new THREE.Vector3(0, 1, 0) });

export function makePose(): HumanPose {
  return {
    hip: v(),
    yaw: 0,
    up: new THREE.Vector3(0, 1, 0),
    twist: 0,
    handL: v(),
    handR: v(),
    thumbL: new THREE.Vector3(0, 0, 1),
    thumbR: new THREE.Vector3(0, 0, -1),
    elbow: new THREE.Vector3(-0.35, -0.6, 0.7),
    footL: plant(),
    footR: plant(),
    knee: new THREE.Vector3(1, 0, 0),
    kneeOut: 0.05,
    gaze: new THREE.Vector3(10, 1.5, 0),
    legs: true,
  };
}

/** Trunk tilt from forward lean (toward the facing direction) and side roll (toward the right side). */
export function setTrunk(p: HumanPose, lean: number, roll: number) {
  const fx = Math.cos(p.yaw);
  const fz = -Math.sin(p.yaw);
  const sl = Math.sin(lean);
  const cl = Math.cos(lean);
  const sr = Math.sin(roll);
  p.up.set(fx * sl - fz * sr, cl * Math.cos(roll), fz * sl + fx * sr).normalize();
  return p;
}

/** Thumbs point at each other along a shaft held in both hands. */
export function thumbsAlong(p: HumanPose) {
  p.thumbR.subVectors(p.handL, p.handR).normalize();
  p.thumbL.copy(p.thumbR).negate();
  return p;
}

/** Plant a foot flat on a deck at height y, heel at (x, z), toes along heading `ang` (0 = +x). */
export function flatFoot(f: FootPlant, x: number, y: number, z: number, ang: number) {
  f.heel.set(x, y, z);
  f.toe.set(Math.cos(ang), 0, -Math.sin(ang));
  f.sole.set(0, 1, 0);
  return f;
}

/** Plant a foot with the sole pitched by `pitch` (rad, + toes up). */
export function tiltFoot(f: FootPlant, x: number, y: number, z: number, ang: number, pitch: number) {
  f.heel.set(x, y, z);
  const c = Math.cos(pitch);
  const s = Math.sin(pitch);
  f.toe.set(Math.cos(ang) * c, s, -Math.sin(ang) * c);
  f.sole.set(-Math.cos(ang) * s, c, Math.sin(ang) * s);
  return f;
}

export function copyPose(dst: HumanPose, src: HumanPose) {
  dst.hip.copy(src.hip);
  dst.yaw = src.yaw;
  dst.up.copy(src.up);
  dst.twist = src.twist;
  dst.handL.copy(src.handL);
  dst.handR.copy(src.handR);
  dst.thumbL.copy(src.thumbL);
  dst.thumbR.copy(src.thumbR);
  dst.elbow.copy(src.elbow);
  for (const k of ['footL', 'footR'] as const) {
    dst[k].heel.copy(src[k].heel);
    dst[k].toe.copy(src[k].toe);
    dst[k].sole.copy(src[k].sole);
  }
  dst.knee.copy(src.knee);
  dst.kneeOut = src.kneeOut;
  dst.gaze.copy(src.gaze);
  dst.legs = src.legs;
}

// ---------------------------------------------------------------------------------------------
// Solver
// ---------------------------------------------------------------------------------------------

const Y = new THREE.Vector3(0, 1, 0);
const _q = new THREE.Quaternion();
const _qt = new THREE.Quaternion();
const _qy = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _g = new THREE.Vector3();
const _u = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _wr = new THREE.Vector3();
const _gl = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _end = new THREE.Vector3();
const _ank = new THREE.Vector3();

/** Frame with +Y along `y` and +X toward `hint` (orthogonalised). Same convention as rig.ts. */
function frame(y: THREE.Vector3, hint: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _x.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Two-bone IK (law of cosines), middle joint bent toward `pole`. */
function twoBone(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3, bend: THREE.Vector3) {
  _v.subVectors(target, root);
  let L = _v.length();
  _v.divideScalar(L || 1);
  L = THREE.MathUtils.clamp(L, Math.abs(a - b) + 1e-4, (a + b) * 0.9995);
  const ca = (a * a + L * L - b * b) / (2 * a * L);
  const h = a * Math.sqrt(Math.max(0, 1 - ca * ca));
  bend.copy(pole).addScaledVector(_v, -pole.dot(_v));
  if (bend.lengthSq() < 1e-8) bend.set(0, 1, 0).addScaledVector(_v, -_v.y);
  bend.normalize();
  mid.copy(root).addScaledVector(_v, a * ca).addScaledVector(bend, h);
  end.copy(root).addScaledVector(_v, L);
}

function at(pos: THREE.Vector3, q: THREE.Quaternion, x: number, y: number, z: number, out: THREE.Vector3) {
  return out.set(x, y, z).applyQuaternion(q).add(pos);
}

const TRUNK = [B.pelvis, B.spine, B.chest] as const;
const TILT = [0.5, 0.8, 1];
const TWIST = [0.15, 0.55, 1];

export function solveHuman(a: Anthro, pose: HumanPose, rig: Rig) {
  const { p, q } = rig;
  const T = a.trunk;
  p[B.root].set(0, 0, 0);
  q[B.root].identity();

  // Trunk: tilt distributed up the spine (lumbar + thoracic), shoulders twisted against the hips.
  _qt.setFromUnitVectors(Y, pose.up);
  for (let k = 0; k < 3; k++) {
    _q.identity().slerp(_qt, TILT[k]);
    _qy.setFromAxisAngle(Y, pose.yaw - pose.twist * TWIST[k]);
    q[TRUNK[k]].multiplyQuaternions(_q, _qy);
  }
  p[B.pelvis].copy(pose.hip);
  at(p[B.pelvis], q[B.pelvis], 0, 0.25 * T, 0, p[B.spine]);
  at(p[B.spine], q[B.spine], 0, 0.3 * T, 0, p[B.chest]);
  const qc = q[B.chest];

  // Head: turn and nod toward the gaze target within comfortable neck range; the head stays
  // partly levelled against trunk tilt (righting reflex).
  at(p[B.chest], qc, -0.02 * T, 0.5 * T, 0, p[B.neck]);
  _g.subVectors(pose.gaze, p[B.neck]);
  _qi.copy(qc).invert();
  _g.applyQuaternion(_qi);
  const hy = THREE.MathUtils.clamp(Math.atan2(-_g.z, _g.x), -1.2, 1.2);
  const hp = THREE.MathUtils.clamp(Math.atan2(_g.y, Math.hypot(_g.x, _g.z)), -0.7, 0.5);
  _g.set(Math.cos(hp) * Math.cos(hy), Math.sin(hp), -Math.cos(hp) * Math.sin(hy)).applyQuaternion(qc);
  _u.set(0, 1, 0).applyQuaternion(qc).addScaledVector(Y, 0.8).normalize();
  _w.copy(_g).addScaledVector(_u, -_g.dot(_u));
  if (_w.lengthSq() < 1e-6) _w.set(1, 0, 0).applyQuaternion(qc);
  _w.normalize();
  _z.crossVectors(_w, _u);
  _m.makeBasis(_w, _u, _z);
  _qh.setFromRotationMatrix(_m);
  q[B.neck].copy(qc).slerp(_qh, 0.45);
  at(p[B.neck], q[B.neck], 0, a.neck, 0, p[B.head]);
  q[B.head].copy(_qh);

  // Arms
  gripLocal(a, _gl);
  const arm = (a.upperArm + a.foreArm) * 0.995;
  for (let i = 0; i < 2; i++) {
    const zs = i === 0 ? -1 : 1;
    const clav = i === 0 ? B.clavL : B.clavR;
    const ua = i === 0 ? B.upArmL : B.upArmR;
    const fa = i === 0 ? B.foreArmL : B.foreArmR;
    const hd = i === 0 ? B.handL : B.handR;
    const grip = i === 0 ? pose.handL : pose.handR;
    const thumb = i === 0 ? pose.thumbL : pose.thumbR;
    at(p[B.chest], qc, 0, 0.45 * T, zs * a.shoulderHalf, _sh);
    // Hand frame: Z radial for the right hand (ulnar for the mirrored left), Y wrist → knuckles.
    _z.copy(thumb).multiplyScalar(zs);
    _y.subVectors(grip, _sh);
    _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-8) _y.set(0, -1, 0);
    _y.normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    q[hd].setFromRotationMatrix(_m);
    _q.setFromAxisAngle(_z, -0.12);
    q[hd].premultiply(_q);
    _wr.copy(_gl).applyQuaternion(q[hd]).negate().add(grip);
    // Shoulder girdle protracts toward a long reach.
    const d = _sh.distanceTo(_wr);
    const protract = 0.075 * THREE.MathUtils.smoothstep(d, arm - 0.1, arm + 0.06);
    _v.subVectors(_wr, _sh).normalize();
    _sh.addScaledVector(_v, protract);
    at(p[B.chest], qc, 0.03 * T, 0.38 * T, zs * 0.02, p[clav]);
    _w.set(-1, 0, 0).applyQuaternion(qc);
    frame(_v.subVectors(_sh, p[clav]), _w, q[clav]);
    _pole.set(pose.elbow.x, pose.elbow.y, zs * pose.elbow.z).normalize().applyQuaternion(qc);
    twoBone(_sh, _wr, a.upperArm, a.foreArm, _pole, p[fa], _end, _bend);
    p[ua].copy(_sh);
    frame(_v.subVectors(p[fa], _sh), _w.copy(_bend).negate(), q[ua]);
    _x.set(-1, 0, 0).applyQuaternion(q[hd]);
    frame(_v.subVectors(_end, p[fa]), _x, q[fa]);
    p[hd].copy(_end);
  }

  // Legs
  for (let i = 0; i < 2; i++) {
    const zs = i === 0 ? -1 : 1;
    const th = i === 0 ? B.thighL : B.thighR;
    const sh = i === 0 ? B.shinL : B.shinR;
    const ft = i === 0 ? B.footL : B.footR;
    const f = i === 0 ? pose.footL : pose.footR;
    at(p[B.pelvis], q[B.pelvis], 0, 0, zs * a.hipHalf, p[th]);
    frame(f.toe, f.sole, q[ft]);
    // ankle sits above and in front of the heel corner of the sole
    _ank.copy(f.heel).addScaledVector(f.toe, 0.27 * a.foot + 0.012).addScaledVector(f.sole, a.ankleH + 0.012);
    at(p[B.pelvis], q[B.pelvis], 0, 0, zs * pose.kneeOut, _pole).sub(p[B.pelvis]).add(pose.knee).normalize();
    twoBone(p[th], _ank, a.thigh, a.shin, _pole, p[sh], _end, _bend);
    frame(_v.subVectors(p[sh], p[th]), _bend, q[th]);
    frame(_v.subVectors(_end, p[sh]), _bend, q[sh]);
    p[ft].copy(_end);
  }

  // Stretcher plate is collapsed (bone scaled to ~0); park it inside the pelvis.
  p[B.stretcher].copy(p[B.pelvis]);
  q[B.stretcher].identity();
}

// ---------------------------------------------------------------------------------------------
// People: who they are and what they wear
// ---------------------------------------------------------------------------------------------

export type Role = 'kayak' | 'oc6' | 'sup' | 'sailor' | 'coach' | 'boater';
export type Hat = Headwear | 'bucket' | 'brim';

export interface BoaterSpec {
  seed: number;
  female: boolean;
  H: number;
  girth: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  hat: Hat;
  hatColor: string;
  glasses: boolean;
  outfit: Outfit;
  standing: boolean;
}

const HAIR = ['#1c140f', '#2a1d16', '#3a2618', '#5b3d24', '#8a6438', '#b08850', '#6e6e6a'];
const pick = <T,>(r: () => number, a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
/** Approximately normal (Irwin-Hall, 4 terms), mean 0, sd 1. */
const gauss = (r: () => number) => (r() + r() + r() + r() - 2) * 1.732;

let seedBase = 9000;

/**
 * A paddler / sailor / coach. Body dimensions follow US adult stature (NHANES 2021-23: men 175 cm,
 * women 161 cm mean) with Drillis & Contini segment ratios (as anthro.ts), clothes by activity.
 */
export function makeBoater(r: () => number, role: Role, standing: boolean, opts: { tops?: string[]; pfd?: string[] | null; female?: boolean } = {}): BoaterSpec {
  const female = opts.female ?? r() < (role === 'coach' ? 0.35 : role === 'sailor' ? 0.45 : 0.42);
  const athletic = role === 'oc6' || role === 'sailor' ? 0.03 : 0;
  const H = THREE.MathUtils.clamp(female ? 1.63 + athletic + 0.065 * gauss(r) : 1.77 + athletic + 0.07 * gauss(r), female ? 1.5 : 1.62, female ? 1.8 : 1.96);
  const girth = (female ? 0.9 : 1) * (role === 'boater' || role === 'coach' ? 0.98 + 0.14 * r() : 0.92 + 0.12 * r());
  const si = Math.floor(r() * SKIN_TONES.length) % SKIN_TONES.length;
  const skin = SKIN_TONES[si];
  const hair = si >= 3 ? pick(r, HAIR.slice(0, 2)) : role === 'coach' && r() < 0.35 ? HAIR[6] : pick(r, HAIR.slice(0, 6));
  const hairStyle: HairStyle = female ? (r() < 0.75 ? 'pony' : 'bun') : pick(r, ['buzz', 'crop', 'crop', 'swept'] as const);
  const tops = opts.tops ?? ['#2e2d29', '#f4f2ec', '#3d5a80'];
  const top = pick(r, tops);
  const hr = r();
  let hat: Hat;
  let outfit: Outfit;
  const pfd = opts.pfd === null ? null : opts.pfd ? pick(r, opts.pfd) : null;
  switch (role) {
    case 'kayak':
      hat = hr < 0.35 ? 'bucket' : hr < 0.6 ? 'cap' : hr < 0.7 ? 'brim' : 'none';
      outfit = { top, topStyle: r() < 0.6 ? 'longsleeve' : 'tee', bottom: pick(r, ['#2e2d29', '#3b3f45', '#1f2a3a']), bottomStyle: 'shorts', accent: null, pfd, shoe: '#2b2c2e' };
      break;
    case 'oc6':
      hat = hr < 0.45 ? 'cap' : hr < 0.7 ? 'visor' : 'none';
      outfit = { top, topStyle: r() < 0.5 ? 'tank' : r() < 0.5 ? 'longsleeve' : 'tee', bottom: pick(r, ['#2e2d29', '#24262b', '#1f2a3a']), bottomStyle: 'shorts', accent: null, pfd, shoe: null };
      break;
    case 'sup':
      hat = hr < 0.4 ? 'cap' : hr < 0.65 ? 'brim' : 'none';
      outfit = { top, topStyle: r() < 0.55 ? 'longsleeve' : 'tank', bottom: pick(r, ['#2e2d29', '#3d5a80', '#24262b']), bottomStyle: 'shorts', accent: null, pfd, shoe: null };
      break;
    case 'sailor':
      hat = hr < 0.4 ? 'cap' : 'none';
      outfit = { top, topStyle: r() < 0.55 ? 'jacket' : 'longsleeve', bottom: pick(r, ['#2e2d29', '#24262b', '#3b3f45']), bottomStyle: r() < 0.6 ? 'pants' : 'shorts', accent: null, pfd, shoe: '#202022' };
      break;
    case 'coach':
      hat = hr < 0.7 ? 'cap' : hr < 0.85 ? 'brim' : 'none';
      outfit = { top, topStyle: 'jacket', bottom: pick(r, ['#2e2d29', '#3b3f45', '#7a6a52']), bottomStyle: 'pants', accent: null, pfd, shoe: pick(r, ['#e8e8e4', '#3b3f45']) };
      break;
    default:
      hat = hr < 0.5 ? 'cap' : hr < 0.65 ? 'brim' : 'none';
      outfit = { top, topStyle: 'tee', bottom: pick(r, ['#c9b37e', '#3d5a80', '#2e2d29']), bottomStyle: 'shorts', accent: null, pfd, shoe: pick(r, ['#e8e8e4', '#6b4f2a']) };
  }
  const hatColor = hat === 'bucket' || hat === 'brim' ? pick(r, ['#c9b37e', '#e6e1d3', '#6f7a5a', '#3b3f45']) : pick(r, [WHITE, WHITE, DARK, CARDINAL, '#3d5a80']);
  const glasses = r() < (role === 'coach' ? 0.75 : role === 'boater' ? 0.55 : 0.45);
  return { seed: seedBase++, female, H, girth, skin, hair, hairStyle, hat, hatColor, glasses, outfit, standing };
}

/** Colours for the far-LOD proxy, matching the skinned figure. */
export function lookOf(s: BoaterSpec): Look {
  return {
    skin: new THREE.Color(s.skin),
    top: new THREE.Color(s.outfit.top),
    bottom: new THREE.Color(s.outfit.bottom),
    hair: new THREE.Color(s.hair),
    hat: s.hat === 'none' ? null : new THREE.Color(s.hatColor),
    pfd: s.outfit.pfd ? new THREE.Color(s.outfit.pfd) : null,
  };
}

function anthroOf(s: BoaterSpec): Anthro {
  // makeAnthro only supplies the template; every field that depends on its crew counter is overridden.
  const base = makeAnthro(s.seed, s.female ? 'women' : 'men');
  const H = s.H;
  const sun = s.hat === 'bucket' || s.hat === 'brim';
  return {
    ...base,
    female: s.female,
    H,
    girth: s.girth,
    thigh: 0.245 * H,
    shin: 0.246 * H,
    upperArm: 0.186 * H,
    foreArm: 0.146 * H,
    hand: 0.108 * H,
    foot: 0.152 * H,
    ankleH: 0.039 * H,
    trunk: 0.288 * H,
    hipAboveSeat: 0.048 * H,
    hipHalf: (s.female ? 0.05 : 0.047) * H,
    shoulderHalf: (s.female ? 0.097 : 0.105) * H * (0.96 + 0.08 * (s.girth - 0.86)),
    neck: 0.052 * H,
    head: Math.sqrt(H / 1.88) * (s.female ? 0.95 : 1),
    skin: s.skin,
    hair: s.hair,
    hairStyle: sun && s.hairStyle === 'bun' ? 'pony' : s.hairStyle,
    headwear: sun ? 'none' : (s.hat as Headwear),
    headwearColor: s.hatColor,
    glasses: s.glasses,
    shoe: s.outfit.shoe ?? s.skin,
  };
}

// ---------------------------------------------------------------------------------------------
// Soft sun hats (bucket / wide brim), skinned rigidly to the head bone and merged into the body.
// ---------------------------------------------------------------------------------------------

const ss = (a: number, b: number, x: number) => THREE.MathUtils.smoothstep(x, a, b);

function hatGeometry(a: Anthro, style: 'bucket' | 'brim', color: string, head: THREE.Matrix4) {
  const hd = a.head;
  // Same head ellipsoid as body.ts (X face, Y up, Z right), padded for hair.
  const cx = 0.012 * hd;
  const cy = 0.085 * hd;
  const RX = 0.098 * hd + 0.02;
  const RY = 0.118 * hd + 0.016;
  const RZ = 0.077 * hd + 0.02;
  const brim = style === 'bucket' ? 0.05 : 0.085;
  const drop = style === 'bucket' ? 0.03 : 0.018;
  const cols = 28;
  // rows: crown from the top down to the band, then brim top out, edge, brim underside back in
  const crownRows = 7;
  const prof: [number, number, number][] = []; // per row: [mode, a, b]
  for (let i = 0; i <= crownRows; i++) prof.push([0, i / crownRows, 0]);
  prof.push([1, 0.55, 0], [1, 1, 0], [1, 1, -0.008], [1, 0.5, -0.006], [1, 0, -0.006]);
  const pos: number[] = [];
  const col: number[] = [];
  const base = new THREE.Color(color);
  const band = base.clone().multiplyScalar(0.62);
  const under = base.clone().multiplyScalar(0.8);
  const p = new THREE.Vector3();
  for (let r = 0; r < prof.length; r++) {
    const [mode, t, off] = prof[r];
    for (let j = 0; j < cols; j++) {
      const ph = (j / cols) * Math.PI * 2;
      const c = Math.cos(ph);
      const s = Math.sin(ph);
      // band height: low at the back, above the brow at the front
      const bandU = THREE.MathUtils.lerp(0.02, 0.36, ss(-0.8, 0.9, c));
      const th0 = Math.acos(bandU);
      let k = 1;
      if (mode === 0) {
        const th = th0 * t;
        const flat = 1 - 0.18 * ss(0, 0.5, 1 - t); // flatter crown top
        p.set(cx + RX * Math.sin(th) * c, cy + RY * Math.cos(th) * flat + 0.004, RZ * Math.sin(th) * s);
        k = t > 0.86 ? 0.5 : 1;
      } else {
        const sb = Math.sin(th0);
        const ex = RX * sb * c;
        const ez = RZ * sb * s;
        const el = Math.hypot(ex, ez) || 1;
        const out = brim * t;
        p.set(cx + ex + (ex / el) * out, cy + RY * bandU - drop * t * t + off + 0.004, ez + (ez / el) * out);
        k = off < 0 ? 0.25 : 0;
      }
      p.applyMatrix4(head);
      pos.push(p.x, p.y, p.z);
      const cc = k === 0.5 ? band : k === 0.25 ? under : base;
      col.push(cc.r, cc.g, cc.b);
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < prof.length - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const a0 = r * cols + j;
      const a1 = r * cols + ((j + 1) % cols);
      const b0 = a0 + cols;
      const b1 = a1 + cols;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }
  return { pos, col, idx };
}

interface Extra {
  pos: number[];
  col: number[];
  idx: number[];
  /** Four bone indices / weights per vertex; omitted = rigid to the head. */
  si?: number[];
  sw?: number[];
}

/** Append extra skinned triangles to a figure geometry (returns a new geometry, disposes the old one). */
function mergeExtra(geo: THREE.BufferGeometry, ex: Extra) {
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const C = geo.getAttribute('color') as THREE.BufferAttribute;
  const SI = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const SW = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
  const I = geo.getIndex()!;
  const n0 = P.count;
  const n1 = ex.pos.length / 3;
  const n = n0 + n1;
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  pos.set(P.array as Float32Array);
  col.set(C.array as Float32Array);
  si.set(SI.array as ArrayLike<number>);
  sw.set(SW.array as Float32Array);
  pos.set(ex.pos, n0 * 3);
  col.set(ex.col, n0 * 3);
  if (ex.si && ex.sw) {
    si.set(ex.si, n0 * 4);
    sw.set(ex.sw, n0 * 4);
  } else {
    for (let i = 0; i < n1; i++) {
      si[(n0 + i) * 4] = B.head;
      sw[(n0 + i) * 4] = 1;
    }
  }
  const idx = new Uint32Array(I.count + ex.idx.length);
  idx.set(I.array as ArrayLike<number>);
  for (let i = 0; i < ex.idx.length; i++) idx[I.count + i] = ex.idx[i] + n0;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  geo.dispose();
  return g;
}

// ---------------------------------------------------------------------------------------------
// Clothing fallback: until body.ts paints the Outfit itself, recolour the unisuit and add a PFD.
// Each step is skipped as soon as the shared geometry already shows that outfit colour.
// ---------------------------------------------------------------------------------------------

const _cc = new THREE.Color();
function hasColour(C: THREE.BufferAttribute, hex: string) {
  _cc.set(hex);
  for (let i = 0; i < C.count; i++) {
    if (Math.abs(C.getX(i) - _cc.r) < 0.003 && Math.abs(C.getY(i) - _cc.g) < 0.003 && Math.abs(C.getZ(i) - _cc.b) < 0.003) return true;
  }
  return false;
}

function dominant(SI: THREE.BufferAttribute, SW: THREE.BufferAttribute, i: number) {
  let bone = SI.getX(i);
  let w = SW.getX(i);
  for (let k = 1; k < 4; k++) {
    if (SW.getComponent(i, k) > w) {
      w = SW.getComponent(i, k);
      bone = SI.getComponent(i, k);
    }
  }
  return bone;
}

/** body.ts still dresses everyone in the unisuit if cardinal shorts remain on the thighs. */
function painted(geo: THREE.BufferGeometry) {
  const C = geo.getAttribute('color') as THREE.BufferAttribute;
  const SI = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const SW = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
  _cc.set(CARDINAL);
  for (let i = 0; i < C.count; i++) {
    if (Math.abs(C.getX(i) - _cc.r) > 0.003 || Math.abs(C.getY(i) - _cc.g) > 0.003 || Math.abs(C.getZ(i) - _cc.b) > 0.003) continue;
    const bone = dominant(SI, SW, i);
    if (bone === B.thighL || bone === B.thighR) return false;
  }
  return true;
}

function recolour(geo: THREE.BufferGeometry, a: Anthro, rest: Rig, o: Outfit) {
  const C = geo.getAttribute('color') as THREE.BufferAttribute;
  const P = geo.getAttribute('position') as THREE.BufferAttribute;
  const SI = geo.getAttribute('skinIndex') as THREE.BufferAttribute;
  const SW = geo.getAttribute('skinWeight') as THREE.BufferAttribute;
  const card = new THREE.Color(CARDINAL);
  const white = new THREE.Color(WHITE);
  const top = new THREE.Color(o.top);
  const bottom = new THREE.Color(o.bottom);
  const trim = bottom.clone().multiplyScalar(0.7);
  const inv = new THREE.Matrix4().compose(rest.p[B.pelvis], rest.q[B.pelvis], _hs).invert();
  const p = new THREE.Vector3();
  for (let i = 0; i < C.count; i++) {
    const r = C.getX(i);
    const g = C.getY(i);
    const bl = C.getZ(i);
    const isCard = Math.abs(r - card.r) < 0.003 && Math.abs(g - card.g) < 0.003 && Math.abs(bl - card.b) < 0.003;
    const isWhite = Math.abs(r - white.r) < 0.003 && Math.abs(g - white.g) < 0.003 && Math.abs(bl - white.b) < 0.003;
    if (!isCard && !isWhite) continue;
    const bone = dominant(SI, SW, i);
    const leg = bone === B.thighL || bone === B.thighR;
    if (isWhite) {
      if (leg) C.setXYZ(i, trim.r, trim.g, trim.b);
      continue;
    }
    p.fromBufferAttribute(P, i).applyMatrix4(inv);
    const c = leg || p.y < 0.03 * a.trunk ? bottom : top;
    C.setXYZ(i, c.r, c.g, c.b);
  }
  C.needsUpdate = true;
}

/** Torso half-depth / half-width / x-offset by height (fraction of trunk), as body.ts's torso rings. */
const TORSO: [number, number, number, number][] = [
  [0.2, 0.1, 0.148, 0],
  [0.35, 0.095, 0.138, 0.002],
  [0.5, 0.104, 0.152, 0.006],
  [0.65, 0.114, 0.168, 0.012],
  [0.78, 0.112, 0.183, 0.008],
  [0.9, 0.088, 0.19, 0],
  [0.98, 0.07, 0.168, -0.006],
];

function torsoAt(t: number, f: number, out: number[]) {
  let k = 0;
  while (k < TORSO.length - 2 && TORSO[k + 1][0] < t) k++;
  const A = TORSO[k];
  const Bk = TORSO[k + 1];
  const u = THREE.MathUtils.clamp((t - A[0]) / (Bk[0] - A[0]), 0, 1);
  out[0] = THREE.MathUtils.lerp(A[1], Bk[1], u) + (t > 0.55 && t < 0.85 ? 0.012 * f : 0);
  out[1] = THREE.MathUtils.lerp(A[2], Bk[2], u) - (t > 0.5 ? 0.012 * f : 0);
  out[2] = THREE.MathUtils.lerp(A[3], Bk[3], u);
  return out;
}

/** Type III foam vest: closed-cell panels over the torso with a front zip and two buckled belts. */
function pfdGeometry(a: Anthro, rest: Rig, colour: string): Extra {
  const wS = (a.girth * a.H) / 1.88;
  const T = a.trunk;
  const f = a.female ? 1 : 0;
  const M = new THREE.Matrix4().compose(rest.p[B.pelvis], rest.q[B.pelvis], _hs);
  const base = new THREE.Color(colour);
  const strap = new THREE.Color('#1b1c1e');
  const edge = base.clone().multiplyScalar(0.7);
  // [t, padding, shoulder narrowing]
  const rows: [number, number, number][] = [
    [0.3, 0.004, 1],
    [0.31, 0.024, 1],
    [0.45, 0.026, 1],
    [0.6, 0.026, 1],
    [0.75, 0.024, 1],
    [0.86, 0.02, 0.98],
    [0.93, 0.016, 0.8],
    [0.965, 0.006, 0.66],
  ];
  const cols = 28;
  const pos: number[] = [];
  const col: number[] = [];
  const si: number[] = [];
  const sw: number[] = [];
  const tmp = [0, 0, 0];
  const v = new THREE.Vector3();
  for (const [t, pad, narrow] of rows) {
    torsoAt(t, f, tmp);
    const rx = tmp[0] * wS + pad;
    const rz = tmp[1] * wS * narrow + pad;
    const ox = tmp[2] * wS;
    for (let j = 0; j < cols; j++) {
      const th = (j / cols) * Math.PI * 2;
      const c = Math.cos(th);
      const sn = Math.sin(th);
      // flatter front and back panels, like a foam vest
      const e = 0.7;
      const cx = Math.sign(c) * Math.pow(Math.abs(c), e);
      const sz = Math.sign(sn) * Math.pow(Math.abs(sn), e);
      v.set(ox + rx * cx, t * T, rz * sz).applyMatrix4(M);
      pos.push(v.x, v.y, v.z);
      const front = c > 0;
      const zip = front && Math.abs(rz * sz) < 0.008;
      const belt = Math.abs(t - 0.45) < 0.02 || Math.abs(t - 0.6) < 0.02;
      const cc = pad < 0.01 ? edge : zip || belt ? strap : base;
      col.push(cc.r, cc.g, cc.b);
      if (t < 0.55) {
        const k = THREE.MathUtils.clamp((t - 0.25) / 0.3, 0, 1);
        si.push(B.spine, B.chest, 0, 0);
        sw.push(1 - k, k, 0, 0);
      } else if (t < 0.85) {
        si.push(B.chest, 0, 0, 0);
        sw.push(1, 0, 0, 0);
      } else {
        const k = ss(0.85, 1.0, t) * ss(0.45, 0.9, Math.abs(sn));
        si.push(B.chest, sn < 0 ? B.clavL : B.clavR, 0, 0);
        sw.push(1 - 0.5 * k, 0.5 * k, 0, 0);
      }
    }
  }
  const idx: number[] = [];
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < cols; j++) {
      const a0 = r * cols + j;
      const a1 = r * cols + ((j + 1) % cols);
      idx.push(a0, a0 + cols, a1, a1, a0 + cols, a1 + cols);
    }
  }
  return { pos, col, idx, si, sw };
}

// ---------------------------------------------------------------------------------------------
// Skinned figure + pool
// ---------------------------------------------------------------------------------------------

const _hm = new THREE.Matrix4();
const _hs = new THREE.Vector3(1, 1, 1);

export class Boater {
  readonly look: Look;
  mesh: THREE.SkinnedMesh | null = null;
  anthro: Anthro | null = null;
  used = -1;
  private bones: THREE.Bone[] = [];
  readonly rig = makeRig();

  constructor(readonly spec: BoaterSpec) {
    this.look = lookOf(spec);
  }

  /** Leg length (hip joint → ankle, straight) and ankle height above the sole, for placing standing hips. */
  get legs() {
    return 0.491 * this.spec.H;
  }
  get ankle() {
    return 0.039 * this.spec.H + 0.012;
  }
  get hipAboveSeat() {
    return 0.048 * this.spec.H;
  }
  get shoulder() {
    return 0.288 * this.spec.H;
  }

  build(rest: HumanPose) {
    const a = (this.anthro ??= anthroOf(this.spec));
    const r = makeRig();
    solveHuman(a, rest, r);
    const o = this.spec.outfit;
    let geo = buildFigureGeometry(a, r, o);
    const C = geo.getAttribute('color') as THREE.BufferAttribute;
    if (!painted(geo)) recolour(geo, a, r, o);
    if (o.pfd && !hasColour(C, o.pfd)) geo = mergeExtra(geo, pfdGeometry(a, r, o.pfd));
    const hat = this.spec.hat;
    if (hat === 'bucket' || hat === 'brim') {
      _hm.compose(r.p[B.head], r.q[B.head], _hs);
      const h = hatGeometry(a, hat, this.spec.hatColor, _hm);
      geo = mergeExtra(geo, h);
      // make sure the crown faces outward
      const N = geo.getAttribute('normal') as THREE.BufferAttribute;
      const top = geo.getAttribute('position').count - h.pos.length / 3;
      _v.fromBufferAttribute(N, top + 3);
      _w.set(0, 1, 0).applyQuaternion(r.q[B.head]);
      if (_v.dot(_w) < 0) {
        const I = geo.getIndex()!;
        const arr = I.array as Uint32Array;
        for (let i = I.count - h.idx.length; i < I.count; i += 3) {
          const t = arr[i + 1];
          arr[i + 1] = arr[i + 2];
          arr[i + 2] = t;
        }
        I.needsUpdate = true;
        geo.computeVertexNormals();
      }
    }
    const mesh = new THREE.SkinnedMesh(geo, FIGURE_MATERIAL);
    mesh.name = 'traffic-human';
    this.bones.length = 0;
    for (let i = 0; i < BONE_COUNT; i++) {
      const bone = new THREE.Bone();
      bone.position.copy(r.p[i]);
      bone.quaternion.copy(r.q[i]);
      this.bones.push(bone);
      mesh.add(bone);
    }
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    // No foot stretcher in these craft: collapse the plate.
    this.bones[B.stretcher].scale.setScalar(1e-4);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.6);
    this.mesh = mesh;
  }

  dispose() {
    if (!this.mesh) return;
    this.mesh.removeFromParent();
    this.mesh.skeleton.dispose();
    this.mesh.geometry.dispose();
    this.mesh = null;
    this.bones.length = 0;
  }

  setPose(pose: HumanPose) {
    solveHuman(this.anthro!, pose, this.rig);
    for (let i = 0; i < BONE_COUNT; i++) {
      this.bones[i].position.copy(this.rig.p[i]);
      this.bones[i].quaternion.copy(this.rig.q[i]);
    }
    this.bones[B.stretcher].scale.setScalar(1e-4);
    this.mesh!.boundingSphere!.center.copy(this.rig.p[B.chest]);
  }

  /** A point in the head frame (x face, y up, z right), in craft-local coords. Valid after setPose. */
  headPoint(x: number, y: number, z: number, out: THREE.Vector3) {
    const s = this.anthro ? this.anthro.head : 1;
    return at(this.rig.p[B.head], this.rig.q[B.head], x * s, y * s, z * s, out);
  }
}

/** Live skinned figures are capped; the rest fall back to the instanced proxies. */
export const MAX_LIVE = 14;
/** Skinned figures are used inside this camera distance (matches traffic.ts DETAIL). */
export const HUMAN_LOD = 150;

const _rest = makePose();

export class HumanPool {
  private live: Boater[] = [];
  private frameNo = 0;
  private built = 0;

  begin() {
    this.frameNo++;
    this.built = 0;
  }

  /** Pose `b` as a skinned figure under `parent`; returns false when the caller should draw a proxy. */
  show(b: Boater, parent: THREE.Object3D, pose: HumanPose): boolean {
    if (!b.mesh) {
      // Build at most one figure per frame (a few ms each) and only if there's a free slot or a stale one.
      if (this.built > 0) return false;
      if (this.live.length >= MAX_LIVE) {
        let k = -1;
        let oldest = this.frameNo - 1;
        for (let i = 0; i < this.live.length; i++) {
          if (this.live[i].used < oldest) {
            oldest = this.live[i].used;
            k = i;
          }
        }
        if (k < 0) return false;
        this.live[k].dispose();
        this.live[k] = this.live[this.live.length - 1];
        this.live.pop();
      }
      copyPose(_rest, pose);
      b.build(_rest);
      this.live.push(b);
      this.built++;
    }
    const m = b.mesh!;
    if (m.parent !== parent) parent.add(m);
    m.visible = true;
    b.used = this.frameNo;
    b.setPose(pose);
    return true;
  }

  end() {
    for (const b of this.live) if (b.used !== this.frameNo && b.mesh) b.mesh.visible = false;
  }

  get count() {
    return this.live.length;
  }
}
