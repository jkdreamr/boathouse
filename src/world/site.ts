import * as THREE from 'three';
import { boxMeters, textTexture } from '../textures';
import { hullGeometry } from '../rowing/hull';
import { addDynamicFlatFloor, addDynamicRamp, addFlatFloor, addWall } from './collide';
import { mesh } from './build';
import { mats } from './materials';
import { PAD, PAD_Y } from './terrain';
import { conditions } from '../sim/conditions';
import { addSystem } from '../sim/systems';

export const DOCK_Y = 0.5;
export const DOCK = { minX: -45, maxX: 45, minZ: -14.2, maxZ: -11 };
/** Where the varsity eight sits alongside the dock (hull centerline). */
export const MOORING = new THREE.Vector3(0, 0, -18);
export const floatingDock = new THREE.Group();
floatingDock.name = 'floating-dock';
export const gangway = new THREE.Group();
gangway.name = 'gangway';

function decal(x0: number, x1: number, z0: number, z1: number, mat: THREE.Material, y = PAD_Y + 0.006) {
  const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, x0 + uv.getX(i) * (x1 - x0), z0 + uv.getY(i) * (z1 - z0));
  const m = mesh(geo, mat, false, true);
  m.rotation.x = -Math.PI / 2;
  m.position.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  return m;
}

function floatBox(w: number, d: number, x: number, z: number, deck: THREE.Material) {
  const M = mats();
  const side = M.concrete;
  const m = mesh(boxMeters(w, 0.6, d), [side, side, deck, side, side, side] as unknown as THREE.Material);
  m.position.set(x, DOCK_Y - 0.3, z);
  return m;
}

function treeGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const trunk = new THREE.CylinderGeometry(0.12, 0.2, 3.2, 7);
  trunk.translate(0, 1.6, 0);
  const colorize = (g: THREE.BufferGeometry, hex: string, jitter: number) => {
    const c = new THREE.Color(hex);
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const f = 1 - jitter + Math.random() * jitter * 2;
      arr[i * 3] = c.r * f;
      arr[i * 3 + 1] = c.g * f;
      arr[i * 3 + 2] = c.b * f;
    }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    return g;
  };
  parts.push(colorize(trunk.toNonIndexed(), '#5a4636', 0.1));
  const blobs = [
    [0, 4.2, 0, 1.7],
    [0.9, 3.7, 0.4, 1.2],
    [-0.8, 3.8, -0.3, 1.25],
    [0.2, 5.1, -0.2, 1.2],
    [-0.3, 3.4, 0.9, 1.0],
  ];
  for (const [x, y, z, r] of blobs) {
    const b = new THREE.IcosahedronGeometry(r, 1);
    const p = b.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 0.85 + Math.sin(p.getX(i) * 5 + p.getY(i) * 3) * 0.12;
      p.setXYZ(i, p.getX(i) * k + x, p.getY(i) * k + y, p.getZ(i) * k + z);
    }
    b.computeVertexNormals();
    parts.push(colorize(b, '#3f5a2c', 0.18));
  }
  const geo = new THREE.BufferGeometry();
  let n = 0;
  for (const p of parts) n += p.attributes.position.count;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    pos.set(p.attributes.position.array as Float32Array, o * 3);
    nor.set(p.attributes.normal.array as Float32Array, o * 3);
    col.set(p.attributes.color.array as Float32Array, o * 3);
    o += p.attributes.position.count;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function makeTrees(spots: [number, number, number, number][]) {
  const geo = treeGeometry();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
  const im = new THREE.InstancedMesh(geo, mat, spots.length);
  const m = new THREE.Matrix4();
  spots.forEach(([x, y, z, s], i) => {
    m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), i * 2.4), new THREE.Vector3(s, s * (0.9 + (i % 3) * 0.1), s));
    im.setMatrixAt(i, m);
  });
  im.castShadow = true;
  im.receiveShadow = true;
  return im;
}

