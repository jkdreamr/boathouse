import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { boxMeters, textTexture } from '../textures';
import { hullGeometry } from '../rowing/hull';
import { addDynamicFlatFloor, addFlatFloor, addWall, floors } from './collide';
import { mesh } from './build';
import { mats } from './materials';
import { PAD, PAD_Y } from './terrain';
import { conditions, KT } from '../sim/conditions';
import { addSystem } from '../sim/systems';
import { applyWindSway } from './props';
import { mergeStaticMeshes } from './mergeStatic';

export const DOCK_Y = 0.5;
export const DOCK = { minX: -45, maxX: 45, minZ: -14.2, maxZ: -11 };
// [realism:water]
export const dockDeckY = () => DOCK_Y + conditions.level;
/** Where the varsity eight sits alongside the dock (hull centerline). */
export const MOORING = new THREE.Vector3(0, 0, -18);
export const floatingDock = new THREE.Group();
floatingDock.name = 'floating-dock';
floatingDock.userData.staticMergeExclude = true;
export const gangway = new THREE.Group();
gangway.name = 'gangway';
gangway.userData.staticMergeExclude = true;

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
  // [realism:water]
  applyWindSway(mat, { stiffness: 0.0009, minY: 0 });
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

// [realism:water]
let pileSurfaceTexture: THREE.CanvasTexture | null = null;

function pileTexture() {
  if (pileSurfaceTexture) return pileSurfaceTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const py = (y: number) => ((4 - y) / 9) * canvas.height;
  ctx.fillStyle = '#705b46';
  ctx.fillRect(0, 0, 512, 512);
  ctx.fillStyle = '#2c3326';
  ctx.fillRect(0, py(-1.9), 512, 512 - py(-1.9));
  ctx.fillStyle = '#716f63';
  ctx.fillRect(0, py(-0.6), 512, py(-1.9) - py(-0.6));
  const algae = ctx.createLinearGradient(0, py(0.25), 0, py(-0.6));
  algae.addColorStop(0, '#82774f');
  algae.addColorStop(1, '#39452c');
  ctx.fillStyle = algae;
  ctx.fillRect(0, py(0.25), 512, py(-0.6) - py(0.25));
  ctx.fillStyle = '#332f25';
  ctx.fillRect(0, py(0.4), 512, Math.max(3, py(0.25) - py(0.4)));

  let seed = 719;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 150; i++) {
    const x = rnd() * 512;
    ctx.strokeStyle = `rgba(35,25,18,${0.08 + rnd() * 0.13})`;
    ctx.lineWidth = 1 + rnd() * 3;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + rnd() * 8 - 4, 170, x + rnd() * 8 - 4, 340, x + rnd() * 8 - 4, 512);
    ctx.stroke();
  }
  const speckles = (count: number, minY: number, maxY: number, colors: string[], radius: number) => {
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = colors[Math.floor(rnd() * colors.length)];
      ctx.beginPath();
      ctx.arc(rnd() * 512, py(minY + rnd() * (maxY - minY)), radius * (0.45 + rnd()), 0, Math.PI * 2);
      ctx.fill();
    }
  };
  speckles(1300, -5, -1.9, ['rgba(142,151,127,.5)', 'rgba(13,21,17,.7)', 'rgba(91,91,73,.7)'], 1.3);
  speckles(2100, -1.9, -0.6, ['rgba(222,220,201,.88)', 'rgba(178,181,171,.9)', 'rgba(112,110,99,.8)'], 1.8);
  speckles(520, -0.6, 0.25, ['rgba(44,57,31,.65)', 'rgba(129,119,72,.55)'], 1.5);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  pileSurfaceTexture = texture;
  return texture;
}

