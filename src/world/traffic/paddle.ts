import * as THREE from 'three';
import { Craft } from './craft';
import { type Ctx, DARK, clamp, headingTo, laneZ, lerp, rng, smooth, WHITE } from './nav';
import { addMesh, type Loft, loftDeck, loftGeometry, loftRail, std } from './hulls';
import { along, type Look, makeLook, type PeopleBatch, type SeatedPose } from './people';

const _hip = new THREE.Vector3();
const _hL = new THREE.Vector3();
const _hR = new THREE.Vector3();
const _fL = new THREE.Vector3();
const _fR = new THREE.Vector3();
const _B = new THREE.Vector3();
const _T = new THREE.Vector3();
const _low = new THREE.Vector3();
const _C = new THREE.Vector3();
const _A = new THREE.Vector3();
const _O = new THREE.Vector3();
const _d = new THREE.Vector3();
const pose: SeatedPose = { hip: _hip, lean: 0, roll: 0, twist: 0, handL: _hL, handR: _hR };
const SHAFT = new THREE.Color('#1d1e20');

interface StrokeSpec {
  reach: number;
  exit: number;
  depth: number;
  beamOff: number;
  len: number;
  handGap: number;
  leanCatch: number;
  leanExit: number;
}

/**
 * Single-blade (outrigger / SUP) stroke. φ ∈ [0,1): catch at 0, drive to 0.55 (blade buried, shaft
 * stacked vertical, top hand driving down), exit at the hip, then a low forward recovery.
 */
function singleStroke(phi: number, hip: THREE.Vector3, from: number, to: number, sp: StrokeSpec) {
  let bx: number;
  let by: number;
  let bz: number;
  let alpha: number;
  let lean: number;
  let side: number;
  if (phi < 0.55) {
    const u = phi / 0.55;
    const dip = smooth(u / 0.16) * (1 - smooth((u - 0.82) / 0.18));
    side = to;
    bx = hip.x + lerp(sp.reach, sp.exit, smooth(u));
    by = 0.06 + (sp.depth - 0.06) * dip;
    bz = side * sp.beamOff;
    alpha = lerp(-0.22, 0.42, u);
    lean = lerp(sp.leanCatch, sp.leanExit, smooth(u));
  } else {
    const r = (phi - 0.55) / 0.45;
    side = lerp(from, to, smooth(r));
    bx = hip.x + lerp(sp.exit, sp.reach, smooth(r));
    by = 0.08 + 0.28 * Math.sin(Math.PI * r);
    bz = side * (sp.beamOff + 0.12 * Math.sin(Math.PI * r));
    alpha = lerp(0.42, -0.22, smooth(r));
    lean = lerp(sp.leanExit, sp.leanCatch, smooth(r));
  }
  _B.set(bx, by, bz);
  const tz = side * 0.05;
  const dx = sp.len * Math.sin(alpha);
  const dz = tz - bz;
  _T.set(bx + dx, by + Math.sqrt(Math.max(0.05, sp.len * sp.len - dx * dx - dz * dz)), tz);
  along(_low, _T, _B, sp.handGap);
  // Paddling on starboard: top hand = left, bottom hand = right.
  const s = side >= 0 ? 1 : -1;
  if (s > 0) {
    _hL.copy(_T);
    _hR.copy(_low);
  } else {
    _hR.copy(_T);
    _hL.copy(_low);
  }
  pose.lean = lean;
  pose.twist = -side * 0.4 * clamp((lean - sp.leanExit) / Math.max(0.01, sp.leanCatch - sp.leanExit), 0, 1);
  pose.roll = side * 0.07;
}

/** Hawaiian-style six-person outrigger canoe (OC6): ama on the left (port), two iako, six paddlers. */
const OC6: Loft = { length: 13.7, beam: 0.54, draft: 0.22, freeboard: 0.42, transom: 0, bowRise: 0.28, section: 1.0, maxAt: 0.5 };
const AMA: Loft = { length: 5.2, beam: 0.26, draft: 0.12, freeboard: 0.16, transom: 0, bowRise: 0.08, section: 1.0, maxAt: 0.5 };
const OC6_SEATS = [3.6, 2.28, 0.96, -0.36, -1.68, -3.0];
const OC6_STROKE: StrokeSpec = { reach: 0.8, exit: -0.25, depth: -0.4, beamOff: 0.42, len: 1.3, handGap: 0.56, leanCatch: 0.5, leanExit: 0.05 };

