import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormalTexture } from '../textures';
import { bearingToWorld, conditions, setWindClimate, type WindPreset } from '../sim/conditions';

export { waveSlope, waveHeight } from '../sim/conditions';

export interface TimePreset {
  name: string;
  elevation: number;
  azimuth: number;
  turbidity: number;
  rayleigh: number;
  sun: string;
  sunIntensity: number;
  hemiSky: string;
  hemiGround: string;
  hemiIntensity: number;
  fog: string;
  exposure: number;
  wind: WindPreset;
}

/** Azimuth in degrees measured from +x (downstream, roughly NE) toward -z (across the creek, roughly NW). */
export const PRESETS: TimePreset[] = [
  {
    name: 'Golden hour',
    elevation: 9,
    azimuth: 120,
    turbidity: 5,
    rayleigh: 2.2,
    sun: '#ffc99a',
    sunIntensity: 3.2,
    hemiSky: '#b6c8e6',
    hemiGround: '#6b5a44',
    hemiIntensity: 0.9,
    fog: '#d7c3ad',
    exposure: 0.62,
    wind: 'afternoon',
  },
  {
    name: 'Midday',
    elevation: 58,
    azimuth: 200,
    turbidity: 3,
    rayleigh: 1.2,
    sun: '#fff4e4',
    sunIntensity: 3.4,
    hemiSky: '#bcd4f2',
    hemiGround: '#776a52',
    hemiIntensity: 1.1,
    fog: '#c4d3e3',
    exposure: 0.5,
    wind: 'midday',
  },
  {
    name: 'Dawn practice',
    elevation: 3.5,
    azimuth: -40,
    turbidity: 8,
    rayleigh: 3,
    sun: '#ffa66e',
    sunIntensity: 2.2,
    hemiSky: '#8e9cc4',
    hemiGround: '#4a4038',
    hemiIntensity: 0.75,
    fog: '#c9a99a',
    exposure: 0.72,
    wind: 'dawn',
  },
];

/**
 * Water surface shader: wind-aligned, wind-scaled chop (glassy at dawn, whitecaps at 15+ kt), cat's-paw gust patches
 * advected downwind (same field as conditions.pawField), Fresnel reflection with a near-field-limited distortion.
 */
