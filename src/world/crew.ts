import * as THREE from 'three';
import { between } from './build';

export interface CrewPose {
  pos: THREE.Vector3; // feet/ground point, world
  yaw: number; // facing; forward = (sin yaw, 0, cos yaw)
  walkPhase: number; // radians, advance by distance/stride
  walk: number; // 0 stand .. 1 full stride
  crouch: number; // 0..1 knee bend / hip drop
  handL: THREE.Vector3 | null;
  handR: THREE.Vector3 | null; // world hand targets; null = relaxed arm swinging with the walk
  headTilt: number; // radians sideways (head out from under the hull at shoulders)
}

const SKIN_TONES = ['#f1c7a5', '#e0ac87', '#c68863', '#a86b47', '#7d4a2d', '#5a3420'];

const limbGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
const headGeo = new THREE.SphereGeometry(0.105, 14, 10);
const hairGeo = new THREE.SphereGeometry(0.112, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
const footGeo = new THREE.BoxGeometry(1, 1, 1);
const handGeo = new THREE.SphereGeometry(0.045, 8, 6);

const suitMat = new THREE.MeshStandardMaterial({ color: '#8c1515', roughness: 0.7 });
const shoeMat = new THREE.MeshStandardMaterial({ color: '#2e2d29', roughness: 0.8 });
const hairMats = ['#1c140f', '#2a1d16', '#4a3020', '#6b4a2b', '#a77b48'].map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
const trimMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.7 });
const capMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.7 });
const skinMats = SKIN_TONES.map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));

const _hip = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _ankle = new THREE.Vector3();
const _elbow = new THREE.Vector3();
const _hand = new THREE.Vector3();
const _pole = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _side = new THREE.Vector3();

/** 2-bone IK: midpoint between a and b for bone lengths l1/l2, bent toward pole. */
function ikMid(a: THREE.Vector3, b: THREE.Vector3, l1: number, l2: number, pole: THREE.Vector3, out: THREE.Vector3) {
  _a.subVectors(b, a);
  let d = _a.length();
  const maxD = l1 + l2 - 0.001;
  if (d > maxD) {
    _a.multiplyScalar(maxD / d);
    b.copy(a).add(_a);
    d = maxD;
  }
  if (d < 1e-5) {
    out.copy(a);
    out.y += l1;
    return;
  }
  _a.divideScalar(d);
  const x = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  _b.copy(pole).addScaledVector(_a, -pole.dot(_a));
  const pl = _b.length();
  if (pl < 1e-5) _b.set(_a.y, _a.z, _a.x);
  else _b.divideScalar(pl);
  out.copy(a).addScaledVector(_a, x).addScaledVector(_b, h);
}

export class CrewFigure {
  readonly group = new THREE.Group();
  readonly scale: number;
  private readonly torso: THREE.Mesh;
  private readonly pelvis: THREE.Mesh;
  private readonly neck: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly thigh: THREE.Mesh[] = [];
  private readonly hem: THREE.Mesh[] = [];
  private readonly bareThigh: THREE.Mesh[] = [];
  private readonly shin: THREE.Mesh[] = [];
  private readonly foot: THREE.Mesh[] = [];
  private readonly uarm: THREE.Mesh[] = [];
  private readonly farm: THREE.Mesh[] = [];
  private readonly handM: THREE.Mesh[] = [];
  private readonly shoulderL = new THREE.Vector3();
  private readonly shoulderR = new THREE.Vector3();
  private readonly lastPose = new THREE.Vector3();

  constructor(seed: number) {
    // men's varsity stature 1.83-2.00 m, matching RowerFigure (base figure is 1.805 m tall)
    this.scale = (1.83 + (((seed * 16807) % 2147483647) / 2147483647) * 0.17) / 1.805;
    const skin = skinMats[seed % skinMats.length];
    const mk = (mat: THREE.Material, shadow = false) => {
      const m = new THREE.Mesh(limbGeo, mat);
      m.castShadow = shadow;
      this.group.add(m);
      return m;
    };
    this.torso = mk(suitMat, true);
    this.pelvis = mk(suitMat);
    this.neck = mk(skin);
    this.head = new THREE.Mesh(headGeo, skin);
    this.head.castShadow = true;
    const cap = new THREE.Mesh(hairGeo, seed % 3 === 0 ? capMat : hairMats[(seed * 7) % hairMats.length]);
    cap.position.set(0, 0.012, -0.025);
    this.head.add(cap);
    this.group.add(this.head);
    for (let i = 0; i < 2; i++) {
      this.thigh.push(mk(suitMat, true));
      this.hem.push(mk(trimMat));
      this.bareThigh.push(mk(skin));
      this.shin.push(mk(skin, true));
      this.uarm.push(mk(skin));
      this.farm.push(mk(skin));
      const f = new THREE.Mesh(footGeo, shoeMat);
      this.group.add(f);
      this.foot.push(f);
      const h = new THREE.Mesh(handGeo, skin);
      this.group.add(h);
      this.handM.push(h);
    }
    this.group.visible = false;
  }

