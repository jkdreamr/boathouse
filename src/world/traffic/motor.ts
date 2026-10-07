import * as THREE from 'three';
import type { CrewAI } from './crews';
import { Craft } from './craft';
import { type Ctx, clamp, DARK, headingTo, laneZ, rng, smooth, wrap } from './nav';
import { addMesh, type Loft, loftDeck, loftGeometry, loftRail, std } from './hulls';
import { makeLook, type PeopleBatch } from './people';
import { Boater, flatFoot, makeBoater, makePose } from './humans';

const _w = new THREE.Vector3();
const _g = new THREE.Vector3();
const _m = new THREE.Vector3();
const _hu = new THREE.Vector3();
const _tip = new THREE.Vector3();
const _knob = new THREE.Vector3();
const UPY = new THREE.Vector3(0, 1, 0);
const EXT = new THREE.Color('#1f2023');
const hp = makePose();
/** Helm wheel on the runabout console: centre, in-plane up (tilted toward the console), radius. */
const WHEEL = new THREE.Vector3(-0.24, 1.0, 0.3);
const WHEEL_TILT = 0.45;
const WHEEL_UP = new THREE.Vector3(Math.sin(WHEEL_TILT), Math.cos(WHEEL_TILT), 0);
const WHEEL_N = new THREE.Vector3(-Math.cos(WHEEL_TILT), Math.sin(WHEEL_TILT), 0);
const WHEEL_R = 0.17;

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
  private coach: Boater;
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
    // This draw used to pick the proxy colours; keep it so the talk/wash random sequence is unchanged.
    makeLook(this.rand, ['#2e2d29', '#8c1515', '#1f2a3a'], { hat: 0.85 });
    this.coach = new Boater(makeBoater(rng(78), 'coach', true, { tops: ['#2e2d29', '#8c1515', '#1f2a3a'], pfd: ['#b3261e', '#1f2a3a', '#e0a63a'] }));
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
    pb.craft(this.group, this.camDist);
    const talking = this.talk > 0;
    const b = this.coach;
    // Tiller tip and a short rigid extension rising to the coach's aft (left) hand, turning with the motor.
    _tip.set(0.64, 0.08, 0).applyEuler(this.motor.rotation).add(this.motor.position);
    _knob.set(0.7, 0.36, 0).applyEuler(this.motor.rotation).add(this.motor.position);
    pb.limb(_tip, _knob, 0.016, EXT);
    // Watch the crew: their position in launch-local coords (heading only; roll/pitch are small).
    const ch = Math.cos(this.heading);
    const sh = Math.sin(this.heading);
    const dx = this.crew.x - this.x;
    const dz = this.crew.z - this.z;
    hp.gaze.set(dx * ch - dz * sh, 1.1, dx * sh + dz * ch);
    // Standing aft beside the tiller, feet apart and knees soft for the chop, turned toward the crew.
    const floor = LAUNCH.freeboard - 0.44 + 0.004;
    flatFoot(hp.footL, -2.12, floor, 0.06, 0.25);
    flatFoot(hp.footR, -2.06, floor, 0.4, -0.2);
    hp.yaw = 0.25;
    hp.twist = talking ? -0.45 : -0.2;
    hp.up.set(0.04, 1, 0).normalize();
    hp.hip.set(-1.98, floor + b.ankle + b.legs * 0.975, 0.23);
    hp.handL.copy(_knob);
    hp.thumbL.set(0, 1, 0);
    hp.knee.set(1, 0, 0.2);
    hp.kneeOut = 0.05;
    hp.elbow.set(-0.25, -0.8, 0.5);
    hp.legs = true;
    // Mouth estimate for the proxy / first solve; refined from the posed head when skinned.
    _m.copy(hp.hip).addScaledVector(hp.up, b.shoulder * 1.27);
    _g.subVectors(hp.gaze, _m).normalize();
    _hu.copy(UPY);
    if (talking) {
      hp.handR.copy(_m).addScaledVector(_g, 0.11).addScaledVector(_hu, -0.07);
      hp.thumbR.copy(_g);
    } else {
      hp.handR.set(hp.hip.x + 0.06, hp.hip.y - 0.36, hp.hip.z + 0.26);
      hp.thumbR.set(1, 0, 0);
    }
    hp.elbow.set(-0.25, -0.8, 0.5);
    if (pb.human(b, hp) && talking) {
      b.headPoint(0.105, 0.03, 0, _m);
      b.headPoint(0.105, 1.03, 0, _hu).sub(_m).normalize();
      _g.subVectors(hp.gaze, _m).normalize();
      hp.handR.copy(_m).addScaledVector(_g, 0.11).addScaledVector(_hu, -0.07);
      hp.thumbR.copy(_g);
      hp.elbow.set(-0.1, -0.9, 0.75);
      b.setPose(hp);
    }
    if (talking) {
      // Bell away from the mouth, narrow end just off the lips.
      this.mega.position.copy(_m).addScaledVector(_g, 0.19);
      this.mega.quaternion.setFromUnitVectors(UPY, _w.copy(_g).negate());
    } else {
      this.mega.position.set(-1.6, 0.56, 0.4);
      this.mega.quaternion.setFromUnitVectors(UPY, _w.set(1, 0, 0));
    }
  }
}

