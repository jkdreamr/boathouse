import * as THREE from 'three';
import { boxMeters } from '../../textures';
import { addFlatFloor, addRamp, addWall } from '../collide';
import { mats } from '../materials';
import { CMU_H, ENTRY, EAVE, X0, X1, Y0, ZF, ZW } from '../boathouseDims';
import { PAD_Y } from '../terrain';
import { extMats } from './extMats';
import { Batch, v3 } from './geo';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z, d.x, d.y, d.z], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([a.x, a.z, b.x, b.z, c.x, c.z, d.x, d.z], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.computeVertexNormals();
  return g;
}

/** Brushed-aluminium monument sign, lettering as photographed on the site (Commons: "Stanford Rowing and Sailing Center sign"). */
function monumentTexture(w: number, h: number) {
  const W = 640;
  const H = Math.round((W * h) / w);
  const { c, g } = canvas(W, H);
  g.fillStyle = '#c3c4c1';
  g.fillRect(0, 0, W, H);
  for (let x = 0; x < W; x++) {
    const v = 175 + Math.random() * 40;
    g.fillStyle = `rgba(${v},${v + 1},${v - 2},0.35)`;
    g.fillRect(x, 0, 1, H);
  }
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillStyle = '#8c1515';
  g.font = `bold 62px Georgia, 'Times New Roman', serif`;
  g.fillText('STANFORD', W / 2, H * 0.14);
  g.fillText('UNIVERSITY', W / 2, H * 0.205);
  g.fillStyle = '#1d1b1a';
  g.font = `112px Georgia, 'Times New Roman', serif`;
  ['Rowing', 'and', 'Sailing', 'Center'].forEach((t, i) => g.fillText(t, W / 2, H * (0.34 + i * 0.1)));
  g.fillStyle = '#8c1515';
  g.font = `bold 46px Georgia, 'Times New Roman', serif`;
  g.fillText('300 CARDINAL WAY', W / 2, H * 0.83);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(1 / w, 1 / h);
  t.offset.set(0.5, 0);
  t.anisotropy = 8;
  return t;
}