export class OutriggerCanoe extends Craft {
  private phi = 0;
  private strokes = 0;
  private flip = 1;
  private fromFlip = 1;
  private looks: Look[];
  private bladeC: THREE.Color[];

  constructor(parent: THREE.Object3D, x: number, dir: number, private readonly frac: number, private readonly x0: number, private readonly x1: number, hull: string) {
    super(parent, 'traffic-oc6', x, 0, dir > 0 ? 0 : Math.PI, 6.85, 1.2);
    this.dir = dir;
    const hm = std(hull, 0.3, 0, THREE.DoubleSide);
    addMesh(this.group, loftGeometry(OC6, 40, 12), hm, true);
    const deck = std(WHITE, 0.4);
    addMesh(this.group, loftDeck(OC6, 0.0, 0.2), deck);
    addMesh(this.group, loftDeck(OC6, 0.8, 1.0), deck);
    for (const r of loftRail(OC6, 0.025, 30)) addMesh(this.group, r, std(DARK, 0.6));
    for (const sx of OC6_SEATS) {
      const seat = addMesh(this.group, new THREE.BoxGeometry(0.34, 0.04, 0.4), std('#3b3f45', 0.7));
      seat.position.set(sx, 0.08, 0);
    }
    const ama = new THREE.Group();
    ama.position.set(0.98, 0, -1.95);
    addMesh(ama, loftGeometry(AMA, 20, 10), std(WHITE, 0.35, 0, THREE.DoubleSide), true);
    addMesh(ama, loftDeck(AMA, 0, 1), std(WHITE, 0.35));
    this.group.add(ama);
    const iakoMat = std(DARK, 0.45, 0.3);
    for (const ix of [2.95, -1.0]) {
      const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(ix, 0.42, 0.12), new THREE.Vector3(ix, 0.72, -1.0), new THREE.Vector3(ix, 0.18, -1.95));
      addMesh(this.group, new THREE.TubeGeometry(c, 12, 0.04, 6), iakoMat, true);
    }
    const rand = rng(606);
    const tops = ['#1f4e79', '#2e2d29', '#f4f2ec', '#c4302b', '#2a7f62', '#e0a63a', '#5a5f66'];
    this.looks = OC6_SEATS.map(() => makeLook(rand, tops, { hat: 0.7 }));
    this.bladeC = OC6_SEATS.map((_, i) => new THREE.Color(i === 5 ? '#c9b37e' : '#1d1e20'));
    this.group.position.z = laneZ(x, dir, frac);
  }

  update(dt: number, time: number, ctx: Ctx) {
    let hd = this.laneHeading(this.frac, this.x0, this.x1, 45);
    hd = this.safeHeading(hd, ctx, 20);
    this.steerTo(hd, 0.12, dt, 1.2);
    // ~60 spm, "hut!" side change every 15 strokes.
    const rate = 60 + 4 * Math.sin(time * 0.01);
    this.phi += (dt * rate) / 60;
    if (this.phi >= 1) {
      this.phi -= 1;
      this.strokes++;
      this.fromFlip = this.flip;
      if (this.strokes % 15 === 14) this.flip = -this.flip;
    }
    const surge = 1 + 0.06 * Math.sin(Math.PI * 2 * (this.phi - 0.12));
    this.speedTo(2.7 * this.av.slow, dt, 4, 6);
    const v = this.speed;
    this.speed = v * surge;
    this.roll = 0.01;
    this.pitch = 0;
    this.integrate(dt, time, 0.02);
    this.speed = v;
    this.wake(ctx, dt, 1.4, 14, 0.9, 0.1);
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    for (let i = 0; i < 6; i++) {
      const sx = OC6_SEATS[i];
      _hip.set(sx, 0.14, 0);
      const base = i % 2 === 0 ? 1 : -1;
      const to = base * this.flip;
      const from = base * this.fromFlip;
      // Seats 1..6 follow the stroker with a small ripple; seat 6 (steersman) poke-steers when correcting.
      const phi = (this.phi - i * 0.012 + 1) % 1;
      if (i === 5 && Math.abs(this.yawRate) > 0.05) {
        const s = this.yawRate > 0 ? 1 : -1;
        _B.set(sx - 0.9, -0.25, s * 0.5);
        _T.set(sx + 0.15, 0.72, s * 0.15);
        along(_low, _T, _B, 0.56);
        _hL.copy(_T);
        _hR.copy(_low);
        pose.lean = -0.05;
        pose.twist = s * 0.5;
        pose.roll = s * 0.05;
      } else singleStroke(phi, _hip, from, to, OC6_STROKE);
      pb.person(pose, this.looks[i]);
      pb.paddle(_T, _B, false, SHAFT, this.bladeC[i], 0.48, 0.23);
    }
  }
}