const WATER_FRAGMENT = /* glsl */ `
uniform sampler2D mirrorSampler;
uniform float alpha;
uniform float time;
uniform float size;
uniform float distortionScale;
uniform sampler2D normalSampler;
uniform vec3 sunColor;
uniform vec3 sunDirection;
uniform vec3 eye;
uniform vec3 waterColor;
uniform vec2 uWindDir;
uniform float uChop;
uniform float uCalm;
uniform float uGusty;
uniform float uWhite;
uniform vec2 uPaw;
uniform vec4 uFlow;

varying vec4 mirrorCoord;
varying vec4 worldPosition;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash12(i);
  float b = hash12(i + vec2(1.0, 0.0));
  float c = hash12(i + vec2(0.0, 1.0));
  float d = hash12(i + vec2(1.0, 1.0));
  return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}
float pawField(vec2 xz) {
  vec2 p = (xz - uPaw) / 46.0;
  return 0.65 * vnoise(p) + 0.35 * vnoise(p * 2.3 + vec2(17.1, 5.3));
}
vec2 tangentAt(vec2 uv) {
  return texture2D(normalSampler, uv).rg * 2.0 - 1.0;
}

void sunLight(const vec3 surfaceNormal, const vec3 eyeDirection, float shiny, float spec, float diffuse, inout vec3 diffuseColor, inout vec3 specularColor) {
  vec3 reflection = normalize(reflect(-sunDirection, surfaceNormal));
  float direction = max(0.0, dot(eyeDirection, reflection));
  specularColor += pow(direction, shiny) * sunColor * spec;
  diffuseColor += max(dot(sunDirection, surfaceNormal), 0.0) * sunColor * diffuse;
}

#include <common>
#include <packing>
#include <bsdfs>
#include <fog_pars_fragment>
#include <logdepthbuf_pars_fragment>
#include <lights_pars_begin>
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

void main() {
  #include <logdepthbuf_fragment>
  vec2 xz = worldPosition.xz;
  vec2 wd = uWindDir;
  vec2 wp = vec2(-wd.y, wd.x);
  // wind frame: x along the wind, y across it; crests are stretched across the wind
  vec2 q = vec2(dot(xz, wd), dot(xz, wp) * 0.8);
  float paw = pawField(xz);
  float gust = clamp(1.0 + uGusty * 3.2 * (paw - 0.5), 0.35, 1.8);
  float amp = uChop * gust + uCalm * 0.32 * smoothstep(0.56, 0.78, paw);

  vec2 t = vec2(0.0);
  t += tangentAt(q * size / 103.0 - uFlow.xy) * 0.55;
  float pixelWidth = max(length(dFdx(xz)), length(dFdy(xz)));
  float detail = 1.0 - smoothstep(0.06, 0.45, pixelWidth);
  t += tangentAt(q * size / 47.0 - uFlow.zw + vec2(0.37, 0.71)) * 0.35 * detail;
  t += tangentAt(q * size / 17.0 - uFlow.zw * 2.6 + vec2(0.13, 0.29)) * 0.22 * (0.4 + 0.6 * uChop) * detail;
  // slow, very long modulation so tiling never reads
  vec2 big = tangentAt(xz / 1091.0 + vec2(time / 109.0, time / 113.0)) + tangentAt(xz / 3307.0 - vec2(time / 211.0, 0.0));
  t += big * 0.12;
  float ta = min(0.42, amp * 0.34) * mix(0.5, 1.0, detail);
  vec2 tw = (t.x * wd + t.y * 0.8 * wp) * ta;
  vec3 surfaceNormal = normalize(vec3(tw.x, 1.0, tw.y) + vec3(big.x, 0.0, big.y) * 0.004);

  vec3 worldToEye = eye - worldPosition.xyz;
  vec3 eyeDirection = normalize(worldToEye);
  float distance = length(worldToEye);

  vec3 diffuseLight = vec3(0.0);
  vec3 specularLight = vec3(0.0);
  float shiny = mix(200.0, 85.0, clamp(amp, 0.0, 1.0));
  sunLight(surfaceNormal, eyeDirection, shiny, 1.6 + 0.8 * amp, 0.5, diffuseLight, specularLight);

  // distortion grows with chop but is capped near the camera so close-up reflections never tear into contours
  vec2 distortion = surfaceNormal.xz * (0.001 + 0.18 / (distance + 28.0)) * distortionScale;
  vec3 reflectionSample = vec3(texture2D(mirrorSampler, mirrorCoord.xy / mirrorCoord.w + distortion));

  float theta = max(dot(eyeDirection, surfaceNormal), 0.0);
  float rf0 = 0.04;
  float reflectance = rf0 + (1.0 - rf0) * pow(1.0 - theta, 5.0);
  // rough gust patches reflect more of the darker upper sky
  reflectance *= 1.0 - 0.18 * smoothstep(0.55, 0.85, paw) * min(1.0, uChop * 2.0 + uCalm);
  vec3 body = waterColor * (0.55 + 0.45 * max(sunDirection.y, 0.0)) * (0.6 + 0.4 * max(dot(surfaceNormal, eyeDirection), 0.0));
  vec3 lit = (sunColor * diffuseLight * 0.18 + body) * getShadowMask();
  vec3 albedo = mix(lit, reflectionSample + specularLight, reflectance);

  // whitecap flecks: short wind-aligned streaks, grouped, coming and going; faded out before they alias
  if (uWhite > 0.001) {
    vec2 wq = vec2(q.x - uFlow.x * 18.0, q.y);
    float streak = vnoise(vec2(wq.x / 0.9, wq.y / 2.6) + vec2(0.0, time * 0.9));
    float group = vnoise(wq / 11.0 + vec2(time * 0.21, 3.7));
    float cap = smoothstep(0.76, 0.9, streak) * smoothstep(0.42, 0.72, group) * uWhite * gust;
    cap *= 1.0 - smoothstep(180.0, 700.0, distance);
    vec3 foam = vec3(0.92, 0.94, 0.95) * (sunColor * max(sunDirection.y, 0.05) * 0.9 + vec3(0.32));
    albedo = mix(albedo, foam, clamp(cap, 0.0, 0.85));
  }

  gl_FragColor = vec4(albedo, alpha);

  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

const smooth01 = (e0: number, e1: number, x: number) => THREE.MathUtils.smoothstep(x, e0, e1);
const tmpWind = new THREE.Vector2();

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight('#ffffff', 3);
  hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  water: Water;
  sunDir = new THREE.Vector3();
  presetIndex = 0;
  private windAngle = 0;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private skyForEnv = new Sky();
  private shadowRight = new THREE.Vector3();
  private shadowUp = new THREE.Vector3();
  private shadowOffset = new THREE.Vector3();

  constructor(
    private scene: THREE.Scene,
    private renderer: THREE.WebGLRenderer,
  ) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.sky.scale.setScalar(40000);
    scene.add(this.sky);
    this.skyForEnv.scale.setScalar(1000);
    this.skyScene.add(this.skyForEnv);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    const s = this.sun.shadow.camera;
    s.left = -70;
    s.right = 70;
    s.top = 70;
    s.bottom = -70;
    s.near = 1;
    s.far = 600;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target, this.hemi);

    const normals = waterNormalTexture();
    this.water = new Water(new THREE.PlaneGeometry(16000, 16000), {
      textureWidth: 1024,
      textureHeight: 1024,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x23342d,
      distortionScale: 0.55,
      fog: true,
    });
    const wm = this.water.material;
    wm.fragmentShader = WATER_FRAGMENT;
    Object.assign(wm.uniforms, {
      uWindDir: { value: new THREE.Vector2(1, 0) },
      uChop: { value: 0.5 },
      uCalm: { value: 0 },
      uGusty: { value: 0.25 },
      uWhite: { value: 0 },
      uPaw: { value: conditions.pawOffset },
      uFlow: { value: new THREE.Vector4() },
    });
    wm.needsUpdate = true;
    this.water.rotation.x = -Math.PI / 2;
    this.water.material.uniforms.size.value = 3.2;
    this.water.name = 'water';
    scene.add(this.water);
    scene.fog = new THREE.FogExp2('#cccccc', 0.00008);
    this.apply(0);
    const w = bearingToWorld(conditions.windFrom + 180);
    this.windAngle = Math.atan2(w.y, w.x);
  }

  apply(i: number) {
    this.presetIndex = i;
    const p = PRESETS[i];
    const phi = THREE.MathUtils.degToRad(90 - p.elevation);
    const az = THREE.MathUtils.degToRad(p.azimuth);
    this.sunDir.set(Math.sin(phi) * Math.cos(az), Math.cos(phi), -Math.sin(phi) * Math.sin(az));
    for (const sky of [this.sky, this.skyForEnv]) {
      const u = sky.material.uniforms;
      u.turbidity.value = p.turbidity;
      u.rayleigh.value = p.rayleigh;
      u.mieCoefficient.value = 0.004;
      u.mieDirectionalG.value = 0.82;
      u.sunPosition.value.copy(this.sunDir);
    }
    this.sun.color.set(p.sun);
    this.sun.intensity = p.sunIntensity;
    this.hemi.color.set(p.hemiSky);
    this.hemi.groundColor.set(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;
    (this.scene.fog as THREE.FogExp2).color.set(p.fog);
    this.water.material.uniforms.sunDirection.value.copy(this.sunDir);
    this.water.material.uniforms.sunColor.value.set(p.sun);
    setWindClimate(p.wind);
    this.renderer.toneMappingExposure = p.exposure;
    this.envRT?.dispose();
    this.envRT = this.pmrem.fromScene(this.skyScene);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
  }

  next() {
    this.apply((this.presetIndex + 1) % PRESETS.length);
    return PRESETS[this.presetIndex].name;
  }

  /** Keep the shadow frustum centered on what the camera is looking at, snapped to texels. */
  update(dt: number, focus: THREE.Vector3) {
    this.updateWater(dt);
    const texel = 140 / 4096;
    const light = this.shadowOffset.set(this.sunDir.x * 300, Math.max(30, this.sunDir.y * 300), this.sunDir.z * 300);
    this.shadowRight.set(light.z, 0, -light.x).normalize();
    this.shadowUp.crossVectors(light, this.shadowRight).normalize();
    const target = this.sun.target.position.set(focus.x, 0, focus.z);
    // Quantize the light's projection, not world x/z, to keep shadow edges fixed between texels.
    const right = target.dot(this.shadowRight);
    const up = target.dot(this.shadowUp);
    target.addScaledVector(this.shadowRight, Math.round(right / texel) * texel - right);
    target.addScaledVector(this.shadowUp, Math.round(up / texel) * texel - up);
    this.sun.position.copy(target).add(light);
  }

  /** Drive the water shader from the wind: glassy and mirror-like in calm air, short wind-aligned chop as it builds. */
  private updateWater(dt: number) {
    const u = this.water.material.uniforms;
    const U = conditions.windMean;
    u.time.value += dt * 0.35;
    this.water.position.y = conditions.level;
    const chop = 0.03 + 0.97 * smooth01(0.3, 8.5, U);
    u.uChop.value = chop;
    u.uCalm.value = 1 - smooth01(1.2, 4.5, U);
    u.uGusty.value = conditions.gustiness;
    u.uWhite.value = smooth01(5.6, 9.2, U);
    // ripple tile shrinks toward short capillary ripples in light air, grows with the chop's wavelength
    const tile = 6 + 1.2 * U;
    u.size.value = 103 / tile;
    u.distortionScale.value = Math.min(0.42, 0.06 + 0.34 * chop);
    tmpWind.set(Math.cos(this.windAngle), Math.sin(this.windAngle));
    const target = Math.atan2(conditions.wind.y, conditions.wind.x);
    let d = target - this.windAngle;
    d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
    if (U > 0.2) this.windAngle += d * Math.min(1, dt * 0.5);
    u.uWindDir.value.copy(tmpWind);
    // phase speed of the dominant ripples (deep-water dispersion), expressed in tile units per second
    const lam = tile / 6;
    const c = Math.sqrt((9.81 * lam) / (Math.PI * 2)) * (0.25 + 0.75 * smooth01(0.5, 3, U));
    const f = u.uFlow.value as THREE.Vector4;
    f.x += (c / 103) * dt * u.size.value;
    f.y += dt * 0.004;
    f.z += ((c * 0.75) / 47) * dt * u.size.value;
    f.w -= dt * 0.003;
  }
}
