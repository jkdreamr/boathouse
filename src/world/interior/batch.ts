import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Static-geometry batcher: collects transformed geometry per material and merges it into
 * one mesh per material on flush, so hundreds of props cost a handful of draw calls.
 * Use frame() to build props in local coordinates.
 */
export class Batch {
  private buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  private tmp = new THREE.Matrix4();
  private e = new THREE.Euler();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  get top() {
    return this.stack[this.stack.length - 1];
  }

  /** Run fn with a local frame translated to (x,y,z) and rotated by ry about +y (then rx, rz). */
  frame(x: number, y: number, z: number, ry: number, fn: () => void, rx = 0, rz = 0) {
    this.e.set(rx, ry, rz, 'YXZ');
    this.q.setFromEuler(this.e);
    const m = new THREE.Matrix4().compose(this.v.set(x, y, z), this.q, this.s.set(1, 1, 1));
    this.stack.push(this.top.clone().multiply(m));
    try {
      fn();
    } finally {
      this.stack.pop();
    }
  }

  /** Add geo (not mutated) transformed by local matrix m (in the current frame). */
  add(geo: THREE.BufferGeometry, mat: THREE.Material, m?: THREE.Matrix4) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.morphAttributes = {};
    g.clearGroups();
    this.tmp.copy(this.top);
    if (m) this.tmp.multiply(m);
    g.applyMatrix4(this.tmp);
    let list = this.buckets.get(mat);
    if (!list) this.buckets.set(mat, (list = []));
    list.push(g);
    if (g !== geo && geo.userData.batchTemp) geo.dispose();
    return this;
  }

  /** Box of size w×h×d centred at (x,y,z) in the current frame, rotated ry about +y. */
  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0) {
    return this.add(unitBox, mat, xform(x, y, z, ry, w, h, d, rx, rz));
  }

  /** Cylinder along local +y, radius r (or rTop/rBot), height h, centred at (x,y,z); rx/rz tilt it. */
  cyl(mat: THREE.Material, r: number, h: number, x: number, y: number, z: number, rx = 0, rz = 0, seg = 12, rBot = r, ry = 0) {
    const g = new THREE.CylinderGeometry(r, rBot, h, seg);
    g.userData.batchTemp = true;
    return this.add(g, mat, xform(x, y, z, ry, 1, 1, 1, rx, rz));
  }

  /** Thin tube between two local points. */
  tube(mat: THREE.Material, r: number, a: THREE.Vector3, b: THREE.Vector3, seg = 8) {
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(r, r, len, seg);
    g.userData.batchTemp = true;
    const dir = this.v.copy(b).sub(a).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const m = new THREE.Matrix4().compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1));
    return this.add(g, mat, m);
  }

  /** Flat quad of size w×h in the local XY plane (facing +z), centred at (x,y,z), rotated ry. */
  quad(mat: THREE.Material, w: number, h: number, x: number, y: number, z: number, ry = 0, rx = 0) {
    return this.add(unitQuad, mat, xform(x, y, z, ry, w, h, 1, rx, 0));
  }

  /** Merge everything into one mesh per material and add them to parent. */
  flush(parent: THREE.Object3D, opts: { cast?: boolean; receive?: boolean; name?: string } = {}) {
    const out: THREE.Mesh[] = [];
    for (const [mat, list] of this.buckets) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      if (!merged) continue;
      merged.computeBoundingSphere();
      const m = new THREE.Mesh(merged, mat);
      m.castShadow = opts.cast ?? false;
      m.receiveShadow = opts.receive ?? true;
      m.matrixAutoUpdate = false;
      if (opts.name) m.name = opts.name;
      parent.add(m);
      out.push(m);
    }
    this.buckets.clear();
    return out;
  }
}

const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitQuad = new THREE.PlaneGeometry(1, 1);

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();
export function xform(x: number, y: number, z: number, ry: number, sx: number, sy: number, sz: number, rx = 0, rz = 0) {
  _e.set(rx, ry, rz, 'YXZ');
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), _q, new THREE.Vector3(sx, sy, sz));
}
