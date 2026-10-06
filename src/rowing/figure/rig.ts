import * as THREE from 'three';
import type { Anthro } from './anthro';

/** Bone indices. "L" is the rower's left = boat +z (the rower faces the stern, -x). */
export const B = {
  root: 0,
  pelvis: 1,
  spine: 2,
  chest: 3,
  neck: 4,
  head: 5,
  clavL: 6,
  upArmL: 7,
  foreArmL: 8,
  handL: 9,
  clavR: 10,
  upArmR: 11,
  foreArmR: 12,
  handR: 13,
  thighL: 14,
  shinL: 15,
  footL: 16,
  thighR: 17,
  shinR: 18,
  footR: 19,
  stretcher: 20,
} as const;
export const BONE_COUNT = 21;

/** Seat top in boat-local y (CrewBoat seat: 0.05 box centred at y = 0.16). */
export const SEAT_TOP = 0.185;
/** Foot-stretcher inclination from horizontal (typical 38-45 deg). */
export const STRETCHER_ANGLE = (42 * Math.PI) / 180;
/** Slide position CrewBoat reaches at the finish; stretchers are set so the legs are just flat there. */
const FINISH_SLIDE = 0.3;
const HEEL_Y = 0.045;
const HANDLE_R = 0.02;
/** Trunk range from the hips: ~30 deg forward at the catch, ~22 deg layback at most at the finish. */
const MIN_LEAN = (-22 * Math.PI) / 180;
const MAX_LEAN = (32 * Math.PI) / 180;

export interface RigPose {
  seatX: number;
  slide: number;
  lean: number;
  stretcherX: number;
  handIn: THREE.Vector3;
  handOut: THREE.Vector3;
  side: number;
  feather: number;
}

export interface Rig {
  p: THREE.Vector3[];
  q: THREE.Quaternion[];
  /** Lean actually used after reach / clearance correction (diagnostics). */
  lean: number;
}

export function makeRig(): Rig {
  const p: THREE.Vector3[] = [];
  const q: THREE.Quaternion[] = [];
  for (let i = 0; i < BONE_COUNT; i++) {
    p.push(new THREE.Vector3());
    q.push(new THREE.Quaternion());
  }
  return { p, q, lean: 0 };
}

/** Anterior depth of the torso surface (m) from the trunk axis at height h (m) above the hips. */
export function torsoFront(a: Anthro, h: number) {
  const t = h / a.trunk;
  const d = t < 0.25 ? 0.105 : t < 0.55 ? 0.105 + (t - 0.25) * 0.11 : 0.138;
  return d * a.girth;
}

/** Grip centre in the hand bone frame (X dorsal, Y wrist->knuckles, Z radial for the right hand). */
export function gripLocal(a: Anthro, out: THREE.Vector3) {
  const s = a.hand / 0.2;
  return out.set(-(0.016 * s + HANDLE_R), 0.074 * s, 0);
}

const Q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _aOut = new THREE.Vector3();
const _shaft = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _ankle = [new THREE.Vector3(), new THREE.Vector3()];
const _wrist = [new THREE.Vector3(), new THREE.Vector3()];
const _grip = [new THREE.Vector3(), new THREE.Vector3()];
const _sh = [new THREE.Vector3(), new THREE.Vector3()];
const _bendArm = [new THREE.Vector3(), new THREE.Vector3()];
const _gl = new THREE.Vector3();
const _heel = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();

function leanQ(lean: number, out: THREE.Quaternion) {
  _q.setFromAxisAngle(Z, lean);
  return out.multiplyQuaternions(_q, Q0);
}

/** Frame with +Y along `y` and +X toward `hint` (orthogonalised). */
function frame(y: THREE.Vector3, hint: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _x.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0).addScaledVector(_y, -_y.x);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Two-bone IK. Writes the middle joint; returns the reachable end point in `end`. */
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

/**
 * Pose the skeleton in boat-local coordinates (+x bow, y up, z across).
 * Bones are flat children of the mesh, so p/q are directly their local transforms.
 */
