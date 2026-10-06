import * as THREE from 'three';
import { Batch } from './batch';
import type { IMats } from './imats';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tube = (b: Batch, mat: THREE.Material, r: number, a: [number, number, number], c: [number, number, number]) =>
  b.tube(mat, r, V(...a), V(...c), 8);

function coil(b: Batch, mat: THREE.Material, x: number, y: number, z: number, radius: number, turns = 1.5) {
  let previous: [number, number, number] | null = null;
  const count = Math.ceil(turns * 20);
  for (let i = 0; i <= count; i++) {
    const angle = (i / count) * turns * Math.PI * 2;
    const point: [number, number, number] = [x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, z];
    if (previous) tube(b, mat, 0.008, previous, point);
    previous = point;
  }
}

function placeCup(b: Batch, M: IMats, x: number, y: number, z: number, h: number) {
  b.frame(x, y, z, 0, () => addTrophyCup(b, M, h));
}

/** Footprint: 2.44 m long × 0.61 m wide; rear leg at x=-1.22, flywheel at x=+1.22. */
export function addErg(b: Batch, M: IMats) {
  b.box(M.ergRail, 1.64, 0.11, 0.085, -0.19, 0.30, 0);
  b.box(M.ergBlack, 0.10, 0.28, 0.10, -1.12, 0.15, 0);
  b.box(M.ergBlack, 0.07, 0.08, 0.61, -1.12, 0.04, 0);
  b.box(M.ergBlack, 0.08, 0.24, 0.10, 0.63, 0.13, 0);
  b.box(M.ergBlack, 0.09, 0.07, 0.61, 0.74, 0.04, 0);
  b.box(M.blackPlastic, 0.31, 0.065, 0.28, -0.50, 0.327, 0);
  b.box(M.foam, 0.24, 0.025, 0.27, -0.50, 0.372, 0);
  b.box(M.ergBlack, 0.18, 0.12, 0.30, 0.62, 0.31, 0);
  b.box(M.blackPlastic, 0.13, 0.05, 0.23, 0.63, 0.42, 0, 0, 0, -0.18);
  b.box(M.strap, 0.025, 0.035, 0.22, 0.63, 0.48, 0);
  b.box(M.ergBlack, 0.09, 0.22, 0.10, 0.31, 0.18, -0.14, 0, 0, -0.40);
  b.box(M.ergBlack, 0.09, 0.22, 0.10, 0.31, 0.18, 0.14, 0, 0, -0.40);
  b.box(M.ergBlack, 0.07, 0.07, 0.61, 0.31, 0.06, 0);
  b.box(M.ergBlack, 0.11, 0.28, 0.10, 0.86, 0.40, 0);
  b.cyl(M.ergBlack, 0.25, 0.13, 0.99, 0.56, 0, Math.PI / 2, 0, 16);
  b.cyl(M.blackPlastic, 0.19, 0.012, 0.99, 0.56, 0.075, Math.PI / 2, 0, 12);
  b.cyl(M.ergRail, 0.035, 0.014, 0.99, 0.56, 0.086, Math.PI / 2, 0, 8);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tube(b, M.ergRail, 0.008, [0.99, 0.56, 0.087], [0.99 + Math.cos(a) * 0.14, 0.56 + Math.sin(a) * 0.14, 0.087]);
  }
  tube(b, M.ergBlack, 0.018, [0.68, 0.43, 0], [0.79, 0.62, 0]);
  tube(b, M.ergBlack, 0.012, [0.79, 0.62, 0], [0.92, 0.64, 0]);
  b.box(M.blackPlastic, 0.035, 0.025, 0.25, 0.91, 0.64, 0);
  b.box(M.ergBlack, 0.035, 0.34, 0.04, 1.10, 0.81, 0, 0, 0, -0.18);
  b.box(M.blackPlastic, 0.25, 0.18, 0.055, 1.14, 1.01, 0, -Math.PI / 2, 0, -0.12);
  b.box(M.screen, 0.20, 0.13, 0.012, 1.106, 1.01, 0, -Math.PI / 2, 0, -0.12);
  b.box(M.ergBlack, 0.014, 0.028, 0.045, 1.09, 0.91, 0.075, -Math.PI / 2);
}

