import * as THREE from 'three';
import { conditions } from '../sim/conditions';
import { addSystem } from '../sim/systems';
import { RIDGE_Z } from './boathouseDims';
import { BirdCalls, type CallKind } from './birds/calls';
import { birdMaterials } from './birds/material';
import * as Models from './birds/models';
import { DOCK, DOCK_Y } from './site';
import { centerline, PAD_Y, southBank, terrainHeight } from './terrain';

/*
 * Birds of Redwood Creek / Bair Island: brown pelicans, Forster's terns, western and California gulls,
 * double-crested cormorants, great blue herons, great and snowy egrets and willets.
 * One InstancedMesh per model (12 draw calls + splashes + pilings); wings, legs and necks are posed in the vertex shader.
 */

type Kind = 'pelican' | 'tern' | 'wgull' | 'cgull' | 'cormorant' | 'heron' | 'egret' | 'snowy' | 'willet';
type Mode =
  | 'line' | 'search' | 'dive' | 'sit' | 'run'
  | 'patrol' | 'hover' | 'plunge' | 'climb'
  | 'soar' | 'land' | 'perch' | 'leave'
  | 'transit' | 'swim' | 'under' | 'alight'
  | 'wade' | 'fly' | 'flock';

interface Spec {
  model: Models.Model;
  /** cruising wingbeat frequency, Hz */
  hz: number;
  amp: number;
  wrist: number;
  bias: number;
  glide: [number, number];
  upFlex: number;
  /** cruising airspeed, m/s */
  air: number;
  /** max yaw rate, rad/s */
  turn: number;
  /** flush distance from the player, m */
  flush: number;
  call: CallKind;
}

const TAU = Math.PI * 2;
const G = 9.81;
const wrap = (a: number) => a - TAU * Math.floor((a + Math.PI) / TAU);
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = THREE.MathUtils.clamp;

let seed = 20251006;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const range = (a: number, b: number) => a + (b - a) * rnd();

/** Surface under a point: water or ground, whichever is higher. */
const surfaceY = (x: number, z: number) => Math.max(conditions.level, terrainHeight(x, z));
const depthAt = (x: number, z: number) => conditions.level - terrainHeight(x, z);

/** z on a bank where the water is `depth` deep (negative = that far above the waterline), searching out from the channel centre. */
function wadeZ(x: number, north: boolean, depth: number) {
  const c = centerline(x);
  const dir = north ? -1 : 1;
  let prev = c;
  for (let s = 2; s <= 160; s += 2) {
    const z = c + dir * s;
    if (depthAt(x, z) <= depth) {
      let a = prev;
      let b = z;
      for (let i = 0; i < 10; i++) {
        const m = (a + b) / 2;
        if (depthAt(x, m) <= depth) b = m;
        else a = m;
      }
      return (a + b) / 2;
    }
    prev = z;
  }
  return null;
}

class Pool {
  mesh: THREE.InstancedMesh;
  private anim: THREE.InstancedBufferAttribute;
  private neck: THREE.InstancedBufferAttribute;
  private used = 0;
  private static m = new THREE.Matrix4();
  private static q = new THREE.Quaternion();
  private static e = new THREE.Euler(0, 0, 0, 'YZX');
  private static one = new THREE.Vector3(1, 1, 1);
  private static zero = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(scene: THREE.Scene, model: Models.Model, cap: number, key: string) {
    const geo = model.geo;
    this.anim = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    this.neck = new THREE.InstancedBufferAttribute(new Float32Array(cap), 1);
    this.anim.setUsage(THREE.DynamicDrawUsage);
    this.neck.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', this.anim);
    geo.setAttribute('aNeck', this.neck);
    const { mat, depth } = birdMaterials(model.rig, key);
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.customDepthMaterial = depth;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.name = 'birds-' + key;
    for (let i = 0; i < cap; i++) this.mesh.setMatrixAt(i, Pool.zero);
    scene.add(this.mesh);
  }

  take() {
    return this.used++;
  }

  write(i: number, b: Bird) {
    Pool.q.setFromEuler(Pool.e.set(b.bank, b.yaw, b.pitch));
    this.mesh.setMatrixAt(i, Pool.m.compose(b.p, Pool.q, Pool.one));
    this.anim.setXYZW(i, b.a1, b.a2, b.fold, b.legs);
    this.neck.setX(i, b.neck);
  }

  hide(i: number) {
    this.mesh.setMatrixAt(i, Pool.zero);
  }

  flush() {
    this.mesh.instanceMatrix.needsUpdate = true;
    this.anim.needsUpdate = true;
    this.neck.needsUpdate = true;
  }
}

interface Perch {
  x: number;
  z: number;
  y: () => number;
  yaw: number;
  kinds: Kind[];
  dry?: boolean;
  bird: Bird | null;
}

class Splashes {
  mesh: THREE.InstancedMesh;
  private items: { x: number; y: number; z: number; age: number; life: number; size: number }[] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private s = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    const geo = new THREE.CylinderGeometry(0.55, 0.25, 1, 12, 1, true).translate(0, 0.5, 0);
    const mat = new THREE.MeshBasicMaterial({ color: '#f2f5f4', transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, 10);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'bird-splashes';
    for (let i = 0; i < 10; i++) {
      this.items.push({ x: 0, y: 0, z: 0, age: 1, life: 1, size: 0 });
      this.mesh.setMatrixAt(i, new THREE.Matrix4().makeScale(0, 0, 0));
    }
    scene.add(this.mesh);
  }

  spawn(x: number, z: number, size: number) {
    let best = this.items[0];
    for (const it of this.items) if (it.age / it.life > best.age / best.life) best = it;
    Object.assign(best, { x, y: conditions.level, z, age: 0, life: 0.5 + size * 0.5, size });
  }