export function solveRig(a: Anthro, pose: RigPose, rig: Rig) {
  const { p, q } = rig;
  const T = a.trunk;
  p[B.root].set(0, 0, 0);
  q[B.root].identity();

  _hip.set(pose.seatX + pose.slide, SEAT_TOP + a.hipAboveSeat, 0);

  // Grip points: the inside hand (rigger side, z sign == side) holds handIn.
  const s = pose.side >= 0 ? 1 : -1;
  _grip[0].copy(s > 0 ? pose.handIn : pose.handOut);
  _grip[1].copy(s > 0 ? pose.handOut : pose.handIn);
  _aOut.subVectors(pose.handOut, pose.handIn).normalize();
  _shaft.copy(_aOut).negate();

  // Hand frames (independent of the trunk except for the forearm-line hint).
  // Z points along the handle toward +z for both hands (thumbs face each other; left hand mirrored).
  gripLocal(a, _gl);
  let lean = pose.lean;
  for (let pass = 0; pass < 2; pass++) {
    torso(a, lean, p, q);
    let reach = 0;
    let clear = 0;
    for (let i = 0; i < 2; i++) {
      const zb = i === 0 ? 1 : -1;
      const S = _sh[i];
      at(p[B.chest], q[B.chest], 0, 0.45 * T, -zb * a.shoulderHalf, S);
      handFrame(a, i, s, pose.feather, S, q[i === 0 ? B.handL : B.handR]);
      _wrist[i].copy(_gl).applyQuaternion(q[i === 0 ? B.handL : B.handR]).negate().add(_grip[i]);
      const arm = (a.upperArm + a.foreArm) * 0.995;
      const d = S.distanceTo(_wrist[i]);
      const protract = 0.075 * THREE.MathUtils.smoothstep(d, arm - 0.1, arm + 0.06);
      reach = Math.max(reach, d - protract - arm);
      // keep the grip in front of the torso surface
      _v.subVectors(_grip[i], _hip);
      const up = _v.x * -Math.sin(lean) + _v.y * Math.cos(lean);
      const fwd = _v.x * -Math.cos(lean) - _v.y * Math.sin(lean);
      const need = torsoFront(a, Math.max(0, up)) + HANDLE_R + 0.02 - fwd;
      if (up > 0.05) clear = Math.max(clear, need / up);
    }
    if (pass === 1) {
      rig.lean = lean;
      break;
    }
    const add = reach > 0 ? Math.min(0.2, reach / (0.8 * T)) : 0;
    const sub = clear > 0 ? Math.min(0.22, Math.atan(clear)) : 0;
    if (add === 0 && sub === 0) {
      rig.lean = lean;
      break;
    }
    lean += add - sub;
  }
  lean = THREE.MathUtils.clamp(lean, MIN_LEAN, MAX_LEAN);
  if (lean !== rig.lean) torso(a, lean, p, q);
  rig.lean = lean;

  // Neck and head: the head stays level and looks to the stern.
  at(p[B.chest], q[B.chest], -0.02 * T, 0.5 * T, 0, p[B.neck]);
  leanQ(lean * 0.55, q[B.neck]);
  at(p[B.neck], q[B.neck], 0, a.neck, 0, p[B.head]);
  leanQ(lean * 0.06 - 0.04, q[B.head]);

  // Arms
  for (let i = 0; i < 2; i++) {
    const zb = i === 0 ? 1 : -1;
    const S = _sh[i];
    const clav = i === 0 ? B.clavL : B.clavR;
    const ua = i === 0 ? B.upArmL : B.upArmR;
    const fa = i === 0 ? B.foreArmL : B.foreArmR;
    const hd = i === 0 ? B.handL : B.handR;
    at(p[B.chest], q[B.chest], 0, 0.45 * T, -zb * a.shoulderHalf, S);
    const arm = (a.upperArm + a.foreArm) * 0.995;
    const d = S.distanceTo(_wrist[i]);
    const protract = 0.075 * THREE.MathUtils.smoothstep(d, arm - 0.1, arm + 0.06);
    _v.subVectors(_wrist[i], S).normalize();
    S.addScaledVector(_v, protract);
    // clavicle from the sternal end toward the (protracted) shoulder joint
    at(p[B.chest], q[B.chest], 0.03 * T, 0.38 * T, -zb * 0.02, p[clav]);
    _w.set(-1, 0, 0).applyQuaternion(q[B.chest]);
    frame(_v.subVectors(S, p[clav]), _w, q[clav]);
    // elbows out, down and back
    _pole.set(0.45, -0.55, 0.75 * zb).normalize();
    twoBone(S, _wrist[i], a.upperArm, a.foreArm, _pole, p[fa], _w, _bendArm[i]);
    p[ua].copy(S);
    frame(_v.subVectors(p[fa], S), _bend.copy(_bendArm[i]).negate(), q[ua]);
    // forearm twists with the hand (volar side = -hand X)
    _x.set(-1, 0, 0).applyQuaternion(q[hd]);
    frame(_v.subVectors(_w, p[fa]), _n.copy(_x), q[fa]);
    p[hd].copy(_w);
    // if the wrist could not be reached, carry the hand with the arm (no gap)
  }

  // Legs: feet fixed in the shoes on the stretcher, knees up and slightly out.
  const alpha = STRETCHER_ANGLE;
  _u.set(-Math.cos(alpha), Math.sin(alpha), 0); // heel -> toe
  _n.set(Math.sin(alpha), Math.cos(alpha), 0); // sole normal
  const legs = (a.thigh + a.shin) * 0.975;
  const ankleOffU = 0.27 * a.foot;
  const ankleY = HEEL_Y + _u.y * ankleOffU + _n.y * a.ankleH;
  const finishHipX = pose.seatX + FINISH_SLIDE;
  const dy = _hip.y - ankleY;
  const want = finishHipX - Math.sqrt(Math.max(0, legs * legs - dy * dy));
  const nominal = pose.stretcherX + 0.04 + _u.x * ankleOffU + _n.x * a.ankleH;
  const ankleX = THREE.MathUtils.clamp(want, nominal - 0.14, nominal + 0.14);
  _heel.set(ankleX - _u.x * ankleOffU - _n.x * a.ankleH, HEEL_Y, 0);
  frame(_u, _n, _q);
  // _q: Y = heel->toe, X = toward sole normal (dorsal)
  p[B.stretcher].copy(_heel);
  q[B.stretcher].copy(_q);
  for (let i = 0; i < 2; i++) {
    const zb = i === 0 ? 1 : -1;
    const th = i === 0 ? B.thighL : B.thighR;
    const sh = i === 0 ? B.shinL : B.shinR;
    const ft = i === 0 ? B.footL : B.footR;
    at(p[B.pelvis], q[B.pelvis], 0, 0, -zb * a.hipHalf, p[th]);
    const footZ = zb * (a.hipHalf + 0.012);
    _ankle[i].set(ankleX, ankleY, footZ);
    _pole.set(0.1, 1, 0.28 * zb).normalize();
    twoBone(p[th], _ankle[i], a.thigh, a.shin, _pole, p[sh], _w, _bend);
    frame(_v.subVectors(p[sh], p[th]), _bend, q[th]);
    frame(_v.subVectors(_w, p[sh]), _bend, q[sh]);
    p[ft].copy(_w);
    q[ft].copy(_q);
  }
}