/** Footprint: 0.25+(n-1)×0.11 m blade span × 0.18 m deep; 0.11 m shaft pitch, oars rise to 3.72 m. */
export function addOarRack(b: Batch, M: IMats, n: number) {
  const count = Math.max(n, 1);
  const width = Math.max(0.25, (count - 1) * 0.11 + 0.25);
  const left = -0.125;
  b.box(M.rackSteel, width, 0.07, 0.18, left + width / 2, 0.05, 0.10);
  b.box(M.rackSteel, width, 0.055, 0.075, left + width / 2, 2.40, 0.04);
  b.box(M.rackSteel, 0.045, 2.40, 0.045, left + 0.02, 1.22, 0.035);
  b.box(M.rackSteel, 0.045, 2.40, 0.045, left + width - 0.02, 1.22, 0.035);
  for (let i = 0; i < n; i++) {
    const x = i * 0.11;
    const bladeSide = i % 2 === 0 ? -1 : 1;
    tube(b, M.greyPlastic, 0.022, [x, 0.12, 0.16], [x, 3.22, 0.02]);
    b.cyl(M.blackPlastic, 0.024, 0.22, x, 0.20, 0.115, 0, 0, 8);
    b.cyl(M.greyPlastic, 0.034, 0.045, x, 1.18, 0.065, Math.PI / 2, 0, 8);
    b.cyl(M.blackPlastic, 0.028, 0.07, x, 1.10, 0.071, Math.PI / 2, 0, 8);
    const blade = new THREE.Shape();
    blade.moveTo(-0.09, -0.25);
    blade.lineTo(-0.10, 0.09);
    blade.lineTo(-0.12, 0.25);
    blade.lineTo(0.11, 0.25);
    blade.lineTo(0.12, 0.10);
    blade.lineTo(0.055, -0.01);
    blade.lineTo(0.085, -0.25);
    blade.closePath();
    const bladeGeometry = new THREE.ExtrudeGeometry(blade, { depth: 0.03, bevelEnabled: false, steps: 1 });
    bladeGeometry.userData.batchTemp = true;
    // blades stack face-to-face like books, standing out from the wall
    b.frame(x - 0.015, 3.47, 0.15 + bladeSide * 0.02, Math.PI / 2, () => b.add(bladeGeometry, M.accentCardinal));
    b.box(M.greyPlastic, 0.055, 0.045, 0.06, x, 2.43, 0.045);
  }
  for (let i = 0; i <= n; i++) b.box(M.rackSteel, 0.025, 0.18, 0.025, left + i * 0.11, 2.49, 0.08);
}

/** Footprint: n×0.22 m wide × 0.32 m deep; wall rack with riggers hooked at about 1.2 m. */
export function addRiggerRack(b: Batch, M: IMats, n: number) {
  const width = Math.max(n, 1) * 0.22;
  b.box(M.rackSteel, width, 0.08, 0.08, width / 2, 1.34, 0.045);
  b.box(M.rackSteel, width, 0.07, 0.08, width / 2, 0.78, 0.045);
  for (let i = 0; i < n; i++) {
    const x = 0.11 + i * 0.22;
    b.box(M.ergRail, 0.58, 0.035, 0.035, x, 1.16, 0.24, 0, 0, 0.13);
    tube(b, M.ergRail, 0.018, [x - 0.24, 1.28, 0.19], [x + 0.24, 1.28, 0.19]);
    tube(b, M.ergRail, 0.022, [x - 0.22, 1.25, 0.19], [x - 0.05, 0.88, 0.28]);
    tube(b, M.ergRail, 0.022, [x + 0.22, 1.25, 0.19], [x + 0.05, 0.88, 0.28]);
    b.cyl(M.blackPlastic, 0.05, 0.08, x, 1.28, 0.20, 0, 0, 8);
    b.box(M.blackPlastic, 0.09, 0.07, 0.035, x, 0.92, 0.28);
    b.cyl(M.blackPlastic, 0.035, 0.07, x, 0.88, 0.32, Math.PI / 2, 0, 8);
  }
}

/** Footprint: folded pair of sling frames, 0.75 m wide × 0.12 m deep × 0.9 m high against a wall. */
export function addSlings(b: Batch, M: IMats) {
  for (const x of [0.22, 0.55]) {
    tube(b, M.rackSteel, 0.024, [x - 0.30, 0.06, 0.08], [x + 0.30, 0.86, 0.08]);
    tube(b, M.rackSteel, 0.024, [x + 0.30, 0.06, 0.08], [x - 0.30, 0.86, 0.08]);
    b.box(M.strap, 0.46, 0.055, 0.035, x, 0.82, 0.09);
    b.box(M.strap, 0.30, 0.045, 0.035, x, 0.43, 0.095);
  }
}

/** Footprint: 0.75 m wide × 0.75 m deep × 0.9 m high; one open folding boat sling. */
export function addSlingOpen(b: Batch, M: IMats) {
  for (const z of [-0.30, 0.30]) {
    tube(b, M.rackSteel, 0.025, [-0.34, 0.05, z], [0.34, 0.90, z]);
    tube(b, M.rackSteel, 0.025, [0.34, 0.05, z], [-0.34, 0.90, z]);
    b.box(M.rackSteel, 0.055, 0.06, 0.78, 0, 0.06, z);
  }
  tube(b, M.rackSteel, 0.022, [-0.34, 0.90, -0.30], [-0.34, 0.90, 0.30]);
  tube(b, M.rackSteel, 0.022, [0.34, 0.90, -0.30], [0.34, 0.90, 0.30]);
  b.box(M.strap, 0.76, 0.09, 0.12, 0, 0.87, 0);
  b.box(M.strap, 0.76, 0.035, 0.10, 0, 0.79, 0);
}

/** Footprint: n hooks spaced 0.28 m along a wall; life jackets hang from 1.5 m. */
export function addPfdRack(b: Batch, M: IMats, n: number) {
  const width = Math.max(n, 1) * 0.28;
  b.box(M.rackSteel, width, 0.06, 0.07, width / 2, 1.53, 0.035);
  for (let i = 0; i < n; i++) {
    const x = 0.14 + i * 0.28;
    const materials = [M.orange, M.red, M.yellow];
    b.box(materials[i % materials.length], 0.25, 0.40, 0.13, x, 1.17, 0.18);
    b.box(M.blackPlastic, 0.065, 0.35, 0.035, x, 1.17, 0.255);
    b.box(M.blackPlastic, 0.11, 0.035, 0.018, x, 1.23, 0.28);
    b.box(M.blackPlastic, 0.11, 0.035, 0.018, x, 1.08, 0.28);
    tube(b, M.rackSteel, 0.012, [x, 1.50, 0.045], [x, 1.39, 0.14]);
  }
}

