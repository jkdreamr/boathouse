import * as THREE from 'three';
import { conditions } from '../sim/conditions';
import { DOCK, DOCK_PILES } from './site';
import { channelDepthDist, terrainHeight } from './terrain';
import { buildLaunchModel } from './traffic/motor';
import type { WakeField } from './traffic/wake';

const MOOR_X = 20;
const MOOR_Z = DOCK.minZ - 1.8;
const MOOR_HEADING = 0.22;
const _cam = new THREE.Vector3();
const _target = new THREE.Vector3();

/** Small tiller-driven coaching launch moored along the floating dock. */
export class PlayerLaunch {
  readonly group = new THREE.Group();
  readonly halfLen = 2.75;
  readonly halfBeam = 1;
  heading = 0;
  speed = 0;
  distance = 0;
  private wakeDistance = 0;
  private motor: THREE.Group;

  constructor(scene: THREE.Scene, private readonly wake?: WakeField) {
    this.group.name = 'player-launch';
    this.group.rotation.order = 'YXZ';
    this.motor = buildLaunchModel(this.group).motor;
    scene.add(this.group);
    this.reset();
  }

  get x() { return this.group.position.x; }
  get z() { return this.group.position.z; }

  reset() {
    this.group.position.set(MOOR_X, conditions.level, MOOR_Z);
    this.group.rotation.set(0, MOOR_HEADING, 0);
    this.heading = MOOR_HEADING;
    this.speed = 0;
    this.distance = 0;
    this.wakeDistance = 0;
  }

  private navigable(x: number, z: number, h: number) {
    if (x < -2200 || x > 2800) return false;
    const fx = Math.cos(h);
    const fz = -Math.sin(h);
    const rx = Math.sin(h);
    const rz = Math.cos(h);
    const dockX = (DOCK.minX + DOCK.maxX) / 2;
    const dockZ = (DOCK.minZ + DOCK.maxZ) / 2;
    const dockHalfX = (DOCK.maxX - DOCK.minX) / 2 + 0.5;
    const dockHalfZ = (DOCK.maxZ - DOCK.minZ) / 2 + 0.1;
    const offsetX = x - dockX;
    const offsetZ = z - dockZ;
    if (
      Math.abs(offsetX) <= dockHalfX + Math.abs(fx) * this.halfLen + Math.abs(rx) * this.halfBeam &&
      Math.abs(offsetZ) <= dockHalfZ + Math.abs(fz) * this.halfLen + Math.abs(rz) * this.halfBeam &&
      Math.abs(offsetX * fx + offsetZ * fz) <= this.halfLen + dockHalfX * Math.abs(fx) + dockHalfZ * Math.abs(fz) &&
      Math.abs(offsetX * rx + offsetZ * rz) <= this.halfBeam + dockHalfX * Math.abs(rx) + dockHalfZ * Math.abs(rz)
    ) return false;
    for (const [pileX, pileZ] of DOCK_PILES) {
      const along = (pileX - x) * fx + (pileZ - z) * fz;
      const across = (pileX - x) * rx + (pileZ - z) * rz;
      if (Math.abs(along) < this.halfLen + 0.42 && Math.abs(across) < this.halfBeam + 0.42) return false;
    }
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      const px = x + fx * this.halfLen * a + rx * this.halfBeam * b;
      const pz = z + fz * this.halfLen * a + rz * this.halfBeam * b;
      if (channelDepthDist(px, pz) < 2 || terrainHeight(px, pz) + 0.43 >= conditions.level) return false;
    }
    return true;
  }

  update(dt: number, time: number, forward: number, steer: number, active: boolean) {
    if (active) {
      const target = Math.max(-1, Math.min(1, forward)) * (forward < 0 ? 2 : 6);
      this.speed += (target - this.speed) * Math.min(1, dt / (forward ? 1.2 : 2.5));
      if (Math.abs(this.speed) < 0.01) this.speed = 0;
      const direction = this.speed < -0.05 ? -1 : 1;
      const turn = Math.max(-1, Math.min(1, steer)) * 0.52 * direction * Math.min(1, Math.abs(this.speed) / 2);
      const nextHeading = this.heading + turn * dt;
      const dx = (Math.cos(nextHeading) * this.speed + conditions.current.x) * dt;
      const dz = (-Math.sin(nextHeading) * this.speed + conditions.current.y) * dt;
      const nx = this.x + dx;
      const nz = this.z + dz;
      if (this.navigable(nx, nz, nextHeading)) {
        this.heading = nextHeading;
        this.group.position.x = nx;
        this.group.position.z = nz;
        const moved = Math.hypot(dx, dz);
        this.distance += moved;
        this.wakeDistance += Math.abs(this.speed) * dt;
        if (this.wake && this.wakeDistance > 1.5 && Math.abs(this.speed) > 0.5) {
          this.wakeDistance %= 1.5;
          this.wake.kelvin(
            this.x - Math.cos(this.heading) * 1.8,
            this.z + Math.sin(this.heading) * 1.8,
            this.heading,
            Math.abs(this.speed), 18, 1.1, 0.24,
          );
        }
      } else {
        this.speed = 0;
      }
      this.motor.rotation.y = -turn * 0.8;
    } else {
      this.speed = 0;
      this.motor.rotation.y = 0;
    }
    this.group.position.y = conditions.level + 0.018 * Math.sin(time * 1.8);
    this.group.rotation.set(0.012 * Math.sin(time * 1.1), this.heading, 0.008 * Math.sin(time * 2.3));
  }

  applyCamera(camera: THREE.PerspectiveCamera) {
    const c = Math.cos(this.heading);
    const s = Math.sin(this.heading);
    _cam.set(this.x - c * 8 + s * 2, this.group.position.y + 4, this.z + s * 8 + c * 2);
    camera.position.lerp(_cam, 0.15);
    _target.set(this.x + c * 2, this.group.position.y + 0.5, this.z - s * 2);
    camera.lookAt(_target);
  }
}
