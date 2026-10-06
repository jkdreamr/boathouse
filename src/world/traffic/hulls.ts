import * as THREE from 'three';

/** Small-craft hull lofted from cross-sections: stern (u = 0) to bow (u = 1), waterline at y = 0, bow at +x. */
export interface Loft {
  length: number;
  beam: number;
  draft: number;
  freeboard: number;
  /** Transom half-beam as a fraction of max beam (0 = double-ender). */
  transom: number;
  /** Extra sheer height at the bow. */
  bowRise: number;
  /** Cross-section exponent: < 1 flat-bottomed, 1 round, > 1 V. */
  section: number;
  /** Position of max beam, 0..1 from the stern. */
  maxAt: number;
}

export function loftHalfBeam(s: Loft, u: number) {
  const m = s.maxAt;
  if (u >= m) {
    const t = (u - m) / (1 - m);
    return (s.beam / 2) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), 0.7);
  }
  const t = (m - u) / m;
  if (s.transom <= 0) return (s.beam / 2) * Math.pow(Math.max(0, 1 - Math.pow(t, 2.1)), 0.7);
  return (s.beam / 2) * (1 - (1 - s.transom) * t * t);
}

export function loftGunwale(s: Loft, u: number) {
  const b = Math.max(0, (u - 0.55) / 0.45);
  return s.freeboard + s.bowRise * b * b;
}

function loftKeel(s: Loft, u: number) {
  return u > 0.45 ? s.draft * (1 - 0.85 * ((u - 0.45) / 0.55) ** 2) : s.draft * (1 - (s.transom > 0 ? 0.2 : 0.85) * ((0.45 - u) / 0.45) ** 2);
}

export const loftX = (s: Loft, u: number) => (u - 0.5) * s.length;

export function loftGeometry(s: Loft, stations = 28, around = 12) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const u = i / stations;
    const x = loftX(s, u);
    const hb = loftHalfBeam(s, u);
    const g = loftGunwale(s, u);
    const dk = loftKeel(s, u);
    for (let j = 0; j <= around; j++) {
      const th = -Math.PI / 2 + (Math.PI * j) / around;
      pos.push(x, g - (g + dk) * Math.pow(Math.cos(th), s.section), hb * Math.sin(th));
    }
  }
  const row = around + 1;
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  if (s.transom > 0) {
    const c = pos.length / 3;
    pos.push(loftX(s, 0), (loftGunwale(s, 0) - loftKeel(s, 0)) / 2, 0);
    for (let j = 0; j < around; j++) idx.push(c, j + 1, j);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat deck/floor between the gunwales over u0..u1, lowered by `drop`. */
export function loftDeck(s: Loft, u0: number, u1: number, drop = 0, inset = 0, n = 16) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const hb = Math.max(0, loftHalfBeam(s, u) - inset);
    const g = loftGunwale(s, u) - drop + 0.004;
    pos.push(loftX(s, u), g, -hb, loftX(s, u), g + 0.01, 0, loftX(s, u), g, hb);
  }
  for (let i = 0; i < n; i++) {
    const a = i * 3;
    const b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Rub rail / gunwale tube following the sheer on both sides. */
export function loftRail(s: Loft, r: number, n = 24) {
  const geos: THREE.BufferGeometry[] = [];
  for (const side of [-1, 1]) {
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= n; i++) {
      const u = 0.002 + (0.996 * i) / n;
      pts.push(new THREE.Vector3(loftX(s, u), loftGunwale(s, u), side * loftHalfBeam(s, u)));
    }
    geos.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n * 2, r, 5));
  }
  return geos;
}

export function std(color: string, roughness = 0.6, metalness = 0, side: THREE.Side = THREE.FrontSide) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness, side });
}

export function addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, cast = false) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast;
  parent.add(m);
  return m;
}
