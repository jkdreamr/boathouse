import * as THREE from 'three';
import { blobTexture, ringTexture, textTexture } from '../textures';
import { between } from '../world/build';
import { conditions } from '../sim/conditions';
import { terrainHeight } from '../world/terrain';
import { DOCK } from '../world/site';
import { deckGeometry, EIGHT, FOUR, gunwaleY, halfBeam, hullGeometry, HullSpec, PAIR } from './hull';
import { BLADE_CENTER, makeOarMesh } from './oar';
import { Coxswain } from './cox';
import { RowerFigure, RowerPose } from './rower';

const PIN_Y = 0.36;
/** Pin sits this far sternward of the seat's mid-slide position. */
const PIN_DX = 0.32;
const PIN_Z = 0.84;
const THETA_C = 0.995;
const THETA_F = -0.576;
const L_HAND = 0.97;
const L_SHOULDER = 0.5;
const REACH_C = (-0.33 - Math.sin(0.42) * L_SHOULDER) - (-PIN_DX - L_HAND * Math.sin(THETA_C));
const REACH_F = (0.33 - Math.sin(-0.3) * L_SHOULDER) - (-PIN_DX - L_HAND * Math.sin(THETA_F));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const clamp01 = (x: number) => clamp(x, 0, 1);
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const pressureFactor = [1.06, 1, 0.97] as const;
export const FPK = [122, 205, 340];
const _a = new THREE.Vector3();
const _c = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _stbd = new THREE.Vector3();
const _ground = new THREE.Vector3();
const _wind = new THREE.Vector3();
const _air = new THREE.Vector3();
const _boatQ = new THREE.Quaternion();
const _localQ = new THREE.Quaternion();
const _lookEuler = new THREE.Euler(0, 0, 0, 'YXZ');
const _chaseTarget = new THREE.Vector3();

export type BoatClass = '8+' | '4+' | '2-';
type CrewState = 'ready' | 'drive' | 'recovery' | 'back';
type Phase = 'Ready' | 'Glide' | 'Drive' | 'Recovery' | 'Backing' | 'Aground';

interface BoatRower {
  side: number;
  seatX: number;
  oar: THREE.Group;
  seat: THREE.Mesh;
  figure: RowerFigure;
  pose: RowerPose;
  handIn: THREE.Vector3;
  handOut: THREE.Vector3;
  slide: number;
  lean: number;
  theta: number;
  pitch: number;
  feather: number;
  jitter: number;
  baseJitter: number;
  backSlide: number;
  backLean: number;
  backTheta: number;
}

interface Fx {
  m: THREE.Mesh;
  life: number;
  age: number;
  s0: number;
  s1: number;
  a0: number;
}

const HULL_DATA = {
  '8+': { shell: 96, rowers: 8, cox: 55, drag: 12.7, rudderDrag: 30, cdAf: 2, cdAs: 9, iz: 15000, cr: 3000, cr0: 400, crRudder: 34, lr: 8, windArm: 1.2, cl2: 1300, cl1: 300 },
  '4+': { shell: 51, rowers: 4, cox: 55, drag: 8.4, rudderDrag: 20, cdAf: 1.2, cdAs: 6, iz: 5500, cr: 1600, cr0: 0, crRudder: 27, lr: 6, windArm: 0.9, cl2: 1300, cl1: 300 },
  '2-': { shell: 27, rowers: 2, cox: 0, drag: 4.9, rudderDrag: 12, cdAf: 0.7, cdAs: 3.5, iz: 1800, cr: 800, cr0: 0, crRudder: 20, lr: 4.6, windArm: 0.7, cl2: 1300, cl1: 300 },
} as const;

/** Shoal or the floating dock's hull footprint (the shell can't pass through the pontoons). */
function blocked(x: number, z: number) {
  if (x > DOCK.minX - 0.2 && x < DOCK.maxX + 0.2 && z > DOCK.minZ - 0.2 && z < DOCK.maxZ) return true;
  return terrainHeight(x, z) > conditions.level - 0.3;
}

