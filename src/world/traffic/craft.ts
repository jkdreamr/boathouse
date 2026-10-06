import * as THREE from 'three';
import { conditions } from '../../sim/conditions';
import { type Agent, type Avoid, type Body, type Ctx, avoid, bankSafe, clamp, headingTo, laneZ, wrap } from './nav';
import type { PeopleBatch } from './people';

/** Kinematic small craft (launch, sailboat, canoe, kayak, SUP, motorboat). Bow = +x, waterline y = 0. */
export abstract class Craft implements Agent {
  readonly group = new THREE.Group();
  heading: number;
  speed = 0;
  yawRate = 0;
  active = true;
  camDist = 0;
  dir = 1;
  protected detail: THREE.Object3D[] = [];
  protected av: Avoid = { turn: 0, slow: 1 };
  protected roll = 0;
  protected pitch = 0;
  protected bobPhase: number;
  protected wakeAcc = 0;

  constructor(
    parent: THREE.Object3D,
    name: string,
    x: number,
    z: number,
    heading: number,
    readonly halfLen: number,
    readonly halfBeam: number,
  ) {
    this.group.name = name;
    this.group.rotation.order = 'YXZ';
    this.group.position.set(x, 0, z);
    this.heading = heading;
    this.bobPhase = (x * 0.37 + z * 0.11) % 6.28;
    parent.add(this.group);
  }

  get x() {
    return this.group.position.x;
  }
  get z() {
    return this.group.position.z;
  }

  nudge(dx: number, dz: number) {
    this.group.position.x += dx;
    this.group.position.z += dz;
  }

  setVisible(v: boolean, detail: boolean) {
    this.group.visible = v;
    for (const d of this.detail) d.visible = detail;
  }

  abstract update(dt: number, time: number, ctx: Ctx): void;
  abstract draw(pb: PeopleBatch, time: number): void;

  /** Pure-pursuit target on the keep-right lane, turning around at the ends of [x0, x1]. */
  protected laneHeading(frac: number, x0: number, x1: number, look: number) {
    if (this.dir > 0 && this.x > x1) this.dir = -1;
    else if (this.dir < 0 && this.x < x0) this.dir = 1;
    const tx = this.x + this.dir * look;
    return headingTo(this.x, this.z, tx, laneZ(tx, this.dir, frac));
  }

  /** Apply collision avoidance and shoal/bank clearance to a desired heading. */
  protected safeHeading(hd: number, ctx: Ctx, margin: number, skip?: Body) {
    avoid(this, ctx.bodies, this.av, 30, skip);
    return bankSafe(this.x, this.z, hd + this.av.turn, 20 + this.speed * 8, margin);
  }

  /** Rate-limited yaw with first-order lag (helm/rudder response). */
  protected steerTo(hd: number, maxYaw: number, dt: number, tau = 0.7) {
    const want = clamp(wrap(hd - this.heading) * 1.2, -maxYaw, maxYaw);
    this.yawRate += (want - this.yawRate) * Math.min(1, dt / tau);
    this.heading = wrap(this.heading + this.yawRate * dt);
  }

  protected speedTo(v: number, dt: number, tauUp: number, tauDown: number) {
    this.speed += (v - this.speed) * Math.min(1, dt / (v > this.speed ? tauUp : tauDown));
  }

  /** Advance with the current, sit on the tide-driven water level, bob on the chop. */
  protected integrate(dt: number, time: number, bob: number) {
    const p = this.group.position;
    p.x += (Math.cos(this.heading) * this.speed + conditions.current.x) * dt;
    p.z += (-Math.sin(this.heading) * this.speed + conditions.current.y) * dt;
    const chop = 0.6 + Math.min(1.5, conditions.wind.length() * 0.15);
    p.y = conditions.level + bob * chop * (Math.sin(time * 1.7 + this.bobPhase) * 0.6 + Math.sin(time * 2.9 + this.bobPhase * 1.7) * 0.4);
    this.group.rotation.set(
      this.roll + bob * chop * 0.25 * Math.sin(time * 1.3 + this.bobPhase),
      this.heading,
      this.pitch + bob * chop * 0.12 * Math.sin(time * 1.9 + this.bobPhase * 0.7),
    );
  }

  /** Emit Kelvin wake arms every `spacing` metres travelled through the water. */
  protected wake(ctx: Ctx, dt: number, spacing: number, life: number, width: number, alpha: number) {
    if (this.camDist > 1100 || this.speed < 0.25) return;
    this.wakeAcc += this.speed * dt;
    if (this.wakeAcc < spacing) return;
    this.wakeAcc -= spacing;
    const bx = this.x + Math.cos(this.heading) * this.halfLen * 0.75;
    const bz = this.z - Math.sin(this.heading) * this.halfLen * 0.75;
    ctx.wake.kelvin(bx, bz, this.heading, this.speed, life, width, alpha * clamp(this.speed / 2, 0.3, 1.4));
  }
}
