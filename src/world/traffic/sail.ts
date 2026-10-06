import * as THREE from 'three';
import { conditions } from '../../sim/conditions';
import { centerline, channelWidth } from '../terrain';
import { Craft } from './craft';
import { type Ctx, clamp, headingTo, lerp, navDist, rng, smooth, wrap } from './nav';
import { addMesh, type Loft, loftDeck, loftGeometry, loftGunwale, loftHalfBeam, loftRail, std } from './hulls';
import { type Look, makeLook, type PeopleBatch, type SeatedPose } from './people';

/** Fallback sea breeze (from ~WNW/NW, typical bay afternoon) used only if the conditions model reports no wind. */
const FALLBACK_WIND = new THREE.Vector2(0.9, 4.2);
const CLOSE = 0.8; // 46°: sail no closer than this to the true wind (no-go zone ≈ ±45°)
const RUN = 2.62; // 150°: broad reach instead of a dead run, gybing downwind
const D2R = Math.PI / 180;

// Generic two-person-dinghy polar: boat speed / true wind speed vs true wind angle (deg).
const POLAR_A = [0, 30, 40, 46, 60, 90, 110, 135, 150, 180];
const POLAR_K = [0, 0, 0.16, 0.4, 0.5, 0.6, 0.62, 0.56, 0.5, 0.42];
function polar(twa: number) {
  const d = Math.abs(twa) / D2R;
  for (let i = 1; i < POLAR_A.length; i++) {
    if (d <= POLAR_A[i]) return lerp(POLAR_K[i - 1], POLAR_K[i], (d - POLAR_A[i - 1]) / (POLAR_A[i] - POLAR_A[i - 1]));
  }
  return POLAR_K[POLAR_K.length - 1];
}

export interface DinghyClass {
  name: 'FJ' | '420';
  loft: Loft;
  mastX: number;
  mastH: number;
  boom: number;
}

export const FJ: DinghyClass = {
  name: 'FJ',
  loft: { length: 4.03, beam: 1.5, draft: 0.17, freeboard: 0.42, transom: 0.74, bowRise: 0.12, section: 0.75, maxAt: 0.4 },
  mastX: 0.55,
  mastH: 6.0,
  boom: 2.25,
};
export const C420: DinghyClass = {
  name: '420',
  loft: { length: 4.2, beam: 1.63, draft: 0.17, freeboard: 0.43, transom: 0.72, bowRise: 0.12, section: 0.75, maxAt: 0.4 },
  mastX: 0.62,
  mastH: 6.2,
  boom: 2.4,
};

/** Cambered sail panel: luff along +y at x = 0, leech toward -x (chord fn), camber in +z. */
function sailGeometry(height: number, chord: (v: number) => number, depth: number, rows = 10, cols = 6) {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const v = i / rows;
    const c = chord(v);
    for (let j = 0; j <= cols; j++) {
      const u = j / cols;
      const x = -c * u;
      const cam = depth * c * 4 * u * (1 - u) * (1 - 0.35 * u);
      pos.push(x, v * height, cam + c * u * 0.08 * v);
    }
  }
  const row = cols + 1;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const a = i * row + j;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function line(parent: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material) {
  const m = addMesh(parent, new THREE.CylinderGeometry(r, r, 1, 4), mat);
  m.position.copy(a).add(b).multiplyScalar(0.5);
  m.scale.y = a.distanceTo(b);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3().subVectors(b, a).normalize());
  return m;
}

const _hip = new THREE.Vector3();
const _hL = new THREE.Vector3();
const _hR = new THREE.Vector3();
const _fL = new THREE.Vector3();
const _fR = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _wire = new THREE.Color('#9aa0a6');
const _tillerC = new THREE.Color('#6b4f2a');
const pose: SeatedPose = { hip: _hip, lean: 0, roll: 0, twist: 0, handL: _hL, handR: _hR, footL: _fL, footR: _fR };

/** Stanford-style college dinghy (FJ / 420) sailed by a skipper and crew. */
export class Dinghy extends Craft {
  private boomG = new THREE.Group();
  private jibG = new THREE.Group();
  private main: THREE.Mesh;
  private jib: THREE.Mesh;
  private rudder: THREE.Group;
  private tack = 1;
  private gybe = 1;
  private cooldown = 0;
  private side = 1;
  private camber = 1;
  private hike = 0;
  private trap = 0;
  private tx = 0;
  private tz = 0;
  private rand: () => number;
  private looks: Look[];
  private boomAng = 0;
  private jibAng = 0;
  private puff: number;
  private heel = 0;

