import * as THREE from 'three';
import { blobTexture, ringTexture, textTexture } from '../textures';
import { between } from '../world/build';
import { centerline, channelDepthDist } from '../world/terrain';
import { deckGeometry, EIGHT, FOUR, gunwaleY, halfBeam, hullGeometry, HullSpec, PAIR } from './hull';
import { BLADE_CENTER, makeOarMesh } from './oar';
import { RowerFigure } from './rower';

const TC = 0.96; // catch angle (rad, blade toward bow)
const TF = 0.6; // finish angle
const PIN_Y = 0.36;
const PIN_Z = 0.84;
const DRAG = 0.0208;
const IMPULSE = 1.0;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ease = (x: number) => {
  x = clamp01(x);
  return x * x * (3 - 2 * x);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type BoatClass = '8+' | '4+' | '2-';

interface BoatRower {
  side: number;
  seatX: number;
  oar: THREE.Group;
  seat: THREE.Mesh;
  figure: RowerFigure;
}

interface Fx {
  m: THREE.Mesh;
  life: number;
  age: number;
  s0: number;
  s1: number;
  a0: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');

export class CrewBoat {
  group = new THREE.Group();
  rate = 24;
  speed = 0;
  distance = 0;
  heading = 0;
  spm = 0;
  t = 0;
  running = false;
  onCatch?: () => void;
  onFinish?: () => void;
  private queued = false;
  private rowers: BoatRower[] = [];
  private autoHold = 0;
  private lastCatch = -10;
  private time = 0;
  private fx: Fx[] = [];
  private fxNext = 0;
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private readonly hullSpec: HullSpec;
  private readonly hasCox: boolean;
  private readonly coxPosition: THREE.Vector3;

  constructor(
    readonly scene: THREE.Scene,
    cls: BoatClass = '8+',
    opts?: { name?: string; hullColor?: string },
  ) {
    this.hullSpec = cls === '8+' ? EIGHT : cls === '4+' ? FOUR : PAIR;
    this.hasCox = cls !== '2-';
    this.coxPosition = new THREE.Vector3(-this.hullSpec.length / 2 + 0.85, 1, 0);
    const g = this.group;
    g.rotation.order = 'YZX';
    g.name = opts?.name ?? (cls === '8+' ? 'eight' : `crewboat-${cls}`);
    scene.add(g);
    const hullMat = new THREE.MeshPhysicalMaterial({ color: opts?.hullColor ?? '#8c1515', roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.15, side: THREE.DoubleSide });
    const hull = new THREE.Mesh(hullGeometry(this.hullSpec), hullMat);
    hull.castShadow = true;
    hull.receiveShadow = true;
    g.add(hull);
    const deckMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.35, side: THREE.DoubleSide });
    for (const [x0, x1] of [
      [Math.min(5.3, this.hullSpec.length / 2 - 0.3), this.hullSpec.length / 2 - 0.02],
      [-this.hullSpec.length / 2 + 0.02, -this.hullSpec.length / 2 + 0.55],
    ]) {
      const d = new THREE.Mesh(deckGeometry(this.hullSpec, x0, x1), deckMat);
      d.castShadow = true;
      g.add(d);
    }
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(1.5, 0.22),
      new THREE.MeshStandardMaterial({ map: textTexture('STANFORD', { color: '#8c1515', w: 512, h: 80, font: 'bold 64px Georgia, serif' }), transparent: true, depthWrite: false }),
    );
    name.rotation.set(-Math.PI / 2, 0, -Math.PI / 2);
    name.position.set(Math.min(6.6, this.hullSpec.length / 2 - 1), gunwaleY(this.hullSpec, Math.min(6.6, this.hullSpec.length / 2 - 1)) + 0.02, 0);
    g.add(name);
    const trim = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.4 });
    for (const s of [-1, 1]) {
      const pts: THREE.Vector3[] = [];
      for (let x = -this.hullSpec.length / 2 + 0.1; x <= this.hullSpec.length / 2 - 0.1; x += 0.4) pts.push(new THREE.Vector3(x, gunwaleY(this.hullSpec, x) + 0.005, s * (halfBeam(this.hullSpec, x) + 0.004)));
      const rail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.012, 5), trim);
      g.add(rail);
    }
    const bowBall = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), trim);
    bowBall.position.set(this.hullSpec.length / 2, gunwaleY(this.hullSpec, this.hullSpec.length / 2) + 0.02, 0);
    g.add(bowBall);
    const carbon = new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.5, metalness: 0.3 });
    const keelson = new THREE.Mesh(new THREE.BoxGeometry(this.hullSpec.length - 3.4, 0.03, 0.26), carbon);
    keelson.position.set(-0.9, 0.0, 0);
    g.add(keelson);
    const fin = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.01), carbon);
    fin.position.set(-this.hullSpec.length / 2 + 0.7, -0.2, 0);
    g.add(fin);
    if (this.hasCox) {
      const coxSeat = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.42), carbon);
      coxSeat.position.set(this.coxPosition.x + 0.1, 0.12, 0);
      g.add(coxSeat);
      const coxBox = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.12, 0.16), carbon);
      coxBox.position.set(this.coxPosition.x + 0.75, 0.3, 0.17);
      g.add(coxBox);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.08), new THREE.MeshBasicMaterial({ color: '#9fd17a' }));
      screen.rotation.y = -Math.PI / 2;
      screen.position.set(this.coxPosition.x + 0.695, 0.31, 0.17);
      g.add(screen);
    }
    const alu = new THREE.MeshStandardMaterial({ color: '#c3c6c9', roughness: 0.3, metalness: 0.85 });
    const limb = new THREE.CylinderGeometry(1, 1, 1, 8);
    const seatGeo = new THREE.BoxGeometry(0.3, 0.05, 0.28);
    const trackGeo = new THREE.BoxGeometry(0.8, 0.03, 0.025);
    const plateGeo = new THREE.BoxGeometry(0.03, 0.32, 0.36);
    const seatCount = cls === '8+' ? 8 : cls === '4+' ? 4 : 2;
    const seatSpacing = cls === '8+' ? 1.42 : this.hullSpec.length / (seatCount + 4);
    for (let k = 1; k <= seatCount; k++) {
      const seatX = cls === '8+' ? -5.5 + (8 - k) * 1.42 : ((seatCount - 1) * seatSpacing) / 2 - (k - 1) * seatSpacing;
      const side = k % 2 === 0 ? -1 : 1;
      const pinX = seatX - 0.2;
      for (const z of [-0.12, 0.12]) {
        const tr = new THREE.Mesh(trackGeo, carbon);
        tr.position.set(seatX, 0.12, z);
        g.add(tr);
      }
      const plate = new THREE.Mesh(plateGeo, carbon);
      plate.position.set(seatX - 0.78, 0.17, 0);
      plate.rotation.z = -0.7;
      g.add(plate);
      const hb = halfBeam(this.hullSpec, pinX);
      const gy = gunwaleY(this.hullSpec, pinX);
      const pin = new THREE.Vector3(pinX, PIN_Y - 0.03, side * PIN_Z);
      for (const dx of [-0.3, 0.3]) {
        const st = new THREE.Mesh(limb, alu);
        between(st, new THREE.Vector3(pinX + dx, gy, side * hb), pin, 0.014);
        st.castShadow = true;
        g.add(st);
      }
      const back = new THREE.Mesh(limb, alu);
      between(back, new THREE.Vector3(pinX, 0.02, side * 0.12), pin, 0.012);
      g.add(back);
      const oar = makeOarMesh();
      oar.rotation.order = 'YZX';
      oar.position.set(pinX, PIN_Y, side * PIN_Z);
      g.add(oar);
      const seat = new THREE.Mesh(seatGeo, carbon);
      g.add(seat);
      const figure = new RowerFigure({ seed: k });
      g.add(figure.group);
      this.rowers.push({
        side,
        seatX,
        oar,
        seat,
        figure,
      });
    }
    const ring = ringTexture();
    const blob = blobTexture();
    const plane = new THREE.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI / 2);
    for (let i = 0; i < 64; i++) {
      const isSplash = i >= 48;
      const m = new THREE.Mesh(
        plane,
        new THREE.MeshBasicMaterial({ map: isSplash ? blob : ring, transparent: true, depthWrite: false, opacity: 0, color: isSplash ? '#ffffff' : '#dfeaf0' }),
      );
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      this.fx.push({ m, life: 1, age: 1, s0: 1, s1: 1, a0: 0 });
    }
    this.pose();
  }

  get x() {
    return this.group.position.x;
  }
  get z() {
    return this.group.position.z;
  }

  reset(p: THREE.Vector3, heading: number) {
    this.group.position.set(p.x, 0, p.z);
    this.heading = heading;
    this.speed = 0;
    this.distance = 0;
    this.running = false;
    this.queued = false;
    this.t = 0;
    this.spm = 0;
    this.chaseInit = false;
    this.pose();
  }

  get driveFrac() {
    return lerp(0.34, 0.46, clamp01((this.rate - 18) / 18));
  }

  get phase() {
    if (!this.running) return this.speed > 0.3 ? 'Glide' : 'Ready';
    return this.t < this.driveFrac ? 'Drive' : 'Recovery';
  }

  stroke() {
    if (!this.running) {
      this.running = true;
      this.t = 0;
      this.catchEvent();
    } else this.queued = true;
  }

  private catchEvent() {
    if (this.time - this.lastCatch < 5) this.spm = 60 / (this.time - this.lastCatch);
    this.lastCatch = this.time;
    this.group.updateMatrixWorld();
    for (const r of this.rowers) this.spawnAtBlade(r, true);
    this.onCatch?.();
  }

  private finishEvent() {
    this.group.updateMatrixWorld();
    for (const r of this.rowers) this.spawnAtBlade(r, false);
    this.onFinish?.();
  }

  private spawnAtBlade(r: BoatRower, splash: boolean) {
    _a.set(BLADE_CENTER, -0.1, 0).applyMatrix4(r.oar.matrixWorld);
    const pool = splash ? [48, 64] : [0, 48];
    const f = this.fx[pool[0] + (this.fxNext++ % (pool[1] - pool[0]))];
    f.m.position.set(_a.x, 0.03, _a.z);
    f.m.visible = true;
    f.age = 0;
    if (splash) {
      f.life = 0.45;
      f.s0 = 0.25;
      f.s1 = 0.9;
      f.a0 = 0.8;
    } else {
      f.life = 5;
      f.s0 = 0.5;
      f.s1 = 2.6;
      f.a0 = 0.55;
    }
  }

  private pose() {
    const d = this.driveFrac;
    const t = this.t;
    let slide: number;
    let lean: number;
    let theta: number;
    let pitch: number;
    let feather: number;
    if (t < d) {
      const u = t / d;
      slide = lerp(-0.3, 0.3, ease(u / 0.65));
      lean = lerp(0.42, -0.3, ease((u - 0.3) / 0.6));
      theta = lerp(TC, -TF, 0.5 - 0.5 * Math.cos(Math.PI * u));
      pitch = u < 0.06 ? lerp(0.08, 0.17, u / 0.06) : u > 0.94 ? lerp(0.17, 0.06, (u - 0.94) / 0.06) : 0.17;
      feather = 0;
    } else {
      const r = (t - d) / (1 - d);
      theta = lerp(-TF, TC, ease(r));
      lean = lerp(-0.3, 0.42, ease(r / 0.35));
      slide = lerp(0.3, -0.3, ease((r - 0.25) / 0.75));
      pitch = r < 0.85 ? 0.05 : lerp(0.05, 0.08, (r - 0.85) / 0.15);
      feather = r < 0.12 ? ease(r / 0.12) : r < 0.7 ? 1 : 1 - ease((r - 0.7) / 0.2);
    }
    for (const rw of this.rowers) {
      const s = rw.side;
      const o = rw.oar;
      o.rotation.set(feather * Math.PI * 0.5, s * (theta - Math.PI / 2), -pitch);
      o.updateMatrix();
      const hx = rw.seatX + slide;
      rw.seat.position.set(hx, 0.16, 0);
      const handIn = _c.set(-0.86, 0, 0).applyMatrix4(o.matrix).clone();
      const handOut = _c.set(-1.08, 0, 0).applyMatrix4(o.matrix).clone();
      rw.figure.setPose({ seatX: rw.seatX, slide, lean, stretcherX: rw.seatX - 0.72, handIn, handOut, side: s });
    }
  }

  update(dt: number, steer: number, time: number) {
    this.time = time;
    const T = 60 / this.rate;
    const d = this.driveFrac;
    if (this.running) {
      const prev = this.t;
      this.t += dt / T;
      if (this.t < d) {
        const u = this.t / d;
        this.speed += IMPULSE * (Math.PI / 2) * Math.sin(Math.PI * u) * (dt / (d * T));
      }
      if (prev < d && this.t >= d) this.finishEvent();
      if (this.t >= 1) {
        if (this.queued) {
          this.queued = false;
          this.t -= 1;
          this.catchEvent();
        } else {
          this.t = 0;
          this.running = false;
        }
      }
    }
    if (time - this.lastCatch > 5) this.spm = 0;
    this.speed = Math.max(0, this.speed - (DRAG * this.speed * this.speed + 0.015 * this.speed) * dt);

    const g = this.group;
    const grip = Math.min(1, this.speed / 3);
    if (steer !== 0) this.autoHold = 3;
    this.autoHold -= dt;
    let yawRate = steer * 0.1 * grip;
    if (this.autoHold <= 0 && this.speed > 0.2) {
      const look = g.position.x + 90;
      const want = Math.atan2(-(centerline(look) - g.position.z), 90);
      yawRate += THREE.MathUtils.clamp(want - this.heading, -0.4, 0.4) * 0.25 * grip;
    }
    const inner = channelDepthDist(g.position.x, g.position.z);
    if (inner < 14) {
      const want = Math.atan2(-(centerline(g.position.x + 60) - g.position.z), 60);
      yawRate += (want - this.heading) * 0.8;
      this.speed *= 1 - 0.6 * dt;
    }
    this.heading += yawRate * dt;
    const step = this.speed * dt;
    g.position.x += Math.cos(this.heading) * step;
    g.position.z -= Math.sin(this.heading) * step;
    if (g.position.x > 5000 || g.position.x < -3000) {
      g.position.x = THREE.MathUtils.clamp(g.position.x, -3000, 5000);
      this.speed *= 0.9;
    }
    this.distance += step;
    const surge = this.running && this.t < d ? Math.sin((Math.PI * this.t) / d) : 0;
    g.position.y = 0.012 * Math.sin(time * 1.6) - 0.01 * surge;
    g.rotation.set(0.008 * Math.sin(time * 1.1) + 0.004 * Math.sin(time * 2.7), this.heading, 0.003 * surge);
    this.pose();

    for (const f of this.fx) {
      if (!f.m.visible) continue;
      f.age += dt;
      const k = f.age / f.life;
      if (k >= 1) {
        f.m.visible = false;
        continue;
      }
      const s = lerp(f.s0, f.s1, 1 - (1 - k) * (1 - k));
      f.m.scale.set(s, 1, s);
      (f.m.material as THREE.MeshBasicMaterial).opacity = f.a0 * (1 - k);
    }
  }

  /** Cox seat view (looking toward the bow) or an elevated chase view. */
  applyCamera(cam: THREE.PerspectiveCamera, yawOff: number, pitchOff: number, chase: boolean, dt: number) {
    const g = this.group;
    if (!chase && this.hasCox) {
      cam.position.copy(this.coxPosition).applyMatrix4(g.matrixWorld);
      _e.set(pitchOff - 0.05, this.heading - Math.PI / 2 + yawOff, 0);
      cam.rotation.copy(_e);
      this.chaseInit = false;
      return;
    }
    const a = this.heading + yawOff;
    _a.set(g.position.x - Math.cos(a) * 17, 6.5 + pitchOff * 8, g.position.z + Math.sin(a) * 17);
    if (!this.chaseInit) {
      this.chasePos.copy(_a);
      this.chaseInit = true;
    }
    this.chasePos.lerp(_a, 1 - Math.exp(-dt * 3));
    cam.position.copy(this.chasePos);
    _b.set(g.position.x + Math.cos(this.heading) * 5, 0.6, g.position.z - Math.sin(this.heading) * 5);
    cam.lookAt(_b);
  }
}