const RUNABOUT: Loft = { length: 6.1, beam: 2.3, draft: 0.38, freeboard: 0.82, transom: 0.82, bowRise: 0.22, section: 1.35, maxAt: 0.42 };

/** Occasional small motorboat going slowly through on the keep-right lane. */
export class Motorboat extends Craft {
  private people: Boater[];
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
    const steel = std('#c8ccd0', 0.3, 0.8);
    const helm = addMesh(this.group, new THREE.TorusGeometry(WHEEL_R, 0.014, 8, 28), steel);
    helm.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3().crossVectors(WHEEL_UP, WHEEL_N), WHEEL_UP, WHEEL_N));
    helm.position.copy(WHEEL);
    const hub = addMesh(this.group, new THREE.CylinderGeometry(0.03, 0.03, 0.1, 10), steel);
    hub.quaternion.setFromUnitVectors(UPY, WHEEL_N);
    hub.position.copy(WHEEL).addScaledVector(WHEEL_N, -0.04);
    for (const ang of [0, (2 * Math.PI) / 3, (4 * Math.PI) / 3]) {
      const spoke = addMesh(this.group, new THREE.CylinderGeometry(0.008, 0.008, WHEEL_R, 5), steel);
      const d = new THREE.Vector3().copy(WHEEL_UP).multiplyScalar(Math.cos(ang)).addScaledVector(new THREE.Vector3(0, 0, 1), Math.sin(ang));
      spoke.quaternion.setFromUnitVectors(UPY, d);
      spoke.position.copy(WHEEL).addScaledVector(d, WHEEL_R / 2);
    }
    this.detail.push(helm, hub);
    this.people = [makeBoater(this.rand, 'boater', false, { tops: ['#f4f2ec', '#3d5a80', '#c9b37e'], pfd: null }), makeBoater(this.rand, 'boater', false, { tops: ['#e07a5f', '#81b29a', '#2e2d29'], pfd: null })].map((x) => new Boater(x));
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
    pb.craft(this.group, this.camDist);
    const deck = RUNABOUT.freeboard - 0.42 + 0.004;
    // Driver seated at the helm, hands at ten and two, eyes over the windscreen.
    let b = this.people[0];
    hp.yaw = 0;
    hp.twist = 0;
    hp.up.set(Math.sin(0.12), Math.cos(0.12), 0);
    hp.hip.set(-0.84, 0.7 + b.hipAboveSeat, 0.38);
    for (let k = 0; k < 2; k++) {
      const hand = k === 0 ? hp.handL : hp.handR;
      const thumb = k === 0 ? hp.thumbL : hp.thumbR;
      const sz = k === 0 ? -1 : 1;
      hand.copy(WHEEL).addScaledVector(WHEEL_UP, WHEEL_R * 0.5).z += sz * WHEEL_R * 0.866;
      thumb.copy(WHEEL).addScaledVector(WHEEL_UP, WHEEL_R).sub(hand).normalize();
    }
    hp.elbow.set(-0.3, -0.75, 0.6);
    flatFoot(hp.footL, -0.5, deck, 0.25, 0.12);
    flatFoot(hp.footR, -0.46, deck, 0.52, -0.12);
    hp.knee.set(1, 0.8, 0);
    hp.kneeOut = 0.08;
    hp.gaze.set(20, 1.6, 0.4);
    hp.legs = true;
    pb.human(b, hp);
    // Passenger on the port seat, leaning back, arm along the gunwale, looking at the shore.
    b = this.people[1];
    hp.yaw = 0.2;
    hp.twist = 0.15;
    hp.up.set(-Math.sin(0.12), Math.cos(0.12), 0);
    hp.hip.set(-0.86, 0.7 + b.hipAboveSeat, -0.48);
    hp.handL.set(-0.95, 0.88, -1.06);
    hp.thumbL.set(1, 0, 0);
    hp.handR.set(-0.48, 0.84, -0.36);
    hp.thumbR.set(1, 0.3, -0.3).normalize();
    hp.elbow.set(-0.4, -0.7, 0.6);
    flatFoot(hp.footL, -0.44, deck, -0.62, 0.15);
    flatFoot(hp.footR, -0.4, deck, -0.34, -0.05);
    hp.knee.set(1, 0.8, 0);
    hp.kneeOut = 0.1;
    hp.gaze.set(-3, 1.2, -12);
    pb.human(b, hp);
  }
}