  constructor(parent: THREE.Object3D, readonly cls: DinghyClass, x: number, z: number, heading: number, seed: number, hullColor: string) {
    super(parent, `traffic-${cls.name}`, x, z, heading, cls.loft.length / 2, cls.loft.beam / 2);
    const L = cls.loft;
    this.rand = rng(seed);
    this.puff = this.rand() * 100;
    const hullMat = std(hullColor, 0.3, 0, THREE.DoubleSide);
    addMesh(this.group, loftGeometry(L), hullMat, true);
    addMesh(this.group, loftDeck(L, 0.66, 0.995, 0), std('#f4f2ec', 0.4));
    addMesh(this.group, loftDeck(L, 0.02, 0.66, 0.28, 0.02), std('#cfd3d4', 0.85));
    for (const r of loftRail(L, 0.03)) addMesh(this.group, r, std('#3b3f45', 0.6));
    const alu = std('#c8ccd0', 0.35, 0.8);
    const deckY = loftGunwale(L, 0.6);
    const mast = addMesh(this.group, new THREE.CylinderGeometry(0.035, 0.045, cls.mastH, 8), alu, true);
    mast.position.set(cls.mastX, deckY + cls.mastH / 2 - 0.25, 0);
    const wire = std('#9aa0a6', 0.4, 0.8);
    const top = new THREE.Vector3(cls.mastX, deckY + cls.mastH * 0.78, 0);
    const bowX = L.length / 2 - 0.08;
    line(this.group, top, new THREE.Vector3(bowX, loftGunwale(L, 0.98), 0), 0.006, wire);
    for (const s of [-1, 1]) line(this.group, top, new THREE.Vector3(cls.mastX - 0.15, deckY, s * (loftHalfBeam(L, 0.6) - 0.02)), 0.005, wire);
    const sailMat = new THREE.MeshStandardMaterial({ color: '#f3f1ea', roughness: 0.85, side: THREE.DoubleSide });
    // Main on the boom, pivoting at the mast.
    this.boomG.position.set(cls.mastX, deckY + 0.8, 0);
    const boom = addMesh(this.boomG, new THREE.CylinderGeometry(0.03, 0.03, cls.boom, 6), alu, true);
    boom.rotation.z = Math.PI / 2;
    boom.position.x = -cls.boom / 2;
    const headH = cls.mastH - 1.25;
    this.main = addMesh(this.boomG, sailGeometry(headH, (v) => Math.max(0.12, cls.boom * (1 - v) + 0.45 * Math.sin(Math.PI * v) * (1 - v * 0.4)), 0.09), sailMat, true);
    this.main.position.y = 0.03;
    const window_ = addMesh(this.boomG, new THREE.PlaneGeometry(0.5, 0.35), new THREE.MeshStandardMaterial({ color: '#c9d6dc', transparent: true, opacity: 0.55, side: THREE.DoubleSide, roughness: 0.1 }));
    window_.position.set(-0.75, 0.75, 0.04);
    this.group.add(this.boomG);
    // Jib from the stem fitting toward the hounds, pivoting at the tack.
    this.jibG.position.set(bowX - 0.05, loftGunwale(L, 0.98) + 0.1, 0);
    const jibLuff = Math.hypot(bowX - cls.mastX, top.y - this.jibG.position.y);
    const jg = sailGeometry(jibLuff - 0.1, (v) => 1.55 * (1 - v) + 0.05, 0.08, 8, 5);
    this.jib = addMesh(this.jibG, jg, sailMat, true);
    this.jib.rotation.z = Math.atan2(bowX - cls.mastX, top.y - this.jibG.position.y);
    this.group.add(this.jibG);
    // Centreboard and rudder.
    const blade = std('#e6e4dc', 0.4);
    // Redwood Creek is turbid: model only the top of each blade, just under the surface.
    const cb = addMesh(this.group, new THREE.BoxGeometry(0.38, 0.3, 0.02), blade);
    cb.position.set(0.15, -0.12, 0);
    this.rudder = new THREE.Group();
    this.rudder.position.set(-L.length / 2 - 0.02, 0.3, 0);
    const rb = addMesh(this.rudder, new THREE.BoxGeometry(0.28, 0.5, 0.025), blade);
    rb.position.set(-0.1, -0.1, 0);
    this.group.add(this.rudder);
    this.detail.push(cb, window_);
    const tops = ['#2e2d29', '#8c1515', '#f4f2ec', '#3d5a80', '#5a5f66'];
    const pfd = ['#2e2d29', '#8c1515', '#c4302b', '#1f4e79', '#e0a63a'];
    this.looks = [makeLook(this.rand, tops, { pfd, hat: 0.6 }), makeLook(this.rand, tops, { pfd, hat: 0.4 })];
    this.pickTarget();
    this.speed = 1.5;
  }

