import * as THREE from 'three';
import { CrewBoat, type BoatClass } from '../../rowing/crewboat';
import { conditions } from '../../sim/conditions';
import { centerline } from '../terrain';
import { type Agent, type Avoid, type Ctx, avoid, bankSafe, clamp, headingTo, laneZ, rng, wrap } from './nav';

interface Piece {
  spm: number;
  dur: number;
}

/**
 * Typical steady-state / pieces practice: long UT2 at 18-22, some 24-28, short pieces at 30-34,
 * light paddling between. Durations in seconds of game time.
 */
const PLANS: Piece[][] = [
  [
    { spm: 20, dur: 300 },
    { spm: 22, dur: 240 },
    { spm: 18, dur: 90 },
    { spm: 32, dur: 75 },
    { spm: 18, dur: 150 },
    { spm: 24, dur: 240 },
    { spm: 34, dur: 45 },
    { spm: 18, dur: 150 },
  ],
  [
    { spm: 22, dur: 240 },
    { spm: 26, dur: 180 },
    { spm: 18, dur: 120 },
    { spm: 30, dur: 120 },
    { spm: 20, dur: 200 },
    { spm: 28, dur: 150 },
    { spm: 18, dur: 120 },
  ],
  [
    { spm: 18, dur: 360 },
    { spm: 24, dur: 210 },
    { spm: 20, dur: 200 },
    { spm: 30, dur: 90 },
    { spm: 19, dur: 180 },
  ],
];

type State = 'row' | 'hold' | 'weigh' | 'spin';

/** AI crew: taps CrewBoat.stroke() at a coached rate and steers a keep-right lane with a PD helm. */
export class CrewAI implements Agent {
  readonly boat: CrewBoat;
  active = true;
  camDist = 0;
  readonly halfLen: number;
  readonly halfBeam: number;
  state: State = 'row';
  /** Increments when the crew changes piece; the launch's coach reacts to it. */
  calls = 0;
  private dir: number;
  private plan: Piece[];
  private seg: number;
  private segT: number;
  private cur = 18;
  private rand: () => number;
  private prevHeading: number;
  private spinSign = 1;
  private spinTarget = 0;
  private holdT = 0;
  private extraDrag: number;
  private wakeAcc = 0;
  private av: Avoid = { turn: 0, slow: 1 };
  private details: THREE.Object3D[] = [];

  constructor(
    scene: THREE.Scene,
    cls: BoatClass,
    name: string,
    hull: string,
    x: number,
    dir: number,
    private readonly frac: number,
    private readonly x0: number,
    private readonly x1: number,
    seed: number,
  ) {
    this.boat = new CrewBoat(scene, cls, { name, hullColor: hull });
    this.halfLen = cls === '8+' ? 8.8 : cls === '4+' ? 6.7 : 5.1;
    this.halfBeam = cls === '2-' ? 2.9 : 3.1;
    // Shorter boats are slower: 4+ ≈ 0.92x, 2- ≈ 0.85x of an eight at the same rate.
    this.extraDrag = cls === '8+' ? 0 : cls === '4+' ? 0.0038 : 0.008;
    this.dir = dir;
    this.rand = rng(seed);
    this.plan = PLANS[seed % PLANS.length];
    this.seg = Math.floor(this.rand() * this.plan.length);
    this.segT = this.plan[this.seg].dur * this.rand();
    this.cur = this.plan[this.seg].spm;
    const h = dir > 0 ? headingTo(x, 0, x + 40, 0) : Math.PI;
    this.boat.reset(new THREE.Vector3(x, 0, laneZ(x, dir, frac)), h);
    this.boat.speed = 3.2;
    this.boat.rate = this.cur;
    this.prevHeading = h;
    this.boat.onCatch = () => {
      // Real crews never hit an exact rate: ±0.5 spm stroke-to-stroke, building 1-2 spm per stroke into a piece.
      const want = this.plan[this.seg].spm;
      this.cur += clamp(want - this.cur, -2, 2);
      this.boat.rate = clamp(this.cur + (this.rand() - 0.5), 17, 36);
    };
    this.boat.group.updateMatrixWorld(true);
    const box = new THREE.Box3();
    const size = new THREE.Vector3();
    for (const c of this.boat.group.children) {
      box.setFromObject(c).getSize(size);
      if (Math.max(size.x, size.y, size.z) < 3) this.details.push(c);
    }
  }

