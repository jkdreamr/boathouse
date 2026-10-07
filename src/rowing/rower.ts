import * as THREE from 'three';
import { makeAnthro, type Anthro } from './figure/anthro';
import { buildFigureGeometry } from './figure/body';
import { B, makeRig, solveRig, type RigPose } from './figure/rig';

export interface RowerPose {
  seatX: number;
  slide: number;
  lean: number;
  stretcherX: number;
  handIn: THREE.Vector3;
  handOut: THREE.Vector3;
  side: number;
  /** 0 = square blade, 1 = fully feathered; the inside wrist rolls the handle. */
  feather?: number;
}

export const FIGURE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 });

const REST: RigPose = {
  seatX: 0,
  slide: 0,
  lean: 0,
  stretcherX: -0.72,
  handIn: new THREE.Vector3(-0.36, 0.5, 0.06),
  handOut: new THREE.Vector3(-0.38, 0.5, -0.18),
  side: 1,
  feather: 0,
};

/**
 * Procedural sweep rower: one GPU-skinned, vertex-coloured mesh on a 21-bone
 * skeleton, posed every frame with two-bone IK in boat-local coordinates.
 */
export class RowerFigure {
  readonly group = new THREE.Group();
  readonly anthro: Anthro;
  readonly mesh: THREE.SkinnedMesh;
  private readonly bones: THREE.Bone[] = [];
  private readonly rig = makeRig();
  private readonly pose: RigPose = { ...REST, handIn: new THREE.Vector3(), handOut: new THREE.Vector3() };

  constructor(opts: { seed: number }) {
    this.anthro = makeAnthro(opts.seed);
    const rest = makeRig();
    solveRig(this.anthro, REST, rest);
    const geo = buildFigureGeometry(this.anthro, rest);
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
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = true;
    this.mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1.4);
    this.group.add(this.mesh);
  }

  setPose(p: RowerPose): void {
    const q = this.pose;
    q.seatX = p.seatX;
    q.slide = p.slide;
    q.lean = p.lean;
    q.stretcherX = p.stretcherX;
    q.handIn.copy(p.handIn);
    q.handOut.copy(p.handOut);
    q.side = p.side;
    q.feather = p.feather ?? 0;
    solveRig(this.anthro, q, this.rig);
    for (let i = 0; i < this.bones.length; i++) {
      this.bones[i].position.copy(this.rig.p[i]);
      this.bones[i].quaternion.copy(this.rig.q[i]);
    }
    this.mesh.boundingSphere!.center.copy(this.rig.p[B.pelvis]);
  }
}