  private pickTarget() {
    for (let k = 0; k < 20; k++) {
      const x = -380 + this.rand() * 900;
      const z = centerline(x) + (this.rand() - 0.5) * channelWidth(x) * 0.55;
      if (navDist(x, z) > 35 && Math.hypot(x - this.x, z - this.z) > 160) {
        this.tx = x;
        this.tz = z;
        return;
      }
    }
    this.tx = 60;
    this.tz = centerline(60);
  }

  update(dt: number, time: number, ctx: Ctx) {
    const W = conditions.wind.lengthSq() > 0.0025 ? conditions.wind : FALLBACK_WIND;
    // Local puffs and lulls on top of the forecast breeze.
    const puff = 1 + 0.14 * Math.sin(time * 0.11 + this.puff) + 0.08 * Math.sin(time * 0.37 + this.puff * 2);
    const wx = W.x * puff;
    const wz = W.y * puff;
    const tws = Math.hypot(wx, wz);
    const hw = Math.atan2(wz, -wx); // heading pointing straight into the wind

    if (Math.hypot(this.tx - this.x, this.tz - this.z) < 25) this.pickTarget();
    const b = headingTo(this.x, this.z, this.tx, this.tz);
    const rel = wrap(b - hw);
    this.cooldown -= dt;
    let hd: number;
    const probe = (h: number) => navDist(this.x + Math.cos(h) * 30, this.z - Math.sin(h) * 30);
    if (Math.abs(rel) < CLOSE) {
      // Beating: close-hauled on the current tack, tacking at the banks (laylines are the shores here).
      hd = hw + this.tack * CLOSE;
      if (this.cooldown <= 0 && probe(hd) < 28) {
        this.tack = -this.tack;
        this.cooldown = 10;
        hd = hw + this.tack * CLOSE;
      }
    } else if (Math.abs(rel) > RUN) {
      hd = hw + this.gybe * RUN;
      if (this.cooldown <= 0 && probe(hd) < 28) {
        this.gybe = -this.gybe;
        this.cooldown = 10;
        hd = hw + this.gybe * RUN;
      }
    } else {
      hd = b;
      this.tack = rel > 0 ? 1 : -1;
      this.gybe = this.tack;
    }
    hd = this.safeHeading(hd, ctx, 22);
    const off = wrap(hd - hw);
    // Can't bear away into the no-go zone: if avoidance pushes us there, luff and slow down instead.
    const pinched = Math.abs(off) < CLOSE;
    if (pinched) hd = hw + (off >= 0 ? 1 : -1) * CLOSE;
    const give = pinched && Math.abs(this.av.turn) > 0.2 ? 0.3 : 1;
    const turning = Math.abs(wrap(hd - this.heading)) > 0.4;
    this.steerTo(hd, turning ? 0.55 : 0.3, dt, 0.5);

    const twa = wrap(this.heading - hw);
    const lowWind = smooth(tws / 2.5);
    const vt = Math.min(4.2, polar(twa) * tws * lowWind) * this.av.slow * give;
    this.speedTo(vt, dt, 3.5, 5);

    // Apparent wind in boat axes.
    const fx = Math.cos(this.heading);
    const fz = -Math.sin(this.heading);
    const ax = -(wx - fx * this.speed);
    const az = -(wz - fz * this.speed);
    const af = ax * fx + az * fz;
    const ar = ax * -fz + az * fx;
    const awa = Math.atan2(Math.abs(ar), af);
    const aws = Math.hypot(ax, az);
    const windSide = ar >= 0 ? 1 : -1; // +1: wind over the starboard side
    const k = Math.min(1, dt * 2.2);

    // Sheet to the apparent wind; luff (flog) inside ~30° apparent.
    const luff = awa < 0.5;
    const trim = clamp(0.5 * awa - 0.12, 0.1, 1.45);
    const mainTarget = luff ? -windSide * 0.06 + 0.07 * Math.sin(time * 9 + this.puff) : -windSide * trim;
    this.boomAng += (mainTarget - this.boomAng) * k;
    this.boomG.rotation.y = this.boomAng;
    const jibTarget = luff ? 0.08 * Math.sin(time * 11) : -windSide * clamp(0.38 * awa, 0.14, 0.8);
    this.jibAng += (jibTarget - this.jibAng) * k;
    this.jibG.rotation.y = this.jibAng;
    this.camber += ((luff ? 0.15 : 1) * -windSide - this.camber) * Math.min(1, dt * 3);
    this.main.scale.z = this.camber;
    this.jib.scale.z = this.camber;

    // Heel to leeward with apparent wind; crew hikes (and in a breeze trapezes) to windward.
    const force = 0.0095 * aws * aws * (awa < Math.PI / 2 ? Math.sin(Math.max(awa, 0.35)) : 0.55 * Math.sin(awa));
    this.hike += (smooth((force - 0.07) / 0.18) - this.hike) * Math.min(1, dt * 0.8);
    this.trap += ((force > 0.32 && awa < 1.9 ? 1 : 0) - this.trap) * Math.min(1, dt * 0.6);
    const heel = clamp(force * (1 - 0.55 * this.hike) * (1 - 0.3 * this.trap), 0, 0.38);
    this.heel += (heel - this.heel) * Math.min(1, dt * 1.2);
    this.side += (windSide - this.side) * Math.min(1, dt * 1.6);
    this.roll = -Math.sign(this.side) * this.heel;
    this.pitch = -0.01 * this.speed;
    this.rudder.rotation.y = clamp(this.yawRate * 1.4, -0.6, 0.6);
    this.integrate(dt, time, 0.03);
    this.wake(ctx, dt, 0.9, 10, 0.55, 0.14);
  }

