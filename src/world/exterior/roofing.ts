import * as THREE from 'three';
import { DORMER, EAVE, EAVE_OVER, ENTRY, RIDGE_Y, RIDGE_Z, SLOPE, X0, X1, Y0, ZF, ZW, CMU_H } from '../boathouseDims';
import { extMats } from './extMats';
import { Batch, v3 } from './geo';

const SEAM = 0.457; // 18 in standing-seam panels
const _m = new THREE.Matrix4();

/** Instanced standing seams on a roof box of size sx * thick * sz. `alongZ`: seams run along local z (the slope), spaced across x. */
export function addSeams(roof: THREE.Mesh, sx: number, sz: number, thick: number, alongZ: boolean) {
  const span = alongZ ? sx : sz;
  const n = Math.floor(span / SEAM);
  const geo = alongZ ? new THREE.BoxGeometry(0.025, 0.04, sz) : new THREE.BoxGeometry(sx, 0.04, 0.025);
  const im = new THREE.InstancedMesh(geo, extMats().seam, n);
  for (let i = 0; i < n; i++) {
    const o = -span / 2 + (span - (n - 1) * SEAM) / 2 + i * SEAM;
    im.setMatrixAt(i, alongZ ? _m.makeTranslation(o, thick / 2 + 0.02, 0) : _m.makeTranslation(0, thick / 2 + 0.02, o));
  }
  im.receiveShadow = true;
  roof.add(im);
}

/** K-style gutter profile (outward a, up b). */
function gutterGeo(len: number) {
  const s = new THREE.Shape();
  const pts: [number, number][] = [
    [0, 0],
    [0.095, 0],
    [0.12, 0.025],
    [0.12, 0.05],
    [0.145, 0.08],
    [0.145, 0.135],
    [0.158, 0.145],
    [0, 0.145],
  ];
  s.moveTo(pts[0][0], pts[0][1]);
  for (const [a, b] of pts.slice(1)) s.lineTo(a, b);
  s.closePath();
  return new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false, steps: 1 });
}

/** Downspout from a gutter outlet down a wall, with offset elbows, straps, kick-out and splash block. */
function downspout(b: Batch, straps: Batch, conc: Batch, pts: THREE.Vector3[], alongWallX: boolean) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    const vertical = Math.abs(a.x - c.x) < 1e-3 && Math.abs(a.z - c.z) < 1e-3;
    if (vertical) {
      b.beam(a, c, alongWallX ? 0.075 : 0.1, alongWallX ? 0.1 : 0.075);
      const len = a.distanceTo(c);
      for (let d = 0.5; d < len - 0.2; d += 1.8) {
        const y = Math.min(a.y, c.y) + d;
        straps.box(alongWallX ? 0.13 : 0.1, 0.025, alongWallX ? 0.1 : 0.13, a.x, y, a.z);
      }
    } else b.beam(a, c, 0.1, 0.075);
  }
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const dx = last.x - prev.x;
  const dz = last.z - prev.z;
  const l = Math.hypot(dx, dz) || 1;
  conc.box(Math.abs(dx) > Math.abs(dz) ? 0.6 : 0.3, 0.05, Math.abs(dx) > Math.abs(dz) ? 0.3 : 0.6, last.x + (dx / l) * 0.35, Y0 + 0.025, last.z + (dz / l) * 0.35);
}