function launch(color: string) {
  const M = mats();
  const g = new THREE.Group();
  const hull = mesh(hullGeometry({ length: 5.4, beam: 2.0, draft: 0.3, freeboard: 0.5 }, 24, 10), new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.5, side: THREE.DoubleSide }));
  g.add(hull);
  const floor = mesh(new THREE.BoxGeometry(4.2, 0.04, 1.5), M.alu);
  floor.position.y = 0.05;
  g.add(floor);
  const console_ = mesh(new THREE.BoxGeometry(0.6, 0.8, 0.7), M.white);
  console_.position.set(-0.6, 0.45, 0);
  g.add(console_);
  const screen = mesh(new THREE.BoxGeometry(0.05, 0.4, 0.6), M.glassDark);
  screen.position.set(-0.3, 1.0, 0);
  screen.rotation.z = -0.3;
  g.add(screen);
  const motor = mesh(new THREE.BoxGeometry(0.45, 0.6, 0.35), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.4 }));
  motor.position.set(-2.85, 0.65, 0);
  g.add(motor);
  const leg = mesh(new THREE.BoxGeometry(0.12, 0.8, 0.1), M.darkSteel);
  leg.position.set(-2.9, 0.05, 0);
  g.add(leg);
  return g;
}

function sailboat(n: number) {
  const M = mats();
  const g = new THREE.Group();
  const hull = mesh(hullGeometry({ length: 4.2, beam: 1.45, draft: 0.25, freeboard: 0.35 }, 20, 10), M.white);
  hull.position.y = 1.05;
  g.add(hull);
  const cover = mesh(new THREE.BoxGeometry(3.4, 0.25, 1.35), new THREE.MeshStandardMaterial({ color: '#c9ccd0', roughness: 0.9 }));
  cover.position.set(0.1, 1.48, 0);
  g.add(cover);
  const band = mesh(new THREE.BoxGeometry(3.6, 0.1, 1.42), new THREE.MeshStandardMaterial({ color: '#3a63b8', roughness: 0.8 }));
  band.position.set(0.1, 1.36, 0);
  g.add(band);
  const mast = mesh(new THREE.CylinderGeometry(0.04, 0.05, 6.6, 8), M.alu);
  mast.position.set(0.7, 1.4 + 3.3, 0);
  g.add(mast);
  const spreader = mesh(new THREE.BoxGeometry(0.04, 0.03, 0.9), M.alu);
  spreader.position.set(0.7, 4.4, 0);
  g.add(spreader);
  const stand = mesh(new THREE.BoxGeometry(0.5, 0.75, 0.5), M.wood);
  stand.position.set(0.9, 0.38, 0);
  g.add(stand);
  const stand2 = stand.clone();
  stand2.position.x = -1.1;
  g.add(stand2);
  const num = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.4),
    new THREE.MeshStandardMaterial({ map: textTexture(String(n), { color: '#a3241f', w: 128, h: 100, font: 'bold 90px Arial' }), transparent: true }),
  );
  num.position.set(-0.4, 1.12, 0.73);
  g.add(num);
  return g;
}

function car(color: string) {
  const g = new THREE.Group();
  const paint = new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0.6 });
  const body = mesh(boxMeters(4.5, 0.75, 1.8), paint);
  body.position.y = 0.65;
  g.add(body);
  const cab = mesh(boxMeters(2.4, 0.6, 1.62), mats().glassDark);
  cab.position.set(-0.2, 1.3, 0);
  g.add(cab);
  const wheel = new THREE.CylinderGeometry(0.34, 0.34, 0.25, 14);
  wheel.rotateX(Math.PI / 2);
  const tire = new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.9 });
  for (const [x, z] of [
    [1.4, 0.82],
    [-1.4, 0.82],
    [1.4, -0.82],
    [-1.4, -0.82],
  ]) {
    const w = mesh(wheel, tire);
    w.position.set(x, 0.34, z);
    g.add(w);
  }
  return g;
}

