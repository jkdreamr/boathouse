import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);

/** Collects many small primitives in world (or parent-local) space and merges them into one mesh per material. */
export class Batch {
  private parts: THREE.BufferGeometry[] = [];

  add(g: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, order: THREE.EulerOrder = 'XYZ') {
    _e.set(rx, ry, rz, order);
    g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    this.parts.push(g);
    return this;
  }

  box(w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, order: THREE.EulerOrder = 'XYZ') {
    return this.add(new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz, order);
  }

  /** Axis-aligned box from min/max corners. */
  aabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    return this.box(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  }

  /** Cylinder (or square tube with seg = 4) running from a to b. */
  rod(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 8, r2 = r) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r2, r, len, seg, 1, false);
    _d.subVectors(b, a).normalize();
    _q.setFromUnitVectors(_up, _d);
    g.applyMatrix4(_m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q, _s.set(1, 1, 1)));
    this.parts.push(g);
    return this;
  }

  /** Box of section w x h whose length runs from a to b (local y of the section stays as close to world up as possible). */
  beam(a: THREE.Vector3, b: THREE.Vector3, w: number, h: number) {
    const len = a.distanceTo(b);
    const g = new THREE.BoxGeometry(len, h, w);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const yaw = Math.atan2(-dz, dx);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    _e.set(0, yaw, pitch, 'YZX');
    g.applyMatrix4(_m.compose(_p.addVectors(a, b).multiplyScalar(0.5), _q.setFromEuler(_e), _s.set(1, 1, 1)));
    this.parts.push(g);
    return this;
  }

  get empty() {
    return this.parts.length === 0;
  }

  geometry() {
    const anyNonIndexed = this.parts.some((p) => !p.index);
    const ps = this.parts.map((p) => {
      const g = anyNonIndexed && p.index ? p.toNonIndexed() : p;
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(ps)!;
    merged.computeBoundingSphere();
    return merged;
  }

  mesh(mat: THREE.Material, cast = true, receive = true) {
    const m = new THREE.Mesh(this.geometry(), mat);
    m.castShadow = cast;
    m.receiveShadow = receive;
    return m;
  }
}

export function v3(x: number, y: number, z: number) {
  return new THREE.Vector3(x, y, z);
}

export function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
