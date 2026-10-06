import * as THREE from 'three';

export const INBOARD = 1.15;
export const OUTBOARD = 2.59;
export const BLADE_CENTER = OUTBOARD - 0.25;

const shaftMat = new THREE.MeshStandardMaterial({ color: '#f1f1ee', roughness: 0.35, metalness: 0.1 });
const gripMat = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9 });
const bladeMat = new THREE.MeshStandardMaterial({ color: '#8c1515', roughness: 0.35, side: THREE.DoubleSide });
const tipMat = new THREE.MeshStandardMaterial({ color: '#f5f5f2', roughness: 0.35, side: THREE.DoubleSide });
const collarMat = new THREE.MeshStandardMaterial({ color: '#d8d6d0', roughness: 0.5 });

let geoCache: { shaft: THREE.BufferGeometry; grip: THREE.BufferGeometry; collar: THREE.BufferGeometry; blade: THREE.BufferGeometry; tip: THREE.BufferGeometry } | null = null;

function geos() {
  if (geoCache) return geoCache;
  const shaft = new THREE.CylinderGeometry(0.019, 0.021, INBOARD + OUTBOARD - 0.5, 8);
  shaft.rotateZ(-Math.PI / 2);
  shaft.translate((-INBOARD + OUTBOARD - 0.5) / 2, 0, 0);
  const grip = new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8);
  grip.rotateZ(-Math.PI / 2);
  grip.translate(-INBOARD + 0.15, 0, 0);
  const collar = new THREE.CylinderGeometry(0.035, 0.035, 0.12, 10);
  collar.rotateZ(-Math.PI / 2);
  collar.translate(0.02, 0, 0);
  const x0 = OUTBOARD - 0.52;
  // cleaver ("hatchet") blade hanging below the shaft line
  const s = new THREE.Shape();
  s.moveTo(x0, 0.02);
  s.lineTo(OUTBOARD - 0.13, 0.035);
  s.lineTo(OUTBOARD - 0.13, -0.21);
  s.lineTo(x0 + 0.2, -0.17);
  s.quadraticCurveTo(x0 + 0.05, -0.1, x0, -0.015);
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: false });
  blade.translate(0, 0, -0.004);
  const t = new THREE.Shape();
  t.moveTo(OUTBOARD - 0.13, 0.035);
  t.lineTo(OUTBOARD, 0.035);
  t.lineTo(OUTBOARD, -0.2);
  t.quadraticCurveTo(OUTBOARD - 0.04, -0.222, OUTBOARD - 0.13, -0.21);
  const tip = new THREE.ExtrudeGeometry(t, { depth: 0.008, bevelEnabled: false });
  tip.translate(0, 0, -0.004);
  geoCache = { shaft, grip, collar, blade, tip };
  return geoCache;
}

/** Sweep oar with the pin (collar) at the origin and the shaft along +x; blade hangs toward -y when squared. */
export function makeOarMesh() {
  const g = geos();
  const o = new THREE.Group();
  for (const [geo, mat] of [
    [g.shaft, shaftMat],
    [g.grip, gripMat],
    [g.collar, collarMat],
    [g.blade, bladeMat],
    [g.tip, tipMat],
  ] as const) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    o.add(m);
  }
  return o;
}