  get x() {
    return this.boat.x;
  }
  get z() {
    return this.boat.z;
  }
  get heading() {
    return this.boat.heading;
  }
  get speed() {
    return this.boat.speed;
  }
  get rate() {
    return this.boat.rate;
  }

  nudge(dx: number, dz: number) {
    this.boat.group.position.x += dx;
    this.boat.group.position.z += dz;
  }

  setVisible(v: boolean, detail: boolean) {
    this.boat.group.visible = v;
    for (const d of this.details) d.visible = detail;
  }

  draw() {}

  private laneHeading() {
    const look = 70;
    const tx = this.x + this.dir * look;
    return headingTo(this.x, this.z, tx, laneZ(tx, this.dir, this.frac));
  }

  update(dt: number, time: number, ctx: Ctx) {
    const b = this.boat;
    this.segT += dt;
    if (this.segT > this.plan[this.seg].dur) {
      this.segT = 0;
      this.seg = (this.seg + 1) % this.plan.length;
      this.calls++;
      // Now and then the coach stops the crew to talk ("weigh enough").
      if (this.state === 'row' && this.rand() < 0.18) {
        this.state = 'hold';
        this.holdT = 20 + this.rand() * 25;
      }
    }

    if (this.state === 'row' && ((this.dir > 0 && this.x > this.x1) || (this.dir < 0 && this.x < this.x0))) {
      this.state = 'weigh';
      this.calls++;
    }

    let steer = 0;
    if (this.state === 'row' || this.state === 'hold') {
      avoid(this, ctx.bodies, this.av, 35);
      const hd = bankSafe(this.x, this.z, this.laneHeading() + this.av.turn * 0.6, 60, 26);
      const err = wrap(hd - b.heading);
      const yawRate = wrap(b.heading - this.prevHeading) / Math.max(dt, 1e-3);
      steer = clamp(2.6 * err - 5 * yawRate, -1, 1);
      if (this.state === 'row' && this.av.slow > 0.35) b.stroke();
      if (this.state === 'hold') {
        this.holdT -= dt;
        if (this.holdT <= 0) {
          this.state = 'row';
          this.cur = 18;
          this.calls++;
        }
      }
    } else if (this.state === 'weigh') {
      if (b.speed < 0.6) {
        this.state = 'spin';
        const cl = centerline(this.x);
        // Spin toward mid-channel: + heading = turn to port.
        this.spinSign = -(cl - this.z) * Math.cos(b.heading) > 0 ? 1 : -1;
        this.dir = -this.dir;
        this.spinTarget = this.dir > 0 ? headingTo(this.x, 0, this.x + 40, 0) : Math.PI;
      }
    }
    if (Math.abs(steer) < 1e-3) steer = steer < 0 ? -1e-3 : 1e-3;
    this.prevHeading = b.heading;
    b.update(dt, steer, time);
    if (this.state === 'spin') {
      // Spinning the shell in place: bow-side backs, stroke-side rows (~45 s for 180°).
      b.heading = wrap(b.heading + this.spinSign * 0.07 * dt);
      b.speed *= 1 - 0.5 * dt;
      if (Math.abs(wrap(b.heading - this.spinTarget)) < 0.12) {
        this.state = 'row';
        this.cur = 18;
        this.calls++;
      }
    }
    if (this.extraDrag > 0) b.speed = Math.max(0, b.speed - this.extraDrag * b.speed * b.speed * dt);
    const g = b.group.position;
    g.x += conditions.current.x * dt;
    g.z += conditions.current.y * dt;
    g.y += conditions.level;

    if (this.camDist < 1100 && b.speed > 0.5) {
      this.wakeAcc += b.speed * dt;
      if (this.wakeAcc > 2.2) {
        this.wakeAcc = 0;
        const hx = this.x + Math.cos(b.heading) * this.halfLen * 0.85;
        const hz = this.z - Math.sin(b.heading) * this.halfLen * 0.85;
        ctx.wake.kelvin(hx, hz, b.heading, b.speed, 16, 1.0, 0.05);
      }
    }
  }
}
