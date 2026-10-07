import * as THREE from 'three';
import { boxMeters } from '../../textures';
import { addFlatFloor, addRamp, addWall } from '../collide';
import { mesh } from '../build';
import { mats } from '../materials';
import { BALCONY_Y, Y0, ZW } from '../boathouseDims';
import { extMats } from './extMats';
import { Batch, v3 } from './geo';

/** Cantilevered water-side balcony (ends short of the tall sailing-bay glazing, as in the Commons photos). */
export const BALC = { x0: -25.5, x1: 16.4, z0: 9.4 };
/** Straight egress stair at the west end: 32 risers of 175 mm, 280 mm treads, mid landing (IBC 1011.8: <= 12 ft rise per flight). */
export const STAIR = { z0: 9.55, z1: 11.05, risers: 32, run: 0.28, landing: 1.4 };

const GUARD_H = 1.07;

/** Top rail, bottom rail, posts and horizontal stainless cables along a polyline of walking-surface points. */
function guard(steel: Batch, cable: Batch, pts: THREE.Vector3[], maxSpan = 1.5) {
  const up = (p: THREE.Vector3, y: number) => v3(p.x, p.y + y, p.z);
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const c = pts[i + 1];
    steel.beam(up(a, GUARD_H), up(c, GUARD_H), 0.1, 0.05);
    steel.beam(up(a, 0.1), up(c, 0.1), 0.05, 0.04);
    for (let k = 0; k <= 10; k++) {
      const y = 0.18 + k * 0.078;
      cable.beam(up(a, y), up(c, y), 0.006, 0.006);
    }
    const n = Math.max(1, Math.ceil(Math.hypot(c.x - a.x, c.z - a.z) / maxSpan));
    for (let j = 0; j < n; j++) {
      const t = j / n;
      steel.box(0.05, GUARD_H, 0.05, a.x + (c.x - a.x) * t, a.y + (c.y - a.y) * t + GUARD_H / 2, a.z + (c.z - a.z) * t);
    }
  }
  const l = pts[pts.length - 1];
  steel.box(0.05, GUARD_H, 0.05, l.x, l.y + GUARD_H / 2, l.z);
}

