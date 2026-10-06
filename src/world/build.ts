import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface Opening {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  /** rise of a round/segmental top above v1 (0 = rectangular) */
  arch?: number;
  cols?: number;
  rows?: number;
  /** true = open doorway (no glass) */
  open?: boolean;
  glass?: THREE.Material;
}

/** Quad in the wall's local plane (normal +z) with UVs in meters. */
export function rectGeo(u0: number, v0: number, u1: number, v1: number) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([u0, v0, 0, u1, v0, 0, u1, v1, 0, u0, v1, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, v0, u1, v0, u1, v1, u0, v1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  return g;
}

/** A wall made of rectangles around rectangular openings (openings may touch the bottom/top edge). */
export function rectWallGeo(len: number, h: number, openings: Opening[]) {
  const os = [...openings].sort((a, b) => a.u0 - b.u0);
  const parts: THREE.BufferGeometry[] = [];
  let u = 0;
  for (const o of os) {
    if (o.u0 > u) parts.push(rectGeo(u, 0, o.u0, h));
    if (o.v0 > 0) parts.push(rectGeo(o.u0, 0, o.u1, o.v0));
    if (o.v1 < h) parts.push(rectGeo(o.u0, Math.min(h, o.v1), o.u1, h));
    u = o.u1;
  }
  if (u < len) parts.push(rectGeo(u, 0, len, h));
  return mergeGeometries(parts)!;
}

export function archPoints(o: Opening, n = 16): THREE.Vector2[] {
  const w = o.u1 - o.u0;
  const rise = o.arch ?? 0;
  const cu = (o.u0 + o.u1) / 2;
  if (rise <= 0) return [new THREE.Vector2(o.u0, o.v0), new THREE.Vector2(o.u1, o.v0), new THREE.Vector2(o.u1, o.v1), new THREE.Vector2(o.u0, o.v1)];
  const R = (w * w) / 4 / (2 * rise) + rise / 2;
  const cv = o.v1 + rise - R;
  const a0 = Math.atan2(o.v1 - cv, w / 2);
  const pts = [new THREE.Vector2(o.u0, o.v0), new THREE.Vector2(o.u1, o.v0)];
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((Math.PI - 2 * a0) * i) / n;
    pts.push(new THREE.Vector2(cu + Math.cos(a) * R, cv + Math.sin(a) * R));
  }
  return pts;
}

/** Height of an arched opening's top at horizontal position u. */
export function archTop(o: Opening, u: number) {
  const rise = o.arch ?? 0;
  if (rise <= 0) return o.v1;
  const w = o.u1 - o.u0;
  const cu = (o.u0 + o.u1) / 2;
  const R = (w * w) / 4 / (2 * rise) + rise / 2;
  const cv = o.v1 + rise - R;
  const du = u - cu;
  return cv + Math.sqrt(Math.max(0, R * R - du * du));
}

export function shapeWallGeo(outline: THREE.Vector2[], holes: THREE.Vector2[][] = []) {
  const s = new THREE.Shape(outline);
  for (const h of holes) s.holes.push(new THREE.Path(h));
  return new THREE.ShapeGeometry(s, 12);
}

const bar = new THREE.BoxGeometry(1, 1, 1);

/** Frame, mullions and glass for an opening, in wall-local coordinates. */
export function windowParts(o: Opening, frameMat: THREE.Material, glassMat: THREE.Material, depth = 0.12) {
  const g = new THREE.Group();
  const t = 0.09;
  const addBar = (u0: number, v0: number, u1: number, v1: number, d = depth, z = -d / 2 + 0.02) => {
    const m = new THREE.Mesh(bar, frameMat);
    m.scale.set(Math.max(0.001, Math.abs(u1 - u0)), Math.max(0.001, Math.abs(v1 - v0)), d);
    m.position.set((u0 + u1) / 2, (v0 + v1) / 2, z);
    m.castShadow = true;
    g.add(m);
  };
  const cols = o.cols ?? 1;
  const rows = o.rows ?? 1;
  const w = o.u1 - o.u0;
  // jambs and sill
  addBar(o.u0 - t / 2, o.v0, o.u0 + t / 2, archTop(o, o.u0 + t / 2), 0.3, -0.13);
  addBar(o.u1 - t / 2, o.v0, o.u1 + t / 2, archTop(o, o.u1 - t / 2), 0.3, -0.13);
  if (o.v0 > 0.01) addBar(o.u0, o.v0 - t / 2, o.u1, o.v0 + t / 2, 0.3, -0.13);
  if (!o.arch) addBar(o.u0, o.v1 - t / 2, o.u1, o.v1 + t / 2, 0.3, -0.13);
  else {
    const pts = archPoints(o, 14).slice(2);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const m = new THREE.Mesh(bar, frameMat);
      const len = a.distanceTo(b) + 0.02;
      m.scale.set(len, t, 0.3);
      m.position.set((a.x + b.x) / 2, (a.y + b.y) / 2, -0.13);
      m.rotation.z = Math.atan2(b.y - a.y, b.x - a.x);
      g.add(m);
    }
  }
  if (o.open) return g;
  for (let i = 1; i < cols; i++) {
    const u = o.u0 + (w * i) / cols;
    addBar(u - 0.035, o.v0, u + 0.035, archTop(o, u), 0.07, -0.08);
  }
  const top = o.v1 + (o.arch ?? 0);
  const step = (top - o.v0) / rows;
  for (let j = 1; j < rows; j++) {
    const v = o.v0 + step * j;
    if (v >= top - 0.05) break;
    let u0 = o.u0;
    let u1 = o.u1;
    if (v > o.v1) {
      const rise = o.arch ?? 0;
      const R = (w * w) / 4 / (2 * rise) + rise / 2;
      const cv = o.v1 + rise - R;
      const half = Math.sqrt(Math.max(0, R * R - (v - cv) ** 2));
      u0 = (o.u0 + o.u1) / 2 - half;
      u1 = (o.u0 + o.u1) / 2 + half;
    }
    addBar(u0, v - 0.035, u1, v + 0.035, 0.07, -0.08);
  }
  const glass = new THREE.Mesh(shapeWallGeo(archPoints(o)), o.glass ?? glassMat);
  glass.position.z = -0.1;
  g.add(glass);
  return g;
}

/** Group positioned so local +x runs from p0 to p1 (x,z) and local +z is the outward normal (to the right of travel). */
export function wallFrame(x0: number, z0: number, x1: number, z1: number, y: number) {
  const g = new THREE.Group();
  g.position.set(x0, y, z0);
  g.rotation.y = Math.atan2(-(z1 - z0), x1 - x0);
  return g;
}

/** Orient a unit-Y mesh (cylinder) between two points. */
const _up = new THREE.Vector3(0, 1, 0);
const _d = new THREE.Vector3();
export function between(m: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, radiusScale = 1) {
  _d.subVectors(b, a);
  const len = _d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  if (len > 1e-6) m.quaternion.setFromUnitVectors(_up, _d.divideScalar(len));
  m.scale.set(radiusScale, len, radiusScale);
}

export function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, cast = true, receive = true) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
}