/** Footprint: w m wide × 0.5 m deep × 1.8 m high; storage shelf with launch gear. */
export function addLaunchGear(b: Batch, M: IMats, w: number) {
  b.box(M.rackSteel, w, 0.055, 0.5, w / 2, 0.04, 0.25);
  for (const y of [0.55, 1.15, 1.78]) {
    b.box(M.rackSteel, w, 0.045, 0.5, w / 2, y, 0.25);
  }
  for (let x = 0.035; x <= w; x += Math.max(w - 0.07, 0.1)) {
    b.box(M.rackSteel, 0.045, 1.8, 0.045, x, 0.9, 0.03);
    b.box(M.rackSteel, 0.045, 1.8, 0.045, x, 0.9, 0.47);
  }
  for (let i = 0; i < Math.max(1, Math.floor(w / 0.65)); i++) {
    const x = 0.30 + i * 0.65;
    b.box(M.red, 0.38, 0.38, 0.25, x, 0.23, 0.26);
    b.box(M.blackPlastic, 0.18, 0.035, 0.18, x, 0.44, 0.26);
    b.box(M.blackPlastic, 0.06, 0.07, 0.05, x, 0.46, 0.26);
    b.box(M.yellow, 0.24, 0.16, 0.18, x, 0.67, 0.23);
    b.cyl(M.orange, 0.10, 0.30, Math.min(x + 0.18, w - 0.12), 0.72, 0.22, 0, 0, 12, 0.035, 0);
    b.box(M.blackPlastic, 0.24, 0.21, 0.15, x, 0.87, 0.25);
    b.box(M.orange, 0.23, 0.07, 0.12, x, 1.34, 0.25);
    b.box(M.blackPlastic, 0.14, 0.16, 0.12, x, 1.29, 0.25);
    b.box(M.towel, 0.30, 0.19, 0.20, x, 1.52, 0.25);
    b.box(M.darkWood, 0.36, 0.22, 0.27, x, 0.30, 0.25);
  }
  b.box(M.rackSteel, 0.04, 0.45, 0.04, w * 0.5, 1.43, 0.12);
  tube(b, M.ergRail, 0.012, [w * 0.5 - 0.18, 1.35, 0.16], [w * 0.5 + 0.18, 1.35, 0.16]);
  tube(b, M.ergRail, 0.012, [w * 0.5, 1.35, -0.02], [w * 0.5, 1.35, 0.28]);
}

/** Footprint: w m wide × 0.35 m deep; wall shelf top at 1.1 m, units and cable hooks above. */
export function addCoxboxShelf(b: Batch, M: IMats, w: number) {
  b.box(M.rackSteel, w, 0.045, 0.35, w / 2, 1.06, 0.18);
  b.box(M.rackSteel, w, 0.045, 0.05, w / 2, 1.13, 0.03);
  for (let x = 0.10; x < w; x += 0.10) b.box(M.rackSteel, 0.018, 0.07, 0.025, x, 1.16, 0.17);
  const count = Math.max(1, Math.min(10, Math.floor((w - 0.05) / 0.17)));
  for (let i = 0; i < count; i++) {
    const x = 0.10 + i * ((w - 0.20) / Math.max(count - 1, 1));
    b.box(M.blackPlastic, 0.15, 0.09, 0.06, x, 1.22, 0.20);
    b.box(M.yellow, 0.11, 0.06, 0.008, x, 1.22, 0.235);
    b.box(M.blackPlastic, 0.17, 0.035, 0.10, x, 1.14, 0.20);
    tube(b, M.blackPlastic, 0.006, [x, 1.17, 0.20], [x, 1.09, 0.28]);
  }
  b.box(M.blackPlastic, Math.min(0.65, w * 0.5), 0.035, 0.06, w * 0.72, 1.17, 0.30);
  const loops = Math.max(2, Math.floor(w / 0.35));
  for (let i = 0; i < loops; i++) {
    const x = 0.16 + i * ((w - 0.32) / Math.max(loops - 1, 1));
    tube(b, M.rackSteel, 0.012, [x, 1.04, 0.04], [x, 0.93, 0.14]);
    coil(b, M.blackPlastic, x, 1.62 + (i % 2) * 0.10, 0.08, 0.09);
    tube(b, M.blackPlastic, 0.008, [x, 1.62, 0.08], [x + 0.03, 1.20, 0.13]);
  }
}

