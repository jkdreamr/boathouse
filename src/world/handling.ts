import * as THREE from 'three';
import type { Player } from '../player';
import type { CrewBoat } from '../rowing/crewboat';
import { EIGHT, gunwaleY, halfBeam, storedHullGeometry } from '../rowing/hull';
import { makeOarMesh } from '../rowing/oar';
import { conditions } from '../sim/conditions';
import { addSystem } from '../sim/systems';
import { floorAt, hitsWall } from './collide';
import { terrainHeight } from './terrain';
import { Y0, ZW } from './boathouseDims';
import { DOCK, DOCK_Y } from './site';
import { CrewFigure } from './crew';
import { rackSlots, RackSlot } from './racks';

export interface HandlingHooks {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  player: Player;
  eight: CrewBoat;
  mode(): 'intro' | 'walk' | 'row';
  boardInPlace(): void; // main: enter row mode WITHOUT eight.reset
  enterWalk(): void; // main: mode='walk', syncUI, WITHOUT resetting eight or player
}

// Slot convention (racks.ts): pos = hull-local origin (waterline origin of
// storedHullGeometry) of the upside-down stored shell; heading uses the
// CrewBoat convention (bow direction = (cos h, 0, -sin h)); mesh = the visible
// stored-shell object (toggle .visible), null = empty slot.

const SPEC = EIGHT;
const HL = SPEC.length / 2; // 8.8
const EYE = 1.65;
const WAIST = 0.95;
const SHOULDER = 1.5;
const OVERHEAD = 2.0;
const SEAT_X = (k: number) => -5.5 + (8 - k) * 1.42; // seat k = 1 (bow) .. 8 (stroke)

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _qY = new THREE.Quaternion();
const _qZ = new THREE.Quaternion();
const _qX = new THREE.Quaternion();
const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const _X = new THREE.Vector3(1, 0, 0);
const _m4 = new THREE.Matrix4();
const _zeroM = new THREE.Matrix4().makeScale(0, 0, 0);

