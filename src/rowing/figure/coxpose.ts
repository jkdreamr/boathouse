import * as THREE from 'three';
import type { Anthro } from './anthro';
import { B, gripLocal, type Rig } from './rig';

/**
 * Seated stern coxswain, facing the bow (+x), in boat-local coordinates.
 * Body frames follow rig.ts (torso X anterior / Y up / Z right; limbs Y along the bone),
 * so the same skinned geometry binds; only the facing differs from a rower:
 * the cox's left side (the L bones) is port (-z).
 */
export interface CoxPose {
  /** Hip-joint centre x and the seat top y. */
  hipX: number;
  seatTop: number;
  /** Trunk pitch toward the bow (rad) and lateral roll toward starboard (rad). */
  lean: number;
  roll: number;
  /** Head pitch down (rad) relative to level. */
  headPitch: number;
  /** Heel contact on the foot board (x, y) and the board inclination from horizontal. */
  heelX: number;
  heelY: number;
  footAngle: number;
  /** Toggle centres held by the left (port) and right (starboard) hands; toggles stand vertical. */
  gripL: THREE.Vector3;
  gripR: THREE.Vector3;
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _gl = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _hint = new THREE.Vector3();
const _S = new THREE.Vector3();
const _wrist = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _u = new THREE.Vector3();
const _n = new THREE.Vector3();

/** Upright-facing-bow trunk orientation: pitch toward +x, then roll about the boat axis. */
function trunkQ(pitch: number, roll: number, out: THREE.Quaternion) {
  _q.setFromAxisAngle(Z, -pitch);
  _r.setFromAxisAngle(X, roll);
  return out.multiplyQuaternions(_r, _q);
}

function frame(y: THREE.Vector3, hint: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _x.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

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

/** Pose the 21-bone rig for a seated stern cox. Allocation-free. */
export function solveCoxRig(a: Anthro, pose: CoxPose, rig: Rig) {
  const { p, q } = rig;
  const T = a.trunk;
  p[B.root].set(0, 0, 0);
  q[B.root].identity();
  rig.lean = pose.lean;

  // Trunk: most of the pitch comes from the pelvis, the thoracic spine stays tall.
  p[B.pelvis].set(pose.hipX, pose.seatTop + a.hipAboveSeat, 0);
  trunkQ(pose.lean * 0.7, pose.roll * 0.6, q[B.pelvis]);
  at(p[B.pelvis], q[B.pelvis], 0, 0.25 * T, 0, p[B.spine]);
  trunkQ(pose.lean * 0.9, pose.roll * 0.85, q[B.spine]);
  at(p[B.spine], q[B.spine], 0, 0.3 * T, 0, p[B.chest]);
  trunkQ(pose.lean, pose.roll, q[B.chest]);
  at(p[B.chest], q[B.chest], -0.02 * T, 0.5 * T, 0, p[B.neck]);
  trunkQ(pose.lean * 0.5 + pose.headPitch * 0.4, pose.roll * 0.5, q[B.neck]);
  at(p[B.neck], q[B.neck], 0, a.neck, 0, p[B.head]);
  // the head self-levels against the boat's roll
  trunkQ(pose.headPitch, pose.roll * 0.15, q[B.head]);

  // Arms: handshake grip on vertical toggles, knuckles forward, thumb up, pinky on the gunwale.
  gripLocal(a, _gl);
  for (let i = 0; i < 2; i++) {
    const zs = i === 0 ? -1 : 1; // boat z side of this arm (left = port)
    const clav = i === 0 ? B.clavL : B.clavR;
    const ua = i === 0 ? B.upArmL : B.upArmR;
    const fa = i === 0 ? B.foreArmL : B.foreArmR;
    const hd = i === 0 ? B.handL : B.handR;
    const grip = i === 0 ? pose.gripL : pose.gripR;
    at(p[B.chest], q[B.chest], 0, 0.45 * T, zs * a.shoulderHalf, _S);

    // Hand frame: Z along the toggle (radial for the right hand, mirrored for the left),
    // Y wrist -> knuckles: forward along the gunwale, slightly inboard.
    _z.set(0, zs, 0);
    _y.set(1, 0, -0.12 * zs).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x, _y, _z);
    q[hd].setFromRotationMatrix(_m);
    _wrist.copy(_gl).applyQuaternion(q[hd]).negate().add(grip);

    at(p[B.chest], q[B.chest], 0.03 * T, 0.38 * T, zs * 0.02, p[clav]);
    _hint.set(-1, 0, 0).applyQuaternion(q[B.chest]);
    frame(_v.subVectors(_S, p[clav]), _hint, q[clav]);
    // elbows down, back and a little out over the gunwale
    _pole.set(-0.35, -0.75, 0.55 * zs).normalize();
    twoBone(_S, _wrist, a.upperArm, a.foreArm, _pole, p[fa], _w, _bend);
    p[ua].copy(_S);
    frame(_v.subVectors(p[fa], _S), _hint.copy(_bend).negate(), q[ua]);
    _hint.set(-1, 0, 0).applyQuaternion(q[hd]);
    frame(_v.subVectors(_w, p[fa]), _hint, q[fa]);
    p[hd].copy(_w);
  }

  // Legs: heels on the foot board, knees up and together (narrow stern cockpit, hands outboard of the knees).
  const al = pose.footAngle;
  _u.set(Math.cos(al), Math.sin(al), 0); // heel -> toe
  _n.set(-Math.sin(al), Math.cos(al), 0); // sole normal (dorsal)
  frame(_u, _n, _r);
  p[B.stretcher].set(pose.heelX, pose.heelY, 0);
  q[B.stretcher].copy(_r);
  const ankleOff = 0.27 * a.foot;
  for (let i = 0; i < 2; i++) {
    const zs = i === 0 ? -1 : 1;
    const th = i === 0 ? B.thighL : B.thighR;
    const sh = i === 0 ? B.shinL : B.shinR;
    const ft = i === 0 ? B.footL : B.footR;
    at(p[B.pelvis], q[B.pelvis], 0, 0, zs * a.hipHalf, p[th]);
    _ankle.set(pose.heelX + _u.x * ankleOff + _n.x * a.ankleH, pose.heelY + _u.y * ankleOff + _n.y * a.ankleH, zs * a.hipHalf * 0.7);
    _pole.set(0.25, 1, -0.3 * zs).normalize();
    twoBone(p[th], _ankle, a.thigh, a.shin, _pole, p[sh], _w, _bend);
    frame(_v.subVectors(p[sh], p[th]), _bend, q[th]);
    frame(_v.subVectors(_w, p[sh]), _bend, q[sh]);
    p[ft].copy(_w);
    q[ft].copy(_r);
  }
}

/** Eye point (between the eyes) in the head-bone frame. */
export function coxEyeLocal(a: Anthro, out: THREE.Vector3) {
  return out.set(0.088 * a.head, 0.098 * a.head, 0);
}
