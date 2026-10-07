import * as THREE from 'three';

/**
 * Bone-free bird rig evaluated in the vertex shader.
 * Per-vertex: aPart (0 body, 1 arm wing, 2 hand wing, 3 legs, 4 neck+head), aSide (-1 left, +1 right).
 * Per-instance aAnim: x shoulder elevation, y wrist elevation (relative), z wing fold 0..1, w leg swing (rad, +back);
 * aNeck: neck+head pitch about the neck base (rad, + up).
 */
export interface Rig {
  /** shoulder hinge: x, y, |z| */
  shoulder: THREE.Vector3;
  /** |z| of the wrist hinge */
  wrist: number;
  hip: THREE.Vector2;
  neck: THREE.Vector2;
}

const HEAD = /* glsl */ `
attribute float aPart;
attribute float aSide;
attribute vec4 aAnim;
attribute float aNeck;
uniform vec3 uShoulder;
uniform float uWrist;
uniform vec2 uHip;
uniform vec2 uNeck;
vec2 birdRot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
vec3 birdPose(vec3 p, bool isDir) {
  float k = isDir ? 0.0 : 1.0;
  if (aPart > 0.5 && aPart < 2.5) {
    float u = p.z * aSide;
    vec2 q;
    if (aPart > 1.5) {
      q = birdRot(vec2(u - uWrist * k, p.y - uShoulder.y * k), aAnim.y);
      u = q.x + uWrist * k; p.y = q.y + uShoulder.y * k;
    }
    q = birdRot(vec2(u - uShoulder.z * k, p.y - uShoulder.y * k), aAnim.x);
    u = q.x; p.y = q.y + uShoulder.y * k;
    // fold: sweep the wing back along the flank and shorten it
    float f = aAnim.z;
    vec2 s = vec2(u * (k > 0.5 ? (1.0 - 0.52 * f) : 1.0), p.x - uShoulder.x * k);
    s = birdRot(s, -1.48 * f);
    p.x = s.y + uShoulder.x * k;
    // roll the swept wing so its upper surface lies against the flank
    // feathers slide over each other, so the folded chord is about half the spread chord
    vec2 r = birdRot(vec2(s.x * (k > 0.5 ? 1.0 - 0.5 * f : 1.0), p.y - uShoulder.y * k), -1.2 * f);
    u = r.x + uShoulder.z * k * (1.0 - 0.15 * f);
    p.y = r.y + uShoulder.y * k - 0.35 * f * uShoulder.z * k;
    p.z = u * aSide;
  } else if (aPart > 2.5 && aPart < 3.5) {
    vec2 q = birdRot(vec2(p.x - uHip.x * k, p.y - uHip.y * k), -aAnim.w);
    p.x = q.x + uHip.x * k; p.y = q.y + uHip.y * k;
  } else if (aPart > 3.5) {
    vec2 q = birdRot(vec2(p.x - uNeck.x * k, p.y - uNeck.y * k), aNeck);
    p.x = q.x + uNeck.x * k; p.y = q.y + uNeck.y * k;
  }
  return p;
}
`;

function patch(shader: THREE.WebGLProgramParametersWithUniforms, rig: Rig, normals: boolean) {
  shader.uniforms.uShoulder = { value: rig.shoulder };
  shader.uniforms.uWrist = { value: rig.wrist };
  shader.uniforms.uHip = { value: rig.hip };
  shader.uniforms.uNeck = { value: rig.neck };
  shader.vertexShader = HEAD + shader.vertexShader;
  if (normals) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', 'vec3 objectNormal = normalize(birdPose(vec3(normal), true));');
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', 'vec3 transformed = birdPose(vec3(position), false);');
}

export function birdMaterials(rig: Rig, key: string) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0, side: THREE.DoubleSide });
  mat.onBeforeCompile = (s) => patch(s, rig, true);
  mat.customProgramCacheKey = () => 'bird-' + key;
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  depth.onBeforeCompile = (s) => patch(s, rig, false);
  depth.customProgramCacheKey = () => 'bird-depth-' + key;
  return { mat, depth };
}