// [realism:water]
function windsockGeometry() {
  const length = 1.5;
  const segments = 16;
  const positions: number[] = [];
  const indices: number[] = [];
  for (let ring = 0; ring <= 3; ring++) {
    const x = (length * ring) / 3;
    const r = THREE.MathUtils.lerp(0.35, 0.15, ring / 3);
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      positions.push(x, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  for (let band = 0; band < 3; band++) {
    for (let i = 0; i < segments; i++) {
      const a = band * segments + i;
      const b = band * segments + ((i + 1) % segments);
      const c = (band + 1) * segments + i;
      const d = (band + 1) * segments + ((i + 1) % segments);
      indices.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const bandSize = segments * 6;
  for (let band = 0; band < 3; band++) geo.addGroup(band * bandSize, bandSize, band % 2);
  geo.computeVertexNormals();
  return geo;
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

  // [realism:water]
  const gangwayLength = 13.5;
  let gangwayHeight = PAD_Y - (dockDeckY() + 0.26);
  let gangwayAngle = Math.asin(THREE.MathUtils.clamp(gangwayHeight / gangwayLength, -1, 1));
  let gangwayFootZ = 0.2 - gangwayLength * Math.cos(gangwayAngle);
  gangway.position.set(0, PAD_Y, 0.2);
  root.add(gangway);
  const gangwayParts: THREE.BufferGeometry[] = [];
  const addGangwayPart = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const part = new THREE.BoxGeometry(w, h, d);
    part.translate(x, y, z);
    gangwayParts.push(part);
  };
  addGangwayPart(1.6, 0.1, gangwayLength, 0, -0.05, -gangwayLength / 2);
  for (const side of [-1, 1]) {
    const x = side * 0.82;
    addGangwayPart(0.05, 0.42, gangwayLength, x, -0.3, -gangwayLength / 2);
    addGangwayPart(0.06, 0.06, gangwayLength, side * 0.86, 0.94, -gangwayLength / 2);
    addGangwayPart(0.05, 0.05, gangwayLength, side * 0.86, 0.48, -gangwayLength / 2);
    for (let k = 0; k <= 13; k++) {
      const z = -0.2 - ((gangwayLength - 0.4) * k) / 13;
      addGangwayPart(0.05, 0.9, 0.05, side * 0.86, 0.45, z);
    }
  }
  const gangwayGeometry = mergeGeometries(gangwayParts);
  for (const part of gangwayParts) part.dispose();
  if (gangwayGeometry) gangway.add(mesh(gangwayGeometry, M.alu));
  const roller = mesh(new THREE.CylinderGeometry(0.08, 0.08, 1.7, 12), M.darkSteel);
  roller.rotation.z = Math.PI / 2;
  roller.position.set(0, -0.18, -gangwayLength);
  gangway.add(roller);

  const transitionPlate = mesh(new THREE.BoxGeometry(1.6, 0.05, 0.7), M.alu);
  root.add(transitionPlate);
  const updateGangway = () => {
    const footTopY = dockDeckY() + 0.26;
    const dockLevel = dockDeckY();
    gangwayHeight = PAD_Y - footTopY;
    gangwayAngle = Math.asin(THREE.MathUtils.clamp(gangwayHeight / gangwayLength, -1, 1));
    const cosine = Math.cos(gangwayAngle);
    gangwayFootZ = 0.2 - gangwayLength * cosine;
    gangway.rotation.x = -gangwayAngle;
    transitionPlate.position.set(0, (footTopY + dockLevel) / 2, gangwayFootZ - 0.35);
    transitionPlate.rotation.x = Math.atan2(dockLevel - footTopY, 0.7);
  };
  floors.push({
    minX: -0.8,
    maxX: 0.8,
    minZ: -14.2,
    maxZ: 0.2,
    y: (_x, z) => {
      if (z >= gangwayFootZ) return PAD_Y - ((0.2 - z) * gangwayHeight) / (gangwayLength * Math.cos(gangwayAngle));
      if (z >= gangwayFootZ - 0.7) {
        const t = (z - (gangwayFootZ - 0.7)) / 0.7;
        return dockDeckY() + 0.26 * t;
      }
      return dockDeckY();
    },
  });
  addWall(-1.0, -0.85, -12.4, -0.2, -5, 3);
  addWall(0.85, 1.0, -12.4, -0.2, -5, 3);
  updateGangway();
  addSystem({
    update: () => {
      updateGangway();
      floatingDock.position.y = conditions.level;
    },
  });

  const windsockPole = mesh(new THREE.CylinderGeometry(0.06, 0.09, 5, 8), M.darkSteel);
  windsockPole.position.set(5.5, PAD_Y + 2.5, 1.0);
  root.add(windsockPole);
  addWall(5.35, 5.65, 0.85, 1.15, PAD_Y, PAD_Y + 5);
  const windsockRoot = new THREE.Group();
  windsockRoot.userData.staticMergeExclude = true;
  windsockRoot.position.set(5.5, PAD_Y + 5, 1.0);
  root.add(windsockRoot);
  const windsock = new THREE.Mesh(
    windsockGeometry(),
    [
      new THREE.MeshStandardMaterial({ color: '#ef6b26', roughness: 0.75, side: THREE.DoubleSide }),
      new THREE.MeshStandardMaterial({ color: '#f4eee1', roughness: 0.8, side: THREE.DoubleSide }),
    ],
  );
  windsock.castShadow = false;
  windsock.receiveShadow = false;
  windsockRoot.add(windsock);
  addSystem({
    update: (_dt, time) => {
      const speed = conditions.wind.length();
      windsockRoot.rotation.y = Math.atan2(-conditions.wind.y, conditions.wind.x);
      const droop = (1 - THREE.MathUtils.clamp(speed / (15 * KT), 0, 1)) * (80 * Math.PI) / 180;
      windsock.rotation.z = -droop + Math.sin(time * 10) * 0.035 * (0.5 + conditions.gust);
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
  // [realism:water]
  const pileSpots: [number, number][] = [
    [-30, -14.9],
    [-10, -14.9],
    [10, -14.9],
    [30, -14.9],
    [-30, -10.3],
    [30, -10.3],
    [-43, -27],
    [43, -27],
  ];
  const pileMat = new THREE.MeshStandardMaterial({ map: pileTexture(), roughness: 0.86 });
  const capMat = M.white;
  const pilings = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.22, 9, 16, 1), pileMat, pileSpots.length);
  const pileCaps = new THREE.InstancedMesh(new THREE.ConeGeometry(0.24, 0.3, 12), capMat, pileSpots.length);
  const pileMatrix = new THREE.Matrix4();
  pileSpots.forEach(([x, z], i) => {
    pileMatrix.makeTranslation(x, -0.5, z);
    pilings.setMatrixAt(i, pileMatrix);
    pileMatrix.makeTranslation(x, 4.15, z);
    pileCaps.setMatrixAt(i, pileMatrix);
  });
  pilings.instanceMatrix.needsUpdate = true;
  pileCaps.instanceMatrix.needsUpdate = true;
  root.add(pilings, pileCaps);
  const hoopGeometry = new THREE.TorusGeometry(0.34, 0.035, 8, 24);
  hoopGeometry.rotateX(Math.PI / 2);
  const guideHoops = new THREE.InstancedMesh(hoopGeometry, M.darkSteel, pileSpots.length);
  const guideBrackets = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.08, 0.08), M.darkSteel, pileSpots.length);
  const guideMatrix = new THREE.Matrix4();
  const guidePosition = new THREE.Vector3();
  const guideDirection = new THREE.Vector3();
  const guideRotation = new THREE.Quaternion();
  const guideScale = new THREE.Vector3();
  pileSpots.forEach(([x, z], i) => {
    guideMatrix.makeTranslation(x, DOCK_Y + 0.15, z);
    guideHoops.setMatrixAt(i, guideMatrix);
    const edgeX = z < -20 ? x : THREE.MathUtils.clamp(x, DOCK.minX, DOCK.maxX);
    const edgeZ = z < -20 ? -26.2 : THREE.MathUtils.clamp(z, DOCK.minZ, DOCK.maxZ);
    guidePosition.set((edgeX + x) / 2, DOCK_Y + 0.15, (edgeZ + z) / 2);
    guideDirection.set(x - edgeX, 0, z - edgeZ);
    const length = guideDirection.length();
    guideRotation.setFromUnitVectors(new THREE.Vector3(1, 0, 0), guideDirection.normalize());
    guideScale.set(length, 1, 1);
    guideMatrix.compose(guidePosition, guideRotation, guideScale);
    guideBrackets.setMatrixAt(i, guideMatrix);
  });
  floatingDock.add(guideHoops, guideBrackets);
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
  mergeStaticMeshes(root);
  return root;
}
