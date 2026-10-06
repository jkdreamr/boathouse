import * as THREE from 'three';

export interface HullSpec {
  length: number;
  beam: number;
  draft: number;
  freeboard: number;
}

export const EIGHT: HullSpec = { length: 17.6, beam: 0.58, draft: 0.17, freeboard: 0.2 };
export const FOUR: HullSpec = { length: 13.4, beam: 0.5, draft: 0.15, freeboard: 0.18 };
export const PAIR: HullSpec = { length: 10.2, beam: 0.36, draft: 0.12, freeboard: 0.16 };

export function halfBeam(spec: HullSpec, x: number) {
  const t = (2 * x) / spec.length;
  const p = t > 0 ? 1.7 : 2.3;
  return (spec.beam / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), p)), 0.85);
}

export function gunwaleY(spec: HullSpec, x: number) {
  const t = (2 * x) / spec.length;
  return spec.freeboard * (0.75 + 0.25 * (1 - t * t)) + 0.04 * t * t;
}

/** Open racing-shell hull: bow at +x, waterline at y = 0. */
export function hullGeometry(spec: HullSpec, stations = 72, around = 18) {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const t = -1 + (2 * i) / stations;
    const x = (t * spec.length) / 2;
    const hb = halfBeam(spec, x);
    const g = gunwaleY(spec, x);
    const dk = spec.draft * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(t), 2.6)), 0.55);
    for (let j = 0; j <= around; j++) {
      const th = -Math.PI / 2 + (Math.PI * j) / around;
      const c = Math.cos(th);
      pos.push(x, g - (g + dk) * Math.pow(c, 0.8), hb * Math.sin(th));
      uv.push(i / stations, j / around);
    }
  }
  const row = around + 1;
  for (let i = 0; i < stations; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/** Flat deck between the gunwales from x0 to x1. */
export function deckGeometry(spec: HullSpec, x0: number, x1: number, n = 24) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + ((x1 - x0) * i) / n;
    const hb = halfBeam(spec, x) + 0.002;
    const g = gunwaleY(spec, x) + 0.004;
    pos.push(x, g, -hb, x, g + 0.012, 0, x, g, hb);
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

/** Hull + decks merged, for stored boats on racks (closed deck so it reads as a shell from any angle). */
export function storedHullGeometry(spec: HullSpec) {
  return hullGeometry(spec, 48, 12);
}
