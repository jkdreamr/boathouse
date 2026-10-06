import * as THREE from 'three';
import { between } from '../world/build';
import { gunwaleY, HullSpec } from './hull';

const SKIN_TONES = ['#f1c7a5', '#e0ac87', '#c68863', '#a86b47', '#7d4a2d', '#5a3420'];
const CARDINAL = '#8c1515';
const WHITE = '#f4f2ec';
const DARK = '#2e2d29';
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

export class Coxswain {
  readonly group = new THREE.Group();
  readonly eye: THREE.Vector3;
  private readonly withFigure: boolean;
  private readonly spec: HullSpec;
  private readonly coxX: number;
  private readonly rudderPivot: THREE.Group;
  private readonly steeringLines: THREE.Mesh[] = [];
  private readonly toggles: THREE.Mesh[] = [];
  private readonly toggleMarkers: THREE.Mesh[] = [];
  private readonly arms: THREE.Mesh[] = [];
  private readonly handMeshes: THREE.Mesh[] = [];
  private readonly micAndHeadset: THREE.Object3D[] = [];
  private readonly bodyMeshes: THREE.Object3D[] = [];
  private figureGroup: THREE.Group | null = null;
  private readonly boxScreen: CanvasRenderingContext2D | null;
  private readonly screenTexture: THREE.CanvasTexture | null;
  private firstPerson = false;
  private readoutSpm = 0;
  private readoutSplit = '—:—';
  private drawnSpm = -1;
  private drawnSplit = '';
  private lastDraw = -Infinity;