function torso(a: Anthro, lean: number, p: THREE.Vector3[], q: THREE.Quaternion[]) {
  const T = a.trunk;
  p[B.pelvis].copy(_hip);
  leanQ(lean * 0.6, q[B.pelvis]);
  at(p[B.pelvis], q[B.pelvis], 0, 0.25 * T, 0, p[B.spine]);
  leanQ(lean * 0.85, q[B.spine]);
  at(p[B.spine], q[B.spine], 0, 0.3 * T, 0, p[B.chest]);
  leanQ(lean, q[B.chest]);
}

/**
 * Hand orientation on the handle. i: 0 = left (boat +z), 1 = right.
 * The inside hand rolls with the handle when feathering (the wrist drops);
 * the outside hand lets the handle turn in its fingers.
 */
function handFrame(a: Anthro, i: number, s: number, feather: number, shoulder: THREE.Vector3, out: THREE.Quaternion) {
  const inside = (i === 0 ? 1 : -1) === s;
  // Z along the handle, pointing toward +z (see header comment)
  _z.copy(_aOut).multiplyScalar(-s);
  _y.subVectors(_grip[i], shoulder);
  _y.addScaledVector(_z, -_y.dot(_z)).normalize();
  _x.crossVectors(_y, _z).normalize();
  _m.makeBasis(_x, _y, _z);
  out.setFromRotationMatrix(_m);
  const roll = -0.12 - (inside ? 1.35 : 0.2) * feather;
  _q.setFromAxisAngle(_z, roll);
  out.premultiply(_q);
  void a;
}