function truckAndTrailer() {
  const M = mats();
  const g = new THREE.Group();
  const truck = car('#f4f4f2');
  truck.scale.set(1.35, 1.3, 1.15);
  g.add(truck);
  const logo = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 0.4),
    new THREE.MeshStandardMaterial({ map: textTexture('Stanford', { color: '#8c1515', w: 512, h: 140, font: 'bold 110px Georgia' }), transparent: true }),
  );
  logo.position.set(0.3, 0.95, 1.05);
  g.add(logo);
  const trailer = new THREE.Group();
  trailer.position.set(-12.5, 0, 0);
  const beam = mesh(new THREE.BoxGeometry(16, 0.15, 0.15), M.alu);
  beam.position.y = 0.7;
  trailer.add(beam);
  for (const x of [-6, -2, 2, 6]) {
    const post = mesh(new THREE.BoxGeometry(0.1, 2.4, 0.1), M.alu);
    post.position.set(x, 1.8, 0);
    trailer.add(post);
    for (const y of [1.3, 2.1, 2.9]) {
      const arm = mesh(new THREE.BoxGeometry(0.08, 0.06, 2.4), M.alu);
      arm.position.set(x, y, 0);
      trailer.add(arm);
    }
  }
  const yellow = new THREE.MeshPhysicalMaterial({ color: '#f0cf2e', roughness: 0.3, clearcoat: 0.8 });
  const geo = hullGeometry({ length: 17.6, beam: 0.58, draft: 0.17, freeboard: 0.2 }, 40, 10);
  for (const [y, z] of [
    [1.55, -0.75],
    [1.55, 0.75],
    [2.35, -0.75],
    [2.35, 0.75],
    [3.15, 0],
  ]) {
    const s = mesh(geo, yellow);
    s.rotation.x = Math.PI;
    s.position.set(0, y, z);
    trailer.add(s);
  }
  const wheel = new THREE.CylinderGeometry(0.4, 0.4, 0.25, 14);
  wheel.rotateX(Math.PI / 2);
  for (const z of [-1, 1]) {
    const w = mesh(wheel, new THREE.MeshStandardMaterial({ color: '#151515' }));
    w.position.set(2, 0.4, z);
    trailer.add(w);
  }
  g.add(trailer);
  return g;
}

function lightPole(x: number, z: number) {
  const M = mats();
  const g = new THREE.Group();
  const pole = mesh(new THREE.CylinderGeometry(0.09, 0.13, 9, 8), M.darkSteel);
  pole.position.y = 4.5;
  g.add(pole);
  const head = mesh(new THREE.BoxGeometry(0.7, 0.25, 0.4), M.darkSteel);
  head.position.set(0.25, 9.05, 0);
  g.add(head);
  g.position.set(x, PAD_Y, z);
  return g;
}

function msiShip() {
  const M = mats();
  const g = new THREE.Group();
  const blue = new THREE.MeshStandardMaterial({ color: '#1f3f86', roughness: 0.5, side: THREE.DoubleSide });
  const hull = mesh(hullGeometry({ length: 20, beam: 6.2, draft: 1.2, freeboard: 1.6 }, 30, 14), blue);
  g.add(hull);
  const deck = mesh(new THREE.BoxGeometry(17, 0.2, 5), M.white);
  deck.position.set(0, 1.45, 0);
  g.add(deck);
  const cabin = mesh(boxMeters(8, 2.4, 4.4), M.white);
  cabin.position.set(1.5, 2.7, 0);
  g.add(cabin);
  const bridge = mesh(boxMeters(4.5, 1.8, 3.8), M.white);
  bridge.position.set(2.5, 4.8, 0);
  g.add(bridge);
  const win = mesh(new THREE.BoxGeometry(4.6, 0.6, 3.9), M.glassDark);
  win.position.set(2.5, 5.1, 0);
  g.add(win);
  const band = mesh(new THREE.BoxGeometry(8.1, 0.5, 4.5), M.glassDark);
  band.position.set(1.5, 3.1, 0);
  g.add(band);
  const mast = mesh(new THREE.CylinderGeometry(0.08, 0.1, 4, 8), M.white);
  mast.position.set(3.2, 7.5, 0);
  g.add(mast);
  const name = new THREE.Mesh(
    new THREE.PlaneGeometry(3.6, 0.45),
    new THREE.MeshStandardMaterial({ map: textTexture('MARINE SCIENCE INSTITUTE', { color: '#1f3f86', bg: '#ffffff', w: 1024, h: 128, font: 'bold 72px Arial' }) }),
  );
  name.position.set(2.5, 4.2, 1.92);
  g.add(name);
  return g;
}