  update(dt: number) {
    this.items.forEach((it, i) => {
      if (it.age >= it.life) {
        this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        return;
      }
      it.age += dt;
      const k = Math.min(1, it.age / it.life);
      const r = it.size * (0.35 + 1.1 * k);
      const h = it.size * 1.6 * Math.sin(Math.PI * Math.min(1, k * 1.3)) + 0.001;
      this.mesh.setMatrixAt(i, this.m.compose(this.v.set(it.x, it.y, it.z), this.q, this.s.set(r, h, r)));
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/** Shared state for a line of pelicans: the leader's recent track, replayed by the followers. */
class Line {
  hist: Float32Array;
  head = 0;
  count = 0;
  acc = 0;
  wp = 0;
  static readonly N = 900;
  static readonly STEP = 0.05;
  constructor(public route: THREE.Vector3[]) {
    this.hist = new Float32Array(Line.N * 7);
  }
  push(b: Bird, dt: number) {
    this.acc += dt;
    while (this.acc >= Line.STEP) {
      this.acc -= Line.STEP;
      const o = this.head * 7;
      this.hist.set([b.p.x, b.p.y - conditions.level, b.p.z, b.yaw, b.pitch, b.bank, b.flapGoal], o);
      this.head = (this.head + 1) % Line.N;
      this.count = Math.min(Line.N, this.count + 1);
    }
  }
  /** Sample `delay` seconds back (clamped to the oldest sample). */
  sample(delay: number, out: number[]) {
    const back = Math.min(this.count - 1, Math.round(delay / Line.STEP));
    const o = ((this.head - 1 - back + Line.N * 2) % Line.N) * 7;
    for (let i = 0; i < 7; i++) out[i] = this.hist[o + i];
  }
}

/** Shared state for a flock of willets. */
interface Flock {
  north: boolean;
  cx: number;
  goal: number;
  flying: boolean;
  members: Bird[];
}

const tmpS: number[] = [0, 0, 0, 0, 0, 0, 0];
const _w = new THREE.Vector2();

class Bird {
  p = new THREE.Vector3();
  v = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  bank = 0;
  air = 0;
  phase = rnd() * TAU;
  flap = 0;
  flapGoal = 0;
  a1 = 0;
  a2 = 0;
  fold = 1;
  legs = 0;
  neck = 0;
  mode: Mode = 'soar';
  t = 0;
  timer = 0;
  aux = 0;
  goal = new THREE.Vector3();
  home = new THREE.Vector3();
  perch: Perch | null = null;
  line: Line | null = null;
  lineIndex = 0;
  flock: Flock | null = null;
  north = true;
  wantDepth = 0.15;
  standing = false;
  radius = 40;
  dir = 1;
  callIn = range(4, 30);
  private repath = 0;

  constructor(
    readonly kind: Kind,
    readonly spec: Spec,
    readonly flySlot: [Pool, number],
    readonly standSlot: [Pool, number] | null = null,
  ) {}

  /** Steer toward a point using air-relative heading, wind drift, coordinated banking and a climb/descent rate limit. */
  fly(dt: number, tx: number, ty: number, tz: number, speed: number, turn = this.spec.turn, climb = 2.5) {
    const h = Math.max(0, this.p.y - surfaceY(this.p.x, this.p.z));
    const wk = clamp(0.55 + 0.15 * Math.log(1 + h), 0.4, 1.1);
    _w.set(conditions.wind.x, conditions.wind.y).multiplyScalar(wk);
    let dx = tx - this.p.x;
    let dz = tz - this.p.z;
    const d = Math.hypot(dx, dz) || 1;
    dx = (dx / d) * speed - _w.x;
    dz = (dz / d) * speed - _w.y;
    const yawGoal = Math.atan2(-dz, dx);
    const rate = clamp(wrap(yawGoal - this.yaw) * 1.6, -turn, turn);
    this.yaw = wrap(this.yaw + rate * dt);
    this.air = damp(this.air, speed, 1.2, dt);
    const gust = Math.hypot(_w.x, _w.y); // conditions.wind already includes gusts
    const chop = gust * 0.025 * Math.sin(this.t * 2.3 + this.phase) * Math.sin(this.t * 0.9 + 1.7);
    this.bank = damp(this.bank, clamp(-Math.atan((this.air * rate) / G), -0.85, 0.85) + chop, 4, dt);
    this.v.y = damp(this.v.y, clamp((ty - this.p.y) * 0.9, -climb * 1.4, climb), 2.5, dt);
    this.v.x = Math.cos(this.yaw) * this.air + _w.x;
    this.v.z = -Math.sin(this.yaw) * this.air + _w.y;
    this.p.addScaledVector(this.v, dt);
    const floor = surfaceY(this.p.x, this.p.z) + 0.35;
    if (this.p.y < floor) {
      this.p.y = floor;
      this.v.y = Math.max(0, this.v.y);
    }
    this.pitch = damp(this.pitch, clamp(Math.atan2(this.v.y, Math.max(1, this.air)) * 0.7, -0.5, 0.5), 3, dt);
    return d;
  }

  /** Wing pose from the flap state machine: amplitude eases in and out so bouts start and stop smoothly. */
  wings(dt: number, hzMul = 1, ampMul = 1) {
    const s = this.spec;
    this.flap = damp(this.flap, this.flapGoal, 5, dt);
    if (this.flap > 0.01) this.phase += TAU * s.hz * hzMul * dt;
    const f = this.flap;
    const sn = Math.sin(this.phase);
    this.a1 = s.glide[0] * (1 - f) + (s.bias + s.amp * ampMul * sn) * f;
    this.a2 = s.glide[1] * (1 - f) + s.wrist * ampMul * Math.sin(this.phase - 0.9) * f;
    this.fold = s.upFlex * f * Math.max(0, Math.cos(this.phase));
  }

  /** Flap-glide rhythm: bouts of a few beats separated by glides. */
  rhythm(dt: number, beats: [number, number], glide: [number, number], force = false) {
    this.timer -= dt;
    if (force) {
      this.flapGoal = 1;
      return;
    }
    if (this.timer <= 0) {
      if (this.flapGoal > 0.5) {
        this.flapGoal = 0;
        this.timer = range(glide[0], glide[1]);
      } else {
        this.flapGoal = 1;
        this.timer = range(beats[0], beats[1]) / this.spec.hz;
      }
    }
  }

  /** Standing on legs with the body pitched by `pitch`: keep the legs vertical and the feet on `y`. */
  stand(y: number, pitch: number) {
    const m = this.spec.model;
    const hip = m.rig.hip;
    this.pitch = pitch;
    this.legs = -pitch;
    this.p.y = y + m.legLen - (hip.x * Math.sin(pitch) + hip.y * Math.cos(pitch));
    this.bank = 0;
    this.fold = 1;
    this.a1 = 0;
    this.a2 = 0;
    this.flap = 0;
    this.flapGoal = 0;
  }

  write() {
    const [fp, fi] = this.flySlot;
    if (this.mode === 'under') {
      fp.hide(fi);
      if (this.standSlot) this.standSlot[0].hide(this.standSlot[1]);
      return;
    }
    if (this.standSlot && this.standing) {
      fp.hide(fi);
      this.standSlot[0].write(this.standSlot[1], this);
    } else {
      if (this.standSlot) this.standSlot[0].hide(this.standSlot[1]);
      fp.write(fi, this);
    }
  }

  get flying() {
    return !['perch', 'sit', 'swim', 'under', 'wade'].includes(this.mode);
  }

  /** Decide if it is time to re-solve the wading line (cheap but not every frame). */
  due(dt: number, every: number) {
    this.repath -= dt;
    if (this.repath > 0) return false;
    this.repath = every;
    return true;
  }
}

/** A long loop: down the creek `near` metres off the south shore, back up it `far` metres north of the centreline. */
const PELICAN_ROUTE = (near: number, far: number, x0: number, x1: number) => {
  const pts: THREE.Vector3[] = [];
  for (let x = x0; x <= x1; x += 120) pts.push(new THREE.Vector3(x, 0, southBank(x) - near));
  for (let x = x1; x >= x0; x -= 120) pts.push(new THREE.Vector3(x, 0, centerline(x) - far));
  return pts;
};

export function initBirds(scene: THREE.Scene, getPlayerPos: () => THREE.Vector3, opts?: { muted?: () => boolean }) {
  const models = {
    pelican: Models.pelican(),
    tern: Models.tern(),
    wgull: Models.gull('western'),
    cgull: Models.gull('california'),
    cormorant: Models.cormorant(),
    heronFly: Models.heronFly(Models.HERON_COLORS.heron, 1),
    heronStand: Models.heronStand(Models.HERON_COLORS.heron, 1),
    egretFly: Models.heronFly(Models.HERON_COLORS.egret, 0.78),
    egretStand: Models.heronStand(Models.HERON_COLORS.egret, 0.84, 1),
    snowyFly: Models.heronFly(Models.HERON_COLORS.snowy, 0.56),
    snowyStand: Models.heronStand(Models.HERON_COLORS.snowy, 0.56, 1),
    willet: Models.willet(),
  };
  // Wingbeat frequencies follow Pennycuick (1990, J. exp. Biol. 150) where measured: brown pelican 3.0 Hz,
  // double-crested cormorant 5.0, great blue heron 2.55, great egret 2.8, herring gull 3.05 (for western),
  // laughing gull 2.74; tern, snowy egret and willet are scaled from similar-sized species in the same table.
  const SPECS: Record<Kind, Spec> = {
    pelican: { model: models.pelican, hz: 3.0, amp: 0.5, wrist: 0.32, bias: 0.05, glide: [0.06, -0.14], upFlex: 0.12, air: 10.5, turn: 0.55, flush: 20, call: 'pelican' },
    tern: { model: models.tern, hz: 3.6, amp: 0.62, wrist: 0.45, bias: 0.1, glide: [0.1, -0.05], upFlex: 0.25, air: 8.5, turn: 1.6, flush: 12, call: 'tern' },
    wgull: { model: models.wgull, hz: 3.0, amp: 0.5, wrist: 0.35, bias: 0.06, glide: [0.1, -0.12], upFlex: 0.2, air: 10.5, turn: 0.9, flush: 16, call: 'gull' },
    cgull: { model: models.cgull, hz: 3.15, amp: 0.5, wrist: 0.35, bias: 0.06, glide: [0.1, -0.12], upFlex: 0.2, air: 10, turn: 0.95, flush: 16, call: 'gull' },
    cormorant: { model: models.cormorant, hz: 5.0, amp: 0.45, wrist: 0.25, bias: 0.04, glide: [0.0, -0.05], upFlex: 0.1, air: 15, turn: 0.7, flush: 22, call: 'pelican' },
    heron: { model: models.heronFly, hz: 2.55, amp: 0.55, wrist: 0.35, bias: -0.08, glide: [-0.02, -0.12], upFlex: 0.15, air: 9.5, turn: 0.6, flush: 25, call: 'heron' },
    egret: { model: models.egretFly, hz: 2.8, amp: 0.55, wrist: 0.35, bias: -0.08, glide: [-0.02, -0.1], upFlex: 0.15, air: 9, turn: 0.65, flush: 22, call: 'heron' },
    snowy: { model: models.snowyFly, hz: 3.6, amp: 0.55, wrist: 0.35, bias: -0.06, glide: [0, -0.1], upFlex: 0.15, air: 8.5, turn: 0.9, flush: 18, call: 'heron' },
    willet: { model: models.willet, hz: 6.2, amp: 0.55, wrist: 0.3, bias: 0.02, glide: [0.05, -0.08], upFlex: 0.15, air: 13, turn: 1.2, flush: 15, call: 'willet' },
  };
  const COUNT: Record<string, number> = { pelican: 11, tern: 8, wgull: 7, cgull: 5, cormorant: 8, heronFly: 3, heronStand: 3, egretFly: 4, egretStand: 4, snowyFly: 3, snowyStand: 3, willet: 8 };
  const pools = {} as Record<keyof typeof models, Pool>;
  for (const k of Object.keys(models) as (keyof typeof models)[]) pools[k] = new Pool(scene, models[k], COUNT[k], k);
  const splashes = new Splashes(scene);
  const calls = new BirdCalls(opts?.muted ?? (() => false));
  const birds: Bird[] = [];
  const make = (kind: Kind, stand?: keyof typeof models) => {
    const fly = (kind === 'heron' ? 'heronFly' : kind === 'egret' ? 'egretFly' : kind === 'snowy' ? 'snowyFly' : kind) as keyof typeof models;
    const b = new Bird(kind, SPECS[kind], [pools[fly], pools[fly].take()], stand ? [pools[stand], pools[stand].take()] : null);
    birds.push(b);
    return b;
  };

  // ---- perches: weathered piling stubs in the creek, light-pole heads, the boathouse ridge, a dock finger
  const pilingSpots = [
    { x: -96, z: -40, top: 2.1, r: 0.2, lean: 0.05 },
    { x: -94.6, z: -40.9, top: 1.85, r: 0.18, lean: -0.1 },
    { x: -95.4, z: -38.7, top: 1.95, r: 0.18, lean: 0.12 },
    ...[0, 1, 2, 3].map((i) => ({ x: 52 + i * 7.5, z: centerline(52 + i * 7.5) - 74, top: 1.7 + (i % 2) * 0.25, r: 0.2, lean: (i - 1.5) * 0.06 })),
    ...[0, 1, 2].map((i) => ({ x: 270 + i * 8, z: southBank(270 + i * 8) - 16, top: 1.8 - i * 0.15, r: 0.19, lean: 0.08 * i })),
  ];
  const pilings = new THREE.Mesh(Models.pilingGeometry(pilingSpots), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }));
  pilings.castShadow = true;
  pilings.receiveShadow = true;
  pilings.name = 'bird-pilings';
  scene.add(pilings);
  const perches: Perch[] = pilingSpots.map((s, i) => ({
    x: s.x + Math.sin(s.lean) * 0.3,
    z: s.z,
    y: () => s.top + 0.012,
    yaw: range(-Math.PI, Math.PI),
    kinds: ['cormorant', 'wgull', 'cgull', 'pelican', 'tern'],
    dry: i % 3 === 0,
    bird: null,
  }));
  // Structures built by other modules are found by ray-casting so the perches follow whatever was built.
  scene.updateMatrixWorld(true);
  const ray = new THREE.Raycaster();
  const targets = scene.children.filter((o) => o.name !== 'water' && o.name !== 'terrain' && !o.name.startsWith('bird') && !(o as THREE.Mesh).isMesh);
  const probe = (x: number, z: number, minY: number, maxY: number) => {
    ray.set(new THREE.Vector3(x, maxY + 3, z), new THREE.Vector3(0, -1, 0));
    ray.far = maxY + 3 - minY;
    const hit = ray.intersectObjects(targets, true)[0];
    return hit && hit.point.y > minY ? hit.point.y : null;
  };
  for (const [x, z] of [
    [-44.75, 1.2],
    [-11.75, 1.2],
    [36.25, 1.2],
    [-39.75, 42],
    [40.25, 42],
  ]) {
    const y = probe(x, z, PAD_Y + 7, PAD_Y + 12);
    if (y !== null) perches.push({ x, z, y: () => y, yaw: range(-Math.PI, Math.PI), kinds: ['wgull', 'cgull'], bird: null });
  }
  for (const x of [-19, -7, 9, 17]) {
    const y = probe(x, RIDGE_Z, PAD_Y + 5, PAD_Y + 25);
    if (y !== null) perches.push({ x, z: RIDGE_Z, y: () => y, yaw: x < 0 ? 0 : Math.PI, kinds: ['wgull', 'cgull'], bird: null });
  }
  perches.push({ x: DOCK.minX + 1.2, z: -25.6, y: () => DOCK_Y + conditions.level, yaw: Math.PI / 2, kinds: ['wgull', 'cgull', 'pelican'], bird: null });
  perches.push({ x: DOCK.maxX - 0.8, z: -25.6, y: () => DOCK_Y + conditions.level, yaw: -Math.PI / 2, kinds: ['wgull', 'cgull'], bird: null });

  const freePerch = (b: Bird, near: THREE.Vector3, maxD = 600) => {
    let best: Perch | null = null;
    let bd = maxD;
    for (const p of perches) {
      if (p.bird || !p.kinds.includes(b.kind)) continue;
      const d = Math.hypot(p.x - near.x, p.z - near.z) + rnd() * 60;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  };
  const seat = (b: Bird, p: Perch) => {
    b.perch = p;
    p.bird = b;
    b.mode = 'perch';
    b.yaw = p.yaw;
    b.p.set(p.x, 0, p.z);
    b.timer = range(40, 200);
    b.aux = 0;
  };

  // ---- pelicans: two lines skimming in ground effect, two lone foragers that plunge-dive, one on a perch
  const lines = [new Line(PELICAN_ROUTE(45, 25, -700, 1000)), new Line(PELICAN_ROUTE(70, 50, -500, 800))];
  lines[1].route.reverse();
  lines.forEach((ln, li) => {
    const n = li === 0 ? 5 : 3;
    const start = li === 0 ? 3 : 5;
    ln.wp = start;
    for (let k = 0; k < n; k++) {
      const b = make('pelican');
      b.mode = 'line';
      b.line = ln;
      b.lineIndex = k;
      const w = ln.route[start - 1];
      b.p.set(w.x, conditions.level + 1, w.z);
      b.yaw = Math.atan2(-(ln.route[start].z - w.z), ln.route[start].x - w.x);
      b.air = b.spec.air;
    }
  });
  for (let i = 0; i < 2; i++) {
    const b = make('pelican');
    b.mode = i === 0 ? 'search' : 'sit';
    b.home.set(i === 0 ? 140 : -160, 0, centerline(i === 0 ? 140 : -160) + 10);
    b.p.set(b.home.x + 30, i === 0 ? 8 : conditions.level, b.home.z);
    b.air = i === 0 ? b.spec.air : 0;
    b.timer = range(8, 20);
    b.radius = range(55, 80);
  }
  {
    const b = make('pelican');
    b.home.set(-95, 0, -40);
    seat(b, perches[0]);
    b.timer = range(120, 300);
  }

  // ---- Forster's terns: patrol beats 6-8 m up along the shoreline, hover into the wind and plunge
  const beats: [number, number, number][] = [
    [-180, 60, -34],
    [-60, 200, -44],
    [80, 360, -40],
    [-380, -120, -60],
    [150, 450, -120],
    [-250, 30, -140],
    [300, 650, -70],
  ];
  for (let i = 0; i < 7; i++) {
    const b = make('tern');
    const [x0, x1, zo] = beats[i];
    b.mode = 'patrol';
    b.home.set(x0, x1, zo);
    const x = range(x0, x1);
    b.p.set(x, range(6, 8), centerline(x) + 92 + zo);
    b.dir = rnd() < 0.5 ? 1 : -1;
    b.yaw = b.dir > 0 ? 0 : Math.PI;
    b.air = b.spec.air;
    b.timer = range(4, 12);
  }
  seat(make('tern'), perches[5]);

  // ---- gulls: soaring circles over the creek and the boathouse, others loafing on poles, the ridge and docks
  const gullCentres: [number, number, number, number][] = [
    [0, 25, 32, 34],
    [110, -60, 24, 45],
    [-150, -90, 38, 40],
    [40, 60, 20, 28],
    [260, -80, 42, 55],
    [-60, -40, 16, 30],
    [-300, -70, 30, 50],
    [500, -60, 26, 45],
  ];
  for (let i = 0; i < 12; i++) {
    const b = make(i < 7 ? 'wgull' : 'cgull');
    if (i < 8) {
      const [cx, cz, h, r] = gullCentres[i];
      b.mode = 'soar';
      b.home.set(cx, h, cz);
      b.goal.copy(b.home);
      b.radius = r;
      b.dir = i % 2 ? 1 : -1;
      const a = rnd() * TAU;
      b.p.set(cx + Math.cos(a) * r, h, cz + Math.sin(a) * r);
      b.yaw = -a + (b.dir * Math.PI) / 2;
      b.air = b.spec.air;
      b.timer = range(20, 90);
    } else {
      const p = freePerch(b, new THREE.Vector3([0, -40, 40, -10][i - 8], 0, [23, 1, 1, -26][i - 8]), 200);
      b.home.set(0, 30, -20);
      b.goal.copy(b.home);
      b.radius = 35;
      if (p) seat(b, p);
      else b.mode = 'soar';
    }
  }

  // ---- double-crested cormorants: drying on pilings, swimming and diving, flying low and fast
  const cormorantRoute = [-600, -300, 0, 300, 600, 900].map((x) => new THREE.Vector3(x, 0, centerline(x) + 20));
  for (let i = 0; i < 8; i++) {
    const b = make('cormorant');
    if (i < 3) {
      const p = perches.find((q) => !q.bird && (i < 2 ? q.dry : true) && q.kinds.includes('cormorant'));
      if (p) seat(b, p);
      b.aux = i < 2 ? 1 : 0;
    } else if (i < 6) {
      b.mode = 'swim';
      const x = [-40, 120, 210][i - 3];
      b.p.set(x, conditions.level, centerline(x) + [55, -40, 20][i - 3]);
      b.yaw = rnd() * TAU;
      b.timer = range(5, 25);
    } else {
      b.mode = 'transit';
      b.aux = i === 6 ? 1 : 4;
      const w = cormorantRoute[b.aux];
      b.p.set(w.x - 200, conditions.level + 1.5, w.z);
      b.air = b.spec.air;
      b.timer = range(40, 90);
    }
  }

  // ---- herons and egrets wading the shallows on both banks (the south bank only beyond the boathouse pad)
  const waders: [Kind, number, boolean, number][] = [
    ['heron', -60, true, 0.26],
    ['heron', 190, true, 0.22],
    ['heron', -265, false, 0.28],
    ['egret', 20, true, 0.18],
    ['egret', -170, true, 0.16],
    ['egret', 320, true, 0.2],
    ['egret', 240, false, 0.17],
    ['snowy', 85, true, 0.1],
    ['snowy', 96, true, 0.08],
    ['snowy', -215, false, 0.1],
  ];
  for (const [kind, x, north, depth] of waders) {
    const b = make(kind, kind === 'heron' ? 'heronStand' : kind === 'egret' ? 'egretStand' : 'snowyStand');
    b.mode = 'wade';
    b.standing = true;
    b.north = north;
    b.wantDepth = depth;
    const z = wadeZ(x, north, depth) ?? centerline(x);
    b.p.set(x, terrainHeight(x, z), z);
    b.home.set(x, 0, z);
    b.yaw = (north ? Math.PI / 2 : -Math.PI / 2) + range(-1.2, 1.2);
    b.timer = range(2, 20);
    b.aux = 0;
  }

  // ---- willets probing the wet mud at the waterline, flushing together
  const flock: Flock = { north: true, cx: 35, goal: 35, flying: false, members: [] };
  for (let i = 0; i < 8; i++) {
    const b = make('willet');
    b.mode = 'wade';
    b.flock = flock;
    b.north = true;
    b.wantDepth = range(-0.03, 0.04);
    b.aux = range(-9, 9);
    const x = flock.cx + b.aux;
    const z = wadeZ(x, true, b.wantDepth) ?? centerline(x);
    b.p.set(x, 0, z);
    b.yaw = rnd() * TAU;
    b.timer = range(0.2, 2);
    flock.members.push(b);
  }

  const player = new THREE.Vector3();
  const near = (b: Bird, d: number) => Math.hypot(b.p.x - player.x, b.p.z - player.z) < d && Math.abs(b.p.y - player.y) < d;

  function call(b: Bird) {
    calls.play(b.spec.call, b.p.distanceTo(player));
  }

  function takeOff(b: Bird, away: boolean) {
    if (b.perch) b.perch.bird = null;
    b.perch = null;
    b.mode = 'leave';
    b.timer = range(1.6, 2.4);
    b.standing = false;
    if (away) {
      b.yaw = Math.atan2(-(b.p.z - player.z), b.p.x - player.x) + range(-0.6, 0.6);
      call(b);
    }
    b.air = 1.5;
    b.flapGoal = 1;
    b.flap = 0.6;
  }

  function defaultFlight(b: Bird) {
    if (b.kind === 'pelican') {
      b.mode = 'search';
      b.home.set(b.p.x, 0, centerline(b.p.x) + range(-30, 30));
      b.radius = range(55, 80);
      b.timer = range(10, 30);
    } else if (b.kind === 'tern') {
      b.mode = 'patrol';
      if (b.home.x === b.home.y) b.home.set(b.p.x - 150, b.p.x + 150, -40);
      b.timer = range(4, 10);
    } else if (b.kind === 'cormorant') {
      b.mode = 'transit';
      let best = 0;
      cormorantRoute.forEach((w, i) => {
        if (Math.abs(w.x - b.p.x) < Math.abs(cormorantRoute[best].x - b.p.x)) best = i;
      });
      b.aux = best;
      b.timer = range(30, 80);
    } else {
      b.mode = 'soar';
      b.goal.set(b.p.x + range(-60, 60), range(18, 40), b.p.z + range(-60, 60));
      b.radius = range(25, 45);
      b.timer = range(30, 90);
    }
  }

  function updateBird(b: Bird, dt: number) {
    b.t += dt;
    const s = b.spec;
    const lvl = conditions.level;
    switch (b.mode) {
      case 'line': {
        const ln = b.line!;
        if (b.lineIndex === 0) {
          const w = ln.route[ln.wp];
          let ty = lvl + 0.85 + 0.25 * Math.sin(b.t * 0.21);
          if (near(b, 22)) ty = lvl + 7;
          const d = b.fly(dt, w.x, ty, w.z, s.air, s.turn, 1.6);
          if (d < 35) ln.wp = (ln.wp + 1) % ln.route.length;
          b.rhythm(dt, [3, 6], [4, 11], b.v.y > 0.8);
          ln.push(b, dt);
        } else {
          const delay = (b.lineIndex * 4.6) / s.air + 0.35;
          ln.sample(delay, tmpS);
          const [x, y, z, yaw, pitch, bank, fg] = tmpS;
          const lat = b.lineIndex * 1.4 * (b.lineIndex % 2 ? 1 : 0.6);
          b.p.set(x - Math.sin(yaw) * lat, y + lvl + 0.04 * b.lineIndex, z - Math.cos(yaw) * lat);
          b.yaw = yaw;
          b.pitch = pitch;
          b.bank = bank;
          b.flapGoal = fg;
          b.air = s.air;
        }
        b.wings(dt);
        b.legs = 1.45;
        b.neck = 0;
        break;
      }
      case 'search': {
        const a = Math.atan2(b.p.z - b.home.z, b.p.x - b.home.x) + 0.45;
        b.fly(dt, b.home.x + Math.cos(a) * b.radius, lvl + 9 + 2 * Math.sin(b.t * 0.15), b.home.z + Math.sin(a) * b.radius, 9);
        b.rhythm(dt, [3, 6], [3, 8]);
        b.wings(dt);
        b.legs = 1.45;
        b.neck = -0.1;
        b.aux -= dt;
        if (b.aux < -range(12, 30) && b.flapGoal < 0.5 && b.p.y > lvl + 6) {
          b.mode = 'dive';
          b.aux = 0;
          b.v.y = -1;
        }
        break;
      }
      case 'dive':
      case 'plunge': {
        // fold the wings back and drop steeply; pelicans twist as they fall
        b.aux += dt;
        const pel = b.mode === 'dive';
        b.pitch = damp(b.pitch, pel ? -1.2 : -1.35, 5, dt);
        if (pel) b.bank = damp(b.bank, 2.3, 2.2, dt);
        b.v.y -= G * dt * 0.9;
        b.air = damp(b.air, 3, 2, dt);
        b.v.x = Math.cos(b.yaw) * b.air;
        b.v.z = -Math.sin(b.yaw) * b.air;
        b.p.addScaledVector(b.v, dt);
        b.flapGoal = 0;
        b.wings(dt);
        b.a1 = 0.15;
        b.a2 = -0.25;
        b.fold = pel ? 0.7 : 0.55;
        b.legs = 1.45;
        if (b.p.y <= lvl + 0.15) {
          splashes.spawn(b.p.x, b.p.z, pel ? 0.9 : 0.3);
          b.p.y = lvl;
          b.v.set(0, 0, 0);
          b.bank = 0;
          b.pitch = 0;
          if (pel) {
            b.mode = 'sit';
            b.timer = range(6, 14);
          } else {
            b.mode = 'climb';
            b.timer = 1.6;
            b.air = 2;
          }
        }
        break;
      }
      case 'sit':
      case 'swim': {
        // floating: pelicans ride high, cormorants low with the bill tilted up; both drift with the current
        const corm = b.kind === 'cormorant';
        b.timer -= dt;
        b.p.x += conditions.current.x * dt;
        b.p.z += conditions.current.y * dt;
        if (corm) {
          b.yaw = wrap(b.yaw + Math.sin(b.t * 0.3 + b.phase) * 0.2 * dt);
          b.p.x += Math.cos(b.yaw) * 0.45 * dt;
          b.p.z -= Math.sin(b.yaw) * 0.45 * dt;
        }
        b.p.y = lvl + (corm ? -0.035 : 0.055) + 0.012 * Math.sin(b.t * 1.7 + b.phase);
        b.pitch = corm ? 0.12 : 0.06;
        b.bank = 0;
        b.fold = 1;
        b.a1 = 0;
        b.a2 = 0;
        b.flap = 0;
        b.flapGoal = 0;
        b.legs = 1.45;
        b.neck = corm ? 0.55 : 0.35 + 0.25 * Math.max(0, Math.sin(b.t * 0.5));
        if (near(b, s.flush) || b.timer <= 0) {
          if (corm && rnd() < 0.7 && b.timer <= 0) {
            b.mode = 'under';
            b.timer = range(15, 35);
            splashes.spawn(b.p.x, b.p.z, 0.15);
          } else if (corm && near(b, s.flush) && rnd() < 0.5) {
            b.mode = 'under';
            b.timer = range(10, 20);
            b.yaw = Math.atan2(-(b.p.z - player.z), b.p.x - player.x);
            splashes.spawn(b.p.x, b.p.z, 0.15);
          } else {
            b.mode = 'run';
            b.timer = corm ? 2.2 : 2.6;
            b.air = 1;
            if (near(b, s.flush + 5)) b.yaw = Math.atan2(-(b.p.z - player.z), b.p.x - player.x);
            else if (conditions.wind.lengthSq() > 1) b.yaw = Math.atan2(conditions.wind.y, -conditions.wind.x);
          }
        }
        break;
      }
      case 'under': {
        b.timer -= dt;
        b.p.x += Math.cos(b.yaw) * 1.1 * dt;
        b.p.z -= Math.sin(b.yaw) * 1.1 * dt;
        b.yaw = wrap(b.yaw + Math.sin(b.t * 0.7) * 0.3 * dt);
        if (b.timer <= 0 && !near(b, 15) && depthAt(b.p.x, b.p.z) > 0.8) {
          b.mode = 'swim';
          b.timer = range(8, 25);
        } else if (b.timer < -10) b.yaw += Math.PI * dt;
        break;
      }
      case 'run': {
        // take-off run: heavy birds patter along the surface before they lift
        b.timer -= dt;
        b.air = damp(b.air, s.air * 0.9, 1.1, dt);
        b.v.x = Math.cos(b.yaw) * b.air;
        b.v.z = -Math.sin(b.yaw) * b.air;
        b.p.x += b.v.x * dt;
        b.p.z += b.v.z * dt;
        b.p.y = damp(b.p.y, lvl + (b.timer < 1 ? 1.0 : 0.15), 2, dt);
        b.pitch = 0.18;
        b.bank = 0;
        b.flapGoal = 1;
        b.wings(dt, 1.2, 1.2);
        b.legs = 0.6;
        b.neck = 0;
        if (rnd() < dt * 5) splashes.spawn(b.p.x, b.p.z, 0.12);
        if (b.timer <= 0) defaultFlight(b);
        break;
      }
      case 'patrol': {
        const [x0, x1, zo] = [b.home.x, b.home.y, b.home.z];
        if (b.p.x > x1) b.dir = -1;
        if (b.p.x < x0) b.dir = 1;
        const tx = b.p.x + b.dir * 30;
        const tz = centerline(tx) + 92 + zo + 10 * Math.sin(b.t * 0.13 + b.phase);
        b.fly(dt, tx, lvl + 7 + 1.2 * Math.sin(b.t * 0.4 + b.phase), tz, s.air);
        b.flapGoal = 1;
        b.wings(dt);
        b.legs = 1.45;
        b.neck = -0.35;
        b.timer -= dt;
        if (near(b, 10)) b.dir = b.p.x > player.x ? 1 : -1;
        if (b.timer <= 0) {
          b.mode = 'hover';
          b.timer = range(1.5, 4);
        }
        break;
      }
      case 'hover': {
        // kiting: face into the wind and fly at the wind speed so the ground speed is ~0
        const ws = conditions.wind.length();
        const into = ws > 0.5 ? Math.atan2(conditions.wind.y, -conditions.wind.x) : b.yaw;
        b.yaw = wrap(b.yaw + clamp(wrap(into - b.yaw), -2 * dt, 2 * dt));
        b.air = damp(b.air, Math.min(ws, 7), 3, dt);
        b.v.x = damp(b.v.x, 0, 3, dt);
        b.v.z = damp(b.v.z, 0, 3, dt);
        b.v.y = damp(b.v.y, 0, 3, dt);
        b.p.addScaledVector(b.v, dt);
        b.pitch = damp(b.pitch, 0.55, 4, dt);
        b.bank = damp(b.bank, 0, 4, dt);
        b.flapGoal = 1;
        b.wings(dt, 1.35, 0.85);
        b.neck = -0.6;
        b.legs = 1.2;
        b.timer -= dt;
        if (b.timer <= 0) {
          if (rnd() < 0.55 && depthAt(b.p.x, b.p.z) > 0.3) {
            b.mode = 'plunge';
            b.v.y = -2;
            b.air = 2;
            if (rnd() < 0.3) call(b);
          } else {
            b.mode = 'patrol';
            b.timer = range(4, 12);
          }
        }
        break;
      }
      case 'climb': {
        b.timer -= dt;
        const tx = b.p.x + Math.cos(b.yaw) * 20;
        const tz = b.p.z - Math.sin(b.yaw) * 20;
        b.fly(dt, tx, lvl + 7, tz, s.air * 0.8, s.turn, 4);
        b.flapGoal = 1;
        b.wings(dt, 1.25, 1.1);
        b.legs = 1.45;
        b.neck = 0;
        if (b.timer <= 0) {
          b.mode = 'patrol';
          b.timer = range(4, 12);
        }
        break;
      }
      case 'soar': {
        // circling flap-glide; the circle's centre drifts downwind as a soaring bird's does
        b.goal.x += conditions.wind.x * dt * 0.8;
        b.goal.z += conditions.wind.y * dt * 0.8;
        const back = Math.hypot(b.goal.x - b.home.x, b.goal.z - b.home.z);
        if (back > 180) {
          b.goal.x += ((b.home.x - b.goal.x) / back) * 4 * dt;
          b.goal.z += ((b.home.z - b.goal.z) / back) * 4 * dt;
        }
        const a = Math.atan2(b.p.z - b.goal.z, b.p.x - b.goal.x) + b.dir * 0.5;
        b.fly(dt, b.goal.x + Math.cos(a) * b.radius, b.goal.y + 3 * Math.sin(b.t * 0.11 + b.phase), b.goal.z + Math.sin(a) * b.radius, s.air);
        const ws = conditions.wind.length();
        const low = b.p.y < b.goal.y - 2;
        b.rhythm(dt, [3, 7], [3 + ws * 0.6, 8 + ws * 1.5], low && b.v.y > 0.3);
        b.wings(dt);
        b.legs = 1.45;
        b.neck = 0;
        b.timer -= dt;
        b.callIn -= dt;
        if (b.callIn <= 0) {
          b.callIn = range(8, 40);
          call(b);
        }
        if (b.timer <= 0) {
          const p = rnd() < 0.5 ? freePerch(b, b.p, 350) : null;
          if (p) {
            b.mode = 'land';
            b.perch = p;
            p.bird = b;
            b.timer = 40;
          } else {
            b.goal.set(b.home.x + range(-80, 80), range(16, 42), b.home.z + range(-60, 60));
            b.radius = range(22, 50);
            b.dir = rnd() < 0.5 ? 1 : -1;
            b.timer = range(30, 90);
          }
        }
        break;
      }
      case 'land': {
        const p = b.perch!;
        const py = p.y() + 0.3;
        const d = Math.hypot(p.x - b.p.x, p.z - b.p.z);
        b.timer -= dt;
        if (d > 22) b.fly(dt, p.x, py + Math.min(15, d * 0.12), p.z, s.air);
        else b.fly(dt, p.x, py, p.z, 2.5 + d * 0.32, s.turn * 2, 3);
        b.rhythm(dt, [3, 5], [2, 5], d < 7);
        b.wings(dt, d < 7 ? 1.15 : 1, d < 7 ? 1.2 : 1);
        b.legs = d < 9 ? damp(b.legs, 0, 3, dt) : 1.45;
        if (d < 7) b.pitch = damp(b.pitch, 0.45, 4, dt);
        b.neck = 0;
        if (d < 0.9 && Math.abs(b.p.y - py) < 1.2) {
          seat(b, p);
        } else if (b.timer <= 0 || (d < 25 && near(b, s.flush))) {
          p.bird = null;
          b.perch = null;
          defaultFlight(b);
        }
        break;
      }
      case 'perch': {
        const p = b.perch!;
        b.timer -= dt;
        const corm = b.kind === 'cormorant';
        const upright = corm ? 0.75 : b.kind === 'pelican' ? 0.55 : b.kind === 'tern' ? 0.15 : 0.12;
        b.stand(p.y(), upright);
        b.p.x = p.x;
        b.p.z = p.z;
        b.yaw = p.yaw + 0.25 * Math.sin(b.t * 0.05 + b.phase);
        b.neck = corm ? -0.45 : b.kind === 'pelican' ? -0.4 : 0.05 * Math.sin(b.t * 0.7);
        if (corm && b.aux > 0) {
          // the classic spread-eagle drying pose: arms raised, hands drooping, a slow flutter now and then
          b.fold = 0;
          b.a1 = 0.22 + 0.05 * Math.sin(b.t * 0.6) * Math.max(0, Math.sin(b.t * 0.13));
          b.a2 = -0.35;
          b.yaw = p.yaw;
        }
        b.callIn -= dt;
        if (b.callIn <= 0 && b.kind !== 'cormorant') {
          b.callIn = range(15, 60);
          call(b);
        }
        if (near(b, s.flush)) takeOff(b, true);
        else if (b.timer <= 0) {
          if (corm && b.aux > 0 && rnd() < 0.6) {
            b.aux = 0;
            b.timer = range(30, 90);
          } else takeOff(b, false);
        }
        break;
      }
      case 'leave': {
        b.timer -= dt;
        const tx = b.p.x + Math.cos(b.yaw) * 30;
        const tz = b.p.z - Math.sin(b.yaw) * 30;
        b.fly(dt, tx, b.p.y + 3, tz, s.air, s.turn, 3);
        b.flapGoal = 1;
        b.wings(dt, 1.2, 1.15);
        b.legs = damp(b.legs, 1.45, 2, dt);
        b.neck = 0;
        if (b.timer <= 0) defaultFlight(b);
        break;
      }
      case 'transit': {
        // cormorants: low, fast and direct with continuous flapping
        const w = cormorantRoute[b.aux];
        const d = b.fly(dt, w.x, lvl + 1.6 + 0.6 * Math.sin(b.t * 0.3 + b.phase), w.z, s.air, s.turn, 1.5);
        if (d < 30) {
          if (b.aux === 0 || b.aux === cormorantRoute.length - 1) b.dir = b.aux === 0 ? 1 : -1;
          b.aux = clamp(b.aux + (b.dir || 1), 0, cormorantRoute.length - 1);
        }
        if (near(b, 25)) b.p.y += dt * 2;
        b.flapGoal = 1;
        b.wings(dt);
        b.legs = 1.45;
        b.neck = 0.05;
        b.timer -= dt;
        if (b.timer <= 0 && depthAt(b.p.x, b.p.z) > 1 && !near(b, 60)) {
          b.mode = 'alight';
        }
        break;
      }
      case 'alight': {
        const tx = b.p.x + Math.cos(b.yaw) * 30;
        const tz = b.p.z - Math.sin(b.yaw) * 30;
        b.fly(dt, tx, lvl, tz, 5, s.turn, 1.5);
        b.p.y = Math.max(lvl, b.p.y - dt * 0.8);
        b.flapGoal = b.air > 8 ? 0 : 1;
        b.wings(dt);
        b.legs = damp(b.legs, 0.4, 2, dt);
        if (b.p.y <= lvl + 0.36) {
          splashes.spawn(b.p.x, b.p.z, 0.35);
          b.mode = 'swim';
          b.timer = range(10, 30);
          b.v.set(0, 0, 0);
        }
        break;
      }
      case 'wade':
        if (b.flock) wadeWillet(b, dt);
        else wadeHeron(b, dt);
        break;
      case 'fly': {
        // heron/egret flight to a new spot along the bank
        const d = b.fly(dt, b.goal.x, d0(b) > 25 ? surfaceY(b.goal.x, b.goal.z) + range(4, 4.2) : surfaceY(b.goal.x, b.goal.z) + 0.6, b.goal.z, d0(b) > 25 ? s.air : 3 + d0(b) * 0.25, s.turn, 1.5);
        b.rhythm(dt, [6, 14], [1.5, 3], b.t - b.aux < 3 || d < 12);
        b.wings(dt, b.t - b.aux < 3 ? 1.15 : 1, b.t - b.aux < 3 ? 1.15 : 1);
        b.neck = 0;
        if (d < 1.2) {
          b.mode = 'wade';
          b.standing = true;
          b.pitch = 0;
          b.bank = 0;
          b.timer = range(3, 10);
          b.home.copy(b.p);
        }
        break;
      }
      case 'flock': {
        const f = b.flock!;
        const tx = f.cx + b.aux;
        const z = wadeZ(tx, f.north, b.wantDepth) ?? b.p.z;
        const d = b.fly(dt, tx, surfaceY(tx, z) + (Math.abs(f.goal - f.cx) > 30 ? 2.2 + b.aux * 0.05 : 0.3), z + b.aux * 0.25, Math.abs(f.goal - f.cx) > 30 ? s.air : 4, 2.5, 3);
        b.flapGoal = Math.abs(f.goal - f.cx) > 40 ? 1 : 0.6;
        b.wings(dt);
        b.legs = 1.45;
        b.neck = 0;
        if (!f.flying && d < 1.5) {
          b.mode = 'wade';
          b.timer = range(0.3, 1.5);
        }
        break;
      }
    }
  }

  const d0 = (b: Bird) => Math.hypot(b.goal.x - b.p.x, b.goal.z - b.p.z);

  function wadeHeron(b: Bird, dt: number) {
    const s = b.spec;
    b.timer -= dt;
    b.standing = true;
    b.fold = 1;
    b.bank = 0;
    if (b.due(dt, 0.4)) {
      const z = wadeZ(b.p.x, b.north, b.wantDepth);
      if (z !== null) b.home.z = z;
    }
    // aux: 0 still, 1 walking, 2 striking
    const alert = near(b, s.flush * 2);
    let neck = alert ? 0.22 : 0;
    if (b.aux === 1) {
      const pace = b.kind === 'snowy' ? 0.5 : b.kind === 'egret' ? 0.22 : 0.15;
      const step = Math.max(0, Math.sin(b.t * (b.kind === 'snowy' ? 7 : 3.2)));
      b.p.x += Math.cos(b.yaw) * pace * step * dt * 1.6;
      b.p.z = damp(b.p.z, b.home.z, 0.8, dt);
      neck += -0.05 + 0.04 * step;
    } else {
      b.p.z = damp(b.p.z, b.home.z, 0.3, dt);
    }
    if (b.aux === 2) {
      const k = b.t - b.goal.y;
      neck = k < 0.18 ? -1.05 * (k / 0.18) : k < 0.5 ? -1.05 : -1.05 * Math.max(0, 1 - (k - 0.5) / 0.6);
      if (k > 0.25 && k < 0.3) splashes.spawn(b.p.x + Math.cos(b.yaw) * 0.5, b.p.z - Math.sin(b.yaw) * 0.5, 0.06);
    }
    b.neck = damp(b.neck, neck, b.aux === 2 ? 30 : 3, dt);
    b.p.y = terrainHeight(b.p.x, b.p.z);
    b.pitch = 0;
    if (b.timer <= 0) {
      const r = rnd();
      if (b.aux === 2 || r < 0.45) {
        b.aux = 1;
        const toWater = b.north ? Math.PI / 2 : -Math.PI / 2;
        const along = Math.abs(b.p.x - b.home.x) > 25 ? (b.home.x > b.p.x ? 0 : Math.PI) : rnd() < 0.5 ? 0 : Math.PI;
        b.yaw = wrap(along + (wrap(toWater - along) > 0 ? 0.35 : -0.35));
        b.timer = range(3, 9);
      } else if (r < 0.75) {
        b.aux = 2;
        b.goal.y = b.t;
        b.timer = 1.2;
      } else {
        b.aux = 0;
        b.yaw = wrap(b.yaw + range(-0.8, 0.8));
        b.timer = range(6, 30);
      }
    }
    if (near(b, s.flush)) {
      const dir = b.p.x > player.x ? 1 : -1;
      const x = b.p.x + dir * range(80, 180);
      const z = wadeZ(x, b.north, b.wantDepth) ?? centerline(x);
      b.goal.set(x, 0, z);
      b.mode = 'fly';
      b.standing = false;
      b.aux = b.t;
      b.yaw = Math.atan2(-(z - b.p.z), x - b.p.x);
      b.air = 2;
      b.flap = 1;
      b.flapGoal = 1;
      b.p.y = terrainHeight(b.p.x, b.p.z) + 0.9 * (b.kind === 'heron' ? 1 : 0.75);
      b.v.y = 1.5;
      call(b);
    }
  }

  function wadeWillet(b: Bird, dt: number) {
    const f = b.flock!;
    b.timer -= dt;
    const x = f.cx + b.aux;
    if (b.due(dt, 0.3)) {
      const z = wadeZ(b.p.x, f.north, b.wantDepth);
      if (z !== null) b.goal.z = z;
    }
    // quick walk, stop, probe
    const probing = b.timer < 0.3;
    if (!probing) {
      const dx = x + Math.sin(b.t * 0.2 + b.phase) * 3 - b.p.x;
      const dz = b.goal.z - b.p.z;
      const want = Math.atan2(-dz, dx);
      b.yaw = wrap(b.yaw + clamp(wrap(want - b.yaw), -3 * dt, 3 * dt));
      const sp = Math.min(0.5, Math.hypot(dx, dz) * 0.4);
      b.p.x += Math.cos(b.yaw) * sp * dt;
      b.p.z -= Math.sin(b.yaw) * sp * dt;
    }
    b.stand(terrainHeight(b.p.x, b.p.z), probing ? -0.55 : 0.02);
    b.neck = probing ? -0.25 : 0;
    if (b.timer <= 0) b.timer = range(0.8, 2.6);
    if (near(b, b.spec.flush) && !f.flying) {
      f.flying = true;
      const dir = b.p.x > player.x ? 1 : -1;
      f.goal = f.cx + dir * range(120, 220);
      for (const m of f.members) {
        m.mode = 'flock';
        m.air = 4;
        m.flap = 1;
        m.flapGoal = 1;
        m.yaw = dir > 0 ? 0 : Math.PI;
        m.v.y = 1.5;
      }
      call(b);
    }
  }

  const api = {
    birds,
    perches,
    pools,
    paused: false,
    step(dt: number) {
      player.copy(getPlayerPos());
      calls.tick(dt);
      if (flock.flying) {
        flock.cx += Math.sign(flock.goal - flock.cx) * Math.min(Math.abs(flock.goal - flock.cx), 12 * dt);
        if (Math.abs(flock.goal - flock.cx) < 1) flock.flying = false;
      }
      for (const b of birds) {
        updateBird(b, dt);
        b.write();
      }
      for (const k in pools) pools[k as keyof typeof pools].flush();
      splashes.update(dt);
    },
  };
  scene.userData.birds = api;
  addSystem({
    update(dt) {
      if (!api.paused) api.step(dt);
    },
  });
  return api;
}