  shoulderWorld(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 {
    return out.copy(side < 0 ? this.shoulderL : this.shoulderR);
  }

  setPose(p: CrewPose): void {
    const s = this.scale;
    const hipH = 0.98 * s;
    const torsoLen = 0.5 * s;
    const thighL = 0.47 * s;
    const shinL = 0.46 * s;
    const uarmL = 0.32 * s;
    const farmL = 0.35 * s;
    const hipDrop = p.crouch * 0.26 * s;

    _fwd.set(Math.sin(p.yaw), 0, Math.cos(p.yaw));
    _side.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));

    const hipY = hipH - hipDrop;
    // legs: 2-bone IK hip -> foot
    for (let i = 0; i < 2; i++) {
      const th = p.walkPhase + i * Math.PI;
      const lat = (i === 0 ? -1 : 1) * 0.11 * s;
      const fwdOff = Math.sin(th) * 0.32 * p.walk;
      const lift = Math.max(0, Math.cos(th)) * 0.08 * p.walk;
      _ankle.copy(p.pos).addScaledVector(_side, lat).addScaledVector(_fwd, fwdOff);
      _ankle.y = p.pos.y + 0.06 * s + lift;
      _hip.copy(p.pos).addScaledVector(_side, lat * 0.86);
      _hip.y = p.pos.y + hipY;
      _pole.copy(_fwd);
      ikMid(_hip, _ankle, thighL, shinL, _pole, _knee);
      // unisuit leg ends mid-thigh with a white hem band
      _a.lerpVectors(_hip, _knee, 0.52);
      _b.lerpVectors(_hip, _knee, 0.58);
      between(this.thigh[i], _hip, _a, 0.075 * s);
      between(this.hem[i], _a, _b, 0.072 * s);
      between(this.bareThigh[i], _b, _knee, 0.066 * s);
      between(this.shin[i], _knee, _ankle, 0.05 * s);
      this.foot[i].position.copy(_ankle);
      this.foot[i].position.y -= 0.03 * s;
      this.foot[i].scale.set(0.09 * s, 0.06 * s, 0.26 * s);
      this.foot[i].rotation.set(0, p.yaw, 0);
    }

    // pelvis + torso
    _a.copy(p.pos);
    _a.y = p.pos.y + hipY - 0.02 * s;
    _b.copy(p.pos);
    _b.y = p.pos.y + hipY + torsoLen;
    const leanF = p.crouch * 0.18;
    _b.addScaledVector(_fwd, leanF);
    _c.copy(_b).lerp(_a, 0.55);
    between(this.pelvis, _a, _c, 0.16 * s);
    between(this.torso, _a.setY(_a.y + 0.1 * s), _b, 0.145 * s);

    // shoulders
    this.shoulderL.copy(_b).addScaledVector(_side, -0.19 * s);
    this.shoulderR.copy(_b).addScaledVector(_side, 0.19 * s);
    this.shoulderL.y = this.shoulderR.y = _b.y;

    // neck + head
    _a.copy(_b);
    _a.y += 0.02;
    between(this.neck, _b, _a.setY(_a.y + 0.12 * s), 0.05 * s);
    this.head.position.copy(_b);
    this.head.position.y += 0.22 * s;
    this.head.position.addScaledVector(_side, Math.sin(p.headTilt) * 0.14);
    this.head.rotation.set(0, p.yaw, p.headTilt);
    // white side stripe: reuse trim on torso? keep simple — torso is cardinal unisuit

    // arms: 2-bone IK shoulder -> hand (or relaxed swing)
    for (let i = 0; i < 2; i++) {
      const sh = i === 0 ? this.shoulderL : this.shoulderR;
      const target = i === 0 ? p.handL : p.handR;
      if (target) _hand.copy(target);
      else {
        const th = p.walkPhase + (1 - i) * Math.PI;
        _hand.copy(sh).addScaledVector(_fwd, Math.sin(th) * 0.15 * p.walk + 0.06);
        _hand.y -= (uarmL + farmL) * 0.86;
        _hand.addScaledVector(_side, (i === 0 ? -1 : 1) * 0.05);
      }
      // elbow pole: out, down, slightly back
      _pole.copy(_side).multiplyScalar(i === 0 ? -1 : 1);
      _pole.y -= 0.6;
      _pole.addScaledVector(_fwd, -0.35).normalize();
      ikMid(sh, _hand, uarmL, farmL, _pole, _elbow);
      between(this.uarm[i], sh, _elbow, 0.05 * s);
      between(this.farm[i], _elbow, _hand, 0.042 * s);
      this.handM[i].position.copy(_hand);
    }
    this.lastPose.copy(p.pos);
  }
}
