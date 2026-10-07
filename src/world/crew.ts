import * as THREE from 'three';
import { CARDINAL, DARK, WHITE, makeAnthro, type Anthro } from '../rowing/figure/anthro';
import { buildFigureGeometry } from '../rowing/figure/body';
import type { Outfit } from '../rowing/figure/outfit';
import { B } from '../rowing/figure/rig';
import { StandingSolver, standingRest, type StandInput } from '../rowing/figure/standing';
import { FIGURE_MATERIAL } from '../rowing/rower';

export interface CrewPose {
  pos: THREE.Vector3; // feet/ground point, world
  yaw: number; // facing; forward = (sin yaw, 0, cos yaw)
  walkPhase: number; // radians, advance by distance/stride
  walk: number; // 0 stand .. 1 full stride
  crouch: number; // 0..1 knee bend / hip drop
  handL: THREE.Vector3 | null;
  handR: THREE.Vector3 | null; // world hand targets; null = relaxed arm swinging with the walk
  headTilt: number; // radians sideways (head out from under the hull at shoulders)
  hull?: THREE.Object3D | null; // carried shell, for grip orientation
  dt?: number;
}

/**
 * Practice kit for walking a shell down: cardinal or white tees and long
 * sleeves over black spandex tights or shorts, running shoes or just socks.
 */
const TOPS: [string, Outfit['topStyle']][] = [
  [CARDINAL, 'tee'],
  [WHITE, 'tee'],
  [CARDINAL, 'longsleeve'],
  ['#1f1f22', 'tee'],
  [WHITE, 'longsleeve'],
  ['#8a8d8f', 'tee'],
  [CARDINAL, 'tee'],
  ['#5e0f0f', 'longsleeve'],
];
const BOTTOMS: [string, Outfit['bottomStyle']][] = [
  ['#18181a', 'tights'],
  ['#18181a', 'shorts'],
  [DARK, 'shorts'],
  ['#18181a', 'tights'],
  ['#2b2f3a', 'shorts'],
];
const SHOES = ['#e8e8e4', '#202022', '#7d8288', '#f2f1ec', '#3a3d44', '#c9ccd0'];

function rand(seed: number) {
  let s = (seed * 2654435761) >>> 0;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function practiceKit(seed: number): Outfit {
  const r = rand(seed + 11);
  const [top, topStyle] = TOPS[(seed * 3 + Math.floor(r() * 2)) % TOPS.length];
  const [bottom, bottomStyle] = BOTTOMS[Math.floor(r() * BOTTOMS.length)];
  return {
    top,
    topStyle,
    bottom,
    bottomStyle,
    accent: top === WHITE ? CARDINAL : r() < 0.5 ? WHITE : null,
    pfd: null,
    shoe: SHOES[Math.floor(r() * SHOES.length)],
  };
}

const _in: StandInput = { pos: new THREE.Vector3(), yaw: 0, crouch: 0, handL: null, handR: null, hull: null, headTilt: 0, look: null, dt: 0 };
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);
let _lastT = -1;
let _lastDt = 1 / 60;

/**
 * One rower of the boat-carrying crew: a single GPU-skinned mesh on the shared
 * 21-bone rig, posed by the standing / walking / carrying solver.
 */
export class CrewFigure {
  readonly group = new THREE.Group();
  readonly scale: number;
  readonly anthro: Anthro;
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[] = [];
  private readonly solver: StandingSolver;
  private readonly pos = new THREE.Vector3();

  constructor(seed: number) {
    const kit = practiceKit(seed);
    const base = makeAnthro(1000 + seed * 13, 'men', { counterFree: true });
    this.anthro = { ...base, shoe: kit.shoe ?? base.shoe };
    this.scale = this.anthro.H / 1.85;
    this.solver = new StandingSolver(this.anthro);
    const rest = standingRest(this.anthro);
    const geo = buildFigureGeometry(this.anthro, rest, kit);
    this.mesh = new THREE.SkinnedMesh(geo, FIGURE_MATERIAL);
    for (let i = 0; i < rest.p.length; i++) {
      const bone = new THREE.Bone();
      bone.position.copy(rest.p[i]);
      bone.quaternion.copy(rest.q[i]);
      this.bones.push(bone);
      this.mesh.add(bone);
    }
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new THREE.Skeleton(this.bones));
    // no foot stretcher when standing: collapse its plate into the pelvis
    this.bones[B.stretcher].scale.setScalar(1e-4);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 1, 0), 1.5);
    this.group.add(this.mesh);
    this.group.visible = false;
  }

  /** side: -1 = the figure's left shoulder, +1 = right (world). */
  shoulderWorld(side: -1 | 1, out: THREE.Vector3): THREE.Vector3 {
    out.copy(this.solver.rig.p[side < 0 ? B.upArmL : B.upArmR]);
    return out.applyQuaternion(_q.setFromAxisAngle(UP, this.solver.yaw)).add(this.pos);
  }

  setPose(p: CrewPose): void {
    let dt = p.dt;
    if (dt === undefined) {
      const now = performance.now() / 1000;
      if (now !== _lastT) {
        _lastDt = _lastT < 0 ? 1 / 60 : Math.min(0.1, now - _lastT);
        _lastT = now;
      }
      dt = _lastDt;
    }
    _in.pos.copy(p.pos);
    _in.yaw = p.yaw;
    _in.crouch = p.crouch;
    _in.handL = p.handL;
    _in.handR = p.handR;
    _in.hull = p.hull ?? null;
    _in.headTilt = p.headTilt;
    _in.dt = dt;
    this.solver.solve(_in);
    const rig = this.solver.rig;
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(rig.p[i]);
      this.bones[i].quaternion.copy(rig.q[i]);
    }
    this.pos.copy(p.pos);
    this.mesh.position.copy(p.pos);
    this.mesh.rotation.set(0, this.solver.yaw, 0);
    this.mesh.boundingSphere!.center.copy(rig.p[B.pelvis]);
  }
}