/** Footprint: w m wide × 0.05 m deep; brown wall panel h m high with painted tool silhouettes. */
export function addPegboard(b: Batch, M: IMats, w: number, h: number) {
  b.box(M.lockerWood, w, h, 0.045, w / 2, 0.9 + h / 2, 0.025);
  const toolMat = M.blackPlastic;
  for (let i = 0; i < 7; i++) {
    const x = 0.18 + i * 0.24;
    tube(b, M.galv, 0.014, [x, 1.10, 0.065], [x + 0.14, 1.48, 0.065]);
    b.box(toolMat, 0.09, 0.035, 0.025, x + 0.15, 1.47, 0.065, 0, 0, -0.4);
  }
  for (let i = 0; i < 4; i++) {
    const x = 0.22 + i * 0.28;
    b.box(M.red, 0.045, 0.27, 0.045, x, 1.38, 0.075);
    b.box(M.blackPlastic, 0.08, 0.07, 0.055, x, 1.54, 0.075);
  }
  b.box(M.blackPlastic, 0.045, 0.32, 0.05, 1.45, 1.32, 0.07, 0, 0, 0.3);
  b.box(M.red, 0.14, 0.07, 0.07, 1.45, 1.50, 0.07);
  for (let i = 0; i < 3; i++) {
    b.cyl(M.blackPlastic, 0.10, 0.045, 0.28 + i * 0.24, 1.76, 0.07, Math.PI / 2, 0, 12);
  }
  b.box(M.rackSteel, w * 0.72, 0.045, 0.15, w * 0.50, 0.98, 0.12);
  for (let i = 0; i < 4; i++) {
    b.box(M.darkWood, 0.17, 0.16, 0.13, 0.24 + i * 0.22, 1.08, 0.14);
    for (let j = 0; j < 3; j++) b.cyl(M.galv, 0.016, 0.035, 0.19 + i * 0.22 + j * 0.035, 1.12, 0.22, 0, 0, 8);
  }
  b.box(M.blackPlastic, 0.18, 0.08, 0.04, 0.36, 1.91, 0.07);
  b.cyl(M.greyPlastic, 0.065, 0.035, 0.65, 1.90, 0.08, Math.PI / 2, 0, 12);
  b.box(M.bench, 0.32, 0.13, 0.18, 0.97, 1.91, 0.08);
  b.box(M.foam, 0.20, 0.11, 0.09, Math.min(w - 0.2, 1.55), 1.32, 0.08);
}

/** Footprint: w m wide × 0.75 m deep × 0.9 m high; freestanding workbench. */
export function addWorkbench(b: Batch, M: IMats, w: number) {
  b.box(M.bench, w, 0.08, 0.75, 0, 0.86, 0);
  b.box(M.darkWood, w, 0.04, 0.75, 0, 0.92, 0);
  for (const x of [-w / 2 + 0.07, w / 2 - 0.07]) {
    for (const z of [-0.30, 0.30]) b.box(M.rackSteel, 0.06, 0.84, 0.06, x, 0.43, z);
  }
  b.box(M.rackSteel, w - 0.12, 0.045, 0.62, 0, 0.30, 0);
  b.box(M.rackSteel, 0.20, 0.22, 0.18, -w * 0.30, 1.07, 0.12);
  b.box(M.galv, 0.17, 0.03, 0.14, -w * 0.30, 1.19, 0.12);
  tube(b, M.galv, 0.012, [-w * 0.30 - 0.09, 1.08, 0.12], [-w * 0.30 - 0.09, 1.18, 0.12]);
}

/** Footprint: n open-front lockers, each 0.6 m wide × 0.5 m deep × 2.0 m high, backs at z=0. */
export function addLockerBank(b: Batch, M: IMats, n: number) {
  for (let i = 0; i < n; i++) {
    const x = i * 0.6 + 0.30;
    b.box(M.lockerWood, 0.045, 2.0, 0.50, i * 0.6 + 0.0225, 1.0, 0.25);
    b.box(M.lockerWood, 0.045, 2.0, 0.50, (i + 1) * 0.6 - 0.0225, 1.0, 0.25);
    b.box(M.lockerWood, 0.55, 0.045, 0.50, x, 1.98, 0.25);
    b.box(M.lockerWood, 0.55, 0.045, 0.50, x, 0.02, 0.25);
    b.box(M.lockerWood, 0.55, 0.045, 0.045, x, 1.45, 0.04);
    b.box(M.lockerWood, 0.55, 0.04, 0.48, x, 1.74, 0.25);
    tube(b, M.galv, 0.014, [x - 0.20, 1.66, 0.20], [x + 0.20, 1.66, 0.20]);
    b.box(i % 2 === 0 ? M.fabricCardinal : M.towel, 0.32, 0.48, 0.08, x - 0.07, 1.36, 0.25);
    b.box(M.towel, 0.22, 0.35, 0.07, x + 0.15, 1.42, 0.22);
    b.box(M.darkWood, 0.38, 0.10, 0.32, x, 0.20, 0.32);
    b.box(M.blackPlastic, 0.08, 0.03, 0.015, x, 0.21, 0.49);
    b.box(M.blackPlastic, 0.12, 0.07, 0.22, x - 0.09, 0.34, 0.32);
    b.box(M.blackPlastic, 0.12, 0.07, 0.22, x + 0.09, 0.34, 0.32);
    b.box(M.darkWood, 0.36, 0.035, 0.05, x, 1.47, 0.48);
  }
}

/** Footprint: len m long × 0.35 m deep × 0.45 m high; freestanding locker-room bench. */
export function addBench(b: Batch, M: IMats, len: number) {
  b.box(M.bench, len, 0.065, 0.35, 0, 0.43, 0);
  for (const x of [-len * 0.42, len * 0.42]) {
    b.box(M.chairFrame, 0.05, 0.40, 0.28, x, 0.20, 0);
    b.box(M.chairFrame, 0.09, 0.04, 0.34, x, 0.04, 0);
  }
  b.box(M.bench, len - 0.12, 0.035, 0.05, 0, 0.20, 0);
}

