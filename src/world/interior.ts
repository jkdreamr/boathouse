import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { EIGHT, FOUR, PAIR, HullSpec, deckGeometry, gunwaleY, halfBeam, hullGeometry, storedHullGeometry } from '../rowing/hull';
import type { BoatClass } from '../rowing/crewboat';
import { addFlatFloor, addRamp, addWall } from './collide';
import { mats } from './materials';
import { BAYS, BALCONY_Y, EAVE, RIDGE_Z, SLOPE, X0, X1, Y0, ZF, ZW } from './boathouseDims';
import { rackSlots, RackSlot } from './racks';
import { Batch, xform } from './interior/batch';
import { imats, IMats } from './interior/imats';
import { Atlas, rand } from './interior/atlas';
import * as P from './interior/props';

/*
 * Arrillaga Family Rowing & Sailing Center interior. gostanford.com describes a two-story,
 * five-bay boathouse with locker rooms, a banquet/function room, a laundry room, a history room
 * and a kitchen; the layout below is a plausible arrangement of those rooms, not a survey.
 */

const FL = Y0; // lower (bay) floor
const CEIL = Y0 + 5.25; // underside of the second-floor slab
const UF = BALCONY_Y; // upstairs floor
const UCEIL = UF + 3.0; // flat ceiling over the small rooms
const DT = 0.1; // half thickness of bay divider walls
const ZDIV = 31.0; // dividers + racks stop here, leaving a cross corridor along the back wall
const TIERS = [0.72, 1.32, 1.92, 2.52, 3.12]; // pad-top heights of rack tiers above the floor
const RACK_UZ = [13.4, 16.3, 19.2, 22.1, 25.0, 27.9, 30.6]; // rack upright stations along z
const SLOT_OFF = [1.15, 0.48]; // [inner (aisle), outer (wall)] slot centre distance from the wall face
const BOW_Z = 12.95; // stored bows point at the bay door (-z)
const STORED_HEADING = Math.PI / 2; // bow toward -z (heading 0 = +x)

// stair in the back of the east (sailing) bay: two flights + mid landing
const SX0 = 16.6;
const SX1 = 21.1;
const SZ_B = [31.3, 32.5]; // flight B (upper), z range
const SZ_A = [32.55, 33.75]; // flight A (lower), z range
const S_MID = FL + (UF - FL) / 2;

// upstairs plan (x/z of partitions)
const UX_BANQ = -9.2; // banquet | erg/kitchen
const UX_HIST = 13.2; // erg/lockers | history
const UZ_ERG = 22.0; // erg | corridor
const UZ_ROOMS = 24.4; // corridor | street-side rooms
const UZ_STAIR = 31.25; // history | stair opening guard
// creek-side cross gable over the centre (see boathouse.ts "dormer gable")
const DORMER_X = 1;
const DORMER_HALF = 4.5;
const DORMER_RISE = DORMER_HALF * 0.7;
const STREET_X = [UX_BANQ, -3.2, 1.0, 7.1, UX_HIST]; // kitchen | laundry | men | women

/** Underside of the vaulted ceiling at z (follows the roof pitch). */
function vaultY(z: number) {
  const d = RIDGE_Z - Math.abs(z - RIDGE_Z) - ZW;
  return EAVE - 0.12 + Math.max(0, d) * SLOPE;
}

/** Plane with UVs in metres (for tiling textures). */
function mplane(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  g.userData.batchTemp = true;
  return g;
}

function floorRect(b: Batch, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, y: number) {
  b.add(mplane(x1 - x0, z1 - z0), mat, xform((x0 + x1) / 2, y, (z0 + z1) / 2, 0, 1, 1, 1, -Math.PI / 2));
}
function ceilRect(b: Batch, mat: THREE.Material, x0: number, x1: number, z0: number, z1: number, y: number) {
  b.add(mplane(x1 - x0, z1 - z0), mat, xform((x0 + x1) / 2, y, (z0 + z1) / 2, 0, 1, 1, 1, Math.PI / 2));
}

/** Room labels for the HUD. */
export function interiorLabel(x: number, y: number, z: number): string | null {
  if (x < X0 || x > X1 || z < ZW || z > ZF) return null;
  if (y < UF - 0.4) {
    if (x > SX0 - 0.2 && z > SZ_B[0] - 0.1 && y > FL + 0.3) return 'Stairs';
    const i = [...BAYS].sort((a, b) => a.x - b.x).findIndex((bb, k, arr) => x < (k < arr.length - 1 ? (bb.x + arr[k + 1].x) / 2 : X1));
    return i === BAYS.length - 1 ? 'Sailing bay' : `Boat bay ${i + 1}`;
  }
  if (x < UX_BANQ) return 'Function room';
  if (x > UX_HIST) return 'History room';
  if (z < UZ_ERG) return 'Erg room';
  if (z < UZ_ROOMS) return 'Upstairs hall';
  if (x < STREET_X[1]) return 'Kitchen';
  if (x < STREET_X[2]) return 'Laundry';
  if (x < STREET_X[3]) return "Men's locker room";
  return "Women's locker room";
}

// ---------------------------------------------------------------- stored shells

const SHELL_COLORS: Record<string, string> = {
  white: '#f1efe8',
  yellow: '#e6c02c',
  carbon: '#2a2b2e',
  cardinal: '#8c1515',
  blue: '#9db6cc',
  silver: '#c4c6c8',
};

const SPEC: Record<BoatClass, HullSpec> = { '8+': EIGHT, '4+': FOUR, '2-': PAIR };
const SEATS: Record<BoatClass, number> = { '8+': 8, '4+': 4, '2-': 2 };

const shellGeoCache = new Map<string, THREE.BufferGeometry>();

function tint(g: THREE.BufferGeometry, color: string) {
  let n = g.index ? g.toNonIndexed() : g;
  if (n !== g) g.dispose();
  for (const k of Object.keys(n.attributes)) if (k !== 'position' && k !== 'normal') n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  const c = new THREE.Color(color);
  const a = new Float32Array(n.attributes.position.count * 3);
  for (let i = 0; i < a.length; i += 3) {
    a[i] = c.r;
    a[i + 1] = c.g;
    a[i + 2] = c.b;
  }
  n.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return n;
}

