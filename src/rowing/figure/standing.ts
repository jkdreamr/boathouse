import * as THREE from 'three';
import type { Anthro } from './anthro';
import { B, gripLocal, makeRig, type Rig } from './rig';

/**
 * Standing / walking / boat-carrying solver for the shared 21-bone rig.
 *
 * Figure-local frame: origin on the ground under the body, +Y up, +Z forward,
 * +X to the figure's left. Bone frames follow the rig contract (X anterior or
 * dorsal, Y along the segment, Z to the right), so the same body geometry binds
 * to this rest pose as to the seated one.
 *
 * Gait follows healthy adult walking (Perry & Burnfield, "Gait Analysis"):
 * ~62% stance, heel strike with ~10 deg dorsiflexion, flat foot through
 * mid-stance, heel rise and ~30 deg plantarflexion at toe-off, ~60 deg knee
 * flexion in swing, a few cm of pelvic bob from the leg geometry, ~4 deg pelvic
 * rotation/obliquity and counter-rotating shoulders with opposite arm swing.
 * Feet are planted in world space and never slide: they only move in swing.
 */

export interface StandInput {
  /** ground point under the body, world */
  pos: THREE.Vector3;
  /** facing: forward = (sin yaw, 0, cos yaw) */
  yaw: number;
  /** 0..1 extra knee bend / hip drop */
  crouch: number;
  /** world grip targets (null = relaxed arm) */
  handL: THREE.Vector3 | null;
  handR: THREE.Vector3 | null;
  /** carried hull: local +x along the keel, local y = up when right side up; centreline through the origin */
  hull: THREE.Object3D | null;
  /** optional world point to look at */
  look: THREE.Vector3 | null;
  dt: number;
}

const DUTY = 0.62;
const SWING = 1 - DUTY;
const TAU = Math.PI * 2;
const HEEL_STRIKE = 0.17;
const TOE_OFF = 0.52;
const TOE_OUT = 0.12;
const CADENCE_IDLE = 0.95; // strides / s when stepping on the spot

const UP = new THREE.Vector3(0, 1, 0);
const AX = new THREE.Vector3(1, 0, 0);
const AZ = new THREE.Vector3(0, 0, 1);
const Q_BASE = new THREE.Quaternion().setFromAxisAngle(UP, -Math.PI / 2);

const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _t = new THREE.Vector3();
const _n = new THREE.Vector3();
const _f = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _bend = new THREE.Vector3();
const _gl = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _out = new THREE.Vector3();
const _down = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _hullUp = new THREE.Vector3();
const _hullO = new THREE.Vector3();
const _lat = new THREE.Vector3();
const _look = new THREE.Vector3();
const _invYaw = new THREE.Quaternion();
const _sh = [new THREE.Vector3(), new THREE.Vector3()];
const _tgt = [new THREE.Vector3(), new THREE.Vector3()];
const _raw = [new THREE.Vector3(), new THREE.Vector3()];
const _wrist = [new THREE.Vector3(), new THREE.Vector3()];
const _hq = [new THREE.Quaternion(), new THREE.Quaternion()];
const _relW = [new THREE.Vector3(), new THREE.Vector3()];
const _relE = [new THREE.Vector3(), new THREE.Vector3()];
const _relQ = [new THREE.Quaternion(), new THREE.Quaternion()];
const _has = [false, false];
let _hullOn = false;

const ss = THREE.MathUtils.smoothstep;
const clamp = THREE.MathUtils.clamp;
const lerp = THREE.MathUtils.lerp;

