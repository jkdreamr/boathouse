import * as THREE from 'three';
import type { CrewAI } from './crews';
import { Craft } from './craft';
import { type Ctx, clamp, DARK, headingTo, laneZ, rng, smooth, wrap } from './nav';
import { addMesh, type Loft, loftDeck, loftGeometry, loftRail, std } from './hulls';
import { type Look, makeLook, type PeopleBatch, type SeatedPose } from './people';

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _hL = new THREE.Vector3();
const _hR = new THREE.Vector3();
const _fL = new THREE.Vector3();
const _fR = new THREE.Vector3();
const _hip = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);
const pose: SeatedPose = { hip: _hip, lean: 0, roll: 0, twist: 0, handL: _hL, handR: _hR };

/** ~18 ft aluminium coaching launch with a tiller outboard. */
const LAUNCH: Loft = { length: 5.5, beam: 2.0, draft: 0.28, freeboard: 0.6, transom: 0.86, bowRise: 0.16, section: 0.5, maxAt: 0.42 };

function outboard(parent: THREE.Object3D, x: number, y: number, cowl: string) {
  const g = new THREE.Group();
  g.position.set(x, y, 0);
  const dark = std(cowl, 0.4, 0.2);
  const grey = std('#5d6166', 0.5, 0.5);
  const c = addMesh(g, new THREE.BoxGeometry(0.5, 0.48, 0.38), dark, true);
  c.position.set(-0.12, 0.2, 0);
  const cap = addMesh(g, new THREE.SphereGeometry(0.24, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), dark);
  cap.scale.set(1.05, 0.5, 0.8);
  cap.position.set(-0.12, 0.44, 0);
  const shaft = addMesh(g, new THREE.BoxGeometry(0.14, 0.95, 0.09), grey);
  shaft.position.set(-0.06, -0.48, 0);
  const plate = addMesh(g, new THREE.BoxGeometry(0.42, 0.02, 0.24), grey);
  plate.position.set(-0.06, -0.72, 0);
  const lower = addMesh(g, new THREE.CapsuleGeometry(0.06, 0.32, 4, 8), grey);
  lower.rotation.z = Math.PI / 2;
  lower.position.set(-0.02, -0.86, 0);
  const prop = addMesh(g, new THREE.BoxGeometry(0.02, 0.26, 0.05), grey);
  prop.position.set(-0.24, -0.86, 0);
  const tiller = addMesh(g, new THREE.CylinderGeometry(0.022, 0.022, 0.75, 6), std('#1f2023', 0.6));
  tiller.rotation.z = Math.PI / 2 - 0.12;
  tiller.position.set(0.3, 0.12, 0);
  parent.add(g);
  return g;
}

/** Coaching launch shadowing a crew a boat-width off its port side (mid-channel side). */
export class Launch extends Craft {
  private motor: THREE.Group;
  private mega: THREE.Mesh;
  private look: Look;
  private talk = 0;
  private nextTalk = 6;
  private lastCalls = 0;
  private washAcc = 0;
  private rand = rng(77);

  constructor(parent: THREE.Object3D, private readonly crew: CrewAI) {
    super(parent, 'traffic-launch', crew.x - 4, crew.z - 18, crew.heading, 2.75, 1.0);
    const alu = std('#b7bcc1', 0.42, 0.75, THREE.DoubleSide);
    addMesh(this.group, loftGeometry(LAUNCH), alu, true).receiveShadow = true;
    const floor = addMesh(this.group, loftDeck(LAUNCH, 0.02, 0.84, 0.44, 0.08), std('#8c9196', 0.8, 0.4));
    floor.receiveShadow = true;
    addMesh(this.group, loftDeck(LAUNCH, 0.84, 0.995, 0), alu);
    for (const r of loftRail(LAUNCH, 0.035)) addMesh(this.group, r, std('#2e2d29', 0.7));
    for (const [x, w] of [
      [-1.6, 0.36],
      [0.35, 0.3],
    ]) {
      const seat = addMesh(this.group, new THREE.BoxGeometry(w, 0.05, LAUNCH.beam - 0.25), std('#a9aeb3', 0.5, 0.6));
      seat.position.set(x, 0.42, 0);
    }
    const tank = addMesh(this.group, new THREE.BoxGeometry(0.5, 0.28, 0.34), std('#b3261e', 0.5));
    tank.position.set(-2.2, 0.32, -0.55);
    const ring = addMesh(this.group, new THREE.TorusGeometry(0.22, 0.05, 6, 14), std('#e4572e', 0.6));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(0.9, 0.48, 0.45);
    this.motor = outboard(this.group, -LAUNCH.length / 2 - 0.08, LAUNCH.freeboard + 0.02, DARK);
    this.mega = addMesh(this.group, new THREE.CylinderGeometry(0.035, 0.13, 0.34, 12, 1, true), std('#e9e7e1', 0.5, 0, THREE.DoubleSide));
    this.detail.push(this.motor, this.mega, ring, tank);
    this.look = makeLook(this.rand, ['#2e2d29', '#8c1515', '#1f2a3a'], { hat: 0.85 });
  }