/** Footprint: n shower stalls each 0.9 m wide × 1.0 m deep × 2.2 m high, backs at z=0. */
export function addShowers(b: Batch, M: IMats, n: number) {
  for (let i = 0; i < n; i++) {
    const x = i * 0.9 + 0.45;
    b.box(M.tile, 0.86, 0.06, 1.0, x, 0.03, 0.50);
    b.box(M.tile, 0.045, 2.1, 1.0, i * 0.9 + 0.02, 1.08, 0.50);
    b.box(M.tile, 0.045, 2.1, 1.0, (i + 1) * 0.9 - 0.02, 1.08, 0.50);
    b.box(M.tile, 0.86, 2.1, 0.05, x, 1.08, 0.035);
    b.box(M.chrome, 0.035, 0.035, 0.38, x, 2.04, 0.20);
    b.cyl(M.chrome, 0.09, 0.03, x, 2.04, 0.39, Math.PI / 2, 0, 12);
    tube(b, M.chrome, 0.014, [x, 2.04, 0.22], [x, 2.13, 0.38]);
    b.box(M.chrome, 0.78, 0.025, 0.025, x, 2.17, 0.86);
    b.box(M.towel, 0.76, 1.65, 0.025, x, 1.30, 0.90);
  }
}

/** Footprint: n sinks across a (0.7n) m long × 0.55 m deep vanity, with wall mirror above. */
export function addVanity(b: Batch, M: IMats, n: number) {
  const width = n * 0.7;
  b.box(M.counter, width, 0.08, 0.55, width / 2, 0.86, 0.275);
  b.box(M.cabinet, width - 0.08, 0.78, 0.48, width / 2, 0.43, 0.27);
  for (let i = 0; i < n; i++) {
    const x = i * 0.7 + 0.35;
    b.box(M.stainless, 0.42, 0.035, 0.32, x, 0.91, 0.29);
    b.box(M.blackPlastic, 0.35, 0.018, 0.25, x, 0.93, 0.29);
    b.cyl(M.chrome, 0.018, 0.22, x, 1.02, 0.10, 0, 0, 8);
    tube(b, M.chrome, 0.012, [x, 1.12, 0.10], [x, 1.17, 0.22]);
    b.box(M.blackPlastic, 0.06, 0.03, 0.16, x, 1.12, 0.25);
  }
  b.box(M.mirror, width - 0.08, 0.75, 0.025, width / 2, 1.48, 0.03);
}

/** Footprint: 1.52 m diameter × 0.76 m high; floor-length white cloth and eight chairs. */
export function addBanquetTable(b: Batch, M: IMats) {
  b.cyl(M.tablecloth, 0.76, 0.72, 0, 0.38, 0, 0, 0, 16, 0.80);
  b.cyl(M.tablecloth, 0.77, 0.045, 0, 0.76, 0, 0, 0, 16, 0.77);
  b.cyl(M.chairFrame, 0.11, 0.69, 0, 0.36, 0, 0, 0, 12, 0.18);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const x = Math.cos(a) * 1.18;
    const z = Math.sin(a) * 1.18;
    b.frame(x, 0, z, -Math.PI / 2 - a, () => addChair(b, M));
  }
}

/** Footprint: 0.48 m wide × 0.5 m deep × 0.95 m high; freestanding chair facing +z, seat at 0.46 m. */
export function addChair(b: Batch, M: IMats) {
  b.box(M.chairSeat, 0.46, 0.06, 0.44, 0, 0.46, 0);
  b.box(M.chairSeat, 0.44, 0.43, 0.055, 0, 0.72, -0.19);
  for (const x of [-0.18, 0.18]) {
    b.box(M.chairFrame, 0.035, 0.45, 0.035, x, 0.225, 0.18);
    b.box(M.chairFrame, 0.035, 0.88, 0.035, x, 0.44, -0.18, 0, 0, -0.04);
    b.box(M.chairFrame, 0.035, 0.035, 0.38, x, 0.46, 0);
  }
  b.box(M.chairFrame, 0.36, 0.035, 0.035, 0, 0.90, -0.18);
}

/** Footprint: 0.72 m wide × 0.65 m deep × 1.1 m high; wooden lectern with sloped reading top. */
export function addPodium(b: Batch, M: IMats) {
  b.box(M.darkWood, 0.70, 0.10, 0.62, 0, 0.05, 0);
  b.box(M.darkWood, 0.54, 0.83, 0.42, 0, 0.49, 0.04);
  b.box(M.darkWood, 0.76, 0.13, 0.62, 0, 0.97, 0.05, 0, 0, -0.10);
  b.box(M.bench, 0.62, 0.035, 0.43, 0, 1.05, 0.05, 0, 0, -0.10);
  tube(b, M.blackPlastic, 0.012, [0.22, 1.00, 0.18], [0.24, 1.28, 0.12]);
  b.box(M.blackPlastic, 0.11, 0.035, 0.035, 0.24, 1.29, 0.12, 0, 0, 0.20);
}

/** Footprint: w m wide × 0.08 m deep × 1.3 m high; wall-mounted screen faces +z. */
export function addProjectorScreen(b: Batch, M: IMats, w: number) {
  b.box(M.blackPlastic, w + 0.12, 0.11, 0.12, w / 2, 2.27, 0.06);
  b.box(M.tablecloth, w, 1.28, 0.025, w / 2, 1.55, 0.13);
  b.box(M.blackPlastic, w + 0.06, 0.035, 0.05, w / 2, 0.89, 0.12);
}

