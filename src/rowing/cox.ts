import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { between } from '../world/build';
import { gunwaleY, halfBeam, HullSpec } from './hull';
import { CARDINAL, DARK, makeAnthro, WHITE, type Anthro } from './figure/anthro';
import { buildFigureGeometry } from './figure/body';
import { coxEyeLocal, solveCoxRig, type CoxPose } from './figure/coxpose';
import type { Outfit } from './figure/outfit';
import { B, makeRig } from './figure/rig';
import { FIGURE_MATERIAL } from './rower';

/** Stanford cox kit: cardinal spray jacket over the unisuit, dark tights, neoprene booties. */
const COX_OUTFIT: Outfit = {
  top: CARDINAL,
  topStyle: 'jacket',
  bottom: DARK,
  bottomStyle: 'tights',
  accent: WHITE,
  pfd: null,
  shoe: '#26272a',
};

/** Cockpit layout relative to coxX (the stern seat station CrewBoat passes in). */
const HIP_DX = 0.85;
const SEAT_TOP = 0.12;
const GRIP_DX = 0.36;
const HEEL_DX = 0.47;
const HEEL_Y = 0.04;
const FOOT_ANGLE = (55 * Math.PI) / 180;
/** NK CoxBox Core: ~112 mm diameter x 81 mm puck, cup-mounted in front of the cox. */
const BOX_R = 0.056;
const BOX_H = 0.081;
const BOX_DX = 1.56;
const BOX_Y = 0.15;

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
let coxCount = 0;

const kitMat = new THREE.MeshStandardMaterial({ color: '#1c1d1f', roughness: 0.55, metalness: 0.25 });
const carbonMat = new THREE.MeshStandardMaterial({ color: '#191a1c', roughness: 0.46, metalness: 0.55 });
const darkMat = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.65, metalness: 0.2 });
const cordMat = new THREE.MeshStandardMaterial({ color: '#2b2c2e', roughness: 0.85 });
const toggleMat = new THREE.MeshStandardMaterial({ color: '#c7ad80', roughness: 0.7 });
const unitCylinder = new THREE.CylinderGeometry(1, 1, 1, 6);

/** Cox build: 1.56-1.70 m, light, derived from the shared anthropometry. */
function coxAnthro(seed: number): Anthro {
  const base = makeAnthro(seed, 'women');
  const H = 1.56 + (base.H - 1.7) * 0.875;
  const k = H / base.H;
  const girth = 0.8 + (base.girth / 0.9 - 0.93) * 0.4;
  return {
    ...base,
    H,
    girth,
    thigh: base.thigh * k,
    shin: base.shin * k,
    upperArm: base.upperArm * k,
    foreArm: base.foreArm * k,
    hand: base.hand * k,
    foot: base.foot * k,
    ankleH: base.ankleH * k,
    trunk: base.trunk * k,
    hipAboveSeat: base.hipAboveSeat * k,
    hipHalf: base.hipHalf * k * 0.92,
    shoulderHalf: 0.097 * H * (0.96 + 0.08 * (girth - 0.8)),
    neck: base.neck * k,
    head: Math.sqrt(H / 1.88) * 0.95,
    headwear: base.headwear === 'none' ? 'none' : 'cap',
    shoe: COX_OUTFIT.shoe ?? base.shoe,
  };
}

function tube(points: THREE.Vector3[], radius: number, segments = 24) {
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), segments, radius, 6, false);
}