export function buildSite(scene: THREE.Scene) {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'site';
  scene.add(root);

  // raised pad with a concrete bulkhead to the creek
  const padW = PAD.maxX - PAD.minX;
  const padD = PAD.maxZ - PAD.minZ;
  const pad = mesh(boxMeters(padW, PAD_Y + 3, padD), [M.concrete, M.concrete, M.asphalt, M.concrete, M.concrete, M.concrete] as unknown as THREE.Material);
  pad.position.set((PAD.minX + PAD.maxX) / 2, (PAD_Y - 3) / 2, (PAD.minZ + PAD.maxZ) / 2);
  root.add(pad);
  addFlatFloor(PAD.minX, PAD.maxX, PAD.minZ, PAD.maxZ, PAD_Y);
  addWall(PAD.minX - 1, PAD.minX + 0.3, PAD.minZ, PAD.maxZ);
  addWall(PAD.maxX - 0.3, PAD.maxX + 1, PAD.minZ, PAD.maxZ);
  addWall(PAD.minX, PAD.maxX, PAD.maxZ - 0.3, PAD.maxZ + 1);

  root.add(decal(-62, 42, 0, 12, M.apron));
  root.add(decal(-62, -24, 12, 44, M.apron));
  root.add(decal(24, 62, 12, 44, M.apron));
  root.add(decal(-24, 24, 34, 44, M.concrete, PAD_Y + 0.008));
  const cap = mesh(boxMeters(padW, 0.18, 0.45), M.concrete);
  cap.position.set((PAD.minX + PAD.maxX) / 2, PAD_Y + 0.02, 0.22);
  root.add(cap);
  const stripeMat = new THREE.MeshBasicMaterial({ color: '#d9d6cc' });
  for (let x = -60; x <= 60; x += 3) {
    for (const z0 of [52, 70]) {
      const s = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 5.2), stripeMat);
      s.rotation.x = -Math.PI / 2;
      s.position.set(x, PAD_Y + 0.01, z0 + 2.6);
      root.add(s);
    }
  }
  const carColors = ['#8a8f96', '#1f2a44', '#e8e8e6', '#5a1d1d', '#2e2e30', '#9aa3a8', '#365a3a'];
  const carSpots = [-55.5, -49.5, -40.5, -31.5, -19.5, -13.5, 4.5, 16.5, 25.5, 40.5, 49.5];
  carSpots.forEach((x, i) => {
    const c = car(carColors[i % carColors.length]);
    c.rotation.y = Math.PI / 2;
    c.position.set(x, PAD_Y, i % 2 ? 54.6 : 72.6);
    root.add(c);
    addWall(x - 1, x + 1, (i % 2 ? 54.6 : 72.6) - 2.3, (i % 2 ? 54.6 : 72.6) + 2.3);
  });
  const tt = truckAndTrailer();
  tt.position.set(-30, PAD_Y, 47);
  root.add(tt);
  addWall(-52, -27, 45.4, 48.6);

  // FJ sailboats on stands with masts up
  for (let i = 0; i < 7; i++) {
    const s = sailboat(i + 3);
    s.rotation.y = Math.PI / 2;
    s.position.set(-56 + i * 2.6, PAD_Y, 5.5);
    root.add(s);
  }
  addWall(-57.5, -38, 3.2, 7.8);

  for (const [x, z] of [
    [-45, 1.2],
    [-12, 1.2],
    [36, 1.2],
    [-40, 42],
    [40, 42],
    [-10, 62],
    [30, 62],
  ])
    root.add(lightPole(x, z));

  const treeSpots: [number, number, number, number][] = [];
  for (let x = -40; x <= 44; x += 9) if (Math.abs(x) > 8) treeSpots.push([x + (x % 2), PAD_Y, 40.5, 0.95 + (Math.abs(x) % 3) * 0.08]);
  for (const [x, z] of [
    [-8.5, 38.5],
    [8.5, 38.5],
    [-27, 30],
    [-29, 20],
    [28, 30],
    [64, 20],
    [66, 34],
    [-66, 22],
    [-68, 36],
    [-80, 60],
    [80, 60],
    [90, 95],
    [-90, 95],
  ])
    treeSpots.push([x, PAD_Y, z, 1.1]);
  root.add(makeTrees(treeSpots));
  for (const [x, , z] of treeSpots) addWall(x - 0.3, x + 0.3, z - 0.3, z + 0.3);

  // gangway down to the floating dock
  const gl = Math.hypot(11, PAD_Y - DOCK_Y);
  const ga = Math.atan2(PAD_Y - DOCK_Y, 11);
  gangway.position.set(0, PAD_Y, 0.2);
  gangway.rotation.x = -ga;
  root.add(gangway);
  const localPosition = (x: number, y: number, z: number) => {
    const dy = y - PAD_Y;
    const dz = z - 0.2;
    return new THREE.Vector3(x, dy * Math.cos(ga) - dz * Math.sin(ga), dy * Math.sin(ga) + dz * Math.cos(ga));
  };
  const addGangwayMesh = (m: THREE.Mesh, x: number, y: number, z: number, upright = false) => {
    m.position.copy(localPosition(x, y, z));
    if (upright) m.rotation.x = ga;
    gangway.add(m);
  };
  const gw = mesh(boxMeters(1.6, 0.1, gl), M.alu);
  addGangwayMesh(gw, 0, (PAD_Y + DOCK_Y) / 2 - 0.02, -5.5);
  for (const s of [-1, 1]) {
    const rail = mesh(new THREE.BoxGeometry(0.06, 0.06, gl), M.alu);
    addGangwayMesh(rail, s * 0.82, (PAD_Y + DOCK_Y) / 2 + 1.0, -5.5);
    const truss = mesh(new THREE.BoxGeometry(0.04, 0.5, gl), M.alu);
    addGangwayMesh(truss, s * 0.82, (PAD_Y + DOCK_Y) / 2 + 0.25, -5.5);
    for (let k = 0; k <= 6; k++) {
      const z = -11 + (11 * k) / 6;
      const y = DOCK_Y + ((z + 11) / 11) * (PAD_Y - DOCK_Y);
      const p = mesh(new THREE.BoxGeometry(0.05, 1.0, 0.05), M.alu);
      addGangwayMesh(p, s * 0.82, y + 0.5, z, true);
    }
  }
  addDynamicRamp(-0.8, 0.8, -11.2, 0.2, 'z', () => DOCK_Y + conditions.level, () => PAD_Y);
  addWall(-1.0, -0.85, -11, -0.2, 0, 3);
  addWall(0.85, 1.0, -11, -0.2, 0, 3);
  addSystem({
    update: () => {
      const dockLevel = DOCK_Y + conditions.level;
      gangway.rotation.x = -Math.asin(THREE.MathUtils.clamp((PAD_Y - dockLevel) / gl, -1, 1));
      floatingDock.position.y = conditions.level;
    },
  });

  // floating docks
  floatingDock.position.y = conditions.level;
  root.add(floatingDock);
  floatingDock.add(floatBox(DOCK.maxX - DOCK.minX, DOCK.maxZ - DOCK.minZ, 0, (DOCK.minZ + DOCK.maxZ) / 2, M.deck));
  addDynamicFlatFloor(DOCK.minX, DOCK.maxX, DOCK.minZ, DOCK.maxZ, () => DOCK_Y + conditions.level);
  for (const fx of [-43, 43]) {
    floatingDock.add(floatBox(3, 12, fx, -20.2, M.deckGray));
    addDynamicFlatFloor(fx - 1.5, fx + 1.5, -26.2, DOCK.minZ, () => DOCK_Y + conditions.level);
  }
  const pileMat = new THREE.MeshStandardMaterial({ color: '#4a3a30', roughness: 0.8 });
  const capMat = M.white;
  for (const [x, z] of [
    [-30, -14.9],
    [-10, -14.9],
    [10, -14.9],
    [30, -14.9],
    [-30, -10.3],
    [30, -10.3],
    [-43, -27],
    [43, -27],
  ]) {
    const p = mesh(new THREE.CylinderGeometry(0.22, 0.22, 7, 12), pileMat);
    p.position.set(x, 0.5, z);
    root.add(p);
    const c = mesh(new THREE.ConeGeometry(0.24, 0.3, 12), capMat);
    c.position.set(x, 4.15, z);
    root.add(c);
  }
  for (let i = 0; i < 6; i++) {
    const cleat = mesh(new THREE.BoxGeometry(0.3, 0.08, 0.08), M.darkSteel);
    cleat.position.set(-12 + i * 5, DOCK_Y + 0.05, DOCK.minZ + 0.2);
    floatingDock.add(cleat);
  }

  const l1 = launch('#c8ccd0');
  l1.position.set(46.6, 0, -21);
  l1.rotation.y = Math.PI / 2;
  floatingDock.add(l1);
  const l2 = launch('#f0f0ee');
  l2.position.set(-46.6, 0, -21);
  l2.rotation.y = -Math.PI / 2;
  floatingDock.add(l2);
  const l3 = launch('#b8bcc2');
  l3.position.set(-34, 0, -10);
  floatingDock.add(l3);

  const ship = msiShip();
  ship.position.set(86, 0, -21);
  floatingDock.add(ship);
  const msiFloat = floatBox(30, 2.6, 85, -16.3, M.deckGray);
  floatingDock.add(msiFloat);
  return root;
}
