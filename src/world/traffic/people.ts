import * as THREE from 'three';
import { clamp, SKIN_TONES } from './nav';

const LIMBS = 900;
const BALLS = 160;
const BOXES = 220;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _d = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _sh = new THREE.Vector3();
const _el = new THREE.Vector3();
const _up = new THREE.Vector3();
const _ac = new THREE.Vector3();
const _hip = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _head = new THREE.Vector3();
const _k = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);
const _pd = new THREE.Vector3();
const _pn = new THREE.Vector3();
const _pw = new THREE.Vector3();
const _pc = new THREE.Vector3();

export interface Look {
  skin: THREE.Color;
  top: THREE.Color;
  bottom: THREE.Color;
  hair: THREE.Color;
  hat: THREE.Color | null;
  pfd: THREE.Color | null;
}

const HAIR = ['#1c140f', '#2a1d16', '#4a3020', '#6b4a2b', '#a77b48', '#3b3b3b'];

export function makeLook(rand: () => number, tops: string[], opts: { pfd?: string[]; hat?: number; bottoms?: string[] } = {}): Look {
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length) % a.length];
  return {
    skin: new THREE.Color(pick(SKIN_TONES)),
    top: new THREE.Color(pick(tops)),
    bottom: new THREE.Color(pick(opts.bottoms ?? ['#2e2d29', '#1f2a3a', '#3b3f45', '#24262b'])),
    hair: new THREE.Color(pick(HAIR)),
    hat: rand() < (opts.hat ?? 0.5) ? new THREE.Color(pick(['#f4f2ec', '#2e2d29', '#8c1515', '#3d5a80', '#c9b37e'])) : null,
    pfd: opts.pfd ? new THREE.Color(pick(opts.pfd)) : null,
  };
}

export interface SeatedPose {
  /** Hip (seat contact) in craft-local coords. */
  hip: THREE.Vector3;
  /** Forward pitch of the torso (rad, + toward the bow). */
  lean: number;
  /** Sideways lean (rad, + toward starboard/+z). */
  roll: number;
  /** Shoulder rotation about the vertical (rad, + brings the starboard shoulder aft). */
  twist: number;
  handL: THREE.Vector3;
  handR: THREE.Vector3;
  /** Optional feet (seated sailors / standing paddlers). */
  footL?: THREE.Vector3;
  footR?: THREE.Vector3;
  torsoLen?: number;
}

/** Instanced low-poly people: every paddler, sailor and coach in three draw calls. */
export class PeopleBatch {
  readonly limbs: THREE.InstancedMesh;
  readonly balls: THREE.InstancedMesh;
  readonly boxes: THREE.InstancedMesh;
  private nl = 0;
  private nb = 0;
  private nx = 0;
  private M = new THREE.Matrix4();

