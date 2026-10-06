import * as THREE from 'three';
import { conditions } from '../../sim/conditions';
import { blobTexture } from '../../textures';

const N = 1400;
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** Pooled, instanced foam/wash streaks drifting with the current. One draw call for all traffic wakes. */
export class WakeField {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(N);
  private pz = new Float32Array(N);
  private vx = new Float32Array(N);
  private vz = new Float32Array(N);
  private yaw = new Float32Array(N);
  private age = new Float32Array(N);
  private life = new Float32Array(N);
  private sx0 = new Float32Array(N);
  private sx1 = new Float32Array(N);
  private sz0 = new Float32Array(N);
  private sz1 = new Float32Array(N);
  private a0 = new Float32Array(N);
  private next = 0;

  constructor(parent: THREE.Object3D) {
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      map: blobTexture(),
      color: '#dbe7ec',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, N);
    this.mesh.name = 'traffic-wakes';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(0, 0, 0));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    this.mesh.count = 0;
    this.age.fill(1);
    this.life.fill(1);
    parent.add(this.mesh);
  }

  emit(x: number, z: number, vx: number, vz: number, yaw: number, life: number, sx0: number, sx1: number, sz0: number, sz1: number, alpha: number) {
    const i = this.next;
    this.next = (this.next + 1) % N;
    this.px[i] = x;
    this.pz[i] = z;
    this.vx[i] = vx;
    this.vz[i] = vz;
    this.yaw[i] = yaw;
    this.age[i] = 0;
    this.life[i] = life;
    this.sx0[i] = sx0;
    this.sx1[i] = sx1;
    this.sz0[i] = sz0;
    this.sz1[i] = sz1;
    this.a0[i] = alpha;
  }

  /** Divergent Kelvin-wake arms (19.47° half-angle) from a hull moving at `speed`. */
  kelvin(x: number, z: number, heading: number, speed: number, life: number, width: number, alpha: number) {
    const lat = speed * 0.354;
    const rx = Math.sin(heading);
    const rz = Math.cos(heading);
    for (const s of [-1, 1]) {
      this.emit(x, z, rx * lat * s, rz * lat * s, heading - s * 0.34, life, width * 1.6, width * 3.2, width * 0.35, width * 1.4, alpha);
    }
  }

  update(dt: number) {
    const cx = conditions.current.x;
    const cz = conditions.current.y;
    const y = conditions.level + 0.035;
    let k = 0;
    for (let i = 0; i < N; i++) {
      if (this.age[i] >= this.life[i]) continue;
      this.age[i] += dt;
      const t = this.age[i] / this.life[i];
      if (t >= 1) continue;
      const damp = Math.exp(-this.age[i] * 0.25);
      this.px[i] += (this.vx[i] * damp + cx) * dt;
      this.pz[i] += (this.vz[i] * damp + cz) * dt;
      const e = 1 - (1 - t) * (1 - t);
      _p.set(this.px[i], y, this.pz[i]);
      _q.setFromAxisAngle(UP, this.yaw[i]);
      _s.set(this.sx0[i] + (this.sx1[i] - this.sx0[i]) * e, 1, this.sz0[i] + (this.sz1[i] - this.sz0[i]) * e);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(k, _m);
      const a = this.a0[i] * Math.min(1, this.age[i] * 4) * (1 - t) * (1 - t);
      this.mesh.setColorAt(k, _c.setRGB(a, a, a));
      k++;
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }
}