export class CrewBoat {
  readonly group = new THREE.Group();
  rate = 24;
  speed = 0;
  avgSpeed = 0;
  distance = 0;
  heading = 0;
  spm = 0;
  moored = false;
  pressure: 0 | 1 | 2 = 1;
  rudder = 0;
  hands = 0;
  onCatch?: () => void;
  onFinish?: () => void;
  /** Hull shell paint, so a racked shell's colour carries over when it is launched. */
  hullMaterial!: THREE.MeshPhysicalMaterial;
  private readonly rowers: BoatRower[] = [];
  private readonly fx: Fx[] = [];
  private readonly hullSpec: HullSpec;
  private readonly hasCox: boolean;
  private readonly coxPosition: THREE.Vector3;
  private readonly cox: Coxswain | null;
  private readonly hullData: (typeof HULL_DATA)[BoatClass];
  private readonly rowerMass: number;
  private readonly totalMass: number;
  private readonly lateralMass: number;
  private readonly seatCount: number;
  private readonly randomSeed: { value: number };
  private state: CrewState = 'ready';
  private queuedCatch = false;
  private queuedCatchDue = 0;
  private queuedBackstrokes = 0;
  private driveElapsed = 0;
  private driveDuration = 0;
  private recoveryProgress = 0;
  private recoveryDuration = 0;
  private backElapsed = 0;
  private backForwardQueued = false;
  private tapLast = -Infinity;
  private lastCatch = -Infinity;
  private catchDistance = 0;
  private time = 0;
  private lastCameraTime = -Infinity;
  private lastReadoutSpm = -1;
  private lastReadoutSplit = -1;
  private fxNext = 0;
  private momentum = 0;
  private lateralSpeed = 0;
  private yawRate = 0;
  private previousCrewX = 0;
  private crewSpeed = 0;
  private roll = 0;
  private rollRate = 0;
  private propulsiveForce = 0;
  private agroundPoints = 0;
  private wasAground = false;
  private limitedHands = 0;
  private catchYawNoise = 0;
  private readonly coxX: number;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;