const KAYAK: Loft = { length: 5.0, beam: 0.6, draft: 0.16, freeboard: 0.26, transom: 0, bowRise: 0.07, section: 1.0, maxAt: 0.47 };

/** Touring kayak with a double-bladed paddle, ~55 strokes/min alternating sides. */
export class Kayak extends Craft {
  private phi: number;
  private look: Look;
  private bladeC: THREE.Color;
  follower?: Kayak;

  constructor(parent: THREE.Object3D, x: number, dir: number, private readonly frac: number, private readonly x0: number, private readonly x1: number, color: string, seed: number, private readonly buddy?: Kayak) {
    super(parent, 'traffic-kayak', x, 0, dir > 0 ? 0 : Math.PI, 2.5, 0.9);
    this.dir = dir;
    addMesh(this.group, loftGeometry(KAYAK, 28, 10), std(color, 0.35, 0, THREE.DoubleSide), true);
    addMesh(this.group, loftDeck(KAYAK, 0, 1), std(color, 0.35));
    const coaming = addMesh(this.group, new THREE.TorusGeometry(0.3, 0.03, 6, 18), std(DARK, 0.6));
    coaming.rotation.x = Math.PI / 2;
    coaming.scale.set(1.45, 0.78, 1);
    coaming.position.set(-0.15, KAYAK.freeboard + 0.02, 0);
    const skirt = addMesh(this.group, new THREE.CircleGeometry(0.29, 16), std(DARK, 0.8));
    skirt.rotation.x = -Math.PI / 2;
    skirt.scale.set(1.45, 0.78, 1);
    skirt.position.set(-0.15, KAYAK.freeboard + 0.03, 0);
    this.detail.push(coaming);
    const rand = rng(seed);
    this.phi = rand();
    this.look = makeLook(rand, ['#2e2d29', '#f4f2ec', '#3d5a80', '#81b29a'], { pfd: ['#e4572e', '#f3a712', '#2e86ab', '#c4302b'], hat: 0.6 });
    this.bladeC = new THREE.Color(rand() < 0.5 ? '#f3a712' : '#f4f2ec');
    this.group.position.z = laneZ(x, dir, frac) + (buddy ? -4 * dir : 0);
  }

  update(dt: number, time: number, ctx: Ctx) {
    let hd: number;
    if (this.buddy) {
      // Paddle alongside a friend, a few metres off their port beam.
      const b = this.buddy;
      this.dir = b.dir;
      const tx = b.x + Math.cos(b.heading) * 6 - Math.sin(b.heading) * 5;
      const tz = b.z - Math.sin(b.heading) * 6 - Math.cos(b.heading) * 5;
      hd = headingTo(this.x, this.z, tx, tz);
      const dist = Math.hypot(tx - this.x, tz - this.z);
      hd = this.safeHeading(hd, ctx, 16, b);
      this.speedTo(clamp(b.speed + (dist - 6) * 0.15, 0.4, 2.2), dt, 3, 3);
    } else {
      hd = this.safeHeading(this.laneHeading(this.frac, this.x0, this.x1, 25), ctx, 16, this.follower);
      this.speedTo(1.6 * this.av.slow, dt, 4, 4);
    }
    this.steerTo(hd, 0.35, dt, 0.6);
    this.phi = (this.phi + (dt * 27) / 60) % 1;
    this.roll = 0.03 * Math.sin(this.phi * Math.PI * 2);
    this.integrate(dt, time, 0.03);
    this.wake(ctx, dt, 0.8, 8, 0.45, 0.1);
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    const half = this.phi < 0.5 ? this.phi * 2 : this.phi * 2 - 1;
    const s = this.phi < 0.5 ? 1 : -1;
    const hx = -0.25;
    _hip.set(hx, 0.12, 0);
    _C.set(hx + 0.42, 0.62, 0);
    if (half < 0.7) {
      const u = half / 0.7;
      const dip = smooth(u / 0.18) * (1 - smooth((u - 0.8) / 0.2));
      _A.set(hx + lerp(1.05, 0.0, smooth(u)), lerp(0.12, -0.18, dip), s * 0.92);
    } else {
      // Recovery: the working blade lifts as the other end swings down toward the next catch.
      const r = (half - 0.7) / 0.3;
      _O.set(hx + 1.05, 0.12, -s * 0.92);
      _O.subVectors(_C, _O).add(_C);
      _A.set(hx, -0.1, s * 0.92).lerp(_O, smooth(r));
    }
    _d.subVectors(_A, _C).normalize();
    _A.copy(_C).addScaledVector(_d, 1.1);
    _O.copy(_C).addScaledVector(_d, -1.1);
    const low = s > 0 ? _hR : _hL;
    const high = s > 0 ? _hL : _hR;
    low.copy(_C).addScaledVector(_d, 0.38);
    high.copy(_C).addScaledVector(_d, -0.38);
    pose.lean = 0.22;
    pose.twist = -s * 0.35 * (half < 0.7 ? 1 - half / 0.7 : 0);
    pose.roll = 0;
    pb.person(pose, this.look);
    pb.paddle(_O, _A, true, SHAFT, this.bladeC, 0.44, 0.17);
  }
}