const ease = (x: number) => {
  x = Math.min(1, Math.max(0, x));
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

function groundAt(x: number, z: number, refY: number) {
  const f = floorAt(x, z, refY + 0.55);
  return f !== null ? f : terrainHeight(x, z);
}

interface Pose {
  cx: number;
  cz: number;
  heading: number;
  roll: number;
  lift: number;
  yO: number | null; // explicit hull-origin y (afloat)
}

interface CrewState {
  fig: CrewFigure;
  k: number; // seat 1..8
  seatX: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  yaw: number;
  walkPhase: number;
  walkAmt: number;
  oar: THREE.Group | null;
  spawn: THREE.Vector3;
}

// 'walkOut'/'walkIn' are player-driven; other phases are scripted anims.
// wait* sub-states freeze the player until E.
type Phase =
  | 'idle'
  | 'handsOn'
  | 'lift'
  | 'walkOut'
  | 'roll'
  | 'downIn'
  | 'oars'
  | 'board'
  | 'u_approach'
  | 'u_oarCarry'
  | 'u_waists'
  | 'u_over'
  | 'u_swing'
  | 'walkIn'
  | 'u_shoulders'
  | 'u_down'
  | 'u_rack'
  | 'u_release';

const ANIMS = new Set<Phase>([
  'handsOn',
  'lift',
  'roll',
  'downIn',
  'oars',
  'board',
  'u_approach',
  'u_oarCarry',
  'u_waists',
  'u_over',
  'u_swing',
  'u_shoulders',
  'u_down',
  'u_rack',
  'u_release',
]);

const WALK_OUT_SUBS = new Set(['waist', 'waitShoulder', 'waitOverhead', 'waitRoll']);
const WALK_IN_SUBS = new Set(['overIn', 'waistIn', 'u_waitShoulders']);

const _cp = { pos: new THREE.Vector3(), yaw: 0, walkPhase: 0, walk: 0, crouch: 0, handL: null as THREE.Vector3 | null, handR: null as THREE.Vector3 | null, headTilt: 0 };

export class Handling {
  stowed = false;
  private h: HandlingHooks;
  private phase: Phase = 'idle';
  private sub = '';
  private t = 0;
  private dur = 0;
  private callT = 0;
  private pendingPrompt: string | null = null;
  private btnLabel = '';
  private slot: RackSlot | null = null;
  private outSlot: RackSlot | null = null;
  private aisleSign = 1; // hull-local z side facing the aisle
  private aisleX = 0; // world x of the aisle line
  private split = false; // even seats on the far side
  private carryH = WAIST;
  private leadIsBow = true;
  private doorChecked = false;
  private gangwayToast = false;
  private shouldersIn = false;
  private pose: Pose = { cx: 0, cz: 0, heading: Math.PI / 2, roll: Math.PI, lift: WAIST, yO: null };
  private from: Pose = { cx: 0, cz: 0, heading: 0, roll: 0, lift: 0, yO: null };
  private to: Pose = { cx: 0, cz: 0, heading: 0, roll: 0, lift: 0, yO: null };
  private pitch = 0;
  private hullY = Y0 + 1;
  private carried: THREE.Mesh;
  private crew: CrewState[] = [];
  private oars: THREE.Group[] = [];
  private oarsMode: 'hidden' | 'deck' | 'hand' = 'hidden';
  private trail = Array.from({ length: 512 }, () => new THREE.Vector3());
  private trailN = 0;
  private trailHead = 0;
  private leadTip = new THREE.Vector2();
  private tailTip = new THREE.Vector2();
  private leadDir = new THREE.Vector2(0, -1);
  private handA = new THREE.Vector3();
  private handB = new THREE.Vector3();
  private lastHit = '';

  constructor(h: HandlingHooks) {
    this.h = h;
    // TEMP until interior merges: discover stored 8+ shells facing the aisles.
    if (rackSlots.length === 0) {
      const names = ['Jim Gray', 'Cardinal', 'Arrillaga', 'Redwood'];
      const aisleXs = [-11.55, -4.45, -2.55, 4.55];
      const shells: { im: THREE.InstancedMesh; i: number; m: THREE.Matrix4 }[] = [];
      h.scene.traverse((o) => {
        const im = o as THREE.InstancedMesh;
        if (!im.isInstancedMesh) return;
        if (!im.geometry.boundingBox) im.geometry.computeBoundingBox();
        const bb = im.geometry.boundingBox!;
        if (bb.max.x - bb.min.x > 9 && Math.abs(bb.max.x - bb.min.x - EIGHT.length) < 0.3) {
          for (let i = 0; i < im.count; i++) {
            im.getMatrixAt(i, _m4);
            shells.push({ im, i, m: _m4.clone() });
          }
        }
      });
      let n = 0;
      for (const s of shells) {
        if (n >= 3) break;
        const p = _v1.setFromMatrixPosition(s.m);
        if (!aisleXs.some((x) => Math.abs(p.x - x) < 0.1)) continue;
        const lev = p.y - Y0 - EIGHT.freeboard - 0.04;
        const tier = Math.abs(lev - 0.95) < 0.1 ? 0 : Math.abs(lev - 1.8) < 0.1 ? 1 : -1;
        if (tier < 0) continue;
        s.im.setMatrixAt(s.i, _zeroM);
        s.im.instanceMatrix.needsUpdate = true;
        const mesh = new THREE.Mesh(s.im.geometry, s.im.material as THREE.Material);
        mesh.applyMatrix4(s.m);
        mesh.castShadow = mesh.receiveShadow = true;
        (s.im.parent ?? h.scene).add(mesh);
        rackSlots.push({ id: `temp-${n}`, cls: '8+', name: names[n], pos: p.clone(), heading: Math.PI / 2, tier, mesh });
        n++;
      }
      // one empty 8+ slot at a free aisle-facing level-0/1 spot
      for (const x of aisleXs) {
        if (n >= 4) break;
        let placed = false;
        for (const [tier, lev] of [0.95, 1.8].entries()) {
          const y = Y0 + lev + 0.04 + EIGHT.freeboard;
          const taken = shells.some((s) => {
            const q = _v2.setFromMatrixPosition(s.m);
            return Math.abs(q.x - x) < 0.1 && Math.abs(q.y - y) < 0.1;
          });
          if (!taken) {
            rackSlots.push({ id: `temp-${n}`, cls: '8+', name: names[n], pos: new THREE.Vector3(x, y, 23.1), heading: Math.PI / 2, tier, mesh: null });
            n++;
            placed = true;
            break;
          }
        }
        if (placed) break;
      }
    }
    this.carried = new THREE.Mesh(storedHullGeometry(EIGHT), new THREE.MeshPhysicalMaterial({ color: '#f3f1ea', roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, side: THREE.DoubleSide }));
    this.carried.castShadow = true;
    this.carried.visible = false;
    h.scene.add(this.carried);
    for (let k = 1; k <= 8; k++) {
      const fig = new CrewFigure(k);
      h.scene.add(fig.group);
      this.crew.push({ fig, k, seatX: SEAT_X(k), pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, walkPhase: k * 1.7, walkAmt: 0, oar: null, spawn: new THREE.Vector3() });
    }
    for (let i = 0; i < 8; i++) {
      const o = makeOarMesh();
      o.visible = false;
      h.scene.add(o);
      this.oars.push(o);
    }
    document.getElementById('callBtn')?.addEventListener('click', () => {
      if (this.h.mode() === 'row') this.dock();
      else this.next();
    });
    addSystem({ update: (dt) => this.update(dt) });
  }

  get active() {
    return this.phase !== 'idle';
  }

  /** Debug/screenshot hook: current hull + phase summary. */
  debug() {
    return {
      phase: this.phase,
      sub: this.sub,
      cx: this.pose.cx,
      cz: this.pose.cz,
      y: this.hullY,
      heading: this.pose.heading,
      roll: this.pose.roll,
      lift: this.carryH,
      hit: this.lastHit,
      player: [this.h.player.pos.x, this.h.player.pos.y, this.h.player.pos.z],
      slots: rackSlots.map((s) => ({ name: s.name, x: s.pos.x, y: s.pos.y, visible: s.mesh?.visible ?? null })),
    };
  }

  prompt(): string | null {
    if (this.h.mode() !== 'walk') return null;
    if (this.pendingPrompt) return this.pendingPrompt;
    if (this.active) return null;
    const s = this.nearSlot();
    if (s) return `<kbd>E</kbd> Hands on — ${s.name} (8+)`;
    return null;
  }

  rowPrompt(): string | null {
    if (this.h.mode() !== 'row') return null;
    if (this.pendingPrompt) return this.pendingPrompt;
    return this.dockEligible() ? '<kbd>E</kbd> Weigh enough, dock it' : null;
  }

  next(): boolean {
    if (this.h.mode() !== 'walk') return false;
    if (this.active) {
      this.advance();
      return true;
    }
    const s = this.nearSlot();
    if (!s) return false;
    this.startLoad(s);
    return true;
  }

  dock(): boolean {
    if (this.h.mode() !== 'row' || !this.dockEligible()) return false;
    this.startUnload();
    return true;
  }

  // ---------- DOM ----------

  private callout(call: string) {
    const el = document.getElementById('callout');
    if (!el) return;
    el.innerHTML = `<span class="cox">COX</span> &ldquo;${call}&rdquo;`;
    el.classList.remove('hidden');
    this.callT = 3.5;
  }

  private toast(msg: string) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    setTimeout(() => el.classList.add('hidden'), 2600);
  }

  private waitE(prompt: string, label: string, sub: string) {
    this.sub = sub;
    this.pendingPrompt = `<kbd>E</kbd> ${prompt}`;
    this.btnLabel = label;
    this.t = 0;
    this.dur = Infinity; // wait for E; do not re-fire phaseDone
  }

  // ---------- eligibility ----------

  private nearSlot(): RackSlot | null {
    const p = this.h.player.pos;
    if (Math.abs(p.y - Y0) > 1.0) return null;
    let best: RackSlot | null = null;
    let bestD = 2.2;
    for (const s of rackSlots) {
      if (s.cls !== '8+' || !s.mesh || s.mesh.visible === false) continue;
      const dx = Math.cos(s.heading);
      const dz = -Math.sin(s.heading);
      const ax = s.pos.x - dx * HL;
      const az = s.pos.z - dz * HL;
      const t = Math.min(1, Math.max(0, ((p.x - ax) * dx * 2 * HL + (p.z - az) * dz * 2 * HL) / (HL * HL * 4)));
      const d = Math.hypot(p.x - (ax + dx * 2 * HL * t), p.z - (az + dz * 2 * HL * t));
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  private dockEligible(): boolean {
    if (this.active) return false;
    const e = this.h.eight;
    const z = e.group.position.z;
    const x = e.group.position.x;
    if (e.speed >= 0.5) return false;
    if (z < DOCK.minZ - 4.5 || z > DOCK.minZ - 0.6) return false;
    if (x < DOCK.minX + 10 || x > DOCK.maxX - 10) return false;
    if (Math.abs(Math.sin(e.heading)) >= 0.35) return false;
    return this.targetSlot() !== null;
  }

  private slotEmpty(s: RackSlot) {
    return !s.mesh || s.mesh.visible === false;
  }

  private targetSlot(): RackSlot | null {
    if (this.outSlot && this.slotEmpty(this.outSlot)) return this.outSlot;
    let best: RackSlot | null = null;
    let bd = Infinity;
    for (const s of rackSlots) {
      if (s.cls !== '8+' || !this.slotEmpty(s)) continue;
      if (Math.abs(s.pos.x) < bd) {
        bd = Math.abs(s.pos.x);
        best = s;
      }
    }
    return best;
  }

  // ---------- hull pose ----------

  private applyPose() {
    const p = this.pose;
    const dx = Math.cos(p.heading);
    const dz = -Math.sin(p.heading);
    const ref = this.hullY;
    const gA = groundAt(p.cx + dx * HL, p.cz + dz * HL, ref);
    const gB = groundAt(p.cx - dx * HL, p.cz - dz * HL, ref);
    this.pitch = THREE.MathUtils.clamp(Math.atan2(gA - gB, HL * 2), -0.35, 0.35);
    if (p.yO !== null) {
      this.hullY = p.yO;
      this.pitch = 0;
    } else {
      const upsideDown = Math.cos(p.roll) < 0;
      const gm = (gA + gB) / 2 + p.lift;
      this.hullY = upsideDown ? gm + SPEC.freeboard : gm - SPEC.freeboard;
    }
    this.carried.position.set(p.cx, this.hullY, p.cz);
    _qY.setFromAxisAngle(_Y, p.heading);
    _qZ.setFromAxisAngle(_Z, this.pitch);
    _qX.setFromAxisAngle(_X, p.roll);
    this.carried.quaternion.copy(_qY).multiply(_qZ).multiply(_qX);
    this.carried.updateMatrixWorld();
  }

  private setPose(cx: number, cz: number, heading: number, roll: number, lift: number, yO: number | null = null) {
    const p = this.pose;
    p.cx = cx;
    p.cz = cz;
    p.heading = heading;
    p.roll = roll;
    p.lift = lift;
    p.yO = yO;
    this.applyPose();
  }

  /** 9 stations tip→tail; true if any hits a wall. */
  private hullBlocked() {
    const m = this.carried.matrixWorld;
    for (let i = 0; i < 9; i++) {
      const lx = this.leadIsBow ? HL - i * (SPEC.length / 8) : -HL + i * (SPEC.length / 8);
      const r = Math.max(0.12, halfBeam(SPEC, lx) + 0.05);
      _v1.set(lx, gunwaleY(SPEC, lx), 0).applyMatrix4(m);
      _v2.set(lx, -SPEC.draft, 0).applyMatrix4(m);
      const y0 = Math.min(_v1.y, _v2.y) - 0.05;
      const y1 = Math.max(_v1.y, _v2.y) + 0.05;
      if (hitsWall(_v1.x, _v1.z, r, y0, y1)) {
        this.lastHit = `st${i} ${_v1.x.toFixed(1)},${_v1.z.toFixed(1)}`;
        return true;
      }
    }
    this.lastHit = '';
    return false;
  }

  /** All 9 stations on the dock and roughly aligned. */
  private onDock() {
    if (Math.abs(Math.sin(this.pose.heading)) >= 0.3) return false;
    const m = this.carried.matrixWorld;
    for (let i = 0; i < 9; i++) {
      const lx = this.leadIsBow ? HL - i * (SPEC.length / 8) : -HL + i * (SPEC.length / 8);
      _v1.set(lx, 0, 0).applyMatrix4(m);
      if (_v1.z < DOCK.minZ - 0.4 || _v1.z > DOCK.maxZ + 0.4 || _v1.x < DOCK.minX || _v1.x > DOCK.maxX) return false;
    }
    return true;
  }

  // ---------- trail ----------

  private trailAt(back: number, out: THREE.Vector3) {
    let acc = 0;
    const L = this.trail.length;
    for (let i = this.trailN - 1; i > 0; i--) {
      const a = this.trail[(this.trailHead - this.trailN + i + L * 2) % L];
      const b = this.trail[(this.trailHead - this.trailN + i - 1 + L * 2) % L];
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (acc + d >= back) return out.copy(a).lerp(b, (back - acc) / (d || 1e-6));
      acc += d;
    }
    return out.copy(this.trail[(this.trailHead - this.trailN + L * 2) % L]);
  }

  private trailPush(p: THREE.Vector3) {
    if (this.trailN > 0) {
      const l = this.trail[(this.trailHead + this.trail.length - 1) % this.trail.length];
      if (Math.hypot(p.x - l.x, p.z - l.z) < 0.25) return false;
    }
    this.trail[this.trailHead].copy(p);
    this.trailHead = (this.trailHead + 1) % this.trail.length;
    if (this.trailN < this.trail.length) this.trailN++;
    return true;
  }

  private trailPop() {
    if (this.trailN <= 0) return;
    this.trailHead = (this.trailHead + this.trail.length - 1) % this.trail.length;
    this.trailN--;
  }

  private hullFromTrail() {
    this.trailAt(0.8, _v1);
    this.trailAt(0.8 + SPEC.length, _v2);
    this.leadTip.set(_v1.x, _v1.z);
    this.tailTip.set(_v2.x, _v2.z);
    const dx = (_v1.x - _v2.x) / (SPEC.length || 1);
    const dz = (_v1.z - _v2.z) / (SPEC.length || 1);
    const l = Math.hypot(dx, dz) || 1;
    this.leadDir.set(dx / l, dz / l);
    const b = this.leadIsBow ? 1 : -1;
    const heading = Math.atan2(-(dz / l) * b, (dx / l) * b);
    this.setPose(_v1.x - (dx / l) * HL, _v1.z - (dz / l) * HL, heading, this.pose.roll, this.carryH);
  }

  private initTrail() {
    this.trailN = 0;
    this.trailHead = 0;
    const p = this.pose;
    const lead = _v3.set(Math.cos(p.heading) * (this.leadIsBow ? 1 : -1), 0, -Math.sin(p.heading) * (this.leadIsBow ? 1 : -1));
    const tipX = p.cx + lead.x * HL;
    const tipZ = p.cz + lead.z * HL;
    for (let d = SPEC.length + 1.6; d >= 0; d -= 1) {
      this.trail[this.trailHead].set(tipX + lead.x * (0.8 - d), 0, tipZ + lead.z * (0.8 - d));
      this.trailHead++;
      this.trailN++;
    }
    const pl = this.h.player;
    pl.pos.x = tipX + lead.x * 0.8;
    pl.pos.z = tipZ + lead.z * 0.8;
    pl.yaw = Math.atan2(-lead.x, -lead.z);
    pl.vy = 0;
    pl.pos.y = groundAt(pl.pos.x, pl.pos.z, pl.pos.y + 0.5);
    this.trailPush(pl.pos);
    this.hullFromTrail();
  }

  // ---------- constrain (after player.update in walk mode) ----------

  constrain(prev: THREE.Vector3, dt: number) {
    const p = this.h.player.pos;
    if (!this.active) return;
    const walking = (this.phase === 'walkOut' && WALK_OUT_SUBS.has(this.sub)) || (this.phase === 'walkIn' && WALK_IN_SUBS.has(this.sub));
    const restore = () => {
      p.copy(prev);
      this.h.player.vy = 0;
    };
    if (!walking) {
      restore();
      this.h.camera.position.set(p.x, p.y + EYE, p.z);
      return;
    }
    if (this.h.player.vy > 0) {
      p.y = prev.y;
      this.h.player.vy = 0;
    }
    let mx = p.x - prev.x;
    let mz = p.z - prev.z;
    const cap = (this.carryH >= OVERHEAD ? 1.0 : 1.3) * dt;
    const len = Math.hypot(mx, mz);
    if (len > cap && len > 1e-6) {
      mx *= cap / len;
      mz *= cap / len;
      p.x = prev.x + mx;
      p.z = prev.z + mz;
    }
    if (Math.hypot(mx, mz) < 1e-6) {
      this.h.camera.position.set(p.x, p.y + EYE, p.z);
      return;
    }
    // no backing up: reject only moves clearly opposing the lead direction
    // (a strict <0 test would also block perpendicular turns onto the dock)
    if (mx * this.leadDir.x + mz * this.leadDir.y < -0.35 * Math.hypot(mx, mz)) {
      restore();
      this.h.camera.position.set(p.x, p.y + EYE, p.z);
      return;
    }
    const tryPose = (nx: number, nz: number) => {
      p.x = nx;
      p.z = nz;
      const pushed = this.trailPush(p);
      this.hullFromTrail();
      // gangway gate: lead tip may not enter the gangway unless at overheads
      if (this.phase === 'walkOut' && this.carryH < OVERHEAD && this.leadTip.y < 0.5 && Math.abs(this.leadTip.x) < 1.5) {
        if (pushed) this.trailPop();
        if (!this.gangwayToast) {
          this.gangwayToast = true;
          this.toast('Overheads before the gangway');
        }
        return false;
      }
      if (!this.hullBlocked()) return true;
      if (pushed) this.trailPop();
      return false;
    };
    if (!tryPose(prev.x + mx, prev.z + mz) && !tryPose(prev.x + mx, prev.z) && !tryPose(prev.x, prev.z + mz)) restore();
    p.y = groundAt(p.x, p.z, p.y + 0.55);
    this.h.camera.position.set(p.x, p.y + EYE, p.z);
  }

  // ---------- sequencing ----------

  private snapFrom() {
    Object.assign(this.from, this.pose);
  }

  private startLoad(s: RackSlot) {
    this.slot = s;
    const a = this.scanAisle(s);
    this.aisleX = s.pos.x + a.sign * a.d;
    this.aisleSign = Math.sin(s.heading) * a.sign > 0 ? 1 : -1;
    this.callout('Hands on.');
    this.h.eight.group.visible = false;
    if (s.mesh) s.mesh.visible = false;
    if (s.mesh instanceof THREE.Mesh) this.carried.material = s.mesh.material as THREE.Material;
    this.carried.visible = true;
    this.carryH = WAIST;
    this.leadIsBow = true;
    this.doorChecked = false;
    this.gangwayToast = false;
    this.shouldersIn = false;
    this.split = false;
    this.oarsMode = 'hidden';
    // the stored shell sits upside down; gunwale height above the floor = origin - freeboard - Y0
    this.setPose(s.pos.x, s.pos.z, s.heading, Math.PI, s.pos.y - SPEC.freeboard - Y0);
    for (const c of this.crew) {
      c.spawn.set(this.aisleX + (c.k % 2 ? 0.4 : -0.4), Y0, ZW + 0.6 + c.k * 0.35);
      c.pos.copy(c.spawn);
      c.prev.copy(c.pos);
      c.yaw = Math.PI;
      c.walkAmt = 0;
      c.oar = null;
      c.fig.group.visible = true;
    }
    this.stowed = true;
    this.phase = 'handsOn';
    this.sub = '';
    this.t = 0;
    this.dur = 1.8;
    this.pendingPrompt = null;
  }

  private scanAisle(s: RackSlot) {
    const results = [-1, 1].map((sign) => {
      let d1 = -1;
      let d2 = 6;
      for (let d = 0.8; d <= 6; d += 0.1) {
        const x = s.pos.x + sign * d;
        let clear = true;
        for (let i = 0; i < 9 && clear; i++) {
          const lx = HL - i * (SPEC.length / 8);
          if (hitsWall(x + Math.cos(s.heading) * lx, s.pos.z - Math.sin(s.heading) * lx, 0.35, Y0 + 0.4, Y0 + 1.6)) clear = false;
        }
        if (clear) {
          if (d1 < 0) d1 = d;
        } else if (d1 >= 0) {
          d2 = d;
          break;
        }
      }
      return { sign, d1: d1 < 0 ? 6 : d1, d2 };
    });
    const r = results[0].d1 <= results[1].d1 ? results[0] : results[1];
    return { sign: r.sign, d: Math.min((r.d1 + r.d2) / 2, r.d1 + 2) };
  }

  private startUnload() {
    const s = this.targetSlot()!;
    this.slot = s;
    const a = this.scanAisle(s);
    this.aisleX = s.pos.x + a.sign * a.d;
    this.aisleSign = Math.sin(s.heading) * a.sign > 0 ? 1 : -1;
    this.callout('Weigh enough. Lean away — bring it in.');
    this.doorChecked = false;
    this.gangwayToast = false;
    this.shouldersIn = false;
    this.split = false;
    const e = this.h.eight;
    const snap = Math.abs(e.heading) < Math.PI / 2 ? 0 : Math.PI;
    this.phase = 'u_approach';
    this.sub = '';
    this.t = 0;
    this.dur = 2.5;
    Object.assign(this.from, { cx: e.group.position.x, cz: e.group.position.z, heading: e.heading, roll: 0, lift: 0, yO: conditions.level });
    Object.assign(this.to, { cx: e.group.position.x, cz: DOCK.minZ - 1.05, heading: snap, roll: 0, lift: 0, yO: conditions.level });
    this.pendingPrompt = null;
  }

  private advance() {
    switch (this.sub) {
      // ---- load ----
      case 'waitLift':
        this.callout('Up to waists, ready, up — off the racks.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { cx: this.aisleX, lift: WAIST });
        this.t = 0;
        this.dur = 1.3;
        this.phase = 'lift';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'waitWalk':
        this.callout('Walk it out.');
        this.phase = 'walkOut';
        this.sub = 'waist';
        this.pendingPrompt = null;
        this.initTrail();
        break;
      case 'doorStop':
        this.callout('Walk it out.');
        this.sub = 'waist';
        this.pendingPrompt = null;
        break;
      case 'waitShoulder':
        this.callout('Up to shoulders, ready, up.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { lift: SHOULDER });
        this.t = 0;
        this.dur = 1.6;
        this.phase = 'lift';
        this.sub = 'animShoulder';
        this.pendingPrompt = null;
        break;
      case 'waitOverhead':
        this.callout('Up and over heads, ready, up.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { lift: OVERHEAD });
        this.t = 0;
        this.dur = 1.4;
        this.phase = 'lift';
        this.sub = 'animOverhead';
        this.pendingPrompt = null;
        break;
      case 'waitRoll': {
        this.callout('Toes to the edge. Roll it to waists, toward the water, ready, roll.');
        const snap = Math.abs(this.pose.heading) < Math.PI / 2 ? 0 : Math.PI;
        // roll direction toward the water (-z): keel world z must be negative mid-roll
        const rollTo = snap === 0 ? 0 : Math.PI * 2;
        this.snapFrom();
        Object.assign(this.to, this.pose, { cz: DOCK.minZ - 0.35, heading: snap, roll: rollTo, lift: WAIST });
        this.t = 0;
        this.dur = 2.2;
        this.phase = 'roll';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      }
      case 'waitDown':
        this.callout('Down and in — watch the fin.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { cz: DOCK.minZ - 1.05, yO: conditions.level });
        this.t = 0;
        this.dur = 2.0;
        this.phase = 'downIn';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'waitOars':
        this.callout('Oars down — ports get oars, starboards get oarlocks.');
        this.t = 0;
        this.dur = 2.2;
        this.phase = 'oars';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'waitBoard':
        this.callout('One foot in, and down.');
        this.t = 0;
        this.dur = 1.2;
        this.phase = 'board';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      // ---- unload ----
      case 'u_waitOut':
        this.callout('One foot up and out.');
        this.swapOut();
        break;
      case 'u_waitHands':
        this.callout('Hands on.');
        this.waitE('Up to waists', 'Up to waists', 'u_waitWaists');
        break;
      case 'u_waitWaists':
        this.callout('Up to waists, ready, up.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { cz: DOCK.minZ - 0.35, lift: WAIST, yO: null });
        this.t = 0;
        this.dur = 1.4;
        this.phase = 'u_waists';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'u_waitOver': {
        this.callout('Overheads, ready, up.');
        const rollTo = Math.abs(this.pose.heading) < Math.PI / 2 ? Math.PI : -Math.PI;
        this.snapFrom();
        Object.assign(this.to, this.pose, { cz: (DOCK.minZ + DOCK.maxZ) / 2, roll: rollTo, lift: OVERHEAD, yO: null });
        this.t = 0;
        this.dur = 1.6;
        this.phase = 'u_over';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      }
      case 'u_waitShoulders':
        this.callout('Split to shoulders, ready, down.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { lift: SHOULDER });
        this.t = 0;
        this.dur = 1.4;
        this.phase = 'u_shoulders';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'u_doorStop':
        this.callout('Walk it in.');
        this.phase = 'walkIn';
        this.sub = 'waistIn';
        this.pendingPrompt = null;
        break;
      case 'u_waitDown':
        this.callout('Down to waists, ready, down.');
        this.snapFrom();
        Object.assign(this.to, this.pose, { lift: WAIST });
        this.t = 0;
        this.dur = 1.4;
        this.phase = 'u_down';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      case 'u_waitRack': {
        this.callout('Up an inch, and on the racks.');
        const sh = this.slot!.heading;
        const ang = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
        const hd = ang(this.pose.heading, sh) < ang(this.pose.heading, sh + Math.PI) ? sh : sh + Math.PI;
        this.snapFrom();
        // keep roll parity continuous: both are upside down
        Object.assign(this.to, this.pose, {
          cx: this.slot!.pos.x,
          cz: this.slot!.pos.z,
          heading: hd,
          lift: this.slot!.pos.y - SPEC.freeboard - Y0,
        });
        this.t = 0;
        this.dur = 2.5;
        this.phase = 'u_rack';
        this.sub = 'anim';
        this.pendingPrompt = null;
        break;
      }
    }
  }

  private swapOut() {
    const e = this.h.eight;
    e.group.visible = false;
    this.carried.visible = true;
    this.carryH = WAIST;
    this.leadIsBow = Math.abs(e.heading) < Math.PI / 2 ? e.group.position.x < 0 : e.group.position.x > 0;
    this.setPose(e.group.position.x, e.group.position.z, Math.abs(e.heading) < Math.PI / 2 ? 0 : Math.PI, 0, WAIST, conditions.level);
    this.oarsMode = 'hand';
    for (const c of this.crew) {
      const wx = this.pose.cx + Math.cos(this.pose.heading) * c.seatX;
      c.pos.set(wx, DOCK_Y + conditions.level, DOCK.minZ + 0.35);
      c.prev.copy(c.pos);
      c.yaw = Math.PI;
      c.oar = this.oars[c.k - 1];
      c.fig.group.visible = true;
    }
    this.t = 0;
    this.dur = 2.5;
    this.phase = 'u_oarCarry';
    this.sub = 'anim';
    this.pendingPrompt = null;
  }

  private finishLoad() {
    for (const c of this.crew) c.fig.group.visible = false;
    for (const o of this.oars) o.visible = false;
    this.oarsMode = 'hidden';
    this.carried.visible = false;
    this.outSlot = this.slot;
    this.slot = null;
    _v3.set(this.pose.cx, 0, this.pose.cz);
    this.h.eight.reset(_v3, this.pose.heading);
    this.h.eight.group.visible = true;
    this.h.eight.group.name = this.outSlot?.name ?? 'eight';
    this.stowed = false;
    this.phase = 'idle';
    this.sub = '';
    this.h.boardInPlace();
  }

  private finishUnload() {
    const s = this.slot!;
    if (!s.mesh) {
      const m = new THREE.Mesh(this.carried.geometry, this.carried.material);
      m.castShadow = m.receiveShadow = true;
      this.h.scene.add(m);
      s.mesh = m;
    }
    s.mesh.matrix.copy(this.carried.matrix);
    s.mesh.matrix.decompose(s.mesh.position, s.mesh.quaternion, s.mesh.scale);
    s.mesh.visible = true;
    this.carried.visible = false;
    for (const c of this.crew) {
      c.fig.group.visible = false;
      c.oar = null;
    }
    for (const o of this.oars) o.visible = false;
    this.oarsMode = 'hidden';
    this.outSlot = null;
    this.slot = null;
    this.stowed = true;
    this.phase = 'idle';
    this.sub = '';
    this.toast('Racked.');
  }

  // ---------- per-frame ----------

  private update(dt: number) {
    if (this.callT > 0) {
      this.callT -= dt;
      if (this.callT <= 0) document.getElementById('callout')?.classList.add('hidden');
    }
    const btn = document.getElementById('callBtn');
    if (btn) {
      const show = !!this.pendingPrompt && this.h.mode() !== 'intro';
      btn.classList.toggle('hidden', !show);
      if (show) btn.textContent = this.btnLabel;
    }
    if (this.phase === 'idle') return;
    this.t += dt;
    if (ANIMS.has(this.phase)) {
      const u = this.dur === Infinity ? 1 : ease(Math.min(1, this.t / this.dur));
      this.stepAnim(u);
      if (this.t >= this.dur) this.phaseDone();
    } else {
      this.updateGates();
      if ((this.phase === 'walkOut' && WALK_OUT_SUBS.has(this.sub)) || (this.phase === 'walkIn' && WALK_IN_SUBS.has(this.sub))) this.hullFromTrail();
    }
    this.poseCrew(dt);
  }

  private stepAnim(u: number) {
    switch (this.phase) {
      case 'lift':
      case 'roll':
      case 'downIn':
      case 'u_waists':
      case 'u_over':
      case 'u_swing':
      case 'u_shoulders':
      case 'u_down':
      case 'u_rack':
        this.setPose(
          lerp(this.from.cx, this.to.cx, u),
          lerp(this.from.cz, this.to.cz, u),
          lerpAngle(this.from.heading, this.to.heading, u),
          lerp(this.from.roll, this.to.roll, u),
          lerp(this.from.lift, this.to.lift, u),
          this.to.yO === null ? null : lerp(this.from.yO ?? this.hullY, this.to.yO, u),
        );
        break;
      case 'u_approach':
        _v3.set(lerp(this.from.cx, this.to.cx, u), 0, lerp(this.from.cz, this.to.cz, u));
        this.h.eight.reset(_v3, lerpAngle(this.from.heading, this.to.heading, u));
        break;
      default:
        this.applyPose();
        break;
    }
  }

  private phaseDone() {
    switch (this.phase) {
      case 'handsOn':
        this.waitE('Up to waists — off the racks', 'Up to waists', 'waitLift');
        break;
      case 'lift':
        if (this.sub === 'animShoulder') {
          this.carryH = SHOULDER;
          this.phase = 'walkOut';
          this.waitE('Overheads', 'Overheads', 'waitOverhead');
        } else if (this.sub === 'animOverhead') {
          this.carryH = OVERHEAD;
          this.phase = 'walkOut';
          this.sub = 'waist';
          this.pendingPrompt = null;
        } else {
          this.callout('Every other rower, under to your side.');
          this.split = true;
          this.waitE('Walk it out', 'Walk it out', 'waitWalk');
        }
        break;
      case 'roll':
        this.pose.roll = 0;
        this.carryH = WAIST;
        this.waitE('Down and in', 'Down and in', 'waitDown');
        break;
      case 'downIn':
        this.oarsMode = 'deck';
        for (let i = 0; i < 8; i++) {
          const o = this.oars[i];
          o.visible = true;
          o.rotation.set(0, 0, 0);
          o.position.set(this.pose.cx - 5 + i * 1.42, DOCK_Y + conditions.level + 0.05, DOCK.maxZ - 0.4);
        }
        this.waitE('Oars down', 'Oars down', 'waitOars');
        break;
      case 'oars':
        this.oarsMode = 'hand';
        this.waitE('One foot in, and down', 'In and down', 'waitBoard');
        break;
      case 'board':
        this.finishLoad();
        break;
      case 'u_approach': {
        this.h.enterWalk();
        const e = this.h.eight;
        const sternX = e.group.position.x - Math.cos(e.heading) * (HL - 0.6);
        this.h.player.place(sternX, DOCK_Y + conditions.level, DOCK.minZ + 0.35, Math.PI, -0.1);
        this.waitE('One foot up and out', 'Up and out', 'u_waitOut');
        break;
      }
      case 'u_oarCarry':
        this.oarsMode = 'deck';
        for (let i = 0; i < 8; i++) {
          const o = this.oars[i];
          o.visible = true;
          o.rotation.set(0, 0, 0);
          o.position.set(this.pose.cx - 5 + i * 1.42, DOCK_Y + conditions.level + 0.05, DOCK.maxZ - 0.4);
        }
        for (const c of this.crew) c.oar = null;
        this.waitE('Hands on', 'Hands on', 'u_waitHands');
        break;
      case 'u_waists':
        this.waitE('Overheads', 'Overheads', 'u_waitOver');
        break;
      case 'u_over': {
        this.pose.roll = Math.PI;
        this.carryH = OVERHEAD;
        this.split = false;
        this.shouldersIn = false;
        // swing the lifted shell perpendicular to the dock, aimed up the ramp;
        // a rigid hull cannot pivot through the gangway walls under player control
        const bx = Math.cos(this.pose.heading) * HL;
        this.leadIsBow = Math.abs(this.pose.cx + bx) <= Math.abs(this.pose.cx - bx);
        this.snapFrom();
        Object.assign(this.to, this.pose, { cx: 0, heading: this.leadIsBow ? -Math.PI / 2 : Math.PI / 2 });
        this.t = 0;
        this.dur = 2.6;
        this.phase = 'u_swing';
        break;
      }
      case 'u_swing':
        this.phase = 'walkIn';
        this.sub = 'overIn';
        this.pendingPrompt = null;
        this.initTrail();
        break;
      case 'u_shoulders':
        this.carryH = SHOULDER;
        this.shouldersIn = true;
        this.phase = 'walkIn';
        this.sub = 'waistIn';
        break;
      case 'u_down':
        this.callout('Every other rower, under to your side.');
        this.split = true;
        this.waitE('On the racks', 'On the racks', 'u_waitRack');
        break;
      case 'u_rack':
        this.t = 0;
        this.dur = 2.0;
        this.phase = 'u_release';
        this.sub = 'anim';
        break;
      case 'u_release':
        this.finishUnload();
        break;
    }
  }

  private updateGates() {
    if (this.phase === 'walkOut') {
      if (this.sub === 'waist') {
        if (!this.doorChecked && this.leadTip.y > ZW - 0.2 && this.leadTip.y < ZW + 1.0) {
          this.doorChecked = true;
          this.callout('Weigh enough. Watch the riggers on the door.');
          this.waitE('Walk it out of the house', 'Walk it out', 'doorStop');
          return;
        }
        if (this.leadTip.y < ZW - 0.5 && this.carryH < SHOULDER - 0.01) {
          this.waitE('Up to shoulders', 'Up to shoulders', 'waitShoulder');
        } else if (this.leadTip.y < ZW - 0.5 && this.carryH < OVERHEAD - 0.01) {
          this.waitE('Overheads', 'Overheads', 'waitOverhead');
        }
      }
      const pp = this.h.player.pos;
      const playerOnDock = pp.z > DOCK.minZ && pp.z < DOCK.maxZ && pp.x > DOCK.minX && pp.x < DOCK.maxX;
      // spec gate is all-9-stations aligned; also allow toes-at-edge with the lead
      // over the dock edge — the roll anim swings the hull out to parallel
      if (
        (this.sub === 'waitShoulder' || this.sub === 'waitOverhead' || this.sub === 'waist') &&
        (this.onDock() || (playerOnDock && this.leadTip.y < DOCK.maxZ - 0.5))
      ) {
        this.waitE('Roll it to waists', 'Roll it to waists', 'waitRoll');
      }
    } else if (this.phase === 'walkIn') {
      if (this.sub === 'overIn' && this.tailTip.y > 0.6) {
        this.waitE('Split to shoulders', 'Split to shoulders', 'u_waitShoulders');
        return;
      }
      if (this.sub === 'waistIn' && this.shouldersIn) {
        // approaching the door from outside: stop once before entering
        if (!this.doorChecked && this.leadTip.y > ZW - 1.5 && this.leadTip.y < ZW + 0.05) {
          this.doorChecked = true;
          this.callout('Weigh enough. Watch the riggers on the door.');
          this.waitE('Walk it in', 'Walk it in', 'u_doorStop');
          return;
        }
        // near the target slot
        if (this.slot) {
          const dx = this.pose.cx - this.aisleX;
          const dz = this.pose.cz - this.slot.pos.z;
          if (Math.hypot(dx, dz) < 2.0 && Math.abs(Math.sin(this.pose.heading - this.slot.heading)) < 0.35) {
            this.waitE('Down to waists', 'Down to waists', 'u_waitDown');
          }
        }
      }
    }
  }

  // ---------- crew ----------

  private stationWorld(c: CrewState, side: number, off: number, out: THREE.Vector3) {
    const p = this.pose;
    const dx = Math.cos(p.heading);
    const dz = -Math.sin(p.heading);
    out.set(p.cx + dx * c.seatX - dz * (side * off), 0, p.cz + dz * c.seatX + dx * (side * off));
    return out;
  }

  private dockLineup(c: CrewState, out: THREE.Vector3) {
    const dx = Math.cos(this.pose.heading);
    out.set(this.pose.cx + dx * c.seatX, 0, DOCK.minZ + 0.35);
    return out;
  }

  private gunwaleWorld(seatX: number, side: number, out: THREE.Vector3) {
    out.set(seatX, gunwaleY(SPEC, seatX), side * halfBeam(SPEC, seatX));
    return out.applyMatrix4(this.carried.matrixWorld);
  }

  private poseCrew(dt: number) {
    if (!this.active) {
      for (const c of this.crew) c.fig.group.visible = false;
      return;
    }
    const walking = (this.phase === 'walkOut' && WALK_OUT_SUBS.has(this.sub)) || (this.phase === 'walkIn' && WALK_IN_SUBS.has(this.sub));
    for (const c of this.crew) {
      if (!c.fig.group.visible) continue;
      let tx = c.pos.x;
      let tz = c.pos.z;
      let yaw = c.yaw;
      let crouch = 0;
      let tilt = 0;
      let handL: THREE.Vector3 | null = null;
      let handR: THREE.Vector3 | null = null;
      const phase = this.phase;
      if (phase === 'handsOn') {
        const u = this.dur === Infinity ? 1 : ease(Math.min(1, this.t / this.dur));
        this.stationWorld(c, this.aisleSign, halfBeam(SPEC, c.seatX) + 0.32, _v3);
        tx = lerp(c.spawn.x, _v3.x, u);
        tz = lerp(c.spawn.z, _v3.z, u);
        yaw = Math.atan2(this.pose.cx + Math.cos(this.pose.heading) * c.seatX - tx, this.pose.cz - Math.sin(this.pose.heading) * c.seatX - tz);
        if (u >= 1) {
          handL = this.gunwaleWorld(c.seatX, this.aisleSign, this.handA);
          handR = this.gunwaleWorld(c.seatX, this.aisleSign, this.handB);
        }
      } else if (phase === 'roll' || phase === 'downIn' || phase === 'board' || phase === 'u_waists' || phase === 'u_over' || phase === 'u_approach' || phase === 'u_oarCarry' || phase === 'oars') {
        // crew line up at the dock edge facing -z, hands on gunwales
        if (phase === 'oars' || phase === 'u_oarCarry') {
          const u = Math.min(1, this.t / this.dur);
          this.dockLineup(c, _v3);
          const oarX = this.pose.cx - 5 + (c.k - 1) * 1.42;
          const oarZ = DOCK.maxZ - 0.4;
          if (u < 0.5) {
            const e2 = ease(u * 2);
            tx = lerp(_v3.x, oarX, e2);
            tz = lerp(_v3.z, oarZ, e2);
          } else {
            const e2 = ease((u - 0.5) * 2);
            tx = lerp(oarX, _v3.x, e2);
            tz = lerp(oarZ, _v3.z, e2);
          }
          yaw = Math.atan2(_v3.x - tx, _v3.z - tz);
          if (phase === 'oars' && u >= 0.5) c.oar = this.oars[c.k - 1];
        } else {
          this.dockLineup(c, _v3);
          tx = _v3.x;
          tz = _v3.z;
          yaw = Math.PI;
          if (phase === 'roll' || phase === 'downIn' || phase === 'u_waists') {
            // hands on the near gunwale while it swings
            const side = c.k % 2 === 1 ? 1 : -1;
            handL = this.gunwaleWorld(c.seatX, side, this.handA);
            handR = this.gunwaleWorld(c.seatX, side, this.handB);
          }
          if (phase === 'board') {
            const e2 = ease(Math.min(1, this.t / this.dur));
            tz = _v3.z - 0.35 * e2;
            crouch = 0.3 * Math.sin(e2 * Math.PI);
          }
          if (phase === 'u_over') crouch = 0.3;
        }
      } else if (phase === 'u_release') {
        tx = c.pos.x;
        tz = c.pos.z - 1.6;
        yaw = Math.PI;
        crouch = 0;
      } else {
        // carrying: stations on the crew's current side
        const side = this.split && c.k % 2 === 0 ? -this.aisleSign : this.aisleSign;
        const lift = this.carryH;
        let off: number;
        if (lift >= OVERHEAD - 0.01) off = 0.13;
        else if (lift >= SHOULDER - 0.01) off = halfBeam(SPEC, c.seatX) + 0.16;
        else off = halfBeam(SPEC, c.seatX) + 0.32;
        this.stationWorld(c, side, off, _v3);
        tx = _v3.x;
        tz = _v3.z;
        const hx = this.pose.cx + Math.cos(this.pose.heading) * c.seatX;
        const hz = this.pose.cz - Math.sin(this.pose.heading) * c.seatX;
        yaw = walking ? Math.atan2(this.leadDir.x, this.leadDir.y) : Math.atan2(hx - tx, hz - tz);
        if (lift >= OVERHEAD - 0.01) {
          handL = this.gunwaleWorld(c.seatX, 1, this.handA);
          handR = this.gunwaleWorld(c.seatX, -1, this.handB);
        } else {
          handL = this.gunwaleWorld(c.seatX, side, this.handA);
          handR = walking ? null : this.gunwaleWorld(c.seatX, side, this.handB);
          if (lift >= SHOULDER - 0.01) tilt = side * 0.35;
        }
      }
      const dx = tx - c.pos.x;
      const dz = tz - c.pos.z;
      const d = Math.hypot(dx, dz);
      const step = Math.min(d, 3 * dt);
      let moving = 0;
      if (d > 1e-4) {
        c.pos.x += (dx / d) * step;
        c.pos.z += (dz / d) * step;
        moving = Math.min(1, step / dt / 1.4);
      }
      c.pos.y = groundAt(c.pos.x, c.pos.z, c.pos.y + 0.5);
      c.walkPhase += (Math.hypot(c.pos.x - c.prev.x, c.pos.z - c.prev.z) / 0.64) * Math.PI;
      c.prev.copy(c.pos);
      c.walkAmt = lerp(c.walkAmt, moving, Math.min(1, dt * 8));
      _cp.pos.copy(c.pos);
      _cp.yaw = yaw;
      _cp.walkPhase = c.walkPhase;
      _cp.walk = c.walkAmt;
      _cp.crouch = crouch;
      _cp.handL = handL;
      _cp.handR = handR;
      _cp.headTilt = tilt;
      c.fig.setPose(_cp);
      if (c.oar && this.oarsMode === 'hand') {
        c.oar.visible = true;
        c.fig.shoulderWorld(c.k % 2 === 1 ? 1 : -1, _v4);
        c.oar.position.set(_v4.x, _v4.y - 0.55, _v4.z);
        c.oar.rotation.set(0.15, c.k % 2 === 1 ? Math.PI : 0, 0.15);
      } else if (c.oar) {
        c.oar.visible = this.oarsMode !== 'hidden';
      }
    }
  }
}