export function buildBalcony(root: THREE.Group) {
  const M = mats();
  const E = extMats();
  const { x0: bx0, x1: bx1, z0: bz0 } = BALC;
  const L = bx1 - bx0;
  const cx = (bx0 + bx1) / 2;
  const D = ZW - bz0;
  const slabT = 0.2;
  const slab = mesh(boxMeters(L, slabT, D), M.concrete);
  slab.position.set(cx, BALCONY_Y - slabT / 2, (bz0 + ZW) / 2);
  root.add(slab);

  const steel = new Batch();
  const cable = new Batch();
  const deckY = BALCONY_Y - slabT - 0.075;
  steel.box(L, 0.075, D - 0.1, cx, deckY + 0.0375, (bz0 + ZW) / 2 + 0.03);
  // corrugated deck soffit (flutes span wall -> edge beam)
  const sg = new THREE.PlaneGeometry(L, D - 0.14);
  const uv = sg.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * L, uv.getY(i) * (D - 0.14));
  const soffit = mesh(sg, E.soffit, false, true);
  soffit.rotation.x = Math.PI / 2;
  soffit.position.set(cx, deckY - 0.002, (bz0 + ZW) / 2 + 0.02);
  root.add(soffit);
  // edge channel (fascia), wall ledger, joists, outriggers and knee braces
  steel.box(L, 0.45, 0.08, cx, BALCONY_Y - 0.2, bz0 + 0.04);
  steel.box(L, 0.04, 0.12, cx, BALCONY_Y + 0.01, bz0 + 0.06);
  steel.box(L, 0.3, 0.1, cx, deckY - 0.15, ZW - 0.05);
  for (let x = bx0 + 0.8; x < bx1; x += 1.6) steel.box(0.06, 0.2, D - 0.18, x, deckY - 0.1, (bz0 + ZW) / 2);
  const braces = [-22.6, -14.4, -4.8, 4.8, 14.4];
  for (const x of braces) {
    steel.box(0.16, 0.34, D - 0.08, x, deckY - 0.17, (bz0 + ZW) / 2 + 0.04);
    steel.beam(v3(x, Y0 + 3.95, ZW - 0.08), v3(x, deckY - 0.3, bz0 + 0.35), 0.14, 0.14);
    steel.box(0.32, 0.46, 0.025, x, Y0 + 4.0, ZW - 0.0125);
    steel.box(0.3, 0.025, 0.4, x, deckY - 0.35, bz0 + 0.4);
  }
  // overflow scuppers through the edge channel
  const spout = new Batch();
  for (const x of [-18.5, -9.6, 0, 9.6]) spout.box(0.12, 0.06, 0.18, x, BALCONY_Y - 0.1, bz0 - 0.07);
  // pendant globes under the soffit, between the outriggers
  const lamps = new Batch();
  const lampBase = new Batch();
  for (let i = 0; i < braces.length; i++) {
    const x = i < braces.length - 1 ? (braces[i] + braces[i + 1]) / 2 : (braces[i] + bx1) / 2;
    lamps.add(new THREE.SphereGeometry(0.13, 16, 12), x, deckY - 0.3, 10.9);
    lampBase.add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 12), x, deckY - 0.02, 10.9);
    lampBase.add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), x, deckY - 0.1, 10.9);
  }

  const gz = bz0 + 0.06;
  guard(steel, cable, [v3(bx0 + 0.03, BALCONY_Y, gz), v3(bx1 - 0.04, BALCONY_Y, gz), v3(bx1 - 0.04, BALCONY_Y, ZW - 0.06)]);
  guard(steel, cable, [v3(bx0 + 0.03, BALCONY_Y, STAIR.z1 + 0.1), v3(bx0 + 0.03, BALCONY_Y, ZW - 0.06)]);
  addFlatFloor(bx0, bx1, bz0, ZW, BALCONY_Y);
  addWall(bx0, bx1, bz0 - 0.1, bz0 + 0.12, BALCONY_Y - 0.2, BALCONY_Y + 1.2);
  addWall(bx1 - 0.1, bx1 + 0.4, bz0, ZW, BALCONY_Y - 0.2, BALCONY_Y + 1.2);
  addWall(bx0 - 0.4, bx0 + 0.05, STAIR.z1 + 0.1, ZW, BALCONY_Y - 0.2, BALCONY_Y + 1.2);

  // ---------- stair ----------
  const { z0: sz0, z1: sz1, run: r } = STAIR;
  const h = (BALCONY_Y - Y0) / STAIR.risers;
  const half = STAIR.risers / 2;
  const flight = (half - 1) * r;
  const x0 = bx0 - (2 * flight + STAIR.landing);
  const xL0 = x0 + flight;
  const xL1 = xL0 + STAIR.landing;
  const yL = Y0 + half * h;
  const W = sz1 - sz0 - 0.1;
  const zc = (sz0 + sz1) / 2;
  const fill = new Batch();
  const pan = new Batch();
  const tread = (xa: number, top: number, len: number) => {
    fill.box(len, 0.04, W, xa + len / 2, top - 0.02, zc);
    pan.box(len + 0.02, 0.012, W, xa + len / 2, top - 0.046, zc);
    pan.box(0.035, 0.045, W, xa + 0.0, top - 0.02, zc);
  };
  for (let i = 1; i < half; i++) tread(x0 + (i - 1) * r, Y0 + i * h, r);
  for (let i = half + 1; i < STAIR.risers; i++) tread(xL1 + (i - half - 1) * r, Y0 + i * h, r);
  tread(xL0, yL, STAIR.landing);
  for (let i = 1; i <= STAIR.risers; i++) {
    const x = i <= half ? x0 + (i - 1) * r : xL1 + (i - half - 1) * r;
    steel.box(0.008, h - 0.045, W, x + 0.02, Y0 + (i - 0.5) * h - 0.022, zc);
  }
  const yN = (x: number) => (x <= xL0 ? Y0 + h + ((x - x0) * h) / r : x <= xL1 - r ? yL : yL + h + ((x - xL1) * h) / r);
  for (const z of [sz0 + 0.025, sz1 - 0.025]) {
    steel.beam(v3(x0 - 0.12, yN(x0 - 0.12) - 0.2, z), v3(xL0 + 0.05, yN(xL0 + 0.05) - 0.2, z), 0.05, 0.3);
    steel.beam(v3(xL1 - 0.12, yN(xL1 - 0.12) - 0.2, z), v3(bx0, yN(bx0) - 0.2, z), 0.05, 0.3);
    steel.box(STAIR.landing + 0.05, 0.3, 0.05, (xL0 + xL1) / 2, yL - 0.17, z);
  }
  for (const x of [xL0 + 0.02, xL1 - 0.02]) steel.box(0.05, 0.3, sz1 - sz0, x, yL - 0.17, zc);
  for (const x of [xL0 + 0.1, xL1 - 0.1])
    for (const z of [sz0 + 0.08, sz1 - 0.08]) {
      steel.box(0.12, yL - 0.32 - Y0, 0.12, x, (Y0 + yL - 0.32) / 2, z);
      steel.box(0.3, 0.02, 0.3, x, Y0 + 0.01, z);
    }
  fill.box(0.7, 0.04, sz1 - sz0 + 0.3, x0 - 0.2, Y0 + 0.02, zc);

  // guards outside the stringers, handrails inside (34-38 in, 12 in top extension, one-tread bottom extension)
  for (const [gzS, hz, rz] of [
    [sz0 - 0.03, sz0 + 0.1, bz0 + 0.06],
    [sz1 + 0.03, sz1 - 0.1, STAIR.z1 + 0.1],
  ] as const) {
    guard(steel, cable, [v3(x0, Y0 + h, gzS), v3(xL0, yL, gzS), v3(xL1 - r, yL, gzS), v3(bx0, BALCONY_Y, gzS)], 1.4);
    const HR = 0.9;
    const hp = [
      v3(x0 - r, Y0 + HR, hz),
      v3(xL0, yL + HR, hz),
      v3(xL1 - r, yL + HR, hz),
      v3(bx0, BALCONY_Y + HR, hz),
      v3(bx0 + 0.3, BALCONY_Y + HR, hz),
      v3(bx0 + 0.3, BALCONY_Y + HR, rz),
    ];
    for (let i = 0; i < hp.length - 1; i++) steel.rod(hp[i], hp[i + 1], 0.021, 8);
    steel.rod(v3(x0 - r, Y0, hz), hp[0], 0.021, 8);
    for (let k = 0; k < 4; k++) {
      const t = (k + 0.5) / 4;
      const bx = x0 + t * flight;
      steel.rod(v3(bx, yN(bx) + HR - 0.07, hz), v3(bx, yN(bx) + HR - 0.07, gzS), 0.008, 4);
      const bx2 = xL1 + t * flight;
      steel.rod(v3(bx2, yN(bx2) + HR - 0.07, hz), v3(bx2, yN(bx2) + HR - 0.07, gzS), 0.008, 4);
    }
  }
  addRamp(x0 - r, xL0, sz0, sz1, 'x', Y0, yL);
  addFlatFloor(xL0, xL1, sz0, sz1, yL);
  addRamp(xL1 - r, bx0, sz0, sz1, 'x', yL, BALCONY_Y);
  // guard collision in short segments, so you can still walk under the high part of the stair
  for (let x = x0; x < bx0 - 0.01; x += 0.7) {
    const lo = Math.max(Y0, Math.min(yN(x), yN(Math.min(bx0, x + 0.7))) - h);
    for (const z of [sz0 - 0.03, sz1 + 0.03]) addWall(x, Math.min(bx0, x + 0.7), z - 0.06, z + 0.06, lo + 0.3, BALCONY_Y + 1.3);
  }

  root.add(steel.mesh(E.paintSteel, true, true));
  root.add(cable.mesh(E.stainless, false, false));
  root.add(fill.mesh(E.concrete, true, true));
  root.add(pan.mesh(E.galv, false, true));
  root.add(spout.mesh(E.bronze, false, false));
  root.add(lamps.mesh(E.globe, false, false));
  root.add(lampBase.mesh(E.bronze, false, false));
}