const SUP_STROKE: StrokeSpec = { reach: 0.75, exit: -0.15, depth: -0.42, beamOff: 0.48, len: 1.95, handGap: 0.62, leanCatch: 0.45, leanExit: 0.12 };

function boardGeometry(len: number, width: number, thick: number) {
  const s = new THREE.Shape();
  const h = len / 2;
  const w = width / 2;
  s.moveTo(-h, -w * 0.78);
  s.quadraticCurveTo(-h + 0.6, -w, 0, -w);
  s.quadraticCurveTo(h - 0.5, -w, h, 0);
  s.quadraticCurveTo(h - 0.5, w, 0, w);
  s.quadraticCurveTo(-h + 0.6, w, -h, w * 0.78);
  s.lineTo(-h, -w * 0.78);
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: 0.025, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  g.rotateX(-Math.PI / 2);
  return g;
}

/** Stand-up paddleboarder: ~40 spm, switching sides every 8 strokes. */
export class Paddleboard extends Craft {
  private phi = 0;
  private strokes = 0;
  private side = 1;
  private from = 1;
  private look: Look;
  private bladeC = new THREE.Color(DARK);

  constructor(parent: THREE.Object3D, x: number, dir: number, private readonly frac: number, private readonly x0: number, private readonly x1: number, color: string) {
    super(parent, 'traffic-sup', x, 0, dir > 0 ? 0 : Math.PI, 1.8, 0.6);
    this.dir = dir;
    const b = addMesh(this.group, boardGeometry(3.6, 0.8, 0.1), std(color, 0.4), true);
    b.position.y = -0.02;
    const pad = addMesh(this.group, new THREE.PlaneGeometry(1.2, 0.6), std('#3b3f45', 0.9));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(-0.2, 0.11, 0);
    this.group.position.z = laneZ(x, dir, frac);
    this.look = makeLook(rng(1717), ['#81b29a', '#f4f2ec', '#e07a5f', '#3d5a80'], { hat: 0.7, bottoms: ['#2e2d29', '#3d5a80'] });
  }

  update(dt: number, time: number, ctx: Ctx) {
    const hd = this.safeHeading(this.laneHeading(this.frac, this.x0, this.x1, 20), ctx, 15);
    this.steerTo(hd, 0.3, dt, 0.8);
    this.phi += (dt * 40) / 60;
    if (this.phi >= 1) {
      this.phi -= 1;
      this.strokes++;
      this.from = this.side;
      if (this.strokes % 8 === 7) this.side = -this.side;
    }
    this.speedTo(1.15 * this.av.slow, dt, 5, 5);
    this.roll = 0.015 * Math.sin(this.phi * Math.PI * 2);
    this.integrate(dt, time, 0.03);
    this.wake(ctx, dt, 0.8, 7, 0.45, 0.08);
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    _hip.set(-0.25, 0.98, 0);
    singleStroke(this.phi, _hip, this.from, this.side, SUP_STROKE);
    _hip.y = 0.98 - 0.12 * pose.lean;
    _fL.set(-0.2, 0.11, -0.2);
    _fR.set(-0.2, 0.11, 0.2);
    pose.footL = _fL;
    pose.footR = _fR;
    pb.person(pose, this.look);
    pose.footL = pose.footR = undefined;
    pb.paddle(_T, _B, false, SHAFT, this.bladeC, 0.46, 0.21);
  }
}