function boxAt(w: number, h: number, d: number, x: number, y: number, z: number, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

/** One merged, vertex-coloured shell in boat-local coords (bow +x, upright, waterline y=0). */
function shellGeometry(cls: BoatClass, color: string, wood = false) {
  const key = `${cls}:${color}:${wood}`;
  const hit = shellGeoCache.get(key);
  if (hit) return hit;
  const spec = SPEC[cls];
  const L = spec.length;
  const parts: THREE.BufferGeometry[] = [];
  const deck = wood ? '#a8774a' : color === SHELL_COLORS.carbon ? '#3a3b3e' : '#ece6d6';
  parts.push(tint(wood ? hullGeometry(spec, 56, 14) : storedHullGeometry(spec), color));
  parts.push(tint(deckGeometry(spec, L * 0.28, L / 2 - 0.02), deck));
  parts.push(tint(deckGeometry(spec, -L / 2 + 0.02, -L * 0.33), deck));
  // breakwater behind the bow deck
  const bwX = L * 0.28;
  parts.push(tint(boxAt(0.02, 0.06, halfBeam(spec, bwX) * 1.8, bwX, gunwaleY(spec, bwX) + 0.03, 0, 0.5), deck));
  // fin and rudder near the stern
  const finX = -L * 0.3;
  parts.push(tint(boxAt(0.2, 0.08, 0.005, finX, -spec.draft * 0.85 - 0.035, 0), '#18191b'));
  if (cls !== '2-') parts.push(tint(boxAt(0.12, 0.07, 0.005, -L * 0.44, -spec.draft * 0.5 - 0.03, 0), '#18191b'));
  // bow ball
  const ball = new THREE.SphereGeometry(0.03, 8, 6);
  ball.translate(L / 2 + 0.015, gunwaleY(spec, L / 2) - 0.01, 0);
  parts.push(tint(ball, '#f6f6f2'));
  // cockpit: seats on slides, footstretchers, rigger mounting plates (riggers are off for storage)
  const n = SEATS[cls];
  const pitch = 1.37;
  for (let k = 0; k < n; k++) {
    const sx = (k - (n - 1) / 2) * pitch - 0.25;
    parts.push(tint(boxAt(0.28, 0.035, 0.24, sx, 0.0, 0), '#3b3c3f'));
    parts.push(tint(boxAt(0.78, 0.02, 0.02, sx + 0.1, -0.03, 0.09), '#9ea2a6'));
    parts.push(tint(boxAt(0.78, 0.02, 0.02, sx + 0.1, -0.03, -0.09), '#9ea2a6'));
    parts.push(tint(boxAt(0.02, 0.28, 0.32, sx + 0.72, 0.05, 0, 0.75), '#2b2c2f'));
    const side = k % 2 ? 1 : -1;
    const gx = sx + 0.18;
    const hb = halfBeam(spec, gx);
    parts.push(tint(boxAt(0.22, 0.025, 0.05, gx, gunwaleY(spec, gx) + 0.012, side * (hb - 0.02)), '#1f2023'));
    parts.push(tint(boxAt(0.22, 0.025, 0.05, gx + 0.35, gunwaleY(spec, gx) + 0.012, side * (hb - 0.02)), '#1f2023'));
  }
  if (cls !== '2-') {
    const cx = cls === '8+' ? -L * 0.36 : L * 0.36; // stern cox in the eight, bow-loaded four
    parts.push(tint(boxAt(0.5, 0.03, 0.34, cx, -0.02, 0), '#3b3c3f'));
  }
  // painted hull name panel band is omitted: names live on the rack plates
  const merged = mergeVC(parts);
  shellGeoCache.set(key, merged);
  return merged;
}

function mergeVC(parts: THREE.BufferGeometry[]) {
  const total = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const col = new Float32Array(total * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array as Float32Array, o * 3);
    nor.set(g.attributes.normal.array as Float32Array, o * 3);
    col.set(g.attributes.color.array as Float32Array, o * 3);
    o += g.attributes.position.count;
    g.dispose();
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  m.setAttribute('color', new THREE.BufferAttribute(col, 3));
  m.computeBoundingSphere();
  return m;
}

// Generic, plausible shell names (Bay Area places and birds) — not real Stanford shell names.
const SHELL_NAMES = [
  'Redwood', 'Bair Island', 'Tidewater', 'Sequoia', 'Marsh Hawk', 'Great Egret', 'Pelican', 'Farallon',
  'Tamalpais', 'Peregrine', 'Bay Fog', 'Skyline', 'Coyote Point', 'Avocet', 'Black Oystercatcher', 'Cormorant',
  'Dumbarton', 'Seaport', 'Salt Marsh', 'Ebb Tide', 'Flood Tide', 'Westerly', 'Kingfisher', 'Heron',
  'Cardinal Spirit', 'Ravenswood', 'Alviso', 'Baylands', 'Shoreline', 'Montara', 'Half Moon', 'Pescadero',
  'Grebe', 'Sanderling', 'Curlew', 'Osprey', 'Harrier', 'Willet', 'Plover', 'Teal',
  'Golden Gate', 'Diablo', 'Windward', 'Leeward', 'Morning Light', 'Low Tide', 'High Water', 'Slack Water',
  'Steady State', 'Long Reach', 'First Light', 'Dawn Patrol', 'Mudflat', 'Channel Marker', 'Red Nun', 'Green Can',
  'Pier 39', 'Tule Fog', 'Eelgrass', 'Spartina', 'Pickleweed', 'Brant', 'Scoter', 'Merganser',
];

// [inner, outer] class per tier (index 0 = lowest); '' = no shell in that slot
type Fill = [BoatClass | '', BoatClass | ''];
const BAY_FILL: Fill[][] = [
  [['8+', '8+'], ['8+', '4+'], ['4+', '4+'], ['2-', '4+'], ['2-', '2-']],
  [['8+', '8+'], ['4+', '8+'], ['4+', '4+'], ['4+', '2-'], ['2-', '']],
];
// slots left empty because those boats are out on the water / at the dock
const EMPTY = new Set(['b2-R-t0-i', 'b1-L-t1-o', 'b0-R-t3-i', 'b3-L-t2-o', 'b2-L-t4-o', 'b1-R-t4-i', 'b3-R-t1-i']);
const COLOR_CYCLE = ['white', 'yellow', 'white', 'carbon', 'white', 'yellow', 'cardinal', 'white', 'blue', 'silver', 'yellow', 'carbon'];

// ---------------------------------------------------------------- build

export function buildInterior(scene: THREE.Scene) {
  const M = mats();
  const I = imats();
  I.sealedFloor.map!.repeat.set(0.18, 0.18);
  I.rubberFloor.map!.repeat.set(0.6, 0.6);
  I.carpet.map!.repeat.set(0.4, 0.4);
  I.tile.map!.repeat.set(1.6, 1.6);
  I.ceilingTile.map!.repeat.set(0.5, 0.5);
  I.woodFloor.map!.repeat.set(0.5, 0.5);
  const wallDS = I.drywall.clone();
  wallDS.side = THREE.DoubleSide;
  const vaultMat = I.drywall.clone();
  vaultMat.side = THREE.DoubleSide;
  vaultMat.color.set('#f0ede6');
  const lining = I.drywall.clone();
  lining.side = THREE.BackSide;

  const root = new THREE.Group();
  root.name = 'interior';
  scene.add(root);
  const b = new Batch();
  const atlas = new Atlas();

  const bays = [...BAYS].sort((a, c) => a.x - c.x).map((bay, i, arr) => ({
    x: bay.x,
    open: bay.open,
    x0: i ? (arr[i - 1].x + bay.x) / 2 : X0,
    x1: i < arr.length - 1 ? (bay.x + arr[i + 1].x) / 2 : X1,
  }));
  const sail = bays[bays.length - 1];
  const rowing = bays.slice(0, -1);
  const faceL = (bay: (typeof bays)[number]) => bay.x0 + (bay.x0 === X0 ? 0.02 : DT);
  const faceR = (bay: (typeof bays)[number]) => bay.x1 - (bay.x1 === X1 ? 0.02 : DT);

  // ============================== LOWER FLOOR ==============================
  floorRect(b, I.sealedFloor, X0, X1, ZW, ZF, FL + 0.004);

  // bay divider walls (painted block, bearing the upstairs slab)
  for (let i = 1; i < bays.length; i++) {
    const x = bays[i].x0;
    b.box(I.bayPaint, DT * 2, CEIL - FL, ZDIV - ZW, x, (FL + CEIL) / 2, (ZW + ZDIV) / 2);
    b.box(I.accentCardinal, DT * 2 + 0.01, 0.12, ZDIV - ZW, x, FL + 0.06, (ZW + ZDIV) / 2); // painted base
    addWall(x - DT, x + DT, ZW, ZDIV, -10, CEIL);
  }

  // slab underside with the stair opening, steel beams, sprinkler mains
  ceilRect(b, I.slab, X0, X1, ZW, SZ_B[0] - 0.05, CEIL);
  ceilRect(b, I.slab, X0, SX0, SZ_B[0] - 0.05, ZF, CEIL);
  for (let z = 14; z < ZF - 0.5; z += 3) {
    for (const bay of bays) {
      const x0 = bay.x0 + (bay.x0 === X0 ? 0 : DT);
      const x1 = bay.x1 - (bay.x1 === X1 ? 0 : DT);
      if (z > SZ_B[0] && x1 > SX0) continue;
      b.box(I.galv, x1 - x0, 0.02, 0.2, (x0 + x1) / 2, CEIL - 0.36, z);
      b.box(I.galv, x1 - x0, 0.32, 0.012, (x0 + x1) / 2, CEIL - 0.19, z);
    }
  }
  for (const bay of bays) {
    const sx = bay.x + 1.1;
    const zEnd = bay === sail ? SZ_B[0] - 0.4 : ZF - 0.3;
    b.cyl(I.red, 0.04, zEnd - ZW - 0.5, sx, CEIL - 0.48, (ZW + 0.5 + zEnd) / 2, Math.PI / 2, 0, 8);
    for (let z = 14.5; z < zEnd; z += 3.2) b.cyl(I.chrome, 0.012, 0.1, sx, CEIL - 0.56, z, 0, 0, 6);
    b.box(I.greyPlastic, 0.05, 0.05, zEnd - ZW - 0.5, bay.x - 1.4, CEIL - 0.42, (ZW + 0.5 + zEnd) / 2); // conduit
  }

  // high-bay LED fixtures + one point light per bay
  for (const bay of bays) {
    for (const z of [16.4, 21.9, 27.4]) {
      if (bay === sail && z > 30) continue;
      const y = FL + 4.65;
      b.cyl(I.blackPlastic, 0.006, CEIL - 0.4 - y, bay.x, (y + CEIL - 0.4) / 2, z, 0, 0, 4);
      b.cyl(I.ergBlack, 0.24, 0.16, bay.x, y, z, 0, 0, 16, 0.27);
      for (let k = 0; k < 8; k++) b.box(I.ergBlack, 0.015, 0.1, 0.5, bay.x, y + 0.05, z, (k * Math.PI) / 8);
      b.cyl(I.lightPanel, 0.23, 0.01, bay.x, y - 0.085, z, 0, 0, 16);
    }
    const pl = new THREE.PointLight('#fff4e2', 34, 20, 1.5);
    pl.position.set(bay.x, FL + 4.3, 22);
    root.add(pl);
  }

  // trench drain inside each door, round floor drain mid-bay, wet patches near doors and under racks
  const r = rand(77);
  for (const bay of bays) {
    if (bay.open) {
      b.box(I.drainGrate, 3.9, 0.012, 0.26, bay.x, FL + 0.005, 12.75);
      for (let k = 0; k < 26; k++) b.box(I.blackPlastic, 0.05, 0.004, 0.2, bay.x - 1.9 + k * 0.152, FL + 0.012, 12.75);
    }
    b.cyl(I.drainGrate, 0.16, 0.012, bay.x, FL + 0.006, 22.5, 0, 0, 14);
    const patches = bay === sail ? 3 : 6;
    for (let k = 0; k < patches; k++) {
      const near = k < 3;
      const px = near ? bay.x + (r() - 0.5) * 3.4 : bay.x + (r() < 0.5 ? -1 : 1) * (2.8 + r() * 0.8);
      const pz = near ? 13 + r() * 3.5 : 15 + r() * 12;
      const g = new THREE.CircleGeometry(1, 18);
      const pa = g.attributes.position as THREE.BufferAttribute;
      for (let i = 1; i < pa.count; i++) {
        const w = 0.75 + 0.35 * Math.sin(i * 1.7 + k * 3.1) * r();
        pa.setXY(i, pa.getX(i) * w, pa.getY(i) * w);
      }
      g.userData.batchTemp = true;
      b.add(g, I.wet, xform(px, FL + 0.008, pz, r() * Math.PI, 0.4 + r() * 0.9, 0.3 + r() * 0.7, 1, -Math.PI / 2));
    }
  }

  // ---------- shell racks ----------
  const plates: { text: string; x: number; y: number; z: number; ry: number }[] = [];
  let nameIdx = 0;
  let colorIdx = 0;
  rowing.forEach((bay, bi) => {
    for (const side of ['L', 'R'] as const) {
      const face = side === 'L' ? faceL(bay) : faceR(bay);
      const dir = side === 'L' ? 1 : -1;
      const ux = face + dir * 0.06;
      for (const z of RACK_UZ) {
        b.box(I.rackSteel, 0.1, TIERS[4] + 0.3, 0.1, ux, FL + (TIERS[4] + 0.3) / 2, z);
        b.box(I.rackSteel, 0.24, 0.012, 0.24, ux, FL + 0.006, z); // base plate
        for (const t of TIERS) {
          const y = FL + t;
          b.box(I.rackSteel, 1.58, 0.07, 0.05, face + dir * 0.83, y - 0.115, z);
          b.box(I.rackSteel, 0.05, 0.12, 0.05, face + dir * 1.6, y - 0.06, z); // upturned end stop
          b.box(I.rackSteel, 0.36, 0.05, 0.03, face + dir * 0.22, y - 0.21, z, 0, 0, dir * 0.6); // knee brace
          for (const off of SLOT_OFF) b.cyl(I.foam, 0.045, 0.5, face + dir * off, y - 0.045, z, 0, Math.PI / 2, 10);
        }
      }
      addWall(face, face + dir * 1.7, BOW_Z - 0.2, ZDIV, -10, FL + TIERS[4] + 0.45);

      const fill = BAY_FILL[(bi + (side === 'R' ? 1 : 0)) % 2];
      TIERS.forEach((t, ti) => {
        SLOT_OFF.forEach((off, si) => {
          const cls = fill[ti][si];
          if (!cls) return;
          const id = `b${bi}-${side}-t${ti}-${si ? 'o' : 'i'}`;
          const spec = SPEC[cls];
          const pos = new THREE.Vector3(face + dir * off, FL + t + spec.freeboard, BOW_Z + spec.length / 2);
          const name = SHELL_NAMES[nameIdx++ % SHELL_NAMES.length];
          let m: THREE.Mesh | null = null;
          if (!EMPTY.has(id)) {
            const col = SHELL_COLORS[COLOR_CYCLE[colorIdx++ % COLOR_CYCLE.length]];
            m = new THREE.Mesh(shellGeometry(cls, col), I.hull);
            m.name = `shell:${id}`;
            m.userData.color = col;
            m.position.copy(pos);
            m.rotation.set(Math.PI, STORED_HEADING, 0, 'YXZ');
            m.castShadow = false;
            m.receiveShadow = true;
            root.add(m);
          }
          const slot: RackSlot = { id, cls, name, pos, heading: STORED_HEADING, tier: ti, mesh: m };
          rackSlots.push(slot);
          plates.push({ text: `${name}  ${cls}`, x: face + dir * off, y: FL + t - 0.2, z: RACK_UZ[0] - 0.04, ry: Math.PI });
        });
      });
    }
  });
  for (const p of plates) {
    atlas.quad(b, 0.34, 0.07, (g, w, h) => {
      g.fillStyle = '#f4f2ec';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, 10, h);
      g.fillStyle = '#2e2d29';
      g.font = `bold ${Math.floor(h * 0.5)}px Helvetica, Arial, sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(p.text, 18, h / 2 + 1, w - 24);
    }, 640, p.x, p.y, p.z, p.ry);
  }

  // ---------- back cross-corridor: oars, riggers, slings, bench, boards ----------
  // wall frame on the back wall: local +x runs toward world -x, faces -z
  const back = (xRight: number, y: number, fn: () => void) => b.frame(xRight, y, ZF - 0.01, Math.PI, fn);
  rowing.forEach((bay, bi) => {
    const right = faceR(bay);
    const left = faceL(bay);
    back(bay.x + 1.4, FL, () => P.addOarRack(b, I, 26));
    if (bi === 0 || bi === 3) {
      back(right - 0.3, FL, () => P.addRiggerRack(b, I, 12));
      back(left + 2.2, FL, () => P.addSlings(b, I));
      back(left + 1.3, FL, () => P.addSlings(b, I));
    }
    if (bi === 1) {
      back(right - 0.3, FL, () => P.addWorkbench(b, I, 2.4));
      back(right - 0.3, FL + 1.0, () => P.addPegboard(b, I, 2.4, 1.2));
      back(left + 2.9, FL, () => P.addRiggerRack(b, I, 12));
      addWall(right - 2.7, right - 0.3, ZF - 0.8, ZF, -10, FL + 1.0);
    }
    if (bi === 2) {
      back(left + 2.6, FL, () => P.addCoxboxShelf(b, I, 2.2));
      back(left + 2.6, FL + 1.5, () => P.addRiggerRack(b, I, 10));
    }
    back(right - 0.2, FL, () => P.addTrashBin(b, I));
  });
  // a pair of open slings waiting in the corridor
  b.frame(rowing[2].x + 2.6, FL, 32.2, 0, () => P.addSlingOpen(b, I));
  b.frame(rowing[2].x - 2.6, FL, 32.2, 0, () => P.addSlingOpen(b, I));

  // lineup whiteboard on the back wall of the centre rowing bay
  {
    const bay = rowing[Math.min(2, rowing.length - 1)];
    const wx = bay.x + 2.85;
    const wy = FL + 1.65;
    b.box(I.galv, 2.46, 1.26, 0.03, wx, wy, ZF - 0.025);
    b.box(I.galv, 2.3, 0.04, 0.08, wx, wy - 0.64, ZF - 0.06); // marker tray
    const crews = ['1V8+', '2V8+', '3V8+', '1V4+'];
    const seatsTxt = ['Cox', 'Stroke', '7', '6', '5', '4', '3', '2', 'Bow'];
    const letters = 'ABCDEFGHJKLMNPRSTVW';
    const rr = rand(2024);
    const ini = () => `${letters[Math.floor(rr() * letters.length)]}. ${letters[Math.floor(rr() * letters.length)]}${'aeiouy'[Math.floor(rr() * 6)]}${'nrlstmk'[Math.floor(rr() * 7)]}`;
    const eights = rackSlots.filter((s) => s.cls === '8+' && s.mesh && s.tier <= 1);
    atlas.quad(b, 2.4, 1.2, (g, cw, ch) => {
      const w = 1200;
      const h = 600;
      g.scale(cw / w, ch / h);
      g.fillStyle = '#fbfbf8';
      g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(120,130,150,0.12)'; // ghosting from old lineups
      for (let i = 0; i < 6; i++) {
        g.beginPath();
        g.moveTo(rr() * w, rr() * h);
        g.lineTo(rr() * w, rr() * h);
        g.lineWidth = 8 + rr() * 14;
        g.stroke();
      }
      const hand = (s: number) => `${s}px 'Comic Sans MS', 'Chalkboard SE', 'Marker Felt', 'Segoe Print', cursive`;
      g.fillStyle = '#1b3f8f';
      g.font = hand(44);
      g.fillText('LINEUPS — Mon AM', 24, 52);
      g.fillStyle = '#b01e1e';
      g.font = hand(26);
      g.fillText('Hands on 5:45 · launch 6:00 · 3 x 2k @ 28/30/32', 470, 48);
      const colW = (w - 40) / crews.length;
      crews.forEach((c, ci) => {
        const x = 24 + ci * colW;
        g.fillStyle = '#111';
        g.font = hand(34);
        g.fillText(c, x, 110);
        g.font = hand(22);
        g.fillStyle = '#b01e1e';
        g.fillText(ci < 3 ? (eights[ci]?.name ?? '') : 'Seaport', x + 90, 108, colW - 100);
        const rows = ci < 3 ? seatsTxt : ['Cox', 'Stroke', '3', '2', 'Bow'];
        rows.forEach((st, ri) => {
          g.fillStyle = '#555';
          g.font = hand(24);
          g.fillText(st, x, 156 + ri * 46);
          g.fillStyle = '#1d1d1d';
          g.font = hand(28);
          g.fillText(ini(), x + 92, 156 + ri * 46);
        });
        g.strokeStyle = '#1b3f8f';
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(x - 10, 80);
        g.lineTo(x - 10, h - 24);
        g.stroke();
      });
    }, 800, wx, wy, ZF - 0.042, Math.PI);
    // team banner above it
    atlas.quad(b, 4.2, 0.7, (g, w, h) => {
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4f2ec';
      g.font = `bold ${Math.floor(h * 0.62)}px Georgia, 'Times New Roman', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('STANFORD ROWING', w / 2, h / 2 + 2);
    }, 300, bay.x, FL + 3.9, ZF - 0.03, Math.PI);
  }

  // ---------- sailing / launch bay ----------
  {
    // life jackets + launch gear along the divider wall (faces +x, local +x runs toward -z)
    const fx = faceL(sail);
    b.frame(fx, FL, 28.8, Math.PI / 2, () => P.addPfdRack(b, I, 14));
    b.frame(fx, FL, 24.2, Math.PI / 2, () => P.addLaunchGear(b, I, 2.4));
    b.frame(fx, FL, 21.4, Math.PI / 2, () => P.addLaunchGear(b, I, 2.4));
    addWall(fx, fx + 0.55, 19.0, 24.2, -10, FL + 1.9);
    // sailing dinghies on dollies, bows to the door
    for (const [x, z] of [
      [sail.x - 1.6, 18.2],
      [sail.x + 1.9, 18.2],
      [sail.x + 1.9, 25.0],
    ]) {
      const d = makeDinghy();
      d.position.set(x, FL, z);
      root.add(d);
      addWall(x - 0.75, x + 0.75, z - 2.2, z + 2.2, -10, FL + 1.2);
    }
    b.frame(sail.x - 1.6, FL, 24.8, 0, () => P.addFloorFan(b, I));
  }

  // ---------- interior stair (sailing bay, back corridor) ----------
  {
    const rise = (UF - FL) / 32;
    const runA = (SX1 - SX0) / 16;
    const tread = (x0: number, x1: number, z0: number, z1: number, top: number) => {
      b.box(I.galv, x1 - x0 + 0.02, 0.05, z1 - z0, (x0 + x1) / 2, top - 0.025, (z0 + z1) / 2);
      b.box(I.drainGrate, 0.03, 0.03, z1 - z0, x0 + 0.015, top - 0.005, (z0 + z1) / 2); // nosing
    };
    for (let i = 1; i < 16; i++) {
      tread(SX0 + (i - 1) * runA, SX0 + i * runA, SZ_A[0], SZ_A[1], FL + i * rise);
      const xb1 = SX1 - (i - 1) * runA;
      const xb0 = SX1 - i * runA;
      b.box(I.galv, xb1 - xb0 + 0.02, 0.05, SZ_B[1] - SZ_B[0], (xb0 + xb1) / 2, S_MID + i * rise - 0.025, (SZ_B[0] + SZ_B[1]) / 2);
      b.box(I.drainGrate, 0.03, 0.03, SZ_B[1] - SZ_B[0], xb1 - 0.015, S_MID + i * rise - 0.005, (SZ_B[0] + SZ_B[1]) / 2);
    }
    // mid landing + posts
    b.box(I.galv, X1 - SX1, 0.2, ZF - SZ_B[0], (SX1 + X1) / 2, S_MID - 0.1, (SZ_B[0] + ZF) / 2);
    for (const [x, z] of [
      [SX1 + 0.05, SZ_B[0] + 0.05],
      [SX1 + 0.05, ZF - 0.08],
    ])
      b.box(I.rackSteel, 0.1, S_MID - FL - 0.2, 0.1, x, (FL + S_MID - 0.2) / 2, z);
    // stringers
    const ang = Math.atan2(UF - S_MID, SX1 - SX0);
    const sLen = Math.hypot(SX1 - SX0, UF - S_MID);
    for (const z of [SZ_A[0], SZ_A[1]]) b.box(I.rackSteel, sLen, 0.25, 0.05, (SX0 + SX1) / 2, (FL + S_MID) / 2 - 0.12, z, 0, 0, ang);
    for (const z of [SZ_B[0], SZ_B[1]]) b.box(I.rackSteel, sLen, 0.25, 0.05, (SX0 + SX1) / 2, (S_MID + UF) / 2 - 0.12, z, 0, 0, -ang);
    // handrails
    const hr = 0.95;
    b.tube(I.galv, 0.022, new THREE.Vector3(SX0, FL + hr, SZ_A[1] + 0.02), new THREE.Vector3(SX1, S_MID + hr, SZ_A[1] + 0.02));
    b.tube(I.galv, 0.022, new THREE.Vector3(SX1, S_MID + hr, SZ_B[0] - 0.02), new THREE.Vector3(SX0, UF + hr, SZ_B[0] - 0.02));
    b.tube(I.galv, 0.022, new THREE.Vector3(SX0, FL + hr, SZ_A[0] - 0.02), new THREE.Vector3(SX1, S_MID + hr, SZ_A[0] - 0.02));
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      const x = SX0 + t * (SX1 - SX0);
      b.box(I.galv, 0.03, hr, 0.03, x, FL + t * (S_MID - FL) + hr / 2, SZ_A[0] - 0.02);
      b.box(I.galv, 0.03, hr, 0.03, SX1 - t * (SX1 - SX0), S_MID + t * (UF - S_MID) + hr / 2, SZ_B[0] - 0.02);
      b.box(I.galv, 0.03, hr, 0.03, x, FL + t * (S_MID - FL) + hr / 2, SZ_A[1] + 0.02);
    }
    // centre screen between flights
    b.box(I.rackSteel, SX1 - SX0, 0.04, 0.04, (SX0 + SX1) / 2, (FL + UF) / 2, (SZ_B[1] + SZ_A[0]) / 2);
    // slab edge + guard around the upstairs opening
    b.box(I.slab, X1 - SX0, UF - CEIL, 0.05, (SX0 + X1) / 2, (UF + CEIL) / 2, SZ_B[0] - 0.05);
    b.box(I.slab, 0.05, UF - CEIL, ZF - SZ_A[0] + 0.05, SX0 - 0.025, (UF + CEIL) / 2, (SZ_B[1] + ZF) / 2);
    const guard = (a: THREE.Vector3, c: THREE.Vector3) => {
      b.tube(I.galv, 0.024, a.clone().setY(UF + 1.07), c.clone().setY(UF + 1.07));
      b.tube(I.galv, 0.012, a.clone().setY(UF + 0.55), c.clone().setY(UF + 0.55));
      const n = Math.ceil(a.distanceTo(c) / 1.2);
      for (let i = 0; i <= n; i++) {
        const p = a.clone().lerp(c, i / n);
        b.box(I.galv, 0.04, 1.07, 0.04, p.x, UF + 0.535, p.z);
      }
    };
    guard(new THREE.Vector3(SX0, 0, SZ_B[0] - 0.08), new THREE.Vector3(X1 - 0.05, 0, SZ_B[0] - 0.08));
    guard(new THREE.Vector3(SX0 - 0.08, 0, SZ_B[1] + 0.03), new THREE.Vector3(SX0 - 0.08, 0, ZF - 0.05));

    // collision
    addRamp(SX0, SX1, SZ_A[0], SZ_A[1], 'x', FL, S_MID);
    addFlatFloor(SX1, X1, SZ_B[0], ZF, S_MID);
    addRamp(SX0, SX1, SZ_B[0], SZ_B[1], 'x', S_MID, UF, true);
    addWall(SX0 - 0.6, SX1, SZ_B[1] - 0.02, SZ_A[0] + 0.02); // between flights (full height)
    addWall(SX0, X1, SZ_B[0], SZ_B[1], -10, S_MID - 0.1); // nothing walks under flight B / landing
    addWall(SX1, X1, SZ_B[1], ZF, -10, S_MID - 0.1);
    addWall(SX0, X1, SZ_B[0] - 0.12, SZ_B[0] - 0.02, FL + 2.2, UF + 1.2); // flight B side + upstairs guard
    addWall(SX0 - 0.12, SX0 - 0.02, SZ_B[1], ZF, UF - 0.3, UF + 1.2); // upstairs guard over flight A
  }

  // ============================== UPSTAIRS ==============================
  addFlatFloor(X0, X1, ZW, UZ_STAIR, UF);
  addFlatFloor(X0, SX0, UZ_STAIR, ZF, UF);

  // line the inside of the upper siding walls (they are single-sided from outside)
  const siding = M.siding;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.material === siding && m.parent) {
      const twin = new THREE.Mesh(m.geometry, lining);
      twin.position.copy(m.position);
      twin.quaternion.copy(m.quaternion);
      twin.scale.copy(m.scale);
      twin.receiveShadow = true;
      m.parent.add(twin);
    }
  });

  // floors
  floorRect(b, I.woodFloor, X0, UX_BANQ, ZW, ZF, UF + 0.004);
  floorRect(b, I.rubberFloor, UX_BANQ, UX_HIST, ZW, UZ_ERG, UF + 0.004);
  floorRect(b, I.carpet, UX_BANQ, UX_HIST, UZ_ERG, UZ_ROOMS, UF + 0.004);
  floorRect(b, I.tile, UX_BANQ, UX_HIST, UZ_ROOMS, ZF, UF + 0.004);
  floorRect(b, I.carpet, UX_HIST, X1, ZW, UZ_STAIR, UF + 0.004);
  floorRect(b, I.carpet, UX_HIST, SX0, UZ_STAIR, ZF, UF + 0.004);

  // vaulted ceiling under the roof, flat ceiling over the hall and small rooms
  {
    const alpha = Math.atan(SLOPE);
    const run = RIDGE_Z - ZW;
    const sl = run / Math.cos(alpha);
    const yR = vaultY(RIDGE_Z);
    // creek half: a heightfield so the ceiling also tucks under the creek-side cross gable
    {
      const NX = 192;
      const NZ = 24;
      const g = new THREE.PlaneGeometry(X1 - X0, run, NX, NZ);
      g.rotateX(Math.PI / 2);
      const pa = g.attributes.position as THREE.BufferAttribute;
      const uv = g.attributes.uv as THREE.BufferAttribute;
      for (let i = 0; i < pa.count; i++) {
        const x = pa.getX(i);
        const z = ZW + run / 2 + pa.getZ(i);
        let y = vaultY(z);
        if (Math.abs(x - DORMER_X) < DORMER_HALF + 0.4 && z < ZW + 8.1) y = Math.min(y, EAVE + DORMER_RISE - Math.abs(x - DORMER_X) * 0.7 - 0.14);
        pa.setXYZ(i, x, y, z);
        uv.setXY(i, x, z);
      }
      g.computeVertexNormals();
      g.userData.batchTemp = true;
      b.add(g, vaultMat);
    }
    b.add(mplane(X1 - X0, sl), vaultMat, xform(0, (vaultY(ZF) + yR) / 2, ZF - run / 2, 0, 1, 1, 1, -(Math.PI / 2 - alpha)));
    ceilRect(b, I.ceilingTile, UX_BANQ, UX_HIST, UZ_ERG, ZF, UCEIL);
    // exposed glulam ties + king posts in the function room, erg room and history room
    for (const x of [-21.6, -17.6, -13.6, -4.6, 0.4, 5.4, 10.4, 16.2, 20.4]) {
      const zs = x > UX_BANQ && x < UX_HIST ? [ZW, UZ_ERG] : [ZW, ZF];
      b.box(I.glulam, 0.18, 0.36, zs[1] - zs[0], x, EAVE - 0.3, (zs[0] + zs[1]) / 2);
      if (zs[1] > RIDGE_Z) b.box(I.glulam, 0.18, yR - EAVE + 0.2, 0.18, x, (EAVE - 0.3 + yR) / 2, RIDGE_Z);
    }
    b.box(I.glulam, X1 - X0, 0.4, 0.2, 0, yR - 0.12, RIDGE_Z); // ridge beam
  }

  // partitions
  const doors: { x: number; z: number; ry: number; w: number }[] = [];
  /** Partition from a→b along `axis` at `c`, top following topFn(u), door gaps [u0,u1] (u = coordinate along the wall). */
  const partition = (axis: 'x' | 'z', c: number, a: number, e: number, topFn: (u: number) => number, gaps: [number, number][], holes: [number, number, number, number][] = []) => {
    const DH = 2.13;
    const pts: THREE.Vector2[] = [new THREE.Vector2(0, 0)];
    const sorted = [...gaps].sort((p, q) => p[0] - q[0]);
    for (const [g0, g1] of sorted) pts.push(new THREE.Vector2(g0 - a, 0), new THREE.Vector2(g0 - a, DH), new THREE.Vector2(g1 - a, DH), new THREE.Vector2(g1 - a, 0));
    pts.push(new THREE.Vector2(e - a, 0));
    const N = 24;
    for (let i = N; i >= 0; i--) {
      const u = a + ((e - a) * i) / N;
      pts.push(new THREE.Vector2(u - a, topFn(u) - UF));
    }
    const shape = new THREE.Shape(pts);
    for (const [h0, h1, v0, v1] of holes) shape.holes.push(new THREE.Path([new THREE.Vector2(h0 - a, v0), new THREE.Vector2(h1 - a, v0), new THREE.Vector2(h1 - a, v1), new THREE.Vector2(h0 - a, v1)]));
    const geo = new THREE.ShapeGeometry(shape);
    geo.userData.batchTemp = true;
    if (axis === 'x') b.add(geo, wallDS, xform(a, UF, c, 0, 1, 1, 1));
    else b.add(geo, wallDS, xform(c, UF, a, -Math.PI / 2, 1, 1, 1));
    // collision + skirting + door frames
    let u = a;
    for (const [g0, g1] of [...sorted, [e, e] as [number, number]]) {
      if (g0 > u) {
        if (axis === 'x') addWall(u, g0, c - 0.08, c + 0.08, UF - 0.3, UF + 4);
        else addWall(c - 0.08, c + 0.08, u, g0, UF - 0.3, UF + 4);
        const mid = (u + g0) / 2;
        const len = g0 - u;
        if (axis === 'x') b.box(I.darkWood, len, 0.1, 0.14, mid, UF + 0.05, c);
        else b.box(I.darkWood, 0.14, 0.1, len, c, UF + 0.05, mid);
      }
      if (g1 > g0) {
        const mid = (g0 + g1) / 2;
        const w = g1 - g0;
        for (const j of [g0, g1]) {
          if (axis === 'x') b.box(I.darkWood, 0.06, DH, 0.16, j, UF + DH / 2, c);
          else b.box(I.darkWood, 0.16, DH, 0.06, c, UF + DH / 2, j);
        }
        if (axis === 'x') b.box(I.darkWood, w + 0.12, 0.06, 0.16, mid, UF + DH + 0.03, c);
        else b.box(I.darkWood, 0.16, 0.06, w + 0.12, c, UF + DH + 0.03, mid);
        doors.push({ x: axis === 'x' ? g0 : c, z: axis === 'x' ? c : g0, ry: axis === 'x' ? 0 : -Math.PI / 2, w });
      }
      u = g1;
    }
    for (const [h0, h1, v0, v1] of holes) {
      const mid = (h0 + h1) / 2;
      if (axis === 'x') b.box(I.counter, h1 - h0, 0.04, 0.3, mid, UF + v0 - 0.02, c);
      else b.box(I.counter, 0.3, 0.04, h1 - h0, c, UF + v0 - 0.02, mid);
      void v1;
    }
  };
  const flat = () => UCEIL;
  partition('z', UX_BANQ, ZW, ZF, vaultY, [[UZ_ERG + 0.2, UZ_ROOMS - 0.2], [28.4, 29.4]], [[25.4, 27.4, 0.95, 1.95]]);
  partition('z', UX_HIST, ZW, ZF, vaultY, [[UZ_ERG + 0.2, UZ_ROOMS - 0.2]]);
  partition('x', UZ_ERG, UX_BANQ, UX_HIST, () => vaultY(UZ_ERG), [[-8.0, -6.4], [10.8, 12.4]]);
  partition('x', UZ_ROOMS, UX_BANQ, UX_HIST, flat, [[-5.2, -4.2], [-1.7, -0.7], [1.5, 2.5], [11.7, 12.7]]);
  for (const x of STREET_X.slice(1, -1)) partition('z', x, UZ_ROOMS, ZF, flat, []);
  // door leaves standing open
  for (const d of doors) {
    if (d.w > 1.3) continue;
    b.frame(d.x, UF, d.z, d.ry, () => b.box(I.darkWood, 0.045, 2.08, d.w - 0.06, 0.03, 1.05, 0.08 + (d.w - 0.06) / 2));
  }

  // ---------- signs ----------
  const sign = (text: string, x: number, z: number, ry: number, y = UF + 2.42, w = 1.2) =>
    atlas.quad(b, w, 0.2, (g, cw, ch) => {
      g.fillStyle = '#2e2d29';
      g.fillRect(0, 0, cw, ch);
      g.fillStyle = '#f4f2ec';
      g.font = `600 ${Math.floor(ch * 0.5)}px Helvetica, Arial, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, cw / 2, ch / 2 + 1, cw - 16);
    }, 512, x, y, z, ry);
  sign('KITCHEN', -4.7, UZ_ROOMS - 0.012, Math.PI);
  sign('LAUNDRY', -1.2, UZ_ROOMS - 0.012, Math.PI);
  sign("MEN'S LOCKERS", 2.0, UZ_ROOMS - 0.012, Math.PI, undefined, 1.4);
  sign("WOMEN'S LOCKERS", 12.2, UZ_ROOMS - 0.012, Math.PI, undefined, 1.5);
  sign('ERG ROOM', -7.2, UZ_ERG + 0.012, 0);
  sign('ERG ROOM', 11.6, UZ_ERG + 0.012, 0);
  sign('FUNCTION ROOM', UX_BANQ + 0.012, (UZ_ERG + UZ_ROOMS) / 2, Math.PI / 2, undefined, 1.5);
  sign('HISTORY ROOM', UX_HIST - 0.012, (UZ_ERG + UZ_ROOMS) / 2, -Math.PI / 2, undefined, 1.5);

  // ---------- erg room ----------
  {
    const xs: number[] = [];
    for (let x = UX_BANQ + 0.9; x < UX_HIST - 0.6; x += 1.08) xs.push(x);
    for (const zc of [UZ_ERG - 1.85, UZ_ERG - 5.4]) {
      for (const x of xs) b.frame(x, UF, zc, -Math.PI / 2, () => P.addErg(b, I));
      addWall(xs[0] - 0.32, xs[xs.length - 1] + 0.32, zc - 1.22, zc + 1.22, UF - 0.3, UF + 1.2);
    }
    // mirror wall facing the ergs: live reflection only while the camera is in the room
    const mx0 = -6.2;
    const mx1 = 10.6;
    const mw = mx1 - mx0;
    const my = UF + 1.35;
    const mh = 2.1;
    b.box(I.chrome, mw + 0.06, mh + 0.06, 0.02, (mx0 + mx1) / 2, my, UZ_ERG - 0.012);
    const still = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), I.mirror);
    still.position.set((mx0 + mx1) / 2, my, UZ_ERG - 0.025);
    still.rotation.y = Math.PI;
    root.add(still);
    const refl = new Reflector(new THREE.PlaneGeometry(mw, mh), { textureWidth: 1024, textureHeight: 256, color: new THREE.Color('#c8cdd0'), clipBias: 0.003 });
    refl.position.set((mx0 + mx1) / 2, my, UZ_ERG - 0.03);
    refl.rotation.y = Math.PI;
    refl.visible = false;
    root.add(refl);
    // Scene.onBeforeRender is called as (renderer, scene, camera, renderTarget)
    type Hook = (renderer: THREE.WebGLRenderer, sc: THREE.Scene, cam: THREE.Camera, rt: unknown) => void;
    const prev = scene.onBeforeRender as unknown as Hook;
    const hook: Hook = (renderer, sc, cam, rt) => {
      prev.call(scene, renderer, sc, cam, rt);
      if (rt) return; // don't toggle during the reflector's own pass
      const p = cam.position;
      const inside = p.y > UF + 0.3 && p.y < UF + 4 && p.x > UX_BANQ && p.x < UX_HIST && p.z > ZW && p.z < UZ_ERG;
      refl.visible = inside;
      still.visible = !inside;
    };
    scene.onBeforeRender = hook as unknown as typeof scene.onBeforeRender;
    for (let k = 1; k < 7; k++) b.box(I.chrome, 0.02, mh, 0.03, mx0 + (k * mw) / 7, my, UZ_ERG - 0.04); // panel joints
    b.frame(UX_BANQ + 0.02, UF, 16.2, Math.PI / 2, () => P.addWallTV(b, I, 1.6));
    b.frame(UX_HIST - 0.02, UF + 0.6, 17.0, -Math.PI / 2, () => P.addWallClock(b, I));
    b.frame(UX_BANQ + 1.1, UF, 13.0, 0.6, () => P.addFloorFan(b, I));
    b.frame(UX_HIST - 1.1, UF, 13.0, -0.6, () => P.addFloorFan(b, I));
    b.frame(UX_HIST - 0.02, UF, 20.6, -Math.PI / 2, () => P.addWaterFountain(b, I));
    for (const x of [-4.5, 1.5, 7.5]) {
      for (const z of [14.2, 18.3]) {
        b.box(I.lightPanel, 2.4, 0.04, 0.18, x, UF + 3.15, z);
        b.box(I.ergBlack, 2.44, 0.06, 0.22, x, UF + 3.19, z);
        for (const dx of [-1, 1]) b.cyl(I.blackPlastic, 0.004, vaultY(z) - UF - 3.2, x + dx, (UF + 3.2 + vaultY(z)) / 2, z, 0, 0, 4);
      }
    }
    const pl = new THREE.PointLight('#f4f6ff', 26, 16, 1.5);
    pl.position.set(2, UF + 2.9, 17);
    root.add(pl);
  }

  // ---------- function / banquet room ----------
  {
    const tables: [number, number][] = [];
    for (const x of [-21.0, -17.2, -13.4]) for (const z of [15.4, 19.0, 22.6, 26.2, 29.8]) if (!(x === -13.4 && z < 17)) tables.push([x, z]);
    tables.forEach(([x, z], i) => {
      b.frame(x, UF, z, i * 0.4, () => P.addBanquetTable(b, I));
      addWall(x - 0.95, x + 0.95, z - 0.95, z + 0.95, UF - 0.3, UF + 1.0);
    });
    // stage end: screen + podium on the east partition
    b.frame(UX_BANQ - 0.02, UF + 0.9, 14.9, -Math.PI / 2, () => P.addProjectorScreen(b, I, 3.0));
    b.frame(UX_BANQ - 1.4, UF, 17.6, -Math.PI / 2 - 0.5, () => P.addPodium(b, I));
    // buffet table by the kitchen door
    b.frame(UX_BANQ - 0.6, UF, 31.4, Math.PI / 2, () => {
      b.box(I.tablecloth, 3.0, 0.74, 0.76, 0, 0.37, 0);
      b.box(I.stainless, 0.5, 0.1, 0.3, -0.9, 0.79, 0);
      b.box(I.stainless, 0.5, 0.1, 0.3, 0, 0.79, 0);
      b.box(I.stainless, 0.5, 0.1, 0.3, 0.9, 0.79, 0);
    });
    addWall(UX_BANQ - 1.0, UX_BANQ, 29.8, 33.0, UF - 0.3, UF + 1.0);
    // drum pendants
    for (const x of [-21.0, -17.2, -13.4]) {
      for (const z of [17.2, 24.4, 31.0]) {
        const y = UF + 3.3;
        const top = vaultY(z);
        b.cyl(I.blackPlastic, 0.004, top - y, x, (top + y) / 2, z, 0, 0, 4);
        b.cyl(I.fabricDark, 0.32, 0.3, x, y, z, 0, 0, 18);
        b.cyl(I.lightPanel, 0.3, 0.01, x, y - 0.155, z, 0, 0, 18);
      }
    }
    for (const z of [17, 28]) {
      const pl = new THREE.PointLight('#ffe7c4', 26, 18, 1.5);
      pl.position.set(-17.2, UF + 2.9, z);
      root.add(pl);
    }
    // framed crew photos along the street wall between windows
    photoRow(b, atlas, I, -11.4, ZF - 0.02, Math.PI, 3, 11);
  }

  // ---------- kitchen ----------
  {
    const kx0 = UX_BANQ;
    const kx1 = STREET_X[1];
    b.frame(kx1 - 0.1, UF, ZF - 0.01, Math.PI, () => P.addKitchenRun(b, I, 5.0));
    addWall(kx0, kx1, ZF - 0.65, ZF, UF - 0.3, UF + 2.3);
    b.frame(kx1 - 0.02, UF, 26.6, -Math.PI / 2, () => P.addFridge(b, I));
    addWall(kx1 - 0.85, kx1, 26.1, 27.1, UF - 0.3, UF + 2.3);
    b.frame((kx0 + kx1) / 2, UF, 29.4, 0, () => P.addIsland(b, I, 2.4));
    addWall((kx0 + kx1) / 2 - 1.25, (kx0 + kx1) / 2 + 1.25, 28.9, 29.9, UF - 0.3, UF + 1.0);
    b.frame(kx0 + 0.02, UF, 25.0, Math.PI / 2, () => P.addTrashBin(b, I));
    b.box(I.lightPanel, 1.2, 0.02, 0.6, (kx0 + kx1) / 2, UCEIL - 0.012, 27.0);
    b.box(I.lightPanel, 1.2, 0.02, 0.6, (kx0 + kx1) / 2, UCEIL - 0.012, 31.5);
  }

  // ---------- laundry ----------
  {
    const lx0 = STREET_X[1];
    const lx1 = STREET_X[2];
    for (let k = 0; k < 4; k++) b.frame(lx1 - 0.5 - k * 0.78, UF, ZF - 0.01, Math.PI, () => P.addWasherDryer(b, I));
    addWall(lx0, lx1, ZF - 0.85, ZF, UF - 0.3, UF + 2.0);
    b.frame(lx0 + 0.02, UF, 30.6, Math.PI / 2, () => P.addFoldingTable(b, I, 2.4));
    addWall(lx0, lx0 + 0.8, 28.2, 30.6, UF - 0.3, UF + 1.0);
    b.frame(lx1 - 0.02, UF, 25.4, -Math.PI / 2, () => P.addShelving(b, I, 2.4, 2.0));
    addWall(lx1 - 0.5, lx1, 25.4, 27.8, UF - 0.3, UF + 2.0);
    b.frame(lx0 + 1.6, UF, 26.6, 0.3, () => P.addLaundryCart(b, I));
    b.box(I.lightPanel, 1.2, 0.02, 0.6, (lx0 + lx1) / 2, UCEIL - 0.012, 29.0);
  }

  // ---------- locker rooms ----------
  for (const [x0, x1, label] of [
    [STREET_X[2], STREET_X[3], 'M'],
    [STREET_X[3], STREET_X[4], 'W'],
  ] as [number, number, string][]) {
    const nL = 9;
    b.frame(x0 + 0.02, UF, 25.4 + nL * 0.6, Math.PI / 2, () => P.addLockerBank(b, I, nL));
    b.frame(x1 - 0.02, UF, 25.4, -Math.PI / 2, () => P.addLockerBank(b, I, nL));
    addWall(x0, x0 + 0.5, 25.4, 25.4 + nL * 0.6, UF - 0.3, UF + 2.1);
    addWall(x1 - 0.5, x1, 25.4, 25.4 + nL * 0.6, UF - 0.3, UF + 2.1);
    const cx = (x0 + x1) / 2;
    b.frame(cx, UF, 28.1, Math.PI / 2, () => P.addBench(b, I, 3.6));
    addWall(cx - 0.2, cx + 0.2, 26.3, 29.9, UF - 0.3, UF + 0.5);
    b.frame(x1 - 0.5, UF, ZF - 0.01, Math.PI, () => P.addShowers(b, I, 5));
    addWall(x0, x1, ZF - 1.05, ZF, UF - 0.3, UF + 2.3);
    if (label === 'M') b.frame(x0 + 3.2, UF, UZ_ROOMS + 0.01, 0, () => P.addVanity(b, I, 3));
    else b.frame(x0 + 0.4, UF, UZ_ROOMS + 0.01, 0, () => P.addVanity(b, I, 3));
    addWall(label === 'M' ? x0 + 3.2 : x0 + 0.4, (label === 'M' ? x0 + 3.2 : x0 + 0.4) + 2.1, UZ_ROOMS, UZ_ROOMS + 0.6, UF - 0.3, UF + 1.0);
    for (const z of [26.5, 29.5, 32.6]) b.box(I.lightPanel, 1.2, 0.02, 0.6, cx, UCEIL - 0.012, z);
  }

  // ---------- history room ----------
  {
    const hx = (UX_HIST + X1) / 2;
    // trophy cases on the west partition and along the creek wall beside the tall window
    b.frame(UX_HIST + 0.02, UF, 13.0 + 3.2, Math.PI / 2, () => P.addTrophyCase(b, I, 3.2));
    b.frame(UX_HIST + 0.02, UF, 13.0 + 6.6, Math.PI / 2, () => P.addTrophyCase(b, I, 3.2));
    addWall(UX_HIST, UX_HIST + 0.45, 13.0, 19.8, UF - 0.3, UF + 2.0);
    b.frame(UX_HIST + 0.4, UF, ZW + 0.02, 0, () => P.addTrophyCase(b, I, 3.4));
    addWall(UX_HIST + 0.4, UX_HIST + 3.8, ZW, ZW + 0.45, UF - 0.3, UF + 2.0);
    b.frame(21.5, UF, ZW + 0.02, 0, () => P.addTrophyCase(b, I, 2.2));
    addWall(21.5, 23.7, ZW, ZW + 0.45, UF - 0.3, UF + 2.0);
    for (const [x, z] of [
      [hx - 2.2, 17.5],
      [hx + 2.2, 17.5],
      [hx - 2.2, 26.0],
      [hx + 2.2, 26.0],
    ]) {
      b.frame(x, UF, z, 0, () => P.addPedestal(b, I));
      addWall(x - 0.35, x + 0.35, z - 0.35, z + 0.35, UF - 0.3, UF + 1.4);
    }
    // framed photos + plaques on the partition walls
    photoRow(b, atlas, I, UX_HIST + 0.015, 24.6, Math.PI / 2, 5, 31, true);
    plaqueRow(b, atlas, UX_HIST + 0.015, 20.6, Math.PI / 2, 6, UF + 1.15);
    // decorative oars over the trophy cases
    for (let k = 0; k < 3; k++) {
      const y = UF + 2.25 + k * 0.22;
      b.box(I.towel, 0.04, 0.04, 3.2, UX_HIST + 0.06, y, 17.2);
      b.box(I.blackPlastic, 0.045, 0.045, 0.5, UX_HIST + 0.06, y, 15.4);
      b.box(I.accentCardinal, 0.01, 0.2, 0.55, UX_HIST + 0.04, y, 19.05);
    }
    // a historic wooden eight hung from the roof, right side up
    const wooden = new THREE.Mesh(shellGeometry('8+', '#9a6a3c', true), I.hull);
    wooden.position.set(hx, UF + 3.15, 21.6);
    wooden.rotation.y = Math.PI / 2;
    root.add(wooden);
    for (const z of [15.0, 21.6, 28.2]) {
      for (const dx of [-0.22, 0.22]) b.cyl(I.chrome, 0.004, vaultY(z) - UF - 3.3, hx + dx, (UF + 3.3 + vaultY(z)) / 2, z, 0, 0, 4);
      b.box(I.blackPlastic, 0.56, 0.03, 0.06, hx, UF + 3.06, z);
    }
    // history title + bench
    atlas.quad(b, 3.0, 0.5, (g, w, h) => {
      g.fillStyle = '#8c1515';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#f4f2ec';
      g.font = `bold ${Math.floor(h * 0.42)}px Georgia, 'Times New Roman', serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText('STANFORD ROWING HISTORY', w / 2, h / 2 + 2, w - 40);
    }, 300, UX_HIST + 0.015, UF + 2.75, 27.6, Math.PI / 2);
    b.frame(hx, UF, 30.2, 0, () => P.addBench(b, I, 2.0));
    const pl = new THREE.PointLight('#ffeccc', 24, 16, 1.5);
    pl.position.set(hx, UF + 2.8, 21.6);
    root.add(pl);
    for (const z of [14.4, 19.0, 24.2, 29.0]) b.cyl(I.lightPanel, 0.12, 0.02, hx, UF + 3.0, z, 0, 0, 12);
  }

  // corridor lights
  for (let x = -6.5; x < UX_HIST; x += 4.4) b.box(I.lightPanel, 1.2, 0.02, 0.3, x, UCEIL - 0.012, (UZ_ERG + UZ_ROOMS) / 2);

  atlas.finish();
  b.flush(root, { cast: false, receive: true });
}

