import * as THREE from 'three';
import { conditions, setChannel } from '../sim/conditions';
import { addSystem } from '../sim/systems';

function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

export function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

export function fbm(x: number, y: number, oct = 4) {
  let s = 0;
  let a = 0.5;
  let f = 1;
  for (let i = 0; i < oct; i++) {
    s += vnoise(x * f, y * f) * a;
    f *= 2.03;
    a *= 0.5;
  }
  return s;
}

const smooth = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Ground level of the boathouse apron, parking and building floor. */
export const PAD_Y = 1.5;
export const PAD = { minX: -150, maxX: 170, minZ: 0, maxZ: 140 };

/** Redwood Creek: the south bank (boathouse side) and channel width, x runs downstream toward the Bay. */
export function southBank(x: number) {
  const ramp = smooth(140, 420, Math.abs(x));
  return ramp * (26 * Math.sin(x / 430) + 10 * Math.sin(x / 190 + 1.3));
}

export function channelWidth(x: number) {
  return 170 + 22 * Math.sin(x / 610 + 0.7) + Math.max(0, x - 2300) * 0.9;
}

export function northBank(x: number) {
  return southBank(x) - channelWidth(x);
}

export function centerline(x: number) {
  return southBank(x) - channelWidth(x) / 2;
}

/** Signed distance into the channel (positive = water). */
export function channelDepthDist(x: number, z: number) {
  const zs = southBank(x);
  const zn = zs - channelWidth(x);
  return Math.min(zs - z, z - zn);
}

// [realism:water]
setChannel({ depthDist: channelDepthDist, centerline });

export function terrainHeight(x: number, z: number) {
  const zs = southBank(x);
  const zn = zs - channelWidth(x);
  let natural: number;
  // [realism:water]
  if (z <= zs && z >= zn) {
    const inner = Math.min(zs - z, z - zn);
    const ripple = (fbm(x * 0.11, z * 0.11) - 0.5) * 0.16 * (1 - smooth(22, 26, inner));
    natural = 0.35 - 0.85 * smooth(0, 3, inner) - 1.5 * THREE.MathUtils.clamp((inner - 3) / 19, 0, 1) - 2.8 * smooth(22, 55, inner) + ripple;
  } else {
    const north = z < zn;
    const d = north ? zn - z : z - zs;
    if (d < 6) natural = 0.35 + 0.2 * smooth(0, 6, d);
    else {
      const n = fbm(x * 0.012, z * 0.012);
      if (north) natural = 0.3 + 0.25 * smooth(6, 40, d) + (n - 0.5) * 0.3;
      else if (x > PAD.minX - 2 && x < PAD.maxX + 2 && z < PAD.maxZ + 2) natural = PAD_Y - 0.3;
      else natural = 0.3 + 0.7 * smooth(6, 60, d) + (n - 0.5) * 0.35;
    }
  }
  const xWeight = x < -60 ? smooth(-75, -60, x) : x > 105 ? 1 - smooth(105, 120, x) : 1;
  const zWeight = z > 0 ? 0 : z < -36 ? smooth(-48, -36, z) : 1;
  const basinWeight = xWeight * zWeight;
  if (basinWeight <= 0) return natural;
  const basin = z > -9 ? -1 - 2.8 * smooth(0, 9, -z) : -3.9;
  return THREE.MathUtils.lerp(natural, Math.min(natural, basin), basinWeight);
}

// [realism:water]
function rows(): number[] {
  const out: number[] = [];
  for (let z = -2400; z < -460; z += 40) out.push(z);
  for (let z = -460; z < -60; z += 4) out.push(z);
  for (let z = -60; z <= 10; z += 2) out.push(z);
  for (let z = 12; z < 200; z += 4) out.push(z);
  for (let z = 200; z <= 1800; z += 40) out.push(z);
  return out;
}

export function buildTerrain() {
  const xs: number[] = [];
  for (let x = -3200; x <= 5200; x += 12) xs.push(x);
  const zs = rows();
  const nx = xs.length;
  const nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  const col = new Float32Array(nx * nz * 3);
  const c = new THREE.Color();
  const water = new THREE.Color('#3a3a2d');
  const mud = new THREE.Color('#4f473a');
  const marshA = new THREE.Color('#5c6a37');
  const marshB = new THREE.Color('#7b6b45');
  const marshC = new THREE.Color('#6e4a3a');
  const dry = new THREE.Color('#857b58');
  const pad = new THREE.Color('#6c665c');
  let p = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = xs[i];
      const z = zs[j];
      const h = terrainHeight(x, z);
      pos[p] = x;
      pos[p + 1] = h;
      pos[p + 2] = z;
      const dIn = channelDepthDist(x, z);
      if (dIn >= 0 && dIn < 4 && h > -0.9) {
        c.copy(marshA).lerp(marshB, 0.2 + fbm(x * 0.07, z * 0.07) * 0.25);
      } else if (h < -2.8) c.copy(water);
      else if (h <= 0.25) c.copy(mud).multiplyScalar(0.88 + fbm(x * 0.09 + 5, z * 0.09) * 0.24);
      else {
        const north = z < southBank(x) - channelWidth(x);
        const n1 = fbm(x * 0.008 + 3, z * 0.008);
        const n2 = fbm(x * 0.03, z * 0.03 + 9);
        if (north) {
          c.copy(marshA).lerp(marshB, smooth(0.35, 0.65, n1)).lerp(marshC, smooth(0.55, 0.8, n2) * 0.6);
        } else if (x > PAD.minX && x < PAD.maxX && z < PAD.maxZ) c.copy(pad);
        else c.copy(dry).lerp(marshA, smooth(0.4, 0.7, n1) * 0.5);
        c.multiplyScalar(0.9 + n2 * 0.2);
      }
      col[p] = c.r;
      col[p + 1] = c.g;
      col[p + 2] = c.b;
      p += 3;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i;
      const b = a + 1;
      const d = a + nx;
      const e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  // [realism:water]
  const wetMudUniforms = { uLevel: { value: conditions.level } };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uLevel = wetMudUniforms.uLevel;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainWorldPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uLevel;
varying vec3 vTerrainWorldPosition;
float realismHash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}
float realismNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(realismHash(i), realismHash(i + vec2(1.0, 0.0)), f.x),
    mix(realismHash(i + vec2(0.0, 1.0)), realismHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
float realismIntertidal = 1.0 - smoothstep(0.2, 0.45, vTerrainWorldPosition.y);
float realismWet = 1.0 - smoothstep(uLevel + 0.05, uLevel + 0.6, vTerrainWorldPosition.y);
float realismPuddles = realismIntertidal * (1.0 - realismWet) *
  smoothstep(0.56, 0.82, realismNoise(vTerrainWorldPosition.xz / 3.0));
diffuseColor.rgb *= 1.0 - 0.28 * realismWet * realismIntertidal;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
roughnessFactor = mix(roughnessFactor, 0.3, realismIntertidal);
roughnessFactor = mix(roughnessFactor, 0.08, realismWet * realismIntertidal);
roughnessFactor = mix(roughnessFactor, 0.04, realismPuddles);`,
      );
  };
  mat.customProgramCacheKey = () => 'realism-water-terrain';
  addSystem({ update: () => (wetMudUniforms.uLevel.value = conditions.level) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
