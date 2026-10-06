import * as THREE from 'three';
import { between } from '../world/build';

export interface RowerPose {
  seatX: number;
  slide: number;
  lean: number;
  stretcherX: number;
  handIn: THREE.Vector3;
  handOut: THREE.Vector3;
  side: number;
}

const _hip = new THREE.Vector3();
const _back = new THREE.Vector3();
const _foot = new THREE.Vector3();
const _knee = new THREE.Vector3();
const _hand = new THREE.Vector3();

export class RowerFigure {
  readonly group = new THREE.Group();
  private readonly torso: THREE.Mesh;
  private readonly head: THREE.Mesh;
  private readonly thigh: THREE.Mesh[];
  private readonly shin: THREE.Mesh[];
  private readonly arm: THREE.Mesh[];

  constructor(opts: { seed: number }) {
    const limb = new THREE.CylinderGeometry(1, 1, 1, 8);
    const suit = new THREE.MeshStandardMaterial({ color: '#8c1515', roughness: 0.7 });
    const skins = ['#d6a888', '#b98563', '#8d5a3c', '#e3bc9c', '#a8714e'].map((color) =>
      new THREE.MeshStandardMaterial({ color, roughness: 0.7 }),
    );
    const skin = skins[opts.seed % skins.length];
    const head = new THREE.SphereGeometry(0.105, 14, 10);
    const hairGeo = new THREE.SphereGeometry(0.112, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
    const hairMat = new THREE.MeshStandardMaterial({ color: '#2a1d16', roughness: 0.9 });
    const capMat = new THREE.MeshStandardMaterial({ color: '#f4f2ec', roughness: 0.7 });
    const mk = (mat: THREE.Material) => {
      const mesh = new THREE.Mesh(limb, mat);
      mesh.castShadow = true;
      this.group.add(mesh);
      return mesh;
    };

    this.torso = mk(suit);
    this.head = new THREE.Mesh(head, skin);
    this.head.castShadow = true;
    const cap = new THREE.Mesh(hairGeo, opts.seed % 3 === 0 ? capMat : hairMat);
    cap.position.set(0.025, 0.012, 0);
    this.head.add(cap);
    this.group.add(this.head);
    this.thigh = [mk(suit), mk(suit)];
    this.shin = [mk(skin), mk(skin)];
    this.arm = [mk(skin), mk(skin)];
  }

  setPose(p: RowerPose): void {
    const hx = p.seatX + p.slide;
    const lx = -Math.sin(p.lean);
    const ly = Math.cos(p.lean);
    _hip.set(hx, 0.27, 0);
    _back.set(hx + lx * 0.56, 0.27 + ly * 0.56, 0);
    between(this.torso, _hip, _back, 0.15);
    this.head.position.set(hx + lx * 0.76, 0.27 + ly * 0.76, 0);

    for (let i = 0; i < 2; i++) {
      const z = i ? 0.1 : -0.1;
      _hip.set(hx, 0.25, z);
      _foot.set(p.stretcherX, 0.1, z);
      const dx = _foot.x - _hip.x;
      const dy = _foot.y - _hip.y;
      let dist = Math.hypot(dx, dy);
      const L1 = 0.5;
      const L2 = 0.52;
      if (dist > L1 + L2 - 0.001) dist = L1 + L2 - 0.001;
      const a = (L1 * L1 - L2 * L2 + dist * dist) / (2 * dist);
      const hh = Math.sqrt(Math.max(0, L1 * L1 - a * a));
      const nx = dx / Math.hypot(dx, dy);
      const ny = dy / Math.hypot(dx, dy);
      _knee.set(_hip.x + nx * a + ny * hh, _hip.y + ny * a - nx * hh, z);
      if (_knee.y < _hip.y) _knee.set(_hip.x + nx * a - ny * hh, _hip.y + ny * a + nx * hh, z);
      between(this.thigh[i], _hip, _knee, 0.07);
      between(this.shin[i], _knee, _foot, 0.05);
      _hand.set(hx + lx * 0.5, 0.27 + ly * 0.5, (i ? -p.side : p.side) * 0.18);
      between(this.arm[i], _hand, i ? p.handOut : p.handIn, 0.04);
    }
  }
}