/** Footprint: w m wide × 0.08 m deep; wall-mounted flat panel centred at 1.6 m height. */
export function addWallTV(b: Batch, M: IMats, w: number) {
  const h = w * 0.58;
  b.box(M.blackPlastic, w + 0.06, h + 0.06, 0.075, w / 2, 1.65, 0.06);
  b.box(M.blackPlastic, w, h, 0.015, w / 2, 1.65, 0.105);
  b.box(M.blackPlastic, w * 0.94, h * 0.90, 0.006, w / 2, 1.65, 0.116);
}

/** Footprint: len m long × 0.6 m deep × 2.2 m high; base and upper cabinets with sink, range, hood. */
export function addKitchenRun(b: Batch, M: IMats, len: number) {
  b.box(M.cabinet, len, 0.72, 0.58, len / 2, 0.47, 0.29);
  b.box(M.rubber, len, 0.10, 0.58, len / 2, 0.06, 0.29);
  b.box(M.counter, len + 0.04, 0.06, 0.64, len / 2, 0.86, 0.29);
  for (let x = 0.55; x < len; x += 0.60) {
    b.box(M.darkWood, 0.012, 0.68, 0.012, x, 0.45, 0.595);
    b.box(M.stainless, 0.10, 0.018, 0.012, x - 0.18, 0.62, 0.61);
    b.box(M.stainless, 0.10, 0.018, 0.012, x + 0.18, 0.62, 0.61);
  }
  for (let x = 0.18; x < len; x += 0.60) {
    b.box(M.cabinet, 0.54, 0.72, 0.35, x, 1.82, 0.175);
    b.box(M.darkWood, 0.012, 0.64, 0.012, x, 1.82, 0.355);
    b.box(M.stainless, 0.09, 0.018, 0.012, x, 1.84, 0.37);
  }
  const sinkX = len / 3;
  b.box(M.stainless, 0.50, 0.045, 0.36, sinkX, 0.89, 0.31);
  b.box(M.blackPlastic, 0.41, 0.018, 0.28, sinkX, 0.92, 0.31);
  tube(b, M.chrome, 0.016, [sinkX, 0.91, 0.12], [sinkX, 1.12, 0.12]);
  tube(b, M.chrome, 0.016, [sinkX, 1.12, 0.12], [sinkX, 1.12, 0.28]);
  const rangeX = len * 2 / 3;
  b.box(M.blackPlastic, 0.62, 0.025, 0.48, rangeX, 0.91, 0.31);
  for (let dx of [-0.18, 0.18]) for (const z of [0.20, 0.42]) {
    b.cyl(M.ergBlack, 0.07, 0.014, rangeX + dx, 0.93, z, 0, 0, 12);
  }
  b.box(M.stainless, 0.72, 0.09, 0.52, rangeX, 2.12, 0.26);
  b.box(M.stainless, 0.58, 0.35, 0.16, rangeX, 2.32, 0.06);
}

/** Footprint: 0.9 m wide × 0.8 m deep × 2.0 m high; commercial stainless double-door fridge. */
export function addFridge(b: Batch, M: IMats) {
  b.box(M.stainless, 0.90, 2.0, 0.80, 0, 1.0, 0.40);
  b.box(M.blackPlastic, 0.86, 0.025, 0.012, 0, 1.98, 0.81);
  b.box(M.stainless, 0.012, 1.86, 0.012, 0, 1.02, 0.81);
  for (const x of [-0.23, 0.23]) {
    b.box(M.rackSteel, 0.025, 0.42, 0.025, x, 1.05, 0.83);
    b.box(M.darkWood, 0.34, 0.07, 0.012, x, 1.94, 0.815);
  }
}

/** Footprint: len m long × 0.95 m deep × 0.9 m high; kitchen island with three stools on +z side. */
export function addIsland(b: Batch, M: IMats, len: number) {
  b.box(M.cabinet, len, 0.78, 0.88, 0, 0.42, 0);
  b.box(M.rubber, len - 0.1, 0.10, 0.78, 0, 0.06, 0);
  b.box(M.counter, len + 0.10, 0.06, 0.98, 0, 0.86, 0);
  const spacing = len / 3;
  for (let i = 0; i < 3; i++) {
    const x = -len / 2 + spacing * (i + 0.5);
    b.box(M.blackPlastic, 0.38, 0.06, 0.38, x, 0.66, 0.72);
    for (const dx of [-0.14, 0.14]) for (const dz of [-0.14, 0.14]) {
      b.box(M.chairFrame, 0.025, 0.64, 0.025, x + dx, 0.33, 0.72 + dz);
    }
    b.box(M.chairFrame, 0.32, 0.03, 0.03, x, 0.34, 0.72);
  }
}