function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/** Frame with +Y along `y` and +X toward `hint` (orthogonalised). */
function frame(y: THREE.Vector3, hint: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _x.copy(hint).addScaledVector(_y, -hint.dot(_y));
  if (_x.lengthSq() < 1e-8) _x.set(0, 0, 1).addScaledVector(_y, -_y.z);
  _x.normalize();
  _z.crossVectors(_x, _y);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Frame with +Y along `y`, +Z along `z` (z orthogonalised against y). */
function frameYZ(y: THREE.Vector3, z: THREE.Vector3, out: THREE.Quaternion) {
  _y.copy(y).normalize();
  _z.copy(z).addScaledVector(_y, -z.dot(_y)).normalize();
  _x.crossVectors(_y, _z);
  _m.makeBasis(_x, _y, _z);
  return out.setFromRotationMatrix(_m);
}

/** Two-bone IK; writes the middle joint and the reachable end point. */
function twoBone(root: THREE.Vector3, target: THREE.Vector3, a: number, b: number, pole: THREE.Vector3, mid: THREE.Vector3, end: THREE.Vector3, bend: THREE.Vector3) {
  _v.subVectors(target, root);
  let L = _v.length();
  _v.divideScalar(L || 1);
  L = clamp(L, Math.abs(a - b) + 1e-4, (a + b) * 0.9995);
  const ca = (a * a + L * L - b * b) / (2 * a * L);
  const h = a * Math.sqrt(Math.max(0, 1 - ca * ca));
  bend.copy(pole).addScaledVector(_v, -pole.dot(_v));
  if (bend.lengthSq() < 1e-8) bend.set(0, 0, 1).addScaledVector(_v, -_v.z);
  bend.normalize();
  mid.copy(root).addScaledVector(_v, a * ca).addScaledVector(bend, h);
  end.copy(root).addScaledVector(_v, L);
}

function at(pos: THREE.Vector3, q: THREE.Quaternion, x: number, y: number, z: number, out: THREE.Vector3) {
  return out.set(x, y, z).applyQuaternion(q).add(pos);
}

/** Body-segment orientation from figure-local yaw, roll (about +Z, + tips the top to the right) and forward lean. */
function segQ(yaw: number, roll: number, lean: number, out: THREE.Quaternion) {
  _qa.setFromAxisAngle(UP, yaw);
  _qb.setFromAxisAngle(AZ, roll);
  _qc.setFromAxisAngle(AX, lean);
  return out.copy(_qa).multiply(_qb).multiply(_qc).multiply(Q_BASE);
}

class FootState {
  /** ground point under the flat-foot ankle, world */
  readonly plant = new THREE.Vector3();
  yaw = 0;
  /** actual ankle, world, last frame */
  readonly ankle = new THREE.Vector3();
  pitch = 0;
  readonly lift = new THREE.Vector3();
  liftYaw = 0;
  liftPitch = 0;
  swinging = false;
  /** fraction of the stance phase completed */
  stance = 0;
  /** swing progress 0..1 (only meaningful while swinging) */
  swing = 0;
  amp = 0;
}

export class StandingSolver {
  readonly rig: Rig = makeRig();
  /** smoothed facing (the mesh should be rotated by this, not the raw input) */
  yaw = 0;
  private readonly a: Anthro;
  private init = false;
  private phase = 0;
  private speed = 0;
  private readonly last = new THREE.Vector3();
  private readonly vel = new THREE.Vector3();
  private readonly feet = [new FootState(), new FootState()];
  private readonly hold = [0, 0];
  private readonly lastW = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly lastQ = [new THREE.Quaternion(), new THREE.Quaternion()];
  private readonly flatAnkle: number;
  private readonly lat: number;
  private readonly legs: number;
  private readonly arm: number;

  constructor(a: Anthro) {
    this.a = a;
    this.flatAnkle = a.ankleH + 0.012;
    this.lat = a.hipHalf + 0.012;
    this.legs = a.thigh + a.shin;
    this.arm = a.upperArm + a.foreArm;
  }

  /** Standing shoulder-joint height above the ground (no load, no crouch). */
  get shoulderHeight() {
    return this.flatAnkle + this.legs * 0.985 + this.a.trunk;
  }

  private nominal(i: number, pos: THREE.Vector3, yaw: number, out: THREE.Vector3) {
    const s = i === 0 ? 1 : -1;
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    return out.set(pos.x + c * s * this.lat, pos.y, pos.z - sn * s * this.lat);
  }

  private reset(inp: StandInput) {
    this.yaw = inp.yaw;
    this.phase = 0.9 * TAU;
    this.speed = 0;
    this.vel.set(0, 0, 0);
    this.last.copy(inp.pos);
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      this.nominal(i, inp.pos, inp.yaw, f.plant);
      f.yaw = inp.yaw + (i === 0 ? TOE_OUT : -TOE_OUT);
      f.ankle.copy(f.plant).setY(inp.pos.y + this.flatAnkle);
      f.pitch = 0;
      f.swinging = false;
      f.stance = 0.5;
      f.amp = 0;
    }
    this.hold[0] = inp.handL ? 1 : 0;
    this.hold[1] = inp.handR ? 1 : 0;
    this.init = true;
  }

  /** Flat-foot ankle -> actual ankle for a stance pitch (heel pivot when toe-up, ball pivot when heel-up). */
  private pivot(plant: THREE.Vector3, yaw: number, pitch: number, out: THREE.Vector3) {
    const Fl = this.a.foot;
    const u = this.flatAnkle;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    // ankle relative to the pivot (forward f, up u) rotated toe-up by pitch
    const f0 = pitch >= 0 ? 0.27 * Fl : -0.55 * Fl;
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const f1 = f0 * cp - u * sp;
    const u1 = f0 * sp + u * cp;
    const shift = f1 - f0;
    return out.set(plant.x + fx * shift, plant.y + u1, plant.z + fz * shift);
  }

  solve(inp: StandInput) {
    const a = this.a;
    const T = a.trunk;
    const { p, q } = this.rig;
    const dt = clamp(inp.dt, 0, 0.1);
    if (!this.init || inp.pos.distanceTo(this.last) > 1.5) this.reset(inp);

    // ---- facing, velocity, stride ----
    const dyaw = wrap(inp.yaw - this.yaw);
    this.yaw = wrap(this.yaw + clamp(dyaw, -4.5 * dt, 4.5 * dt));
    const yaw = this.yaw;
    _v.subVectors(inp.pos, this.last).setY(0);
    const dist = _v.length();
    if (dt > 0) this.vel.lerp(_v.divideScalar(dt), 1 - Math.exp(-dt * 7));
    this.speed = this.vel.length();
    this.last.copy(inp.pos);
    const v = this.speed;
    const m = ss(v, 0.06, 0.55);
    const stride = clamp(a.H * (0.34 + 0.36 * Math.min(v, 1.6)), 0.55, 0.8 * a.H);
    _invYaw.setFromAxisAngle(UP, -yaw);

    // ---- step timing: distance-driven, plus stepping on the spot to settle ----
    let settle = false;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      if (f.swinging) settle = true;
      this.nominal(i, inp.pos, yaw, _t);
      const e = Math.hypot(_t.x - f.plant.x, _t.z - f.plant.z);
      if (e > 0.11 || Math.abs(wrap(f.yaw - yaw - (i === 0 ? TOE_OUT : -TOE_OUT))) > 0.42) settle = true;
    }
    let dphi = (TAU * dist) / stride;
    if (settle && v < 0.35) dphi = Math.max(dphi, TAU * CADENCE_IDLE * dt);
    this.phase = (this.phase + Math.min(dphi, 0.45)) % TAU;

    // ---- feet ----
    let moveX = 0;
    let moveZ = 0;
    if (v > 1e-3) {
      moveX = this.vel.x / v;
      moveZ = this.vel.z / v;
    }
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const toe = i === 0 ? TOE_OUT : -TOE_OUT;
      let u = this.phase / TAU + i * 0.5;
      u -= Math.floor(u);
      const inSwing = u < SWING;
      if (inSwing && !f.swinging) {
        f.swinging = true;
        f.lift.copy(f.ankle);
        f.liftYaw = f.yaw;
        f.liftPitch = f.pitch;
        f.amp = Math.max(m, 0.35);
      }
      if (inSwing) {
        const s = u / SWING;
        f.swing = s;
        // landing target: where the body will be at heel strike, plus half the stance sweep
        const ahead = m * ((1 - s) * SWING * stride + DUTY * stride * 0.5);
        this.nominal(i, inp.pos, yaw, _t);
        _t.x += moveX * ahead;
        _t.z += moveZ * ahead;
        const ty = wrap(yaw + toe - f.liftYaw) + f.liftYaw;
        const hs = HEEL_STRIKE * m;
        this.pivot(_t, ty, hs, _w);
        const e = s * s * (3 - 2 * s);
        f.ankle.lerpVectors(f.lift, _w, e);
        f.ankle.y = lerp(f.lift.y, _w.y, s) + (0.025 + 0.06 * m) * Math.sin(Math.PI * Math.pow(s, 0.75));
        f.yaw = lerp(f.liftYaw, ty, e);
        f.pitch = lerp(f.liftPitch, hs, ss(s, 0.15, 0.95));
        // keep the plant target current so the landing frame is continuous
        f.plant.copy(_t);
      } else {
        if (f.swinging) {
          f.swinging = false;
          f.yaw = wrap(f.yaw);
        }
        const t = (u - SWING) / DUTY;
        f.stance = t;
        let pitch = 0;
        const amp = f.amp;
        if (t < 0.15) pitch = HEEL_STRIKE * amp * (1 - ss(t, 0, 0.15));
        else if (t > 0.58) pitch = -TOE_OFF * amp * Math.pow((t - 0.58) / 0.42, 1.6);
        f.pitch = pitch;
        this.pivot(f.plant, f.yaw, pitch, f.ankle);
      }
    }

    // ---- hand targets (figure local) ----
    _has[0] = !!inp.handL;
    _has[1] = !!inp.handR;
    const ys = this.shoulderHeight;
    _hullOn = !!inp.hull;
    if (inp.hull) {
      inp.hull.matrixWorld.extractBasis(_axis, _hullUp, _lat);
      _axis.normalize().applyQuaternion(_invYaw);
      _lat.normalize().applyQuaternion(_invYaw);
      _hullUp.normalize().applyQuaternion(_invYaw);
      _hullO.setFromMatrixPosition(inp.hull.matrixWorld).sub(inp.pos).applyQuaternion(_invYaw);
    } else {
      _axis.set(1, 0, 0);
    }
    if (_has[0]) _raw[0].copy(inp.handL!).sub(inp.pos).applyQuaternion(_invYaw);
    if (_has[1]) _raw[1].copy(inp.handR!).sub(inp.pos).applyQuaternion(_invYaw);
    // a single rail call means the near gunwale (an inverted shell's local sides are mirrored)
    const oneRail = _has[0] !== _has[1] || (_has[0] && _raw[0].distanceToSquared(_raw[1]) < 0.0025);
    if (inp.hull && oneRail) for (let i = 0; i < 2; i++) if (_has[i]) nearRail(_raw[i]);
    // one target -> the hand on that side; two -> left hand takes the more-left one
    if (_has[0] !== _has[1]) {
      const src = _has[0] ? _raw[0] : _raw[1];
      const side = src.x >= 0 ? 0 : 1;
      _tgt[side].copy(src);
      _has[side] = true;
      _has[1 - side] = false;
    } else if (_has[0]) {
      if (_raw[0].x >= _raw[1].x) {
        _tgt[0].copy(_raw[0]);
        _tgt[1].copy(_raw[1]);
      } else {
        _tgt[0].copy(_raw[1]);
        _tgt[1].copy(_raw[0]);
      }
    }
    // a grip still metres away (walking up to the station) is not held yet
    for (let i = 0; i < 2; i++) if (_has[i] && Math.hypot(_tgt[i].x, _tgt[i].z) > 1.2) _has[i] = false;
    let gy = 0;
    let gn = 0;
    for (let i = 0; i < 2; i++) if (_has[i]) ((gy += _tgt[i].y), gn++);
    gy = gn ? gy / gn : 0;
    const wOver = gn ? ss(gy, ys + 0.12, ys + 0.38) : 0;
    const wShoulder = gn ? ss(gy, ys - 0.42, ys - 0.12) * (1 - wOver) : 0;
    // hull side (+1 = hull to the figure's left)
    const hullSide = gn === 1 ? (_has[0] ? 1 : -1) : gn === 2 ? Math.sign(_tgt[0].x + _tgt[1].x) || 1 : 1;
    const sameRail = gn === 2 && _tgt[0].distanceToSquared(_tgt[1]) < 0.0025;
    // gunwale axis pointing forward (or left when it runs across the body)
    const across = Math.abs(_axis.x) > Math.abs(_axis.z);
    if (across ? _axis.x < 0 : _axis.z < 0) _axis.negate();
    if (sameRail) {
      if (across) {
        _tgt[0].addScaledVector(_axis, 0.2);
        _tgt[1].addScaledVector(_axis, -0.2);
      } else {
        // rail alongside: inside hand just ahead, outside hand reaches across further ahead
        const inside = hullSide > 0 ? 0 : 1;
        _tgt[inside].addScaledVector(_axis, 0.1 + 0.14 * wShoulder);
        _tgt[1 - inside].addScaledVector(_axis, 0.42);
        if (wShoulder > 0.5) _has[1 - inside] = false; // shell sits on the shoulder; the outside hand is free
      }
    } else if (gn === 1) {
      const i = _has[0] ? 0 : 1;
      if (!across) _tgt[i].addScaledVector(_axis, 0.06 + 0.22 * wShoulder);
    }

    // ---- hold blend (smooth hand-on / let-go) ----
    for (let i = 0; i < 2; i++) {
      const goal = _has[i] ? 1 : 0;
      this.hold[i] = goal > this.hold[i] ? Math.min(goal, this.hold[i] + dt * 3.5) : Math.max(goal, this.hold[i] - dt * 2.5);
      if (dt === 0) this.hold[i] = goal;
    }

    // ---- shoulders under the shell: drop to the gunwale ----
    let support = 0;
    if (wShoulder > 0) {
      const top = ys + 0.05;
      support = wShoulder * clamp(top - gy, 0, 0.13);
    }

    // ---- trunk posture with reach iteration ----
    const crouchDrop = inp.crouch * 0.36 * this.legs;
    let lean = 0.035 + 0.035 * m + 0.03 * wShoulder;
    let drop = crouchDrop + support * 0.75;
    const shDep = support * 0.25;
    gripLocal(a, _gl);
    // pelvic rotation from the feet: the swing-side hip comes forward
    const zL = this.localZ(0, inp.pos);
    const zR = this.localZ(1, inp.pos);
    const fd = clamp(zL - zR, -0.8, 0.8);
    const pelYaw = -0.11 * fd * m;
    const swL = this.feet[0].swinging ? Math.sin(Math.PI * this.feet[0].swing) : 0;
    const swR = this.feet[1].swinging ? Math.sin(Math.PI * this.feet[1].swing) : 0;
    const handsBusy = Math.max(this.hold[0], this.hold[1]);
    const chestYaw = -pelYaw * (1.0 - 0.75 * handsBusy);
    const pelRoll = 0.065 * (swL - swR) * m;
    const sway = -0.022 * (swL - swR) * m;
    const chestRoll = -0.06 * hullSide * wShoulder;
    for (let pass = 0; pass < 4; pass++) {
      this.torso(inp.pos, lean, drop, pelYaw, pelRoll, sway, chestYaw, chestRoll);
      let reachLow = 0;
      for (let i = 0; i < 2; i++) {
        if (!_has[i]) continue;
        this.shoulder(i, wOver, shDep, _sh[i]);
        this.handFrame(i, _sh[i], _hq[i]);
        _wrist[i].copy(_gl).applyQuaternion(_hq[i]).negate().add(_tgt[i]);
        const d = _sh[i].distanceTo(_wrist[i]);
        const e = d - this.protraction(d) - this.arm * 0.985;
        if (e > 0 && _tgt[i].y < _sh[i].y - 0.1) reachLow = Math.max(reachLow, e);
      }
      if (reachLow <= 0.004) break;
      // reach down: hinge at the hips first (flat back), then bend the knees
      if (lean < 0.62) {
        lean = Math.min(0.62, lean + reachLow * 1.5);
        drop += reachLow * 0.2;
      } else drop += reachLow * 0.85;
      drop = Math.min(drop, 0.32 * this.legs);
    }

    // ---- legs ----
    for (let i = 0; i < 2; i++) {
      const zb = i === 0 ? 1 : -1;
      const f = this.feet[i];
      const th = i === 0 ? B.thighL : B.thighR;
      const sh = i === 0 ? B.shinL : B.shinR;
      const ft = i === 0 ? B.footL : B.footR;
      at(p[B.pelvis], q[B.pelvis], 0, 0, -zb * a.hipHalf, p[th]);
      _t.copy(f.ankle).sub(inp.pos).applyQuaternion(_invYaw);
      const fy = f.yaw - yaw;
      _fwd.set(Math.sin(fy), 0, Math.cos(fy));
      _pole.copy(_fwd).addScaledVector(AX, zb * 0.12).normalize();
      twoBone(p[th], _t, a.thigh, a.shin, _pole, p[sh], _w, _bend);
      frame(_v.subVectors(p[sh], p[th]), _bend, q[th]);
      frame(_v.subVectors(_w, p[sh]), _bend, q[sh]);
      p[ft].copy(_w);
      const cp = Math.cos(f.pitch);
      const sp = Math.sin(f.pitch);
      _y.copy(_fwd).multiplyScalar(cp).addScaledVector(UP, sp);
      _x.copy(UP).multiplyScalar(cp).addScaledVector(_fwd, -sp);
      _f.copy(_y);
      _n.copy(_x);
      frame(_f, _n, q[ft]);
    }

    // ---- arms ----
    _fwd.set(1, 0, 0).applyQuaternion(q[B.chest]).setY(0).normalize();
    _down.set(0, -1, 0);
    const armSwing = 0.3 * m;
    for (let i = 0; i < 2; i++) {
      const zb = i === 0 ? 1 : -1;
      const clav = i === 0 ? B.clavL : B.clavR;
      const ua = i === 0 ? B.upArmL : B.upArmR;
      const fa = i === 0 ? B.foreArmL : B.foreArmR;
      const hd = i === 0 ? B.handL : B.handR;
      const w = this.hold[i];
      const S = _sh[i];
      this.shoulder(i, wOver * w, shDep * w, S);
      _out.set(zb, 0, 0).applyQuaternion(_qa.setFromAxisAngle(UP, chestYaw));
      // relaxed arm: swings opposite the same-side leg
      const zSame = i === 0 ? zL : zR;
      const zOther = i === 0 ? zR : zL;
      const sw = clamp((zOther - zSame) / Math.max(0.3, DUTY * stride), -1, 1);
      const al = armSwing * sw;
      const flex = 0.2 + 0.28 * Math.max(0, sw) * m;
      _relE[i].copy(_down).multiplyScalar(Math.cos(al)).addScaledVector(_fwd, Math.sin(al)).addScaledVector(_out, 0.13).normalize();
      _relE[i].multiplyScalar(a.upperArm).add(S);
      _v.copy(_down).multiplyScalar(Math.cos(al + flex)).addScaledVector(_fwd, Math.sin(al + flex)).addScaledVector(_out, 0.02).normalize();
      _relW[i].copy(_v).multiplyScalar(a.foreArm).add(_relE[i]);
      // relaxed hand: palm to the thigh, slight wrist flexion, fingers curled
      _y.copy(_v).addScaledVector(_fwd, 0.12).normalize();
      _z.copy(_fwd).multiplyScalar(-zb);
      frameYZ(_y, _z, _relQ[i]);
      if (w > 0) {
        if (_has[i]) {
          this.handFrame(i, S, _hq[i]);
          _wrist[i].copy(_gl).applyQuaternion(_hq[i]).negate().add(_tgt[i]);
          this.lastW[i].copy(_wrist[i]);
          this.lastQ[i].copy(_hq[i]);
        } else {
          _wrist[i].copy(this.lastW[i]);
          _hq[i].copy(this.lastQ[i]);
        }
        _wrist[i].lerp(_relW[i], 1 - w);
        _hq[i].slerp(_relQ[i], 1 - w);
        // elbows: low grips out and back, shoulder carry down, overhead out
        const lo = 1 - wShoulder - wOver;
        _pole.set(zb * (0.55 * lo + 0.3 * wShoulder + 1.0 * wOver), -0.6 * lo - 1.0 * wShoulder + 0.1 * wOver, -0.55 * lo + 0.25 * wShoulder + 0.15 * wOver);
        _pole.applyQuaternion(_qa.setFromAxisAngle(UP, chestYaw)).normalize();
        _pole.lerp(_bend.subVectors(_relE[i], S).normalize(), 1 - w).normalize();
        const d = S.distanceTo(_wrist[i]);
        _v.subVectors(_wrist[i], S).normalize();
        S.addScaledVector(_v, this.protraction(d) * w);
        twoBone(S, _wrist[i], a.upperArm, a.foreArm, _pole, p[fa], _w, _bend);
        p[hd].copy(_w);
      } else {
        p[fa].copy(_relE[i]);
        p[hd].copy(_relW[i]);
        _hq[i].copy(_relQ[i]);
        // bend direction = elbow offset from the shoulder-wrist line
        _v.subVectors(_relW[i], S).normalize();
        _bend.subVectors(_relE[i], S);
        _bend.addScaledVector(_v, -_bend.dot(_v));
        if (_bend.lengthSq() < 1e-8) _bend.set(0, 0, -1);
        _bend.normalize();
      }
      q[hd].copy(_hq[i]);
      at(p[B.chest], q[B.chest], 0.03 * T, 0.38 * T, -zb * 0.02, p[clav]);
      _w.set(-1, 0, 0).applyQuaternion(q[B.chest]);
      frame(_v.subVectors(S, p[clav]), _w, q[clav]);
      p[ua].copy(S);
      frame(_v.subVectors(p[fa], S), _t.copy(_bend).negate(), q[ua]);
      _x.set(-1, 0, 0).applyQuaternion(q[hd]);
      frame(_v.subVectors(p[hd], p[fa]), _x, q[fa]);
    }

    // ---- neck and head: level gaze, glance at the hands when still, head out from under the hull ----
    let lookYaw = 0;
    let lookPitch = 0.08 + 0.04 * m;
    if (inp.look) {
      _look.copy(inp.look).sub(inp.pos).applyQuaternion(_invYaw);
    } else if (gn > 0 && wOver < 0.5 && wShoulder < 0.5) {
      _look.set(0, 0, 0);
      for (let i = 0; i < 2; i++) if (_has[i]) _look.add(_tgt[i]);
      _look.divideScalar(gn);
    } else {
      _look.set(0, ys + 0.1, 6);
    }
    _v.subVectors(_look, p[B.chest]);
    _v.y -= 0.35 * T;
    const glance = inp.look ? 1 : (1 - m) * 0.8;
    lookYaw = clamp(Math.atan2(_v.x, Math.max(0.05, _v.z)), -0.75, 0.75) * glance;
    if (_v.z < 0) lookYaw = Math.sign(_v.x) * 0.75 * glance;
    const horiz = Math.hypot(_v.x, _v.z);
    lookPitch = lerp(lookPitch, clamp(Math.atan2(-_v.y, horiz), -0.3, 0.6), glance);
    const headRoll = hullSide * 0.3 * wShoulder;
    at(p[B.chest], q[B.chest], -0.02 * T, 0.5 * T, 0, p[B.neck]);
    segQ(lookYaw, headRoll, lookPitch - 0.06 * wOver, q[B.head]);
    _qb.copy(q[B.chest]).slerp(q[B.head], 0.5);
    q[B.neck].copy(_qb);
    at(p[B.neck], q[B.neck], 0, a.neck, 0, p[B.head]);

    // ---- root and stretcher ----
    p[B.root].set(0, 0, 0);
    q[B.root].identity();
    p[B.stretcher].copy(p[B.pelvis]);
    q[B.stretcher].copy(q[B.pelvis]);
  }

  /** Shoulder-girdle protraction toward a far grip (m). */
  private protraction(d: number) {
    const arm = this.arm * 0.985;
    return 0.07 * ss(d, arm - 0.12, arm + 0.05);
  }

  /** Forward (local z) of a foot's ankle relative to the body. */
  private localZ(i: number, pos: THREE.Vector3) {
    const f = this.feet[i];
    const dx = f.ankle.x - pos.x;
    const dz = f.ankle.z - pos.z;
    return dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw);
  }

  private torso(pos: THREE.Vector3, lean: number, drop: number, pelYaw: number, pelRoll: number, sway: number, chestYaw: number, chestRoll: number) {
    const a = this.a;
    const T = a.trunk;
    const { p, q } = this.rig;
    // hip height: nominal soft-knee stance, capped so each stance leg can reach its foot
    let hy = this.flatAnkle + this.legs * 0.985 - 0.012 - drop;
    const reachL = this.legs * 0.995;
    for (let i = 0; i < 2; i++) {
      const f = this.feet[i];
      const zb = i === 0 ? 1 : -1;
      // hip joint (approximately, ignoring pelvis tilt) in world
      const hx = pos.x + Math.cos(this.yaw) * zb * a.hipHalf;
      const hz = pos.z - Math.sin(this.yaw) * zb * a.hipHalf;
      const d = Math.hypot(f.ankle.x - hx, f.ankle.z - hz);
      const lim = f.ankle.y - pos.y + Math.sqrt(Math.max(0.0, reachL * reachL - Math.min(d * d, reachL * reachL * 0.7)));
      const wgt = f.swinging ? ss(f.swing, 0.55, 1) : 1;
      if (wgt > 0) hy = Math.min(hy, lerp(hy, lim, wgt));
    }
    // squatting moves the hips back over the heels
    const back = -0.42 * drop - 0.08 * Math.max(0, lean - 0.1);
    _hip.set(sway, hy, back);
    p[B.pelvis].copy(_hip);
    segQ(pelYaw, pelRoll, lean * 0.6 + 0.06, q[B.pelvis]);
    at(p[B.pelvis], q[B.pelvis], 0, 0.25 * T, 0, p[B.spine]);
    segQ((pelYaw + chestYaw) * 0.5, chestRoll * 0.5 - pelRoll * 0.4, lean * 0.85 - 0.02, q[B.spine]);
    at(p[B.spine], q[B.spine], 0, 0.3 * T, 0, p[B.chest]);
    segQ(chestYaw, chestRoll - pelRoll * 0.5, lean + 0.02, q[B.chest]);
  }

  /** Shoulder joint; elevated for overhead reach, depressed under a load. */
  private shoulder(i: number, over: number, dep: number, out: THREE.Vector3) {
    const a = this.a;
    const T = a.trunk;
    const { p, q } = this.rig;
    const zb = i === 0 ? 1 : -1;
    return at(p[B.chest], q[B.chest], 0, 0.45 * T + 0.05 * over - dep, -zb * (a.shoulderHalf - 0.012 * over), out);
  }

  /**
   * Hand on a gunwale: Z along the rail, Y from the shoulder toward the grip,
   * palm (-X) toward the hull's centreline so the fingers wrap under the rail.
   */
  private handFrame(i: number, S: THREE.Vector3, out: THREE.Quaternion) {
    const g = _tgt[i];
    _y.subVectors(g, S);
    _z.copy(_axis);
    _y.addScaledVector(_z, -_y.dot(_z));
    if (_y.lengthSq() < 1e-6) _y.set(0, -1, 0);
    _y.normalize();
    _x.crossVectors(_y, _z).normalize();
    // palm direction: toward the hull centreline (or toward the body midline and up)
    if (_hullOn) {
      _n.subVectors(g, _hullO);
      _n.addScaledVector(_axis, -_n.dot(_axis)).negate();
    } else {
      _n.set(-g.x, 0.3, 0);
    }
    if (_n.lengthSq() < 1e-8) _n.set(-g.x, 0.3, 0);
    if (-_x.dot(_n) < 0) {
      _z.negate();
      _x.negate();
    }
    _m.makeBasis(_x, _y, _z);
    return out.setFromRotationMatrix(_m);
  }
}

function mirrorRail(t: THREE.Vector3) {
  _n.subVectors(t, _hullO);
  return t.addScaledVector(_lat, -2 * _n.dot(_lat));
}

/** Replace a gunwale point with whichever of it and its mirror is nearer the body. */
function nearRail(t: THREE.Vector3) {
  const d0 = t.x * t.x + t.z * t.z;
  mirrorRail(t);
  if (t.x * t.x + t.z * t.z > d0) mirrorRail(t);
  return t;
}

/** Neutral standing rest pose (feet under the hips, arms hanging) for binding. */
export function standingRest(a: Anthro): Rig {
  const s = new StandingSolver(a);
  s.solve({ pos: new THREE.Vector3(), yaw: 0, crouch: 0, handL: null, handR: null, hull: null, look: null, dt: 0 });
  return s.rig;
}