  constructor(
    readonly sceneArg: THREE.Scene,
    cls: BoatClass = '8+',
    opts?: { name?: string; hullColor?: string },
  ) {
    this.hullSpec = cls === '8+' ? EIGHT : cls === '4+' ? FOUR : PAIR;
    this.hullData = HULL_DATA[cls];
    this.hasCox = cls !== '2-';
    this.seatCount = this.hullData.rowers;
    this.rowerMass = this.seatCount * 85;
    this.totalMass = this.hullData.shell + this.rowerMass + this.hullData.cox;
    this.lateralMass = this.totalMass * 1.5;
    this.coxX = -this.hullSpec.length / 2 + 0.85;
    this.randomSeed = { value: 9173 + cls.length * 383 };
    const group = this.group;
    group.rotation.order = 'YZX';
    group.name = opts?.name ?? (cls === '8+' ? 'eight' : `crewboat-${cls}`);
    sceneArg.add(group);

    const hullMat = (this.hullMaterial = new THREE.MeshPhysicalMaterial({ color: opts?.hullColor ?? '#8c1515', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide }));
    const hull = new THREE.Mesh(hullGeometry(this.hullSpec), hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    group.add(hull);
    const deckMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.35, side: THREE.DoubleSide });
    for (const [x0, x1] of [
      [Math.min(5.3, this.hullSpec.length / 2 - 0.3), this.hullSpec.length / 2 - 0.02],
      [-this.hullSpec.length / 2 + 0.02, -this.hullSpec.length / 2 + 0.55],
    ]) {
      const deck = new THREE.Mesh(deckGeometry(this.hullSpec, x0, x1), deckMat);
      group.add(deck);
    }
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.22),
      new THREE.MeshStandardMaterial({ map: textTexture('STANFORD', { color: '#8c1515', w: 512, h: 80, font: 'bold 64px Georgia, serif' }), transparent: true, depthWrite: false }),
    );
    name.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    name.position.set(Math.min(6.6, this.hullSpec.length / 2 - 1), gunwaleY(this.hullSpec, Math.min(6.6, this.hullSpec.length / 2 - 1)) + 0.02, 0);
    group.add(name);
    const trim = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.4 });
    for (const side of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let x = -this.hullSpec.length / 2 + 0.1; x <= this.hullSpec.length / 2 - 0.1; x += 0.4) pts.push(new THREE.Vector3(x, gunwaleY(this.hullSpec, x) + 0.005, side * (halfBeam(this.hullSpec, x) + 0.004)));
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.012, 5), trim);
      group.add(rail);
    }
    const bowBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), trim);
    bowBall.position.set(this.hullSpec.length / 2, gunwaleY(this.hullSpec, this.hullSpec.length / 2) + 0.02, 0);
    group.add(bowBall);
    const carbon = new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.5, metalness: 0.3 });
    const keelson = new THREE.Mesh(new THREE.BoxGeometry(this.hullSpec.length - 3.4, 0.03, 0.26), carbon);
    keelson.position.set(-0.9, 0.0, 0);
    group.add(keelson);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.01), carbon);
    fin.position.set(-this.hullSpec.length / 2 + 0.7, -0.2, 0);
    group.add(fin);

    if (this.hasCox) {
      const coxSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.42), carbon);
      coxSeat.position.set(this.coxX + 0.1, 0.12, 0);
      group.add(coxSeat);
    }
    this.cox = new Coxswain({ seed: 9173, coxX: this.coxX, spec: this.hullSpec, withFigure: this.hasCox });
    this.coxPosition = this.cox.eye;
    group.add(this.cox.group);

    const alu = new THREE.MeshStandardMaterial({ color: '#c3c6c9', roughness: 0.3, metalness: 0.85 });
    const limb = new THREE.CylinderGeometry(1, 1, 1, 8);
    const seatGeo = new THREE.BoxGeometry(0.3, 0.05, 0.28);
    const trackGeo = new THREE.BoxGeometry(0.8, 0.03, 0.025);
    const seatSpacing = cls === '8+' ? 1.42 : this.hullSpec.length / (this.seatCount + 4);
    for (let k = 1; k <= this.seatCount; k++) {
      const seatX = cls === '8+' ? -5.5 + (8 - k) * 1.42 : ((this.seatCount - 1) * seatSpacing) / 2 - (k - 1) * seatSpacing;
      const side = k % 2 === 0 ? -1 : 1;
      const pinX = seatX - PIN_DX;
      for (const z of [-0.12, 0.12]) {
        const track = new THREE.Mesh(trackGeo, carbon);
        track.position.set(seatX, 0.12, z);
        group.add(track);
      }
      const beam = halfBeam(this.hullSpec, pinX);
      const gunwale = gunwaleY(this.hullSpec, pinX);
      const pin = new THREE.Vector3(pinX, PIN_Y - 0.03, side * PIN_Z);
      for (const dx of [-0.3, 0.3]) {
        const support = new THREE.Mesh(limb, alu);
        between(support, new THREE.Vector3(pinX + dx, gunwale, side * beam), pin, 0.014);
        group.add(support);
      }
      const back = new THREE.Mesh(limb, alu);
      between(back, new THREE.Vector3(pinX, 0.02, side * 0.12), pin, 0.012);
      group.add(back);
      const oar = makeOarMesh();
      oar.rotation.order = 'YZX';
      oar.position.set(pinX, PIN_Y, side * PIN_Z);
      for (const part of oar.children) (part as THREE.Mesh).castShadow = false;
      group.add(oar);
      const seat = new THREE.Mesh(seatGeo, carbon);
      group.add(seat);
      const figure = new RowerFigure({ seed: k });
      group.add(figure.group);
      const handIn = new THREE.Vector3();
      const handOut = new THREE.Vector3();
      const pose: RowerPose = { seatX, slide: -0.33, lean: 0.42, stretcherX: seatX - 0.72, handIn, handOut, side };
      const baseJitter = (this.rand() * 2 - 1) * 0.012;
      this.rowers.push({
        side, seatX, oar, seat, figure, pose, handIn, handOut,
        slide: -0.33, lean: 0.42, theta: THETA_C, pitch: 0.07, feather: 0,
        jitter: baseJitter, baseJitter, backSlide: -0.33, backLean: 0.42, backTheta: THETA_C,
      });
    }

    const ring = ringTexture();
    const blob = blobTexture();
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    for (let i = 0; i < 64; i++) {
      const isSplash = i >= 48;
      const mesh = new THREE.Mesh(
        plane,
        new THREE.MeshBasicMaterial({ map: isSplash ? blob : ring, transparent: true, depthWrite: false, opacity: 0, color: isSplash ? '#ffffff' : '#dfeaf0' }),
      );
      mesh.visible = false;
      mesh.renderOrder = 2;
      sceneArg.add(mesh);
      this.fx.push({ m: mesh, life: 1, age: 1, s0: 1, s1: 1, a0: 0 });
    }
    this.driveDuration = this.driveTime();
    this.recoveryDuration = Math.max(0.6, 60 / this.rate - this.driveDuration);
    this.previousCrewX = this.crewOffset('ready', 0);
    this.pose();
  }

  get x() {
    return this.group.position.x;
  }
  get z() {
    return this.group.position.z;
  }
  get aground() {
    return this.agroundPoints !== 0;
  }
  get catchQueued() {
    return this.queuedCatch || this.backForwardQueued;
  }
  get driveFrac() {
    return this.driveTime() / (60 / this.rate);
  }
  get phase(): Phase {
    if (this.aground) return 'Aground';
    if (this.state === 'back') return 'Backing';
    if (this.state === 'drive') return 'Drive';
    if (this.state === 'recovery') return 'Recovery';
    return Math.abs(this.speed) > 0.3 ? 'Glide' : 'Ready';
  }

  reset(pos: THREE.Vector3, heading: number) {
    this.group.position.set(pos.x, conditions.level, pos.z);
    this.heading = heading;
    this.speed = 0;
    this.avgSpeed = 0;
    this.distance = 0;
    this.spm = 0;
    this.pressure = 1;
    this.rudder = 0;
    this.hands = 0;
    this.limitedHands = 0;
    this.momentum = 0;
    this.lateralSpeed = 0;
    this.yawRate = 0;
    this.roll = 0;
    this.rollRate = 0;
    this.propulsiveForce = 0;
    this.state = 'ready';
    this.queuedCatch = false;
    this.queuedCatchDue = 0;
    this.queuedBackstrokes = 0;
    this.backForwardQueued = false;
    this.driveElapsed = 0;
    this.driveDuration = this.driveTime();
    this.recoveryProgress = 0;
    this.recoveryDuration = Math.max(0.6, 60 / this.rate - this.driveDuration);
    this.backElapsed = 0;
    this.tapLast = -Infinity;
    this.lastCatch = -Infinity;
    this.catchDistance = 0;
    this.agroundPoints = 0;
    this.wasAground = false;
    this.time = 0;
    this.lastCameraTime = -Infinity;
    this.lastReadoutSpm = -1;
    this.lastReadoutSplit = -1;
    this.chaseInit = false;
    this.previousCrewX = this.crewOffset('ready', 0);
    this.crewSpeed = 0;
    this.group.rotation.set(0, heading, 0);
    this.group.position.y = conditions.level;
    this.pose();
  }

  stroke() {
    const now = this.time;
    if (Number.isFinite(this.tapLast)) {
      const interval = now - this.tapLast;
      if (interval > 0 && interval <= 3.75) {
        const measured = clamp(60 / interval, 16, 40);
        this.rate += 0.55 * (measured - this.rate);
      }
    }
    this.tapLast = now;
    if (this.state === 'ready') {
      this.startCatch(now);
    } else if (this.state === 'drive') {
      if (!this.queuedCatch) {
        this.queuedCatch = true;
        this.queuedCatchDue = now + Math.max(0, this.driveDuration - this.driveElapsed) + 0.6;
      }
    } else if (this.state === 'recovery') {
      if (!this.queuedCatch) {
        this.queuedCatch = true;
        this.queuedCatchDue = now + (1 - this.recoveryProgress) * 0.6;
      }
    } else {
      this.backForwardQueued = true;
    }
  }

  backStroke() {
    if (this.state === 'back') {
      this.queuedBackstrokes++;
      return;
    }
    this.queuedBackstrokes++;
    if (this.state === 'ready') this.startBack();
  }

  private driveTime() {
    return clamp(0.95 - 0.0125 * (this.rate - 20), 0.7, 1) * pressureFactor[this.pressure];
  }

  private rand() {
    this.randomSeed.value = (Math.imul(this.randomSeed.value, 1664525) + 1013904223) >>> 0;
    return this.randomSeed.value / 4294967296;
  }

  private gaussian() {
    const u = Math.max(1e-12, this.rand());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rand());
  }

  private startCatch(at: number) {
    this.state = 'drive';
    this.driveElapsed = 0;
    this.backForwardQueued = false;
    this.driveDuration = this.driveTime();
    this.recoveryProgress = 0;
    this.recoveryDuration = Math.max(0.6, 60 / this.rate - this.driveDuration);
    this.queuedCatch = false;
    this.queuedCatchDue = 0;
    this.catchYawNoise = this.gaussian() * 0.03;
    for (const rower of this.rowers) rower.jitter = rower.baseJitter + (this.rand() * 2 - 1) * 0.004;
    this.catchEvent(at);
  }

  private catchEvent(at: number) {
    if (Number.isFinite(this.lastCatch)) {
      const interval = at - this.lastCatch;
      if (interval > 0 && interval < 5) this.spm = 60 / interval;
      else this.spm = 0;
      if (interval > 0) this.avgSpeed = (this.distance - this.catchDistance) / interval;
    }
    this.lastCatch = at;
    this.catchDistance = this.distance;
    this.group.updateMatrixWorld(true);
    for (const rower of this.rowers) this.spawnAtBlade(rower, true);
    this.onCatch?.();
  }

  private finishEvent() {
    this.group.updateMatrixWorld(true);
    for (const rower of this.rowers) this.spawnAtBlade(rower, false);
    this.rollRate += this.gaussian() * 0.012;
    this.onFinish?.();
  }

  private spawnAtBlade(rower: BoatRower, splash: boolean) {
    _a.set(BLADE_CENTER, -0.1, 0).applyMatrix4(rower.oar.matrixWorld);
    const base = splash ? 48 : 0;
    const count = splash ? 16 : 48;
    const fx = this.fx[base + (this.fxNext++ % count)];
    fx.m.position.set(_a.x, conditions.level + 0.03, _a.z);
    fx.m.visible = true;
    fx.age = 0;
    if (splash) {
      fx.life = 0.45;
      fx.s0 = 0.25;
      fx.s1 = 0.9;
      fx.a0 = 0.8;
    } else {
      fx.life = 5;
      fx.s0 = 0.5;
      fx.s1 = 2.6;
      fx.a0 = 0.55;
    }
  }

  private drivePose(u: number, rower: BoatRower, jitter: boolean) {
    const du = jitter ? rower.jitter / this.driveDuration : 0;
    const progress = clamp01(u + du);
    const legs = smooth(0, 0.62, progress);
    const body = smooth(0.22, 0.85, progress);
    const arms = smooth(0.55, 1, progress);
    rower.slide = lerp(-0.33, 0.33, legs);
    rower.lean = lerp(0.42, -0.3, body);
    const reach = lerp(REACH_C, REACH_F, arms);
    const handX = rower.seatX + rower.slide - Math.sin(rower.lean) * L_SHOULDER - reach;
    rower.theta = Math.asin(clamp((rower.seatX - PIN_DX - handX) / L_HAND, -1, 1));
    rower.feather = 0;
    rower.pitch = progress < 0.04 ? lerp(0.08, 0.17, progress / 0.04) : progress > 0.93 ? lerp(0.17, 0.05, (progress - 0.93) / 0.07) : 0.17;
  }

  private recoveryPose(p: number, rower: BoatRower, jitter: boolean) {
    const progress = clamp01(p + (jitter ? rower.jitter / this.recoveryDuration : 0));
    const arms = smooth(0, 0.22, progress);
    const body = smooth(0.08, 0.4, progress);
    const slide = smooth(0.28, 1, progress);
    rower.slide = lerp(0.33, -0.33, slide);
    rower.lean = lerp(-0.3, 0.42, body);
    const reach = lerp(REACH_F, REACH_C, arms);
    const handX = rower.seatX + rower.slide - Math.sin(rower.lean) * L_SHOULDER - reach;
    rower.theta = Math.asin(clamp((rower.seatX - PIN_DX - handX) / L_HAND, -1, 1));
    rower.feather = progress < 0.1 ? smooth(0, 0.1, progress) : progress < 0.62 ? 1 : progress < 0.88 ? 1 - smooth(0.62, 0.88, progress) : 0;
    rower.pitch = progress < 0.9 ? 0.05 : lerp(0.05, 0.08, (progress - 0.9) / 0.1);
  }

  private backPose(p: number, rower: BoatRower) {
    if (p < 0.3) {
      const u = smooth(0, 0.3, p);
      rower.slide = lerp(rower.backSlide, 0.1, u);
      rower.lean = lerp(rower.backLean, -0.1, u);
      rower.theta = lerp(rower.backTheta, -0.35, u);
      rower.pitch = 0.05;
      rower.feather = lerp(0, 2, smooth(0, 0.3, p));
    } else if (p < 0.7) {
      const u = smooth(0.3, 0.7, p);
      rower.slide = lerp(0.1, -0.15, u);
      rower.lean = lerp(-0.1, 0.3, u);
      rower.theta = lerp(-0.35, 0.6, u);
      rower.pitch = 0.27;
      rower.feather = 2;
    } else {
      const u = smooth(0.7, 1, p);
      rower.slide = lerp(-0.15, -0.33, u);
      rower.lean = lerp(0.3, 0.42, u);
      rower.theta = lerp(0.6, THETA_C, u);
      rower.pitch = lerp(0.27, 0.05, u);
      rower.feather = lerp(2, 0, u);
    }
  }

  private setRowerPose(rower: BoatRower, mode: CrewState, progress: number, useJitter: boolean) {
    if (mode === 'drive') this.drivePose(progress, rower, useJitter);
    else if (mode === 'recovery') this.recoveryPose(progress, rower, useJitter);
    else if (mode === 'back') this.backPose(progress, rower);
    else {
      rower.slide = -0.33;
      rower.lean = 0.42;
      rower.theta = THETA_C;
      rower.pitch = 0.07;
      rower.feather = 0;
    }
  }

  private crewOffset(mode: CrewState, progress: number) {
    let sum = 0;
    for (const rower of this.rowers) {
      this.setRowerPose(rower, mode, progress, mode === 'drive' || mode === 'recovery');
      sum += 0.8 * rower.slide - 0.22 * Math.sin(rower.lean);
    }
    return sum / this.seatCount;
  }

  private pose() {
    let progress = 0;
    if (this.state === 'drive') progress = this.driveElapsed / Math.max(this.driveDuration, 1e-3);
    else if (this.state === 'recovery') progress = this.recoveryProgress;
    else if (this.state === 'back') progress = this.backElapsed / 2.2;
    for (const rower of this.rowers) {
      this.setRowerPose(rower, this.state, progress, this.state === 'drive' || this.state === 'recovery');
      const oar = rower.oar;
      oar.rotation.set(rower.feather * Math.PI / 2, rower.side * (rower.theta - Math.PI / 2), -rower.pitch);
      oar.updateMatrix();
      rower.seat.position.set(rower.seatX + rower.slide, 0.16, 0);
      rower.handIn.set(-0.86, 0, 0).applyMatrix4(oar.matrix).add(oar.position);
      rower.handOut.set(-1.08, 0, 0).applyMatrix4(oar.matrix).add(oar.position);
      rower.pose.slide = rower.slide;
      rower.pose.lean = rower.lean;
      rower.pose.stretcherX = rower.seatX - 0.72;
      rower.pose.feather = Math.min(1, rower.feather);
      rower.figure.setPose(rower.pose);
    }
  }

  private propulsion(mode: CrewState, progress: number) {
    let force = 0;
    for (const rower of this.rowers) {
      this.setRowerPose(rower, mode, progress, mode === 'drive' || mode === 'recovery');
      if (mode === 'drive') {
        const w = (THETA_C - 0.07 - rower.theta) / ((THETA_C - 0.07) - (THETA_F + 0.105));
        if (w >= 0 && w <= 1) force += FPK[this.pressure] * Math.sin(Math.PI * Math.pow(w, 0.7)) * Math.cos(rower.theta);
      } else if (mode === 'back' && progress >= 0.3 && progress <= 0.7) {
        const w = (rower.theta + 0.35) / 0.95;
        if (w >= 0 && w <= 1) force -= 0.5 * FPK[1] * Math.sin(Math.PI * Math.pow(w, 0.7)) * Math.cos(rower.theta);
      }
    }
    return force;
  }

  private startBack() {
    this.queuedBackstrokes = Math.max(0, this.queuedBackstrokes - 1);
    this.state = 'back';
    this.backElapsed = 0;
    for (const rower of this.rowers) {
      rower.backSlide = rower.slide;
      rower.backLean = rower.lean;
      rower.backTheta = rower.theta;
    }
  }

  private advanceState(h: number, now: number) {
    if (this.state === 'drive') {
      const before = this.driveElapsed;
      this.driveElapsed = Math.min(this.driveDuration, this.driveElapsed + h);
      if (before < this.driveDuration && this.driveElapsed >= this.driveDuration) {
        this.finishEvent();
        this.state = 'recovery';
        this.recoveryProgress = 0;
      }
    } else if (this.state === 'recovery') {
      if (this.queuedCatch) {
        const left = this.queuedCatchDue - now;
        const remainingAtStart = left + h;
        this.recoveryProgress = left <= 0 ? 1 : clamp01(this.recoveryProgress + (1 - this.recoveryProgress) * Math.min(1, h / Math.max(remainingAtStart, h)));
      } else {
        this.recoveryProgress = clamp01(this.recoveryProgress + h / this.recoveryDuration);
      }
      if (this.recoveryProgress >= 1) {
        if (this.queuedCatch) this.startCatch(now);
        else this.state = 'ready';
      }
    } else if (this.state === 'back') {
      this.backElapsed = Math.min(2.2, this.backElapsed + h);
      if (this.backElapsed >= 2.2) {
        if (this.queuedBackstrokes > 0) this.startBack();
        else if (this.backForwardQueued) this.startCatch(now);
        else this.state = 'ready';
      }
    } else if (this.queuedBackstrokes > 0) {
      this.startBack();
    }
  }

  private sampleGround() {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    const bowX = this.group.position.x + c * (this.hullSpec.length / 2 - 0.3);
    const bowZ = this.group.position.z - s * (this.hullSpec.length / 2 - 0.3);
    const sternX = this.group.position.x - c * (this.hullSpec.length / 2 - 0.3);
    const sternZ = this.group.position.z + s * (this.hullSpec.length / 2 - 0.3);
    let points = 0;
    if (blocked(bowX, bowZ)) points |= 1;
    if (blocked(this.group.position.x, this.group.position.z)) points |= 2;
    if (blocked(sternX, sternZ)) points |= 4;
    const aground = points !== 0;
    if (aground && !this.wasAground) {
      this.momentum = this.rowerMass * this.crewSpeed;
      this.speed = 0;
      this.lateralSpeed = 0;
      this.yawRate = 0;
    }
    this.agroundPoints = points;
    this.wasAground = aground;
  }

  private updateRoll(h: number, mode: CrewState, progress: number) {
    const rollTarget = 0.004 * this.rudder / 0.262;
    const zeta = mode === 'drive' || (mode === 'back' && progress >= 0.3 && progress <= 0.7) ? 0.85 : 0.25;
    const omega = (2 * Math.PI) / 1.2;
    this.rollRate += (-omega * omega * (this.roll - rollTarget) - 2 * zeta * omega * this.rollRate) * h;
    this.roll = clamp(this.roll + this.rollRate * h, -0.035, 0.035);
  }

  private step(h: number, steer: number, now: number) {
    const handTarget = clamp(-steer, -1, 1);
    this.limitedHands += clamp(handTarget - this.limitedHands, -3 * h, 3 * h);
    this.hands += (this.limitedHands - this.hands) * (1 - Math.exp(-h / 0.06));
    this.rudder += (0.262 * this.hands - this.rudder) * (1 - Math.exp(-h / 0.12));
    this.rudder = clamp(this.rudder, -0.262, 0.262);

    let mode = this.state;
    let progress = 0;
    if (mode === 'drive') progress = (this.driveElapsed + h * 0.5) / Math.max(this.driveDuration, 1e-3);
    else if (mode === 'recovery') progress = this.recoveryProgress + (this.queuedCatch ? (1 - this.recoveryProgress) * h * 0.5 / Math.max(this.queuedCatchDue - now + h, h) : h * 0.5 / this.recoveryDuration);
    else if (mode === 'back') progress = (this.backElapsed + h * 0.5) / 2.2;
    this.propulsiveForce = this.propulsion(mode, progress);

    const crewX = this.crewOffset(mode, progress);
    this.crewSpeed = (crewX - this.previousCrewX) / h;
    this.previousCrewX = crewX;
    if (this.moored) {
      this.propulsiveForce = 0;
      this.crewSpeed = 0;
      this.momentum = 0;
      this.speed = 0;
      this.lateralSpeed = 0;
      this.yawRate = 0;
      this.updateRoll(h, mode, progress);
      this.advanceState(h, now);
      return;
    }

    const vb = this.momentum / this.totalMass - (this.rowerMass / this.totalMass) * this.crewSpeed;
    const heading = this.heading;
    _fwd.set(Math.cos(heading), 0, -Math.sin(heading));
    _stbd.set(Math.sin(heading), 0, Math.cos(heading));
    // conditions.wind already includes the current gust (conditions.gust is a 0..1 intensity, not a multiplier)
    _wind.set(conditions.wind.x, 0, conditions.wind.y);
    _ground.copy(_fwd).multiplyScalar(vb).addScaledVector(_stbd, this.lateralSpeed);
    if (!this.aground) _ground.add(_c.set(conditions.current.x, 0, conditions.current.y));
    _air.subVectors(_wind, _ground);
    const airMagnitude = _air.length();
    const airFactor = 0.5 * 1.226 * airMagnitude;
    const airAxial = airFactor * (this.hullData.cdAf) * _air.dot(_fwd);
    const airSide = this.aground ? 0 : airFactor * this.hullData.cdAs * _air.dot(_stbd);
    const drag = Math.sign(vb) * (this.hullData.drag + this.hullData.rudderDrag * this.rudder * this.rudder) * vb * vb;
    const force = this.propulsiveForce - drag + (this.aground ? 0 : airAxial);
    this.momentum += force * h;
    let nextVb = this.momentum / this.totalMass - (this.rowerMass / this.totalMass) * this.crewSpeed;
    if (this.aground) {
      const bow = (this.agroundPoints & 1) !== 0;
      const mid = (this.agroundPoints & 2) !== 0;
      const stern = (this.agroundPoints & 4) !== 0;
      if (bow && stern) nextVb = 0;
      else if (bow) nextVb = mode === 'back' ? Math.min(0, nextVb) : 0;
      else if (stern) nextVb = mode === 'back' ? 0 : Math.max(0, nextVb);
      else if (mid) nextVb = Math.min(0, nextVb);
      this.momentum = (nextVb + (this.rowerMass / this.totalMass) * this.crewSpeed) * this.totalMass;
    }
    this.speed = nextVb;
    if (!this.aground) {
      const sideDrag = (1300 * (this.hullSpec.length / 17.6)) * Math.abs(this.lateralSpeed) * this.lateralSpeed + 300 * (this.hullSpec.length / 17.6) * this.lateralSpeed;
      this.lateralSpeed += (airSide - sideDrag) / this.lateralMass * h;
      const rudderMoment = -this.hullData.crRudder * this.hullData.lr * vb * Math.abs(vb) * this.rudder;
      const windMoment = -airSide * this.hullData.windArm;
      const crewMoment = mode === 'drive' ? this.catchYawNoise * this.propulsiveForce * PIN_Z : 0;
      const yawDamp = (this.hullData.cr * Math.max(Math.abs(vb), 0.5) + this.hullData.cr0) * this.yawRate;
      this.yawRate += (rudderMoment + windMoment + crewMoment - yawDamp) / this.hullData.iz * h;
      this.heading += this.yawRate * h;
      _fwd.set(Math.cos(this.heading), 0, -Math.sin(this.heading));
      _stbd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    } else {
      this.lateralSpeed = 0;
      this.yawRate = 0;
    }
    _ground.copy(_fwd).multiplyScalar(this.speed).addScaledVector(_stbd, this.lateralSpeed);
    if (!this.aground) _ground.add(_c.set(conditions.current.x, 0, conditions.current.y));
    this.group.position.x += _ground.x * h;
    this.group.position.z += _ground.z * h;
    if (this.group.position.x > 5000 || this.group.position.x < -3000) {
      this.group.position.x = clamp(this.group.position.x, -3000, 5000);
      this.momentum *= 0.9;
    }
    this.distance += Math.hypot(_ground.x, _ground.z) * h;

    this.updateRoll(h, mode, progress);

    this.advanceState(h, now);
    this.sampleGround();
    const cycle = 60 / this.rate;
    if (Number.isFinite(this.lastCatch) && now - this.lastCatch > cycle) {
      const groundSpeed = Math.hypot(_ground.x, _ground.z);
      this.avgSpeed += (groundSpeed - this.avgSpeed) * (1 - Math.exp(-h / 2.5));
    }
  }

  update(dt: number, steer: number, time: number) {
    // THREE.Clock's first getDelta() is 0; a zero substep would divide by zero in step().
    if (!(dt > 0)) return;
    const hMax = 1 / 120;
    const count = Math.max(1, Math.ceil(dt / hMax));
    const h = dt / count;
    const start = time - dt;
    for (let i = 0; i < count; i++) this.step(h, clamp(steer, -1, 1), start + (i + 1) * h);
    this.time = time;
    if (Number.isFinite(this.lastCatch) && time - this.lastCatch > 5) this.spm = 0;
    if (!this.moored) {
      this.group.position.y = conditions.level - 0.01 * (this.propulsiveForce / Math.max(1, this.seatCount * FPK[this.pressure])) + 0.004 * Math.sin(1.6 * time);
    }
    this.group.rotation.set(this.roll, this.heading, -0.015 * this.crewOffset(this.state, this.state === 'drive' ? this.driveElapsed / Math.max(this.driveDuration, 1e-3) : this.state === 'recovery' ? this.recoveryProgress : this.state === 'back' ? this.backElapsed / 2.2 : 0));
    this.pose();
    if (this.cox) {
      if (time - this.lastCameraTime <= 0.5) {
        const roundedSpm = this.spm > 0 ? Math.round(this.spm) : 0;
        const split = this.avgSpeed > 0.4 ? Math.floor(500 / this.avgSpeed) : 0;
        if (roundedSpm !== this.lastReadoutSpm || split !== this.lastReadoutSplit) {
          this.lastReadoutSpm = roundedSpm;
          this.lastReadoutSplit = split;
          const splitText = split > 0 ? `${Math.floor(split / 60)}:${String(split % 60).padStart(2, '0')}` : '—:—';
          this.cox.setReadout(roundedSpm, splitText);
        }
      }
      this.cox.update(this.hands, this.rudder, time);
    }
    for (const fx of this.fx) {
      if (!fx.m.visible) continue;
      fx.age += dt;
      const k = fx.age / fx.life;
      if (k >= 1) {
        fx.m.visible = false;
        continue;
      }
      const size = lerp(fx.s0, fx.s1, 1 - (1 - k) * (1 - k));
      fx.m.scale.set(size, 1, size);
      (fx.m.material as THREE.MeshBasicMaterial).opacity = fx.a0 * (1 - k);
    }
  }

  /** Cox seat view (looking toward the bow) or an elevated chase view. */
  applyCamera(cam: THREE.PerspectiveCamera, yawOff: number, pitchOff: number, chase: boolean, dt: number) {
    const group = this.group;
    this.lastCameraTime = this.time;
    if (!chase && this.hasCox) {
      this.cox?.setFirstPerson(true);
      cam.position.copy(this.coxPosition).applyMatrix4(group.matrixWorld);
      _lookEuler.set(pitchOff - 0.37, -Math.PI / 2 + yawOff, 0, 'YXZ');
      _localQ.setFromEuler(_lookEuler);
      group.getWorldQuaternion(_boatQ);
      cam.quaternion.copy(_boatQ).multiply(_localQ);
      this.chaseInit = false;
      return;
    }
    this.cox?.setFirstPerson(false);
    const angle = this.heading + yawOff;
    const height = THREE.MathUtils.clamp(6.5 + pitchOff * 8, 2.5, 14);
    _a.set(group.position.x - Math.cos(angle) * 17, group.position.y + height, group.position.z + Math.sin(angle) * 17);
    if (!this.chaseInit) {
      this.chasePos.copy(_a);
      this.chaseInit = true;
    }
    this.chasePos.lerp(_a, 1 - Math.exp(-dt * 3));
    cam.position.copy(this.chasePos);
    _chaseTarget.set(group.position.x + Math.cos(this.heading) * 1.8, group.position.y + 0.65, group.position.z - Math.sin(this.heading) * 1.8);
    cam.lookAt(_chaseTarget);
  }
}