/** Behind-the-head mic band (NK style): U-shaped ear rests, metal boom to the mouth, cable down the back. */
function headsetGeometry(a: Anthro) {
  const hd = a.head;
  const cx = 0.012 * hd;
  const cy = 0.085 * hd;
  const rx = 0.098 * hd + 0.011;
  const rz = 0.077 * hd + 0.01;
  const band: THREE.Vector3[] = [];
  for (let i = 0; i <= 12; i++) {
    const th = -Math.PI / 2 - 0.2 + ((Math.PI + 0.4) * i) / 12;
    const back = Math.cos(th);
    band.push(new THREE.Vector3(cx - back * rx, cy - 0.012 - 0.03 * Math.max(0, back), Math.sin(th) * rz));
  }
  const parts: THREE.BufferGeometry[] = [tube(band, 0.0035, 32)];
  for (const s of [-1, 1]) {
    const pad = new THREE.SphereGeometry(1, 10, 8);
    pad.scale(0.016, 0.026, 0.007);
    pad.translate(cx + 0.006, cy - 0.006, s * (rz + 0.001));
    parts.push(pad);
  }
  const mouthY = cy - 0.066 * hd;
  parts.push(
    tube(
      [
        new THREE.Vector3(cx + 0.012, cy - 0.012, rz + 0.004),
        new THREE.Vector3(cx + 0.05, cy - 0.04, 0.072 * hd + 0.012),
        new THREE.Vector3(cx + 0.083 * hd + 0.012, mouthY + 0.002, 0.04 * hd + 0.01),
        new THREE.Vector3(cx + 0.098 * hd + 0.013, mouthY, 0.012),
      ],
      0.0022,
      16,
    ),
  );
  const foam = new THREE.SphereGeometry(0.0095, 10, 8);
  foam.scale(1, 0.85, 1.25);
  foam.translate(cx + 0.098 * hd + 0.014, mouthY, 0.008);
  parts.push(foam);
  parts.push(
    tube(
      [
        new THREE.Vector3(cx - 0.004, cy - 0.03, rz + 0.002),
        new THREE.Vector3(cx - 0.03, cy - 0.075, rz * 0.9),
        new THREE.Vector3(cx - 0.055, cy - 0.13, rz * 0.55),
        new THREE.Vector3(cx - 0.06, cy - 0.18, 0.03),
      ],
      0.0028,
      14,
    ),
  );
  return mergeGeometries(parts)!;
}

export class Coxswain {
  readonly group = new THREE.Group();
  /** Cox-seat camera point (boat-local); updated every frame from the head. */
  readonly eye: THREE.Vector3;
  /** Cox-seat camera pitch (rad): low enough for hands and knees, high enough for the stroke seat. */
  readonly pitch = -0.55;
  private readonly withFigure: boolean;
  private readonly spec: HullSpec;
  private readonly coxX: number;
  private readonly seed: number;
  private readonly rudderPivot: THREE.Group;
  private readonly steeringLines: THREE.Mesh[] = [];
  private readonly toggles: THREE.Mesh[] = [];
  private readonly boxScreen: CanvasRenderingContext2D | null;
  private readonly screenTexture: THREE.CanvasTexture | null;
  private anthro: Anthro | null = null;
  private mesh: THREE.SkinnedMesh | null = null;
  private readonly bones: THREE.Bone[] = [];
  private readonly rig = makeRig();
  private readonly pose: CoxPose;
  private readonly eyeLocal = new THREE.Vector3();
  private firstPerson = false;
  private lastTime = NaN;
  private lastSpeed = 0;
  private surge = 0;
  private readoutSpm = 0;
  private readoutSplit = '—:—';
  private drawnSpm = -1;
  private drawnSplit = '';
  private lastDraw = -Infinity;