export function buildRoofTrim(root: THREE.Group) {
  const E = extMats();
  const run = RIDGE_Z - ZW + EAVE_OVER;
  const yE = RIDGE_Y - run * SLOPE;
  const xe = X1 + 0.7;
  const bronze = new Batch();
  const straps = new Batch();
  const conc = new Batch();

  // fascia with drip edge and boxed soffit on both eaves
  for (const s of [-1, 1]) {
    const zE = s < 0 ? ZW - EAVE_OVER : ZF + EAVE_OVER;
    bronze.box(2 * xe, 0.3, 0.12, 0, yE - 0.05, zE);
    bronze.box(2 * xe, 0.03, 0.03, 0, yE + 0.11, zE + s * 0.07);
    const zw = s < 0 ? ZW : ZF;
    bronze.box(2 * xe, 0.02, EAVE_OVER - 0.06, 0, yE - 0.19, (zw + zE) / 2 - s * 0.03);
  }
  // gutters
  const gutters: [number, number, number][] = [
    [-xe, xe, -1],
    [-xe, -ENTRY.run, 1],
    [ENTRY.run, xe, 1],
  ];
  for (const [a, c, s] of gutters) {
    const zFace = s < 0 ? ZW - EAVE_OVER - 0.06 : ZF + EAVE_OVER + 0.06;
    if (s < 0) bronze.add(gutterGeo(c - a), a, yE - 0.085, zFace, 0, Math.PI / 2, 0);
    else bronze.add(gutterGeo(c - a), c, yE - 0.085, zFace, 0, -Math.PI / 2, 0);
  }
  // rakes on the main gables, entry gable and dormer
  for (const x of [-xe - 0.02, xe + 0.02]) {
    for (const s of [-1, 1]) {
      const zE = RIDGE_Z + s * run;
      bronze.beam(v3(x, yE + 0.04, zE), v3(x, RIDGE_Y + 0.08, RIDGE_Z), 0.05, 0.32);
    }
  }
  const eTop = EAVE + 6 * ENTRY.slope + 0.07;
  for (const s of [-1, 1]) {
    bronze.beam(v3(s * ENTRY.run, eTop - ENTRY.run * ENTRY.slope, ENTRY.zFront + 0.02), v3(0, eTop, ENTRY.zFront + 0.02), 0.05, 0.3);
  }
  bronze.box(0.42, 0.14, ENTRY.zFront - ENTRY.zBack, 0, eTop + 0.1, (ENTRY.zFront + ENTRY.zBack) / 2);
  const dRun = DORMER.half + DORMER.over;
  const dTop = EAVE + DORMER.half * DORMER.slope + 0.05;
  for (const s of [-1, 1]) {
    bronze.beam(v3(DORMER.x + s * dRun, dTop - dRun * DORMER.slope, DORMER.z0 - 0.02), v3(DORMER.x, dTop, DORMER.z0 - 0.02), 0.05, 0.28);
  }
  bronze.box(0.4, 0.13, DORMER.len, DORMER.x, dTop + 0.09, DORMER.z0 + DORMER.len / 2);

  // through-wall flashing where the board-and-batten upper floor sits on the CMU, and siding corner boards
  const yF = Y0 + CMU_H + 0.04;
  const hb = (x0: number, x1: number, z: number) => bronze.box(x1 - x0, 0.08, 0.05, (x0 + x1) / 2, yF, z);
  const vb = (z0: number, z1: number, x: number) => bronze.box(0.05, 0.08, z1 - z0, x, yF, (z0 + z1) / 2);
  hb(X0, 17.15, ZW - 0.025);
  hb(21.25, X1, ZW - 0.025);
  hb(X0, ENTRY.x0, ZF + 0.025);
  hb(ENTRY.x1, X1, ZF + 0.025);
  hb(ENTRY.x0, -2.75, ENTRY.z + 0.025);
  hb(2.75, ENTRY.x1, ENTRY.z + 0.025);
  vb(ZF, ENTRY.z, ENTRY.x0 - 0.025);
  vb(ZF, ENTRY.z, ENTRY.x1 + 0.025);
  vb(ZW, ZF, X0 - 0.025);
  vb(ZW, ZF, X1 + 0.025);
  const cH = EAVE - (Y0 + CMU_H);
  const cy = Y0 + CMU_H + cH / 2;
  for (const [x, z, sx, sz] of [
    [X0, ZW, -1, -1],
    [X1, ZW, 1, -1],
    [X0, ZF, -1, 1],
    [X1, ZF, 1, 1],
    [ENTRY.x0, ENTRY.z, -1, 1],
    [ENTRY.x1, ENTRY.z, 1, 1],
  ] as const) {
    bronze.box(0.14, cH, 0.03, x + sx * 0.055, cy, z + sz * 0.015);
    bronze.box(0.03, cH, 0.14, x + sx * 0.015, cy, z + sz * 0.055);
  }

  // downspouts
  const yG = yE - 0.085;
  const zgW = ZW - EAVE_OVER - 0.13;
  const zgS = ZF + EAVE_OVER + 0.13;
  downspout(bronze, straps, conc, [v3(23.6, yG, zgW), v3(23.6, yG - 0.15, zgW), v3(23.6, yG - 0.7, ZW - 0.06), v3(23.6, Y0 + 0.3, ZW - 0.06), v3(23.6, Y0 + 0.07, ZW - 0.36)], false);
  downspout(bronze, straps, conc, [v3(-24.5, yG, zgW), v3(-24.5, yG - 0.15, zgW), v3(-24.08, yG - 0.85, 12.3), v3(-24.08, Y0 + 0.3, 12.3), v3(-24.38, Y0 + 0.07, 12.3)], true);
  for (const x of [-23.6, -7.0, 7.0, 23.6]) {
    downspout(bronze, straps, conc, [v3(x, yG, zgS), v3(x, yG - 0.15, zgS), v3(x, yG - 0.7, ZF + 0.06), v3(x, Y0 + 0.3, ZF + 0.06), v3(x, Y0 + 0.07, ZF + 0.36)], false);
  }

  root.add(bronze.mesh(E.bronze, true, true));
  root.add(straps.mesh(E.bronze, false, false));
  root.add(conc.mesh(E.concrete, false, true));
}