  draw(pb: PeopleBatch) {
    if (this.camDist > 450) return;
    this.group.updateMatrixWorld();
    pb.frame(this.group.matrixWorld);
    const L = this.cls.loft;
    const s = this.side >= 0 ? 1 : -1;
    const blend = Math.abs(this.side);
    const gy = loftGunwale(L, 0.5);
    // Skipper aft on the windward side deck, tiller extension in the aft hand, mainsheet in the other.
    for (let i = 0; i < 2; i++) {
      const skipper = i === 0;
      const hx = skipper ? -0.95 : 0.05;
      const hb = loftHalfBeam(L, (hx / L.length) + 0.5);
      const trap = skipper ? 0 : this.trap;
      const out = this.hike * (skipper ? 1 : 1 - trap);
      if (trap > 0.5) {
        _fL.set(hx + 0.15, gy, s * hb);
        _fR.set(hx - 0.2, gy, s * hb);
        _hip.set(hx, gy + 0.32, s * (hb + 0.82));
        pose.lean = 0;
        pose.roll = s * 1.25;
        pose.twist = 0;
        _hL.set(this.cls.mastX - 0.6, gy + 1.25, s * (hb + 0.2));
        _hR.set(hx + 0.3, gy + 0.65, s * (hb + 0.95));
        _a.set(this.cls.mastX, gy + this.cls.mastH * 0.74, 0);
        pb.limb(_a, _hip, 0.004, _wire);
      } else {
        _hip.set(hx, gy + 0.06, s * blend * (hb - 0.12 + 0.1 * out));
        pose.lean = 0.12 - 0.35 * out;
        pose.roll = s * blend * (0.12 + 0.95 * out);
        pose.twist = s * (skipper ? 0.25 : 0.1);
        _fL.set(hx + 0.55, gy - 0.26, -s * 0.12 + s * 0.15);
        _fR.set(hx + 0.6, gy - 0.26, s * 0.12 + s * 0.05);
        if (skipper) {
          _hL.set(hx - 0.25, gy + 0.32, _hip.z - s * 0.35);
          _hR.set(hx + 0.35, gy + 0.3, _hip.z - s * 0.3);
        } else {
          _hL.set(hx + 0.35, gy + 0.36, _hip.z - s * 0.3);
          _hR.set(hx + 0.2, gy + 0.05, s * hb);
        }
      }
      if (s < 0) {
        _b.copy(_hL);
        _hL.copy(_hR);
        _hR.copy(_b);
      }
      pb.person(pose, this.looks[i]);
      if (skipper) {
        // Tiller and extension to the skipper's aft hand; mainsheet from boom end to the hand.
        _a.set(-L.length / 2 + 0.02, gy + 0.08, 0);
        _b.set(-L.length / 2 + 0.95, gy + 0.08, -this.rudder.rotation.y * 0.6);
        pb.limb(_a, _b, 0.02, _tillerC);
        pb.limb(_b, s > 0 ? _hL : _hR, 0.01, _wire);
      }
    }
  }
}