/** Footprint: 0.7 m wide × 0.8 m deep × 1.9 m high; commercial front-load washer/dryer stack. */
export function addWasherDryer(b: Batch, M: IMats) {
  b.box(M.stainless, 0.70, 1.90, 0.80, 0, 0.95, 0.40);
  for (const y of [0.48, 1.42]) {
    b.box(M.blackPlastic, 0.50, 0.47, 0.025, 0, y, 0.812);
    b.cyl(M.blackPlastic, 0.205, 0.055, 0, y, 0.84, Math.PI / 2, 0, 16);
    b.cyl(M.glass, 0.155, 0.012, 0, y, 0.88, Math.PI / 2, 0, 16);
    b.cyl(M.stainless, 0.055, 0.014, 0, y, 0.891, Math.PI / 2, 0, 12);
  }
  b.box(M.blackPlastic, 0.46, 0.08, 0.02, 0, 1.78, 0.82);
  b.cyl(M.blackPlastic, 0.035, 0.025, -0.27, 1.78, 0.83, Math.PI / 2, 0, 8);
}

/** Footprint: len m long × 0.75 m deep × 0.9 m high; freestanding laundry folding table. */
export function addFoldingTable(b: Batch, M: IMats, len: number) {
  b.box(M.counter, len, 0.06, 0.75, 0, 0.88, 0);
  for (const x of [-len * 0.43, len * 0.43]) {
    for (const z of [-0.30, 0.30]) b.box(M.rackSteel, 0.035, 0.84, 0.035, x, 0.42, z);
  }
  for (const x of [-len * 0.43, len * 0.43]) b.box(M.rackSteel, 0.035, 0.035, 0.65, x, 0.12, 0);
}

/** Footprint: 0.65 m wide × 0.55 m deep × 0.85 m high; wheeled canvas laundry cart. */
export function addLaundryCart(b: Batch, M: IMats) {
  b.box(M.towel, 0.58, 0.52, 0.45, 0, 0.48, 0);
  for (const x of [-0.31, 0.31]) {
    b.box(M.rackSteel, 0.035, 0.82, 0.035, x, 0.41, 0.25);
    b.box(M.rackSteel, 0.035, 0.82, 0.035, x, 0.41, -0.25);
    b.cyl(M.blackPlastic, 0.07, 0.04, x, 0.07, 0.25, Math.PI / 2, 0, 8);
  }
  b.box(M.rackSteel, 0.68, 0.035, 0.56, 0, 0.11, 0);
  b.box(M.rackSteel, 0.68, 0.035, 0.56, 0, 0.84, 0);
}

/** Footprint: w m wide × 0.45 m deep × h m high; freestanding wire shelves with folded linens. */
export function addShelving(b: Batch, M: IMats, w: number, h: number) {
  for (const x of [-w / 2 + 0.03, w / 2 - 0.03]) for (const z of [-0.19, 0.19]) {
    b.box(M.rackSteel, 0.025, h, 0.025, x, h / 2, z);
  }
  const levels = Math.max(2, Math.floor(h / 0.48));
  for (let i = 0; i < levels; i++) {
    const y = 0.08 + i * ((h - 0.10) / (levels - 1));
    b.box(M.rackSteel, w, 0.025, 0.42, 0, y, 0);
    if (i === 0) continue;
    for (let j = 0; j < Math.max(1, Math.floor(w / 0.28)); j++) {
      b.box(j % 3 === 0 ? M.fabricCardinal : M.towel, 0.24, 0.14, 0.28, -w / 2 + 0.16 + j * 0.28, y + 0.085, 0);
      if (i % 2 === 0) b.box(M.towel, 0.22, 0.09, 0.26, -w / 2 + 0.16 + j * 0.28, y + 0.20, 0);
    }
  }
}

/** Footprint: w m wide × 0.42 m deep × 1.9 m high; trophy cabinet with glass case and three shelves. */
export function addTrophyCase(b: Batch, M: IMats, w: number) {
  b.box(M.darkWood, w, 0.42, 0.42, w / 2, 0.21, 0.21);
  b.box(M.darkWood, w, 0.035, 0.06, w / 2, 0.45, 0.03);
  b.box(M.darkWood, w, 1.35, 0.035, w / 2, 1.12, 0.03);
  b.box(M.glass, w, 1.35, 0.035, w / 2, 1.12, 0.42);
  b.box(M.glass, 0.035, 1.35, 0.39, 0.02, 1.12, 0.22);
  b.box(M.glass, 0.035, 1.35, 0.39, w - 0.02, 1.12, 0.22);
  b.box(M.glass, w, 0.035, 0.39, w / 2, 1.80, 0.22);
  for (let i = 0; i < 3; i++) {
    const y = 0.62 + i * 0.40;
    b.box(M.glass, w - 0.04, 0.025, 0.37, w / 2, y, 0.23);
    for (let j = 0; j < 3; j++) {
      const x = 0.20 + j * ((w - 0.40) / 2);
      placeCup(b, M, x, y + 0.02, 0.23, 0.22 + ((i + j) % 3) * 0.055);
    }
  }
}