  constructor(parent: THREE.Object3D) {
    const mat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.75 });
    const mk = (geo: THREE.BufferGeometry, n: number, name: string) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.name = name;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.setColorAt(0, new THREE.Color(1, 1, 1));
      m.instanceColor!.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.castShadow = true;
      m.count = 0;
      parent.add(m);
      return m;
    };
    this.limbs = mk(new THREE.CylinderGeometry(1, 1, 1, 8), LIMBS, 'traffic-limbs');
    this.balls = mk(new THREE.SphereGeometry(1, 12, 8), BALLS, 'traffic-heads');
    this.boxes = mk(new THREE.BoxGeometry(1, 1, 1), BOXES, 'traffic-boxes');
  }

  begin() {
    this.nl = this.nb = this.nx = 0;
  }

  end() {
    for (const [m, n] of [
      [this.limbs, this.nl],
      [this.balls, this.nb],
      [this.boxes, this.nx],
    ] as const) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      m.instanceColor!.needsUpdate = true;
    }
  }

  /** Set the craft-local → world transform used by the following calls. */
  frame(m: THREE.Matrix4) {
    this.M.copy(m);
  }

  limb(a: THREE.Vector3, b: THREE.Vector3, r: number, c: THREE.Color) {
    if (this.nl >= LIMBS) return;
    _a.copy(a).applyMatrix4(this.M);
    _b.copy(b).applyMatrix4(this.M);
    _d.subVectors(_b, _a);
    const len = _d.length();
    if (len < 1e-4) return;
    _q.setFromUnitVectors(UPY, _d.multiplyScalar(1 / len));
    _a.add(_b).multiplyScalar(0.5);
    _m.compose(_a, _q, _s.set(r, len, r));
    this.limbs.setMatrixAt(this.nl, _m);
    this.limbs.setColorAt(this.nl++, c);
  }

  ball(p: THREE.Vector3, sx: number, sy: number, sz: number, c: THREE.Color) {
    if (this.nb >= BALLS) return;
    _a.copy(p).applyMatrix4(this.M);
    _m.extractRotation(this.M);
    _q.setFromRotationMatrix(_m);
    _m.compose(_a, _q, _s.set(sx, sy, sz));
    this.balls.setMatrixAt(this.nb, _m);
    this.balls.setColorAt(this.nb++, c);
  }

  /** Box centred at p with local axes ax (width), ay (length), az (thickness). */
  box(p: THREE.Vector3, ax: THREE.Vector3, ay: THREE.Vector3, sx: number, sy: number, sz: number, c: THREE.Color) {
    if (this.nx >= BOXES) return;
    _x.copy(ax).transformDirection(this.M);
    _y.copy(ay).transformDirection(this.M);
    _z.crossVectors(_x, _y).normalize();
    _x.crossVectors(_y, _z).normalize();
    _m.makeBasis(_x.multiplyScalar(sx), _y.multiplyScalar(sy), _z.multiplyScalar(sz));
    _a.copy(p).applyMatrix4(this.M);
    _m.setPosition(_a);
    this.boxes.setMatrixAt(this.nx, _m);
    this.boxes.setColorAt(this.nx++, c);
  }

  /** Two-bone chain from root to target, elbow/knee bent toward `pole`. */
  chain(root: THREE.Vector3, target: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, r1: number, r2: number, c1: THREE.Color, c2: THREE.Color) {
    _e1.subVectors(target, root);
    let d = _e1.length();
    const max = l1 + l2 - 0.002;
    if (d > max) {
      _e1.multiplyScalar(max / d);
      d = max;
    }
    _k.copy(root).add(_e1);
    _e1.normalize();
    const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
    _e2.copy(pole).addScaledVector(_e1, -pole.dot(_e1));
    if (_e2.lengthSq() < 1e-6) _e2.set(0, -1, 0);
    _e2.normalize();
    _el.copy(root).addScaledVector(_e1, along).addScaledVector(_e2, h);
    this.limb(root, _el, r1, c1);
    this.limb(_el, _k, r2, c2);
  }

  /** Seated or standing person in craft-local coords. */
  person(p: SeatedPose, look: Look) {
    const tl = p.torsoLen ?? 0.52;
    const sl = Math.sin(p.lean);
    const cl = Math.cos(p.lean);
    _up.set(sl, cl * Math.cos(p.roll), Math.sin(p.roll)).normalize();
    _ac.set(-Math.sin(p.twist), 0, Math.cos(p.twist));
    _hip.copy(p.hip);
    _chest.copy(_hip).addScaledVector(_up, tl);
    this.limb(_hip, _chest, 0.145, look.top);
    if (look.pfd) {
      _a.copy(_hip).addScaledVector(_up, tl * 0.38);
      _b.copy(_hip).addScaledVector(_up, tl * 0.97);
      this.limb(_a, _b, 0.168, look.pfd);
    }
    _head.copy(_chest).addScaledVector(_up, 0.2);
    this.ball(_head, 0.1, 0.112, 0.095, look.skin);
    if (look.hat) {
      _a.copy(_head).addScaledVector(_up, 0.055);
      this.ball(_a, 0.108, 0.07, 0.104, look.hat);
    } else {
      _a.copy(_head).addScaledVector(_up, 0.03).x -= 0.015;
      this.ball(_a, 0.106, 0.095, 0.1, look.hair);
    }
    for (const s of [-1, 1]) {
      _sh.copy(_chest).addScaledVector(_up, -0.05).addScaledVector(_ac, s * 0.19);
      _d.set(-0.4, -0.6, s * 0.7);
      this.chain(_sh, s < 0 ? p.handL : p.handR, 0.29, 0.28, _d, 0.048, 0.04, look.top, look.skin);
    }
    if (p.footL && p.footR) {
      for (const s of [-1, 1]) {
        _a.copy(_hip).addScaledVector(_ac, s * 0.1);
        _a.y -= 0.02;
        const foot = s < 0 ? p.footL : p.footR;
        _d.set(1, 0.4, s * 0.15);
        this.chain(_a, foot, 0.44, 0.44, _d, 0.075, 0.055, look.bottom, look.bottom);
      }
    }
  }

  /** Single- or double-bladed paddle: shaft from a to b, blade(s) at the ends (blade faces aft). */
  paddle(a: THREE.Vector3, b: THREE.Vector3, double: boolean, shaft: THREE.Color, blade: THREE.Color, bladeLen = 0.46, bladeW = 0.21) {
    this.limb(a, b, 0.016, shaft);
    _pd.subVectors(b, a).normalize();
    _pn.set(-1, 0, 0).addScaledVector(_pd, _pd.x);
    if (_pn.lengthSq() < 1e-4) _pn.set(0, 0, 1);
    _pn.normalize();
    _pw.crossVectors(_pd, _pn);
    _pc.copy(b).addScaledVector(_pd, -bladeLen * 0.45);
    this.box(_pc, _pw, _pd, bladeW, bladeLen, 0.012, blade);
    if (double) {
      _pc.copy(a).addScaledVector(_pd, bladeLen * 0.45);
      this.box(_pc, _pw, _pd, bladeW * 0.85, bladeLen, 0.012, blade);
    }
  }
}

/** Point on a shaft from a toward b at distance t (m). */
export function along(out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, t: number) {
  const d = a.distanceTo(b);
  return out.copy(a).lerp(b, clamp(t / Math.max(d, 1e-4), 0, 1));
}