  update(dt: number, time: number, ctx: Ctx) {
    const c = this.crew;
    const ch = c.heading;
    const fx = Math.cos(ch);
    const fz = -Math.sin(ch);
    // Station: level with the coxswain/stern pair, ~16 m off the crew's port side.
    const tx = c.x - fx * 4 + -fz * 16;
    const tz = c.z - fz * 4 + fx * 16;
    const dx = tx - this.x;
    const dz = tz - this.z;
    const dist = Math.hypot(dx, dz);
    const alongErr = dx * fx + dz * fz;
    let hd: number;
    let v: number;
    if (dist > 45) {
      hd = headingTo(this.x, this.z, tx, tz);
      v = 6.5;
    } else if (c.speed < 1 && dist < 12) {
      hd = ch;
      v = 0;
    } else {
      hd = headingTo(this.x, this.z, tx + fx * 25, tz + fz * 25);
      v = clamp(c.speed + alongErr * 0.3, 0, 7);
    }
    hd = this.safeHeading(hd, ctx, 18, c);
    // Never close inside ~9 m of the shell (oars + wash).
    const cx = c.x - this.x;
    const cz = c.z - this.z;
    const cd = Math.hypot(cx, cz);
    if (cd < c.halfLen + 9) {
      const away = headingTo(c.x, c.z, this.x, this.z);
      hd += wrap(away - hd) * clamp(1 - (cd - c.halfLen) / 9, 0, 1) * 0.6;
    }
    this.steerTo(hd, 0.45, dt, 0.5);
    this.speedTo(v * this.av.slow, dt, 3, 2.5);
    this.pitch = 0.012 + 0.05 * smooth((this.speed - 2) / 4);
    this.roll = clamp(-this.yawRate * this.speed * 0.05, -0.1, 0.1);
    this.motor.rotation.y = clamp(-this.yawRate * 1.6, -0.5, 0.5);
    this.integrate(dt, time, 0.03);
    this.wake(ctx, dt, 1.6, 22, 1.3, 0.22);
    if (this.camDist < 1100 && this.speed > 0.6) {
      this.washAcc += dt;
      if (this.washAcc > 0.18) {
        this.washAcc = 0;
        const sx = this.x - Math.cos(this.heading) * (this.halfLen + 0.4);
        const sz = this.z + Math.sin(this.heading) * (this.halfLen + 0.4);
        const r = this.rand() - 0.5;
        ctx.wake.emit(sx, sz, -Math.cos(this.heading) * 0.4 + r * 0.3, Math.sin(this.heading) * 0.4 + r * 0.3, this.heading, 6, 1, 3.5, 0.8, 2.6, 0.2 * clamp(this.speed / 4, 0.3, 1.2));
      }
    }
    if (c.calls !== this.lastCalls) {
      this.lastCalls = c.calls;
      this.talk = 4;
    }
    this.nextTalk -= dt;
    if (this.nextTalk <= 0) {
      this.talk = 2.5 + this.rand() * 3;
      this.nextTalk = 14 + this.rand() * 20;
    }
    this.talk -= dt;
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    const talking = this.talk > 0;
    _hip.set(-1.62, 0.47, -0.42);
    pose.lean = 0.12;
    pose.roll = 0;
    pose.twist = -0.55;
    pose.torsoLen = 0.54;
    // Aft (left) hand on the outboard tiller grip, other hand on the megaphone or knee.
    _v.set(0.3 + 0.37 * Math.cos(this.motor.rotation.y), 0.12, 0).applyEuler(this.motor.rotation).add(this.motor.position);
    _hL.copy(_v);
    if (talking) _hR.set(-1.26, 1.18, -0.1);
    else _hR.set(-1.22, 0.62, -0.3);
    _fL.set(-1.1, 0.16, -0.55);
    _fR.set(-1.1, 0.16, -0.25);
    pose.footL = _fL;
    pose.footR = _fR;
    pb.person(pose, this.look);
    pose.footL = pose.footR = undefined;
    pose.torsoLen = undefined;
    if (talking) {
      this.mega.position.set(-1.25, 1.17, 0.02);
      _w.set(-0.35, 0.05, -1).normalize();
      this.mega.quaternion.setFromUnitVectors(UPY, _w);
    } else {
      this.mega.position.set(-1.6, 0.56, 0.4);
      this.mega.quaternion.setFromUnitVectors(UPY, _w.set(1, 0, 0));
    }
  }
}

const RUNABOUT: Loft = { length: 6.1, beam: 2.3, draft: 0.38, freeboard: 0.82, transom: 0.82, bowRise: 0.22, section: 1.35, maxAt: 0.42 };

/** Occasional small motorboat going slowly through on the keep-right lane. */
export class Motorboat extends Craft {
  private looks: Look[];
  private rand = rng(4242);
  private washAcc = 0;
  private x0 = -1800;
  private x1 = 2800;

