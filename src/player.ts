import * as THREE from 'three';
import { floorAt, hitsWall } from './world/collide';
import { terrainHeight } from './world/terrain';

const EYE = 1.65;
const RADIUS = 0.3;
const STEP = 0.55;

export class Player {
  pos = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  vy = 0;
  onGround = false;
  private fwd = new THREE.Vector3();
  private right = new THREE.Vector3();
  private move = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {}

  place(x: number, y: number, z: number, yaw: number, pitch = 0) {
    this.pos.set(x, y, z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.vy = 0;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - dy * 0.0022, -1.45, 1.45);
  }

  private ground(x: number, z: number, maxY: number) {
    const f = floorAt(x, z, maxY);
    if (f !== null) return f;
    const t = terrainHeight(x, z);
    return t > 0.05 ? t : null;
  }

  /** Returns true if the player fell into the creek. */
  update(dt: number, keys: Set<string>) {
    const run = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const speed = run ? 7 : 4.2;
    this.fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    this.right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.move.set(0, 0, 0);
    if (keys.has('KeyW') || keys.has('ArrowUp')) this.move.add(this.fwd);
    if (keys.has('KeyS') || keys.has('ArrowDown')) this.move.sub(this.fwd);
    if (keys.has('KeyD') || keys.has('ArrowRight')) this.move.add(this.right);
    if (keys.has('KeyA') || keys.has('ArrowLeft')) this.move.sub(this.right);
    if (this.move.lengthSq() > 0) this.move.normalize().multiplyScalar(speed * dt);

    const p = this.pos;
    const tryAxis = (nx: number, nz: number) => {
      if (hitsWall(nx, nz, RADIUS, p.y, p.y + 1.8)) return false;
      const g = this.ground(nx, nz, p.y + STEP);
      if (g !== null && g > p.y + STEP) return false;
      p.x = nx;
      p.z = nz;
      return true;
    };
    tryAxis(p.x + this.move.x, p.z);
    tryAxis(p.x, p.z + this.move.z);

    const g = this.ground(p.x, p.z, p.y + STEP);
    if (this.onGround && keys.has('Space')) {
      this.vy = 4.2;
      this.onGround = false;
    }
    this.vy -= 18 * dt;
    p.y += this.vy * dt;
    if (g !== null && p.y <= g) {
      p.y = g;
      this.vy = 0;
      this.onGround = true;
    } else if (g !== null && this.onGround && p.y - g < STEP && this.vy <= 0) {
      p.y = g;
      this.vy = 0;
    } else {
      this.onGround = false;
    }
    this.camera.position.set(p.x, p.y + EYE, p.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    return p.y < -1.2;
  }
}