  constructor(opts: { seed: number; coxX: number; spec: HullSpec; withFigure: boolean }) {
    this.withFigure = opts.withFigure;
    this.spec = opts.spec;
    this.coxX = opts.coxX;
    this.eye = new THREE.Vector3(this.coxX, 0.8, 0);
    const dark = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.65, metalness: 0.2 });
    const carbon = new THREE.MeshStandardMaterial({ color: '#191a1c', roughness: 0.46, metalness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: WHITE, roughness: 0.65 });
    const cardinal = new THREE.MeshStandardMaterial({ color: CARDINAL, roughness: 0.72 });
    const skin = new THREE.MeshStandardMaterial({ color: SKIN_TONES[opts.seed % SKIN_TONES.length], roughness: 0.72 });
    const cableGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
    const xt = this.coxX - 0.42;
    const gunwale = gunwaleY(this.spec, this.coxX);
    this.rudderPivot = new THREE.Group();
    this.rudderPivot.position.set(xt, 0, 0);
    this.group.add(this.rudderPivot);

    const post = new THREE.Mesh(cableGeo, carbon);
    post.position.set(0, gunwale - 0.08, 0);
    post.scale.set(0.012, Math.max(0.06, gunwale + 0.18), 0.012);
    this.rudderPivot.add(post);
    const tiller = new THREE.Mesh(cableGeo, carbon);
    tiller.rotation.x = Math.PI / 2;
    tiller.position.y = gunwale + 0.02;
    tiller.scale.set(0.012, 0.3, 0.012);
    tiller.visible = this.withFigure;
    this.rudderPivot.add(tiller);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.16, 0.006), carbon);
    blade.position.set(-0.06, -0.14, 0);
    this.rudderPivot.add(blade);
    const bladeCap = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.012), dark);
    bladeCap.position.set(-0.01, -0.14, 0);
    this.rudderPivot.add(bladeCap);

    if (this.withFigure) {
      const cord = new THREE.MeshStandardMaterial({ color: '#292a2b', roughness: 0.85 });
      const lineGeo = new THREE.CylinderGeometry(1, 1, 1, 5);
      for (let i = 0; i < 4; i++) {
        const line = new THREE.Mesh(lineGeo, cord);
        this.group.add(line);
        this.steeringLines.push(line);
      }
      const fairleadGeo = new THREE.SphereGeometry(0.026, 8, 6);
      for (const side of [-1, 1]) {
        const fairlead = new THREE.Mesh(fairleadGeo, carbon);
        fairlead.position.set(this.coxX + 0.6, gunwale + 0.01, side * 0.21);
        this.group.add(fairlead);
      }
      const toggleGeo = new THREE.CylinderGeometry(0.014, 0.014, 0.07, 8);
      for (const side of [-1, 1]) {
        const toggle = new THREE.Mesh(toggleGeo, white);
        toggle.rotation.z = Math.PI / 2;
        toggle.position.set(this.coxX + 0.32, gunwale + 0.03, side * 0.24);
        this.group.add(toggle);
        this.toggles.push(toggle);
        const marker = new THREE.Mesh(new THREE.SphereGeometry(0.014, 8, 6), cardinal);
        marker.position.set(this.coxX + 0.32, gunwale + 0.03, side * 0.24);
        this.group.add(marker);
        this.toggleMarkers.push(marker);
      }
    }

    if (this.withFigure) {
      const figure = new THREE.Group();
      figure.position.x = this.coxX;
      this.group.add(figure);
      this.figureGroup = figure;
      const segmentGeo = new THREE.CylinderGeometry(1, 1, 1, 8);
      const makeLimb = (material: THREE.Material, target = figure) => {
        const mesh = new THREE.Mesh(segmentGeo, material);
        mesh.castShadow = true;
        target.add(mesh);
        return mesh;
      };
      const torso = makeLimb(cardinal);
      between(torso, _a.set(-0.06, 0.22, 0), _b.set(-0.12, 0.61, 0), 0.12);
      this.bodyMeshes.push(torso);
      const tights = new THREE.MeshStandardMaterial({ color: DARK, roughness: 0.82 });
      for (const side of [-1, 1]) {
        const thigh = makeLimb(tights);
        between(thigh, _a.set(0, 0.22, side * 0.08), _b.set(0.29, 0.19, side * 0.08), 0.075);
        this.bodyMeshes.push(thigh);
        const shin = makeLimb(tights);
        between(shin, _a.set(0.29, 0.19, side * 0.08), _b.set(0.58, 0.12, side * 0.08), 0.055);
        this.bodyMeshes.push(shin);
        const foot = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.09), dark);
        foot.position.set(0.64, 0.12, side * 0.08);
        foot.castShadow = true;
        figure.add(foot);
        this.bodyMeshes.push(foot);
      }
      const footboard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.36), carbon);
      footboard.position.set(this.coxX + 0.77, 0.06, 0);
      this.group.add(footboard);

      const head = new THREE.Mesh(new THREE.SphereGeometry(0.09, 14, 10), skin);
      head.position.set(-0.07, 0.76, 0);
      head.castShadow = true;
      figure.add(head);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.098, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), white);
      cap.position.set(-0.055, 0.79, 0);
      cap.castShadow = true;
      figure.add(cap);
      const brim = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.16), white);
      brim.position.set(0.015, 0.79, 0);
      figure.add(brim);
      const glasses = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.025, 0.17), dark);
      glasses.position.set(0.005, 0.77, 0);
      figure.add(glasses);
      this.micAndHeadset.push(head, cap, brim, glasses);

      const headset = new THREE.Mesh(new THREE.TorusGeometry(0.096, 0.006, 6, 24, Math.PI), dark);
      headset.position.set(-0.07, 0.765, 0);
      headset.rotation.z = Math.PI;
      figure.add(headset);
      this.micAndHeadset.push(headset);
      for (const side of [-1, 1]) {
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.025, 10), dark);
        cup.rotation.x = Math.PI / 2;
        cup.position.set(-0.075, 0.75, side * 0.09);
        figure.add(cup);
        this.micAndHeadset.push(cup);
      }
      const mic = makeLimb(dark, figure);
      between(mic, _a.set(-0.035, 0.74, 0.08), _b.set(0.055, 0.70, 0.045), 0.009);
      this.micAndHeadset.push(mic);
      const micTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), dark);
      micTip.position.set(0.055, 0.70, 0.045);
      figure.add(micTip);
      this.micAndHeadset.push(micTip);
      const headsetCable = makeLimb(dark, figure);
      between(headsetCable, _a.set(-0.15, 0.75, -0.085), _b.set(-0.12, 0.43, -0.08), 0.006);
      this.micAndHeadset.push(headsetCable);
      for (const side of [-1, 1]) {
        this.arms.push(makeLimb(skin), makeLimb(skin));
        const hand = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 6), skin);
        hand.castShadow = true;
        hand.position.set(0.32, gunwale + 0.03, side * 0.2);
        figure.add(hand);
        this.handMeshes.push(hand);
      }
    }

    if (this.withFigure) {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.09, 0.07), carbon);
      box.position.set(this.coxX + 0.77, 0.165, 0);
      this.group.add(box);
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 128;
      this.boxScreen = canvas.getContext('2d');
      this.screenTexture = new THREE.CanvasTexture(canvas);
      this.screenTexture.colorSpace = THREE.SRGBColorSpace;
      const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.064, 0.076),
        new THREE.MeshBasicMaterial({ map: this.screenTexture }),
      );
      screen.rotation.set(0, -Math.PI / 2, -0.72);
      screen.position.set(this.coxX + 0.725, 0.239, 0);
      this.group.add(screen);
      this.drawReadout(0, '—:—');
    } else {
      this.boxScreen = null;
      this.screenTexture = null;
    }
    this.update(0, 0, 0);
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
    for (const mesh of this.micAndHeadset) mesh.visible = !on;
    for (const mesh of this.bodyMeshes) mesh.visible = !on;
  }

  setReadout(spm: number, split: string) {
    this.readoutSpm = spm;
    this.readoutSplit = split;
  }

  update(hands: number, rudder: number, time: number) {
    this.rudderPivot.rotation.y = rudder;
    const gunwale = gunwaleY(this.spec, this.coxX);
    const displacement = 0.15 * Math.sin(0.262 * hands);

    if (this.withFigure) {
      const zPort = -0.24;
      const zStarboard = 0.24;
      this.toggles[0].position.set(this.coxX + 0.32 - displacement, gunwale + 0.03, zPort);
      this.toggles[1].position.set(this.coxX + 0.32 + displacement, gunwale + 0.03, zStarboard);
      this.toggleMarkers[0].position.set(this.toggles[0].position.x, gunwale + 0.03, zPort);
      this.toggleMarkers[1].position.set(this.toggles[1].position.x, gunwale + 0.03, zStarboard);

      const xt = this.coxX - 0.42;
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const lineX = this.coxX + 0.6;
        const y = gunwale + 0.01;
        const startX = xt + Math.sin(rudder) * side * 0.15;
        const startZ = Math.cos(rudder) * side * 0.15;
        between(this.steeringLines[i], _a.set(startX, y, startZ), _b.set(lineX, y, side * 0.21), 0.003);
      }
      between(this.steeringLines[2], _a.set(this.coxX + 0.6, gunwale + 0.01, zPort), _b.set(this.coxX + 0.6, gunwale + 0.01, zStarboard), 0.003);
      between(this.steeringLines[3], _a.set(xt + Math.sin(rudder) * -0.15, gunwale + 0.01, -0.15), _b.set(xt + Math.sin(rudder) * 0.15, gunwale + 0.01, 0.15), 0.003);

      const sway = Math.sin(time * 0.8) * 0.004;
      if (this.figureGroup) {
        this.figureGroup.position.y = sway;
        this.figureGroup.rotation.z = Math.sin(time * 0.6) * 0.004;
      }
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const shoulderX = -0.02 + sway;
        const shoulderY = 0.61;
        const shoulderZ = side * 0.14;
        const handX = this.toggles[i].position.x - this.coxX;
        const handY = gunwale + 0.03;
        const handZ = side * 0.2;
        const dx = handX - shoulderX;
        const dy = handY - shoulderY;
        const dz = handZ - shoulderZ;
        const dist = Math.max(0.02, Math.min(0.559, Math.hypot(dx, dy, dz)));
        const along = (0.29 * 0.29 - 0.27 * 0.27 + dist * dist) / (2 * dist);
        const bend = Math.sqrt(Math.max(0, 0.29 * 0.29 - along * along));
        const nx = dx / dist;
        const ny = dy / dist;
        const nz = dz / dist;
        const ex = shoulderX + nx * along - ny * bend * 0.45;
        const ey = shoulderY + ny * along + nx * bend * 0.45 - 0.035;
        const ez = shoulderZ + nz * along + side * bend * 0.82;
        between(this.arms[i * 2], _a.set(shoulderX, shoulderY, shoulderZ), _b.set(ex, ey, ez), 0.035);
        between(this.arms[i * 2 + 1], _a.set(ex, ey, ez), _c.set(handX, handY, handZ), 0.03);
        this.handMeshes[i].position.set(handX, handY, handZ);
      }
    }
    if (time - this.lastDraw >= 0.5 && (this.readoutSpm !== this.drawnSpm || this.readoutSplit !== this.drawnSplit)) {
      this.drawReadout(this.readoutSpm, this.readoutSplit);
      this.lastDraw = time;
    }
  }
}