/** Footprint: cup and plinth fit within 0.22 m diameter; overall height h m. */
export function addTrophyCup(b: Batch, M: IMats, h: number) {
  const base = h * 0.14;
  b.box(M.darkWood, 0.16, base, 0.16, 0, base / 2, 0);
  b.box(M.darkWood, 0.12, 0.025, 0.12, 0, base + 0.0125, 0);
  const points = [
    new THREE.Vector2(0.045, 0),
    new THREE.Vector2(0.045, h * 0.34),
    new THREE.Vector2(0.075, h * 0.62),
    new THREE.Vector2(0.095, h * 0.73),
    new THREE.Vector2(0.075, h * 0.78),
    new THREE.Vector2(0.03, h * 0.80),
    new THREE.Vector2(0, h * 0.80),
  ];
  const geometry = new THREE.LatheGeometry(points, 12);
  geometry.userData.batchTemp = true;
  b.add(geometry, h > 0.38 ? M.brass : M.silver, new THREE.Matrix4().makeTranslation(0, base + 0.025, 0));
  for (const side of [-1, 1]) {
    tube(b, h > 0.38 ? M.brass : M.silver, 0.009, [side * 0.075, base + h * 0.66, 0], [side * 0.12, base + h * 0.70, 0]);
    tube(b, h > 0.38 ? M.brass : M.silver, 0.009, [side * 0.12, base + h * 0.70, 0], [side * 0.09, base + h * 0.47, 0]);
    tube(b, h > 0.38 ? M.brass : M.silver, 0.009, [side * 0.09, base + h * 0.47, 0], [side * 0.055, base + h * 0.50, 0]);
  }
}

/** Footprint: 0.6 m square × 1.0 m high; pedestal with a large trophy on top. */
export function addPedestal(b: Batch, M: IMats) {
  b.box(M.darkWood, 0.62, 0.08, 0.62, 0, 0.04, 0);
  b.box(M.darkWood, 0.42, 0.82, 0.42, 0, 0.49, 0);
  b.box(M.bench, 0.62, 0.08, 0.62, 0, 0.94, 0);
  placeCup(b, M, 0, 1.0, 0, 0.52);
}

/** Footprint: 0.32 m diameter × 0.08 m deep; wall clock centred at 1.8 m. */
export function addWallClock(b: Batch, M: IMats) {
  b.cyl(M.blackPlastic, 0.16, 0.05, 0, 1.80, 0.05, Math.PI / 2, 0, 16);
  b.cyl(M.tablecloth, 0.14, 0.012, 0, 1.80, 0.082, Math.PI / 2, 0, 16);
  b.cyl(M.blackPlastic, 0.012, 0.012, 0, 1.80, 0.093, Math.PI / 2, 0, 8);
  tube(b, M.blackPlastic, 0.006, [0, 1.80, 0.094], [0.07, 1.85, 0.094]);
  tube(b, M.blackPlastic, 0.006, [0, 1.80, 0.095], [-0.025, 1.88, 0.095]);
  for (let i = 0; i < 12; i++) {
    const a = i * Math.PI / 6;
    tube(b, M.blackPlastic, 0.004, [Math.sin(a) * 0.115, 1.80 + Math.cos(a) * 0.115, 0.095], [Math.sin(a) * 0.13, 1.80 + Math.cos(a) * 0.13, 0.095]);
  }
}

/** Footprint: 0.75 m diameter × 0.55 m deep × 1.2 m high; pedestal-mounted drum fan. */
export function addFloorFan(b: Batch, M: IMats) {
  b.box(M.rackSteel, 0.58, 0.06, 0.40, 0, 0.04, 0);
  b.box(M.rackSteel, 0.08, 0.62, 0.08, 0, 0.36, 0);
  b.cyl(M.blackPlastic, 0.34, 0.16, 0, 0.83, 0, Math.PI / 2, 0, 16);
  b.cyl(M.rackSteel, 0.29, 0.025, 0, 0.83, 0.095, Math.PI / 2, 0, 16);
  b.cyl(M.blackPlastic, 0.06, 0.04, 0, 0.83, 0.12, Math.PI / 2, 0, 12);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    tube(b, M.rackSteel, 0.009, [0, 0.83, 0.12], [Math.cos(a) * 0.28, 0.83 + Math.sin(a) * 0.28, 0.12]);
    b.box(M.ergBlack, 0.07, 0.19, 0.025, Math.cos(a) * 0.14, 0.83 + Math.sin(a) * 0.14, 0.105, 0, 0, a);
  }
}

/** Footprint: 0.52 m diameter × 0.45 m deep × 0.75 m high; freestanding round trash bin. */
export function addTrashBin(b: Batch, M: IMats) {
  b.cyl(M.greyPlastic, 0.25, 0.70, 0, 0.36, 0, 0, 0, 12, 0.21);
  b.cyl(M.blackPlastic, 0.26, 0.045, 0, 0.73, 0, 0, 0, 12, 0.26);
  b.cyl(M.blackPlastic, 0.14, 0.025, 0, 0.755, 0, 0, 0, 12, 0.14);
}

/** Footprint: 0.42 m wide × 0.35 m deep × 1.15 m high; wall-mounted bottle filling fountain. */
export function addWaterFountain(b: Batch, M: IMats) {
  b.box(M.stainless, 0.42, 0.62, 0.28, 0, 0.62, 0.15);
  b.box(M.stainless, 0.40, 0.10, 0.30, 0, 0.95, 0.17, 0, 0, -0.12);
  b.box(M.blackPlastic, 0.30, 0.035, 0.23, 0, 0.95, 0.19, 0, 0, -0.12);
  b.box(M.stainless, 0.28, 0.42, 0.05, 0, 1.36, 0.04);
  b.box(M.blackPlastic, 0.12, 0.06, 0.035, 0, 1.49, 0.07);
  tube(b, M.chrome, 0.012, [0.10, 1.10, 0.08], [0.10, 1.18, 0.22]);
  tube(b, M.chrome, 0.012, [0.10, 1.18, 0.22], [0.10, 1.12, 0.30]);
}
