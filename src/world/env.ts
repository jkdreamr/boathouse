import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { waterNormalTexture } from '../textures';

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
  },
];

export class Environment {
  sky = new Sky();
  sun = new THREE.DirectionalLight('#ffffff', 3);
  hemi = new THREE.HemisphereLight('#ffffff', '#444444', 1);
  water: Water;
  sunDir = new THREE.Vector3();
  presetIndex = 0;
  private pmrem: THREE.PMREMGenerator;
  private envRT: THREE.WebGLRenderTarget | null = null;
  private skyScene = new THREE.Scene();
  private skyForEnv = new Sky();

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
    this.water = new Water(new THREE.PlaneGeometry(60000, 60000), {
      textureWidth: 1024,
      textureHeight: 1024,
      waterNormals: normals,
      sunDirection: new THREE.Vector3(0, 1, 0),
      sunColor: 0xffffff,
      waterColor: 0x1c3236,
      distortionScale: 0.55,
      fog: true,
    });
    this.water.rotation.x = -Math.PI / 2;
    this.water.material.uniforms.size.value = 3.2;
    this.water.name = 'water';
    scene.add(this.water);
    scene.fog = new THREE.FogExp2('#cccccc', 0.00008);
    this.apply(0);
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
    this.water.material.uniforms.time.value += dt * 0.35;
    const texel = 140 / 4096;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx + this.sunDir.x * 300, Math.max(30, this.sunDir.y * 300), fz + this.sunDir.z * 300);
  }
}