function adaTexture() {
  const { c, g } = canvas(256, 512);
  g.fillStyle = '#f4f4f0';
  g.fillRect(0, 0, 256, 512);
  g.fillStyle = '#1d5aa8';
  g.fillRect(20, 20, 216, 216);
  // International Symbol of Accessibility (simplified)
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineWidth = 16;
  g.beginPath();
  g.arc(118, 62, 15, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(112, 88);
  g.lineTo(118, 150);
  g.lineTo(170, 150);
  g.lineTo(190, 200);
  g.stroke();
  g.beginPath();
  g.moveTo(115, 118);
  g.lineTo(160, 118);
  g.stroke();
  g.lineWidth = 12;
  g.beginPath();
  g.arc(118, 168, 42, Math.PI * 0.6, Math.PI * 1.85);
  g.stroke();
  g.fillStyle = '#1d5aa8';
  g.textAlign = 'center';
  g.font = 'bold 40px Arial, sans-serif';
  g.fillText('RESERVED', 128, 292);
  g.fillText('PARKING', 128, 338);
  g.fillStyle = '#1d5aa8';
  g.fillRect(20, 380, 216, 112);
  g.fillStyle = '#fff';
  g.font = 'bold 38px Arial, sans-serif';
  g.fillText('VAN', 128, 425);
  g.fillText('ACCESSIBLE', 128, 470);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Wall pack with its housing centred at (x,y,z) on a wall whose outward normal is +-x (nx) or +-z (nz). */
function wallPack(house: Batch, lens: Batch, x: number, y: number, z: number, nx: number, nz: number) {
  const alongX = nz !== 0;
  const w = 0.32;
  const d = 0.2;
  house.box(alongX ? w : d, 0.24, alongX ? d : w, x + nx * d * 0.5, y, z + nz * d * 0.5);
  house.box(alongX ? 0.2 : 0.03, 0.3, alongX ? 0.03 : 0.2, x + nx * 0.015, y, z + nz * 0.015);
  lens.box(alongX ? w - 0.05 : 0.12, 0.02, alongX ? 0.12 : w - 0.05, x + nx * (d * 0.55), y - 0.125, z + nz * (d * 0.55));
}

export function buildExteriorDetails(root: THREE.Group) {
  const M = mats();
  const E = extMats();
  const bronze = new Batch();
  const lens = new Batch();
  const globes = new Batch();
  const brass = new Batch();
  const hose = new Batch();
  const galv = new Batch();
  const alu = new Batch();
  const conc = new Batch();
  const dark = new Batch();
  const strap = new Batch();
  const white = new Batch();

  // ---- wall packs ----
  for (const x of [-23.0, -9.5, 9.5, 23.0]) wallPack(bronze, lens, x, Y0 + 3.9, ZF, 0, 1);
  for (const z of [16, 22.5]) wallPack(bronze, lens, X0, Y0 + 3.9, z, -1, 0);
  for (const z of [16, 22]) wallPack(bronze, lens, X1, Y0 + 3.9, z, 1, 0);
  wallPack(bronze, lens, 22.7, Y0 + 4.1, ZW, 0, -1);

  // ---- globe sconces on the upper water facade ----
  for (const x of [15, 7, -3, -11, -18]) {
    const y = Y0 + CMU_H + 2.2;
    globes.add(new THREE.SphereGeometry(0.17, 16, 12), x, y, ZW - 0.3);
    bronze.add(new THREE.CylinderGeometry(0.08, 0.08, 0.03, 14), x, y - 0.12, ZW - 0.015, Math.PI / 2);
    bronze.rod(v3(x, y - 0.12, ZW - 0.02), v3(x, y - 0.12, ZW - 0.24), 0.015, 6);
    bronze.add(new THREE.CylinderGeometry(0.06, 0.05, 0.05, 12), x, y - 0.17, ZW - 0.3);
  }

  // ---- louvred CMU vents below the balcony ----
  for (const x of [-15.6, -6, 3.6, 13.2]) {
    const y = Y0 + 4.9;
    bronze.box(0.46, 0.46, 0.03, x, y, ZW - 0.015);
    for (let k = 0; k < 6; k++) bronze.box(0.4, 0.06, 0.012, x, y - 0.17 + k * 0.068, ZW - 0.04, -0.7);
  }

  // ---- hose bibs with hangers and coiled hoses on the piers between bays ----
  const bib = (x: number, y: number, z: number, nx: number, nz: number) => {
    const o = (d: number) => v3(x + nx * d, y, z + nz * d);
    brass.add(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 12), o(0.006).x, y, o(0.006).z, nz ? Math.PI / 2 : 0, 0, nx ? Math.PI / 2 : 0);
    brass.rod(o(0.01), o(0.09), 0.012, 8);
    brass.rod(o(0.09), v3(o(0.09).x, y - 0.06, o(0.09).z), 0.011, 8);
    brass.rod(v3(o(0.07).x, y + 0.02, o(0.07).z), v3(o(0.07).x, y + 0.06, o(0.07).z), 0.006, 6);
    brass.add(new THREE.TorusGeometry(0.025, 0.006, 6, 12), o(0.07).x, y + 0.065, o(0.07).z, Math.PI / 2);
  };
  const coil = (x: number, y: number, z: number, faceX: boolean) => {
    for (let k = 0; k < 4; k++) {
      hose.add(new THREE.TorusGeometry(0.2 + k * 0.012, 0.012, 6, 28), x, y - k * 0.01, z, 0, faceX ? Math.PI / 2 : 0, 0);
    }
  };
  for (const x of [-13.2, -3.6, 6.0]) {
    bib(x, Y0 + 0.6, ZW, 0, -1);
    bronze.box(0.08, 0.1, 0.12, x + 0.45, Y0 + 1.45, ZW - 0.06);
    coil(x + 0.45, Y0 + 1.25, ZW - 0.12, false);
    hose.rod(v3(x, Y0 + 0.54, ZW - 0.09), v3(x + 0.3, Y0 + 1.1, ZW - 0.12), 0.012, 6);
  }
  bib(X1, Y0 + 0.6, 14.2, 1, 0);

  // ---- boat wash area on the east apron: pad, trench drain, slings, hose reel ----
  const wx0 = 26;
  const wx1 = 46;
  const wz0 = 2.4;
  const wz1 = 6.2;
  root.add(Object.assign(new THREE.Mesh(boxMeters(wx1 - wx0, 0.03, wz1 - wz0), E.washPad), { receiveShadow: true }).translateX((wx0 + wx1) / 2).translateY(PAD_Y + 0.008).translateZ((wz0 + wz1) / 2));
  const zc = (wz0 + wz1) / 2;
  dark.box(wx1 - wx0 - 1, 0.01, 0.14, (wx0 + wx1) / 2, PAD_Y + 0.026, zc);
  for (let x = wx0 + 0.5; x < wx1 - 0.5; x += 0.5) galv.box(0.02, 0.012, 0.16, x, PAD_Y + 0.027, zc);
  galv.box(wx1 - wx0 - 1, 0.012, 0.02, (wx0 + wx1) / 2, PAD_Y + 0.027, zc - 0.08);
  galv.box(wx1 - wx0 - 1, 0.012, 0.02, (wx0 + wx1) / 2, PAD_Y + 0.027, zc + 0.08);
  for (const sx of [30.5, 41.5]) {
    const gy = PAD_Y + 0.023;
    for (const s of [-1, 1]) {
      const z = zc + s * 0.36;
      alu.rod(v3(sx - 0.32, gy, z), v3(sx, gy + 0.98, z), 0.016, 6);
      alu.rod(v3(sx + 0.32, gy, z), v3(sx, gy + 0.98, z), 0.016, 6);
      alu.rod(v3(sx - 0.2, gy + 0.36, z), v3(sx + 0.2, gy + 0.36, z), 0.01, 6);
      dark.box(0.07, 0.03, 0.05, sx - 0.32, gy + 0.015, z);
      dark.box(0.07, 0.03, 0.05, sx + 0.32, gy + 0.015, z);
    }
    alu.rod(v3(sx, gy + 0.3, zc - 0.36), v3(sx, gy + 0.3, zc + 0.36), 0.012, 6);
    const sag = [v3(sx, gy + 0.98, zc - 0.36), v3(sx, gy + 0.86, zc - 0.2), v3(sx, gy + 0.8, zc), v3(sx, gy + 0.86, zc + 0.2), v3(sx, gy + 0.98, zc + 0.36)];
    for (let i = 0; i < sag.length - 1; i++) strap.beam(sag[i], sag[i + 1], 0.07, 0.006);
    addWall(sx - 0.34, sx + 0.34, zc - 0.42, zc + 0.42, PAD_Y - 1, PAD_Y + 1.0);
  }
  // standpipe + hose reel
  galv.add(new THREE.CylinderGeometry(0.035, 0.035, 0.9, 10), 36, PAD_Y + 0.45, 6.75);
  bib(36, PAD_Y + 0.75, 6.75 - 0.035, 0, -1);
  galv.rod(v3(35.55, PAD_Y + 0.02, 6.9), v3(35.55, PAD_Y + 0.62, 6.9), 0.015, 6);
  galv.rod(v3(35.15, PAD_Y + 0.02, 6.9), v3(35.15, PAD_Y + 0.62, 6.9), 0.015, 6);
  galv.rod(v3(35.1, PAD_Y + 0.45, 6.9), v3(35.6, PAD_Y + 0.45, 6.9), 0.012, 6);
  hose.add(new THREE.CylinderGeometry(0.2, 0.2, 0.34, 20), 35.35, PAD_Y + 0.45, 6.9, 0, 0, Math.PI / 2);
  hose.rod(v3(35.35, PAD_Y + 0.27, 6.75), v3(35.0, PAD_Y + 0.03, 6.2), 0.012, 6);
  hose.rod(v3(35.0, PAD_Y + 0.03, 6.2), v3(33.4, PAD_Y + 0.03, 5.4), 0.012, 6);
  addWall(35.0, 36.1, 6.6, 7.1);

  // ---- bike racks (inverted U, APBP: ~36 in tall, 36 in on centre) with two bikes ----
  const rz0 = 35.45;
  const rz1 = 35.95;
  for (const x of [-12.6, -11.7, -10.8, -9.9]) {
    const top = PAD_Y + 0.84;
    galv.rod(v3(x, PAD_Y, rz0), v3(x, top - 0.12, rz0), 0.024, 8);
    galv.rod(v3(x, PAD_Y, rz1), v3(x, top - 0.12, rz1), 0.024, 8);
    let prev = v3(x, top - 0.12, rz0);
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * Math.PI;
      const p = v3(x, top - 0.12 + Math.sin(a) * 0.12, (rz0 + rz1) / 2 - Math.cos(a) * 0.25);
      galv.rod(prev, p, 0.024, 8);
      prev = p;
    }
    for (const z of [rz0, rz1]) galv.add(new THREE.CylinderGeometry(0.06, 0.06, 0.008, 12), x, PAD_Y + 0.004, z);
  }
  const bike = (x: number, mat: THREE.Material, flip: number) => {
    const fr = new Batch();
    const tyre = new Batch();
    const zb = 35.7;
    const P = (dz: number, y: number) => v3(x, PAD_Y + y, zb + dz * flip);
    const RA = P(-0.52, 0.34);
    const FA = P(0.52, 0.34);
    const BB = P(-0.08, 0.29);
    const ST = P(-0.22, 0.84);
    const HT = P(0.38, 0.86);
    const HB = P(0.42, 0.7);
    for (const [a, b] of [
      [BB, ST],
      [ST, HT],
      [HB, BB],
      [RA, BB],
      [RA, ST],
      [HB, HT],
    ])
      fr.rod(a, b, 0.016, 6);
    fr.rod(v3(x - 0.04, HB.y, HB.z), v3(x - 0.04, FA.y, FA.z), 0.011, 5);
    fr.rod(v3(x + 0.04, HB.y, HB.z), v3(x + 0.04, FA.y, FA.z), 0.011, 5);
    galv.rod(ST, P(-0.25, 0.95), 0.013, 6);
    galv.rod(HT, P(0.35, 0.98), 0.013, 6);
    galv.rod(v3(x - 0.21, PAD_Y + 0.98, zb + 0.35 * flip), v3(x + 0.21, PAD_Y + 0.98, zb + 0.35 * flip), 0.012, 6);
    dark.box(0.12, 0.05, 0.26, x, PAD_Y + 0.97, zb - 0.26 * flip);
    for (const c of [RA, FA]) {
      tyre.add(new THREE.TorusGeometry(0.33, 0.018, 6, 28), c.x, c.y, c.z, 0, Math.PI / 2, 0);
      galv.add(new THREE.TorusGeometry(0.305, 0.008, 4, 28), c.x, c.y, c.z, 0, Math.PI / 2, 0);
      galv.add(new THREE.CylinderGeometry(0.02, 0.02, 0.1, 8), c.x, c.y, c.z, 0, 0, Math.PI / 2);
    }
    dark.add(new THREE.CylinderGeometry(0.09, 0.09, 0.01, 16), x + 0.05, BB.y, BB.z, 0, 0, Math.PI / 2);
    root.add(fr.mesh(mat, true, false), tyre.mesh(E.rubber, true, false));
  };
  bike(-12.45, E.bikeRed, 1);
  bike(-10.65, E.bikeTeal, -1);
  addWall(-13.0, -9.5, 35.0, 36.6);

  // ---- raised walk along the plaza edge with a 1:12 curb ramp and detectable warnings ----
  const W0 = -24;
  const W1 = 24;
  const zs0 = 38.7;
  const zs1 = 41.7;
  const zr0 = 42.2;
  const zr1 = 44.0;
  const top = PAD_Y + 0.15;
  const raised = new Batch();
  raised.add(quad(v3(W0, PAD_Y + 0.009, zs0), v3(W0, top, zs1), v3(W1, top, zs1), v3(W1, PAD_Y + 0.009, zs0)));
  raised.aabb(W0, PAD_Y, zs1, -2.1, top, zr1);
  raised.aabb(2.1, PAD_Y, zs1, W1, top, zr1);
  raised.aabb(-2.1, PAD_Y, zs1, 2.1, top, zr0);
  const ry = (z: number) => PAD_Y + 0.15 * ((zr1 - z) / (zr1 - zr0));
  raised.add(quad(v3(-0.6, ry(zr0), zr0), v3(-0.6, PAD_Y + 0.004, zr1), v3(0.6, PAD_Y + 0.004, zr1), v3(0.6, ry(zr0), zr0)));
  for (const s of [-1, 1]) {
    const a = v3(s * 0.6, top, zr0);
    const b = v3(s * 2.1, top, zr0);
    const c = v3(s * 2.1, top, zr1);
    const d = v3(s * 0.6, PAD_Y + 0.004, zr1);
    raised.add(s > 0 ? quad(a, d, c, b) : quad(a, b, c, d));
    const f = new THREE.BufferGeometry();
    const fp = s > 0 ? [0.6, PAD_Y, zr1, 2.1, PAD_Y, zr1, 2.1, top, zr1] : [-2.1, PAD_Y, zr1, -0.6, PAD_Y, zr1, -2.1, top, zr1];
    f.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    f.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1], 2));
    f.computeVertexNormals();
    raised.add(f);
  }
  root.add(raised.mesh(E.concrete, false, true));
  const red = new Batch();
  red.aabb(W0, PAD_Y, zr1, -2.1, top, zr1 + 0.004);
  red.aabb(2.1, PAD_Y, zr1, W1, top, zr1 + 0.004);
  red.aabb(W0, top, zr1 - 0.15, -2.1, top + 0.003, zr1 + 0.004);
  red.aabb(2.1, top, zr1 - 0.15, W1, top + 0.003, zr1 + 0.004);
  root.add(red.mesh(E.curbRed, false, true));
  // truncated domes (ADA 705: 0.9 in base, 1.6-2.4 in spacing) on a 24 in deep yellow field at the ramp foot
  const dz0 = zr1 - 0.61;
  const field = new Batch();
  field.add(quad(v3(-0.6, ry(dz0) + 0.003, dz0), v3(-0.6, PAD_Y + 0.007, zr1), v3(0.6, PAD_Y + 0.007, zr1), v3(0.6, ry(dz0) + 0.003, dz0)));
  root.add(field.mesh(E.domes, false, true));
  const domeGeo = new THREE.CylinderGeometry(0.006, 0.0115, 0.005, 6);
  const nx = 22;
  const nz = 11;
  const domes = new THREE.InstancedMesh(domeGeo, E.domes, nx * nz);
  const dm = new THREE.Matrix4();
  let di = 0;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++) {
      const z = dz0 + 0.03 + j * 0.055;
      domes.setMatrixAt(di++, dm.makeTranslation(-0.5775 + i * 0.055, ry(z) + 0.006, z));
    }
  root.add(domes);
  addRamp(W0, W1, zs0, zs1, 'z', PAD_Y, top);
  addFlatFloor(W0, W1, zs1, zr0, top);
  addFlatFloor(W0, -0.6, zr0, zr1, top);
  addFlatFloor(0.6, W1, zr0, zr1, top);
  addRamp(-0.6, 0.6, zr0, zr1, 'z', PAD_Y, top, true);
  // tree grates
  for (const [x, z] of [
    [-22, 40.5],
    [-14, 40.5],
    [14, 40.5],
    [-8.5, 38.5],
    [8.5, 38.5],
  ]) {
    const y = z < zs0 ? PAD_Y + 0.012 : PAD_Y + 0.012 + ((z - zs0) / (zs1 - zs0)) * 0.141;
    dark.box(1.2, 0.012, 1.2, x, y, z);
  }

  // ---- monument sign on a split-face CMU wall ----
  {
    const mx = -18.5;
    const mz = 43.1;
    const base = top;
    const wall = new THREE.Mesh(boxMeters(3.6, 1.7, 0.4), E.cmu);
    wall.position.set(mx, base + 0.85, mz);
    wall.castShadow = wall.receiveShadow = true;
    root.add(wall);
    conc.box(3.72, 0.08, 0.5, mx, base + 1.74, mz);
    const sw = 1.15;
    const sh = 2.15;
    const shape = new THREE.Shape();
    shape.moveTo(-sw / 2, 0);
    shape.lineTo(sw / 2, 0);
    shape.lineTo(sw / 2, sh - 0.14);
    shape.quadraticCurveTo(0, sh + 0.14, -sw / 2, sh - 0.14);
    shape.closePath();
    const panel = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.05, bevelEnabled: false, curveSegments: 16 }), [
      new THREE.MeshStandardMaterial({ map: monumentTexture(sw, sh), roughness: 0.38, metalness: 0.55 }),
      E.anod,
    ]);
    panel.position.set(mx, base + 0.12, mz + 0.26);
    panel.castShadow = true;
    root.add(panel);
    for (const s of [-1, 1]) galv.box(0.06, 0.14, 0.06, mx + s * 0.4, base + 0.07, mz + 0.29);
    addWall(mx - 1.85, mx + 1.85, mz - 0.25, mz + 0.35);
  }

  // ---- accessible-parking sign on the street facade ----
  {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.6), new THREE.MeshStandardMaterial({ map: adaTexture(), roughness: 0.5 }));
    s.position.set(-16.5, Y0 + 1.95, ZF + 0.02);
    root.add(s);
  }

  // ---- west gable man door with globe ----
  {
    const z0 = 14.0;
    const z1 = 14.91;
    white.box(0.05, 2.13, z1 - z0, X0 - 0.03, Y0 + 1.065, (z0 + z1) / 2);
    white.box(0.07, 2.2, 0.06, X0 - 0.035, Y0 + 1.1, z0 - 0.03);
    white.box(0.07, 2.2, 0.06, X0 - 0.035, Y0 + 1.1, z1 + 0.03);
    white.box(0.07, 0.06, z1 - z0 + 0.12, X0 - 0.035, Y0 + 2.16, (z0 + z1) / 2);
    galv.box(0.06, 0.02, 0.12, X0 - 0.09, Y0 + 1.0, z1 - 0.12);
    globes.add(new THREE.SphereGeometry(0.15, 16, 12), X0 - 0.28, Y0 + 2.7, (z0 + z1) / 2);
    bronze.rod(v3(X0, Y0 + 2.6, (z0 + z1) / 2), v3(X0 - 0.26, Y0 + 2.6, (z0 + z1) / 2), 0.015, 6);
    conc.box(1.2, 0.08, 1.6, X0 - 0.6, Y0 + 0.04, (z0 + z1) / 2);
  }

  // ---- entry canopy and gable soffit downlights ----
  for (const x of [-2.4, -0.8, 0.8, 2.4]) lens.add(new THREE.CylinderGeometry(0.07, 0.07, 0.015, 14), x, Y0 + 3.115, ENTRY.z + 0.8);
  bronze.box(6.84, 0.22, 0.04, 0, Y0 + 3.2, ENTRY.z + 1.62);
  for (const x of [-4.4, -2.2, 2.2, 4.4]) {
    const y = EAVE + 6 * ENTRY.slope + 0.07 - Math.abs(x) * ENTRY.slope - 0.2;
    bronze.add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 12), x, y, ENTRY.zFront - 0.15);
    lens.add(new THREE.CylinderGeometry(0.045, 0.045, 0.01, 12), x, y - 0.065, ENTRY.zFront - 0.15);
  }

  root.add(bronze.mesh(E.bronze, true, false));
  root.add(lens.mesh(E.lens, false, false));
  root.add(globes.mesh(E.globe, false, false));
  root.add(brass.mesh(E.brass, false, false));
  root.add(hose.mesh(E.hose, false, false));
  root.add(galv.mesh(E.galv, true, false));
  root.add(alu.mesh(M.alu, true, false));
  root.add(conc.mesh(E.concrete, true, true));
  root.add(dark.mesh(E.grate, false, true));
  root.add(strap.mesh(E.strap, false, false));
  root.add(white.mesh(E.paintSteel, true, false));
}