// ---------------------------------------------------------------- framed pictures

function drawPhoto(g: CanvasRenderingContext2D, w: number, h: number, seed: number) {
  const r = rand(seed);
  const sepia = r() < 0.55;
  const tone = (l: number) => (sepia ? `rgb(${Math.round(l * 1.08)},${Math.round(l * 0.94)},${Math.round(l * 0.76)})` : `rgb(${l},${l},${l})`);
  // mat
  g.fillStyle = '#f2efe6';
  g.fillRect(0, 0, w, h);
  const m = Math.round(w * 0.09);
  const iw = w - 2 * m;
  const ih = h - 2 * m;
  g.save();
  g.translate(m, m);
  const horizon = ih * (0.35 + r() * 0.15);
  const sky = g.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, tone(205));
  sky.addColorStop(1, tone(178));
  g.fillStyle = sky;
  g.fillRect(0, 0, iw, horizon);
  g.fillStyle = tone(110);
  g.beginPath();
  g.moveTo(0, horizon);
  for (let x = 0; x <= iw; x += iw / 12) g.lineTo(x, horizon - 4 - r() * 14);
  g.lineTo(iw, horizon);
  g.fill();
  g.fillStyle = tone(130);
  g.fillRect(0, horizon, iw, ih - horizon);
  for (let i = 0; i < 40; i++) {
    g.fillStyle = tone(140 + Math.round(r() * 40));
    g.fillRect(r() * iw, horizon + r() * (ih - horizon), 10 + r() * 30, 1.5);
  }
  const team = r() < 0.3;
  if (team) {
    // team portrait on the dock: rows of figures
    g.fillStyle = tone(150);
    g.fillRect(0, ih * 0.62, iw, ih * 0.38);
    for (let row = 0; row < 2; row++) {
      const n = 9 - row;
      for (let i = 0; i < n; i++) {
        const x = iw * 0.12 + ((iw * 0.76) / (n - 1)) * i + row * 6;
        const y = ih * (0.52 + row * 0.13);
        g.fillStyle = tone(r() < 0.5 ? 50 : 70);
        g.fillRect(x - 7, y, 14, 30);
        g.beginPath();
        g.arc(x, y - 6, 6, 0, Math.PI * 2);
        g.fillStyle = tone(95 + Math.round(r() * 40));
        g.fill();
      }
    }
  } else {
    const boats = r() < 0.4 ? 2 : 1;
    for (let k = 0; k < boats; k++) {
      const y = horizon + (ih - horizon) * (0.35 + k * 0.32);
      const x0 = iw * (0.08 + r() * 0.1);
      const len = iw * (0.7 - k * 0.12);
      g.strokeStyle = tone(35);
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(x0, y);
      g.lineTo(x0 + len, y);
      g.stroke();
      const n = 8;
      const phase = r();
      for (let i = 0; i < n; i++) {
        const x = x0 + len * (0.12 + (0.78 * i) / (n - 1));
        const lean = (phase - 0.5) * 6;
        g.fillStyle = tone(40);
        g.fillRect(x - 2 + lean, y - 11, 4, 9);
        g.beginPath();
        g.arc(x + lean, y - 13, 2.6, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = tone(55);
        g.lineWidth = 1.2;
        g.beginPath();
        g.moveTo(x, y - 4);
        const s = i % 2 ? 1 : -1;
        g.lineTo(x - 14 + phase * 8, y + s * 9 + 3);
        g.stroke();
      }
    }
  }
  // grain
  for (let i = 0; i < 500; i++) {
    g.fillStyle = `rgba(0,0,0,${r() * 0.08})`;
    g.fillRect(r() * iw, r() * ih, 1, 1);
  }
  g.restore();
  // caption strip (generic, no names or results)
  g.fillStyle = '#8a8478';
  g.fillRect(w * 0.3, h - m * 0.6, w * 0.4, 2);
}