  constructor(parent: THREE.Object3D) {
    super(parent, 'traffic-motorboat', -1800, 0, 0, 3.05, 1.15);
    const white = std('#f1f1ee', 0.35, 0, THREE.DoubleSide);
    addMesh(this.group, loftGeometry(RUNABOUT), white, true);
    for (const r of loftRail({ ...RUNABOUT, beam: RUNABOUT.beam + 0.02, freeboard: RUNABOUT.freeboard - 0.2 }, 0.05)) addMesh(this.group, r, std('#1f4e79', 0.4));
    addMesh(this.group, loftDeck(RUNABOUT, 0.7, 0.995, 0), std('#e8e6df', 0.5));
    addMesh(this.group, loftDeck(RUNABOUT, 0.02, 0.7, 0.42, 0.1), std('#bdbab2', 0.85));
    for (const r of loftRail(RUNABOUT, 0.03)) addMesh(this.group, r, std('#c8ccd0', 0.3, 0.8));
    const console_ = addMesh(this.group, new THREE.BoxGeometry(0.6, 0.75, 0.7), std('#e8e6df', 0.5));
    console_.position.set(0.15, 0.78, 0);
    const glass = addMesh(this.group, new THREE.PlaneGeometry(0.75, 0.38), new THREE.MeshStandardMaterial({ color: '#9bb7c4', roughness: 0.05, metalness: 0.5, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    glass.rotation.set(0, Math.PI / 2, -0.5);
    glass.position.set(0.5, 1.28, 0);
    for (const z of [-0.5, 0.5]) {
      const seat = addMesh(this.group, new THREE.BoxGeometry(0.5, 0.3, 0.55), std('#d9d4c7', 0.8));
      seat.position.set(-0.75, 0.55, z);
    }
    outboard(this.group, -RUNABOUT.length / 2 - 0.08, RUNABOUT.freeboard, '#d7d8d6');
    this.looks = [makeLook(this.rand, ['#f4f2ec', '#3d5a80', '#c9b37e'], { hat: 0.8 }), makeLook(this.rand, ['#e07a5f', '#81b29a', '#2e2d29'], { hat: 0.4 })];
    this.active = false;
  }

  spawn(rand: () => number) {
    this.dir = rand() < 0.5 ? 1 : -1;
    const x = this.dir > 0 ? this.x0 : this.x1;
    this.group.position.set(x, 0, laneZ(x, this.dir, 0.5));
    this.heading = this.dir > 0 ? 0 : Math.PI;
    this.speed = 3;
    this.yawRate = 0;
    this.active = true;
  }

  update(dt: number, time: number, ctx: Ctx) {
    if ((this.dir > 0 && this.x > this.x1) || (this.dir < 0 && this.x < this.x0)) {
      this.active = false;
      this.group.visible = false;
      return;
    }
    const tx = this.x + this.dir * 60;
    let hd = headingTo(this.x, this.z, tx, laneZ(tx, this.dir, 0.5));
    hd = this.safeHeading(hd, ctx, 22);
    this.steerTo(hd, 0.3, dt, 0.6);
    // Slow, no-wake-ish speed (~7 kn) and slower still near the boathouse docks.
    const nearDocks = Math.abs(this.x) < 250 ? 0.7 : 1;
    this.speedTo(3.6 * nearDocks * this.av.slow, dt, 4, 3);
    this.pitch = 0.02 + 0.035 * smooth((this.speed - 2) / 3);
    this.roll = clamp(-this.yawRate * this.speed * 0.05, -0.08, 0.08);
    this.integrate(dt, time, 0.035);
    this.wake(ctx, dt, 1.5, 26, 1.5, 0.3);
    if (this.camDist < 1100) {
      this.washAcc += dt;
      if (this.washAcc > 0.2) {
        this.washAcc = 0;
        const sx = this.x - Math.cos(this.heading) * (this.halfLen + 0.4);
        const sz = this.z + Math.sin(this.heading) * (this.halfLen + 0.4);
        ctx.wake.emit(sx, sz, -Math.cos(this.heading) * 0.5, Math.sin(this.heading) * 0.5, this.heading, 7, 1.2, 4, 0.9, 3, 0.24);
      }
    }
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    // Driver standing at the console.
    _hip.set(-0.42, 1.38, 0);
    pose.lean = 0.05;
    pose.roll = 0;
    pose.twist = 0;
    _hL.set(0.02, 1.2, -0.18);
    _hR.set(0.02, 1.2, 0.18);
    _fL.set(-0.45, 0.42, -0.14);
    _fR.set(-0.4, 0.42, 0.14);
    pose.footL = _fL;
    pose.footR = _fR;
    pb.person(pose, this.looks[0]);
    // Passenger seated aft.
    _hip.set(-0.8, 0.72, -0.5);
    pose.lean = -0.1;
    pose.twist = 0.2;
    _hL.set(-0.55, 0.78, -0.75);
    _hR.set(-0.5, 0.75, -0.25);
    _fL.set(-0.2, 0.42, -0.6);
    _fR.set(-0.2, 0.42, -0.38);
    pb.person(pose, this.looks[1]);
    pose.footL = pose.footR = undefined;
  }
}

