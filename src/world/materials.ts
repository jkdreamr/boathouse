import * as THREE from 'three';
import { cmuTexture, noiseTexture, planksTexture, roofTexture, sidingTexture } from '../textures';

export type Mats = ReturnType<typeof create>;
let cached: Mats | null = null;

function create() {
  const cmu = cmuTexture();
  const siding = sidingTexture();
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  return {
    cmu: std({ map: cmu.map, bumpMap: cmu.bump, bumpScale: 1.2, roughness: 0.92 }),
    siding: std({ map: siding.map, bumpMap: siding.bump, bumpScale: 1.5, roughness: 0.78 }),
    roof: std({ map: roofTexture(), roughness: 0.45, metalness: 0.55 }),
    trim: std({ color: '#3a2a26', roughness: 0.6 }),
    frame: std({ color: '#e7e2d6', roughness: 0.45, metalness: 0.1 }),
    glass: std({
      color: '#86a6c4',
      metalness: 0.92,
      roughness: 0.06,
      transparent: true,
      opacity: 0.5,
      envMapIntensity: 1.6,
      depthWrite: false,
    }),
    glassDark: std({ color: '#5d7e9c', metalness: 0.95, roughness: 0.05, envMapIntensity: 1.5 }),
    paint: std({ color: '#d9d6cf', roughness: 0.9, side: THREE.BackSide }),
    ceiling: std({ color: '#c9c6bf', roughness: 0.9 }),
    concrete: std({ map: noiseTexture('#a7a29a', 18, 3, 2), roughness: 0.9 }),
    floor: std({ map: noiseTexture('#9a968e', 14, 4, 3), roughness: 0.65, metalness: 0.05 }),
    apron: std({ map: noiseTexture('#7a443d', 26, 3, 4), roughness: 0.9 }),
    asphalt: std({ map: noiseTexture('#4f4d4a', 22, 3, 5), roughness: 0.95 }),
    steel: std({ color: '#d8d8d4', roughness: 0.4, metalness: 0.6 }),
    darkSteel: std({ color: '#2b2c2e', roughness: 0.5, metalness: 0.6 }),
    alu: std({ color: '#b9bcbf', roughness: 0.35, metalness: 0.8 }),
    deck: std({ map: planksTexture('#8a6a5e', 7), roughness: 0.85 }),
    deckGray: std({ map: planksTexture('#8f877c', 8), roughness: 0.9 }),
    wood: std({ color: '#6b4a35', roughness: 0.85 }),
    rack: std({ color: '#3d3f42', roughness: 0.6, metalness: 0.4 }),
    pad: std({ color: '#2c2c2c', roughness: 0.8 }),
    light: std({ color: '#ffffff', emissive: '#fff6e0', emissiveIntensity: 2.2 }),
    globe: std({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 0.6, roughness: 0.3 }),
    cardinal: std({ color: '#8c1515', roughness: 0.6 }),
    white: std({ color: '#f2f2ee', roughness: 0.5 }),
  };
}

export function mats(): Mats {
  if (!cached) cached = create();
  return cached;
}
