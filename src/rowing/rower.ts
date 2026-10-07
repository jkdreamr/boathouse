import * as THREE from 'three';
import { makeAnthro, type Anthro } from './figure/anthro';
import { buildFigureGeometry, type FigureLod } from './figure/body';
import { BASE_ROUGHNESS } from './figure/builder';
import { ROWING_UNISUIT, type Outfit } from './figure/outfit';
import { B, makeRig, solveRig, type Rig, type RigPose } from './figure/rig';

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

/**
 * Shared figure material. Geometry from buildFigureGeometry carries a `figSurf` attribute
 * (roughness offset, metalness) so skin, lycra, cotton, hair, eyes and mirrored lenses
 * shade differently in a single draw call. Meshes without the attribute get the defaults.
 */
export const FIGURE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: BASE_ROUGHNESS, metalness: 0 });
FIGURE_MATERIAL.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 figSurf;\nvarying vec2 vFigSurf;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFigSurf = figSurf;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vFigSurf;')
    .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + vFigSurf.x, 0.03, 1.0);')
    .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor + vFigSurf.y, 0.0, 1.0);');
};
FIGURE_MATERIAL.customProgramCacheKey = () => 'figure-surf-v1';

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

  constructor(opts: { seed: number; outfit?: Outfit; lod?: FigureLod }) {
    this.anthro = makeAnthro(opts.seed);
    const rest = makeRig();
    solveRig(this.anthro, REST, rest);
    const geo = buildFigureGeometry(this.anthro, rest, opts.outfit ?? ROWING_UNISUIT, opts.lod ?? 'near');
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

  /** Standing T-pose figure for outfit checks (see makeStandingFigure). */
  static standing(a: Anthro, outfit: Outfit, lod: FigureLod = 'near') {
    return makeStandingFigure(a, outfit, lod);
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

/** Standing T-pose rest rig (feet flat, palms down), facing -x like the seated rig. */
export function standingRig(a: Anthro, rig: Rig = makeRig()): Rig {
  const { p, q } = rig;
  const face = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
  const basis = (x: THREE.Vector3, y: THREE.Vector3, out: THREE.Quaternion) =>
    out.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, new THREE.Vector3().crossVectors(x, y)));
  const fwd = new THREE.Vector3(-1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const down = new THREE.Vector3(0, -1, 0);
  const hipY = a.ankleH + a.shin + a.thigh;
  const T = a.trunk;
  p[B.root].set(0, 0, 0);
  q[B.root].identity();
  p[B.pelvis].set(0, hipY, 0);
  for (const i of [B.pelvis, B.spine, B.chest, B.neck, B.head]) q[i].copy(face);
  p[B.spine].set(0, hipY + 0.25 * T, 0);
  p[B.chest].set(0, hipY + 0.55 * T, 0);
  p[B.neck].set(0.02 * T, hipY + 1.05 * T, 0);
  p[B.head].set(0.02 * T, hipY + 1.05 * T + a.neck, 0);
  for (let i = 0; i < 2; i++) {
    const zb = i === 0 ? 1 : -1;
    const out = new THREE.Vector3(0, 0, zb);
    const clav = i === 0 ? B.clavL : B.clavR;
    const ua = i === 0 ? B.upArmL : B.upArmR;
    const fa = i === 0 ? B.foreArmL : B.foreArmR;
    const hd = i === 0 ? B.handL : B.handR;
    const sh = new THREE.Vector3(0, hipY + T, zb * a.shoulderHalf);
    p[clav].set(-0.03 * T, hipY + 0.93 * T, zb * 0.02);
    basis(fwd.clone().addScaledVector(up, 0).normalize(), sh.clone().sub(p[clav]).normalize(), q[clav]);
    // re-orthogonalise the clavicle frame (Y toward the shoulder, X anterior)
    const cy = sh.clone().sub(p[clav]).normalize();
    const cx = fwd.clone().addScaledVector(cy, -fwd.dot(cy)).normalize();
    basis(cx, cy, q[clav]);
    p[ua].copy(sh);
    basis(fwd, out, q[ua]);
    p[fa].copy(sh).addScaledVector(out, a.upperArm);
    basis(down, out, q[fa]);
    p[hd].copy(p[fa]).addScaledVector(out, a.foreArm);
    basis(up, out, q[hd]);
  }
  for (let i = 0; i < 2; i++) {
    const zb = i === 0 ? 1 : -1;
    const th = i === 0 ? B.thighL : B.thighR;
    const sh = i === 0 ? B.shinL : B.shinR;
    const ft = i === 0 ? B.footL : B.footR;
    p[th].set(0, hipY, zb * a.hipHalf);
    basis(fwd, down, q[th]);
    p[sh].set(0, hipY - a.thigh, zb * a.hipHalf);
    basis(fwd, down, q[sh]);
    p[ft].set(0, a.ankleH, zb * a.hipHalf);
    basis(up, fwd, q[ft]);
  }
  p[B.stretcher].set(0.27 * a.foot, 0, 0);
  basis(up, fwd, q[B.stretcher]);
  rig.lean = 0;
  return rig;
}

/** Standalone standing figure (T-pose) for outfit checks: same mesh/skeleton setup as RowerFigure. */
export function makeStandingFigure(a: Anthro, outfit: Outfit, lod: FigureLod = 'near') {
  const rest = standingRig(a);
  const mesh = new THREE.SkinnedMesh(buildFigureGeometry(a, rest, outfit, lod), FIGURE_MATERIAL);
  const bones: THREE.Bone[] = [];
  for (let i = 0; i < rest.p.length; i++) {
    const bone = new THREE.Bone();
    bone.position.copy(rest.p[i]);
    bone.quaternion.copy(rest.q[i]);
    bones.push(bone);
    mesh.add(bone);
  }
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  bones[B.stretcher].scale.setScalar(1e-4);
  return mesh;
}