  constructor(opts: { seed: number; coxX: number; spec: HullSpec; withFigure: boolean }) {
    this.withFigure = opts.withFigure;
    this.spec = opts.spec;
    this.coxX = opts.coxX;
    this.seed = opts.seed + 7 * coxCount++;
    const hipX = this.coxX + HIP_DX;
    this.eye = new THREE.Vector3(hipX + 0.02, SEAT_TOP + 0.76, 0);
    this.pose = {
      hipX,
      seatTop: SEAT_TOP,
      lean: 0.06,
      roll: 0,
      headPitch: 0.1,
      heelX: hipX + HEEL_DX,
      heelY: HEEL_Y,
      footAngle: FOOT_ANGLE,
      gripL: new THREE.Vector3(),
      gripR: new THREE.Vector3(),
    };
    const xt = this.coxX - 0.42;
    const gunwale = gunwaleY(this.spec, this.coxX);
    this.rudderPivot = new THREE.Group();
    this.rudderPivot.position.set(xt, 0, 0);
    this.group.add(this.rudderPivot);

    const post = new THREE.Mesh(unitCylinder, carbonMat);
    post.position.set(0, gunwale - 0.08, 0);
    post.scale.set(0.012, Math.max(0.06, gunwale + 0.18), 0.012);
    this.rudderPivot.add(post);
    const yoke = new THREE.Mesh(unitCylinder, carbonMat);
    yoke.rotation.x = Math.PI / 2;
    yoke.position.y = gunwale + 0.02;
    yoke.scale.set(0.008, 0.07, 0.008);
    yoke.visible = this.withFigure;
    this.rudderPivot.add(yoke);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.006), carbonMat);
    blade.position.set(-0.06, -0.14, 0);
    this.rudderPivot.add(blade);
    const bladeCap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.012), darkMat);
    bladeCap.position.set(-0.01, -0.14, 0);
    this.rudderPivot.add(bladeCap);

    if (!this.withFigure) {
      this.boxScreen = null;
      this.screenTexture = null;
      this.update(0, 0, 0);
      return;
    }

    // Steering: yoke -> aft fairlead -> toggle -> forward fairlead, along the inside of each gunwale.
    const lineGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
    for (let i = 0; i < 6; i++) {
      const line = new THREE.Mesh(lineGeo, cordMat);
      this.group.add(line);
      this.steeringLines.push(line);
    }
    const fairleads: THREE.BufferGeometry[] = [];
    for (const x of [this.aftLeadX(), this.foreLeadX()]) {
      for (const s of [-1, 1]) {
        const g = new THREE.SphereGeometry(0.011, 8, 6);
        g.translate(x, gunwaleY(this.spec, x) + 0.012, s * (halfBeam(this.spec, x) - 0.03));
        fairleads.push(g);
      }
    }
    this.group.add(new THREE.Mesh(mergeGeometries(fairleads)!, carbonMat));
    const toggleGeo = new THREE.CylinderGeometry(0.0125, 0.0125, 0.1, 10);
    for (let i = 0; i < 2; i++) {
      const toggle = new THREE.Mesh(toggleGeo, toggleMat);
      toggle.castShadow = true;
      this.group.add(toggle);
      this.toggles.push(toggle);
    }

    // Cox seat, low in the stern cockpit.
    const seatW = 2 * halfBeam(this.spec, hipX) * 0.86;
    const seat = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, seatW), carbonMat);
    seat.position.set(hipX - 0.05, SEAT_TOP - 0.015, 0);
    seat.receiveShadow = true;
    this.group.add(seat);

    // Cox box in its cup, angled up at the cox, with the speaker harness and the mic lead.
    const boxX = this.coxX + BOX_DX;
    const boxC = new THREE.Vector3(boxX, BOX_Y, 0);
    const axis = new THREE.Vector3(-0.72, 0.69, 0).normalize();
    _q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    const puck = new THREE.CylinderGeometry(BOX_R, BOX_R * 0.97, BOX_H, 28);
    const cup = new THREE.CylinderGeometry(BOX_R + 0.006, BOX_R + 0.004, 0.045, 28, 1, true);
    cup.translate(0, -BOX_H / 2 + 0.012, 0);
    for (const g of [puck, cup]) {
      g.applyQuaternion(_q);
      g.translate(boxC.x, boxC.y, boxC.z);
    }
    const back = boxC.clone().addScaledVector(axis, -BOX_H / 2);
    const keel = 0.022;
    const box = mergeGeometries([
      puck,
      cup,
      tube([back, new THREE.Vector3(back.x + 0.03, keel, 0.0)], 0.009, 2),
      tube(
        [
          back.clone().add(new THREE.Vector3(0.005, -0.004, 0.02)),
          new THREE.Vector3(back.x + 0.05, keel, 0.035),
          new THREE.Vector3(back.x + 0.4, keel, 0.05),
          new THREE.Vector3(back.x + 1.6, keel, 0.05),
        ],
        0.004,
        30,
      ),
      tube(
        [
          back.clone().add(new THREE.Vector3(0, -0.006, -0.02)),
          new THREE.Vector3(back.x - 0.04, keel, -0.03),
          new THREE.Vector3(hipX + 0.5, keel, -0.04),
          new THREE.Vector3(hipX + 0.22, keel + 0.01, -0.06),
          new THREE.Vector3(hipX + 0.08, SEAT_TOP + 0.05, -0.1),
        ],
        0.003,
        30,
      ),
    ])!;
    const boxMesh = new THREE.Mesh(box, kitMat);
    boxMesh.castShadow = true;
    this.group.add(boxMesh);
    const canvas = document.createElement('canvas');
    canvas.width = 96;
    canvas.height = 128;
    this.boxScreen = canvas.getContext('2d');
    this.screenTexture = new THREE.CanvasTexture(canvas);
    this.screenTexture.colorSpace = THREE.SRGBColorSpace;
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.072), new THREE.MeshBasicMaterial({ map: this.screenTexture }));
    // face the cox, display "up" toward the bow
    const zAxis = axis;
    const yAxis = new THREE.Vector3(1, 0, 0).addScaledVector(zAxis, -zAxis.x).normalize();
    const xAxis = new THREE.Vector3().crossVectors(yAxis, zAxis);
    screen.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis));
    screen.position.copy(boxC).addScaledVector(axis, BOX_H / 2 + 0.0015);
    this.group.add(screen);
    this.drawReadout(0, '—:—');
    this.layout(0, 0);
  }

  private aftLeadX() {
    return this.coxX + HIP_DX - 0.24;
  }

  private foreLeadX() {
    return this.coxX + HIP_DX + GRIP_DX + 0.3;
  }

  /** Built on the first update, after the boat's rowers, so makeAnthro's crew alternation is untouched. */
  private buildFigure() {
    const a = (this.anthro = coxAnthro(this.seed));
    this.layout(0, 0);
    const rest = makeRig();
    solveCoxRig(a, this.pose, rest);
    const mesh = (this.mesh = new THREE.SkinnedMesh(buildFigureGeometry(a, rest, COX_OUTFIT), FIGURE_MATERIAL));
    for (let i = 0; i < rest.p.length; i++) {
      const bone = new THREE.Bone();
      bone.position.copy(rest.p[i]);
      bone.quaternion.copy(rest.q[i]);
      this.bones.push(bone);
      mesh.add(bone);
    }
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(this.bones));
    // the foot board under the cox's heels: shrink the shared stretcher plate to the cockpit
    this.bones[B.stretcher].scale.set(1, 0.6, 0.5);
    const headset = new THREE.Mesh(headsetGeometry(a), kitMat);
    headset.castShadow = true;
    this.bones[B.head].add(headset);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.1);
    this.group.add(mesh);
    coxEyeLocal(a, this.eyeLocal);
    this.eyeLocal.x -= 0.1;
    this.eyeLocal.y += 0.02;
    this.applyFirstPerson();
  }

  private drawReadout(spm: number, split: string) {
    if (!this.boxScreen || !this.screenTexture) return;
    const ctx = this.boxScreen;
    ctx.fillStyle = '#151719';
    ctx.fillRect(0, 0, 96, 128);
    ctx.fillStyle = '#d8e4d2';
    ctx.font = 'bold 42px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(spm > 0 ? String(spm) : '—', 4, 49);
    ctx.font = 'bold 14px ui-monospace, monospace';
    ctx.textAlign = 'right';
    ctx.fillText(split, 92, 96);
    this.screenTexture.needsUpdate = true;
    this.drawnSpm = spm;
    this.drawnSplit = split;
  }

  setFirstPerson(on: boolean) {
    if (!this.withFigure || this.firstPerson === on) return;
    this.firstPerson = on;
    this.applyFirstPerson();
  }

  /** Cox seat view: collapse the head and neck (and the headset on the head bone); arms, hands and legs stay. */
  private applyFirstPerson() {
    if (!this.mesh) return;
    const s = this.firstPerson ? 1e-4 : 1;
    this.bones[B.head].scale.setScalar(s);
    this.bones[B.neck].scale.setScalar(s);
  }

  setReadout(spm: number, split: string) {
    this.readoutSpm = spm;
    this.readoutSplit = split;
  }

  /** Toggles, steering lines and rudder for the current hand / rudder positions. */
  private layout(hands: number, rudder: number) {
    this.rudderPivot.rotation.y = rudder;
    if (!this.withFigure) return;
    // human-speed hands: right hand forward = starboard, left hand forward = port
    const displacement = 0.15 * Math.sin(0.262 * hands);
    const gx = this.coxX + HIP_DX + GRIP_DX;
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const x = gx + s * displacement;
      const grip = i === 0 ? this.pose.gripL : this.pose.gripR;
      grip.set(x, gunwaleY(this.spec, x) + 0.045, s * (halfBeam(this.spec, x) - 0.03));
      this.toggles[i].position.copy(grip);
    }
    const xt = this.coxX - 0.42;
    const yt = gunwaleY(this.spec, xt) + 0.012;
    const xa = this.aftLeadX();
    const xf = this.foreLeadX();
    for (let i = 0; i < 2; i++) {
      const s = i === 0 ? -1 : 1;
      const grip = i === 0 ? this.pose.gripL : this.pose.gripR;
      const ya = gunwaleY(this.spec, xa) + 0.012;
      const za = s * (halfBeam(this.spec, xa) - 0.03);
      between(this.steeringLines[i * 3], _a.set(xt + Math.sin(rudder) * s * 0.035, yt, Math.cos(rudder) * s * 0.035), _b.set(xa, ya, za), 0.0045);
      _v.set(grip.x, grip.y - 0.033, grip.z);
      between(this.steeringLines[i * 3 + 1], _a.set(xa, ya, za), _v, 0.0045);
      between(this.steeringLines[i * 3 + 2], _v, _b.set(xf, gunwaleY(this.spec, xf) + 0.012, s * (halfBeam(this.spec, xf) - 0.03)), 0.0045);
    }
  }

  /** speed: boat speed (m/s); its rate of change drives the cox's surge sway. */
  update(hands: number, rudder: number, time: number, speed = 0) {
    if (this.withFigure && !this.mesh) this.buildFigure();
    this.layout(hands, rudder);
    const dt = time - this.lastTime;
    if (dt > 1e-4 && dt < 0.5) {
      const accel = (speed - this.lastSpeed) / dt;
      this.surge += (accel - this.surge) * (1 - Math.exp(-dt / 0.15));
    } else {
      this.surge = 0;
    }
    this.lastTime = time;
    this.lastSpeed = speed;

    if (this.mesh && this.anthro) {
      const p = this.pose;
      // the trunk lags the hull: thrown back as the boat surges forward, forward as it checks at the catch
      p.lean = 0.06 + THREE.MathUtils.clamp(-0.012 * this.surge, -0.07, 0.07) + 0.006 * Math.sin(time * 1.3);
      p.roll = 0.012 * Math.sin(time * 0.55);
      p.headPitch = 0.1 - 0.4 * (p.lean - 0.06);
      solveCoxRig(this.anthro, p, this.rig);
      for (let i = 0; i < this.bones.length; i++) {
        this.bones[i].position.copy(this.rig.p[i]);
        this.bones[i].quaternion.copy(this.rig.q[i]);
      }
      this.mesh.boundingSphere!.center.copy(this.rig.p[B.pelvis]);
      this.eye.copy(this.eyeLocal).applyQuaternion(this.rig.q[B.head]).add(this.rig.p[B.head]);
    }
    if (time - this.lastDraw >= 0.5 && (this.readoutSpm !== this.drawnSpm || this.readoutSplit !== this.drawnSplit)) {
      this.drawReadout(this.readoutSpm, this.readoutSplit);
      this.lastDraw = time;
    }
  }
}