function photoRow(b: Batch, atlas: Atlas, I: IMats, x: number, z: number, ry: number, n: number, seed: number, grid = false) {
  const fw = 0.62;
  const fh = 0.48;
  const rows = grid ? 2 : 1;
  b.frame(x, BALCONY_Y, z, ry, () => {
    for (let row = 0; row < rows; row++) {
      for (let i = 0; i < n; i++) {
        const lx = i * (fw + 0.28) + fw / 2;
        const ly = 1.3 + row * (fh + 0.22) + fh / 2;
        b.box(I.darkWood, fw + 0.06, fh + 0.06, 0.03, lx, ly, 0.015);
        atlas.quad(b, fw, fh, (g, w, h) => drawPhoto(g, w, h, seed + row * 37 + i * 7), 360, lx, ly, 0.032);
      }
    }
  });
}

function plaqueRow(b: Batch, atlas: Atlas, x: number, z: number, ry: number, n: number, y: number) {
  const I = imats();
  b.frame(x, y, z, ry, () => {
    for (let i = 0; i < n; i++) {
      const lx = -(i % 3) * 0.55 - 0.25;
      const ly = Math.floor(i / 3) * 0.62;
      b.box(I.darkWood, 0.36, 0.46, 0.025, lx, ly, 0.0125);
      atlas.quad(b, 0.26, 0.34, (g, w, h) => {
        const grd = g.createLinearGradient(0, 0, w, h);
        grd.addColorStop(0, '#d8b85e');
        grd.addColorStop(0.5, '#f1d98a');
        grd.addColorStop(1, '#b8943e');
        g.fillStyle = grd;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = '#7a5f22';
        g.lineWidth = 3;
        g.strokeRect(6, 6, w - 12, h - 12);
        g.fillStyle = '#4a3a14';
        g.font = `bold ${Math.floor(w * 0.075)}px Georgia, serif`;
        g.textAlign = 'center';
        g.fillText('STANFORD ROWING', w / 2, h * 0.16);
        // engraved lines stand in for text that we don't invent
        for (let k = 0; k < 9; k++) {
          const lw = w * (0.45 + ((k * 37 + i * 11) % 30) / 100);
          g.fillStyle = 'rgba(74,58,20,0.55)';
          g.fillRect((w - lw) / 2, h * (0.28 + k * 0.075), lw, 3);
        }
      }, 520, lx, ly, 0.027);
    }
  });
}

function makeDinghy() {
  const M = mats();
  const I = imats();
  const g = new THREE.Group();
  const hull = new THREE.Mesh(storedHullGeometry({ length: 4.2, beam: 1.4, draft: 0.3, freeboard: 0.25 }), M.white);
  hull.rotation.y = Math.PI / 2;
  hull.position.y = 0.75;
  hull.receiveShadow = true;
  g.add(hull);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 3.6), new THREE.MeshStandardMaterial({ color: '#3d64b0', roughness: 0.8 }));
  cover.position.y = 1.0;
  g.add(cover);
  const dolly = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.5, 0.1), I.galv);
  dolly.position.set(0, 0.25, 0.8);
  g.add(dolly);
  const dolly2 = dolly.clone();
  dolly2.position.z = -0.8;
  g.add(dolly2);
  for (const z of [-1.3, 1.3]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.1, 12), I.rubber);
    w.rotation.z = Math.PI / 2;
    w.position.set(0.62, 0.15, z);
    g.add(w);
    const w2 = w.clone();
    w2.position.x = -0.62;
    g.add(w2);
  }
  return g;
}
