import * as THREE from 'three';
import { noiseTexture, planksTexture } from '../../textures';

/** Interior-only materials, created once and shared. */
function create() {
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  return {
    // structure / finishes
    sealedFloor: std({ map: noiseTexture('#8f8c86', 10, 3, 31), roughness: 0.32, metalness: 0.05 }),
    wet: std({ color: '#3d3c39', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }),
    drainGrate: std({ color: '#3a3b3c', roughness: 0.45, metalness: 0.75 }),
    slab: std({ color: '#bdb9b1', roughness: 0.95 }),
    bayPaint: std({ color: '#dcd8cf', roughness: 0.9 }),
    drywall: std({ color: '#ece8df', roughness: 0.92 }),
    drywallWarm: std({ color: '#e6dccb', roughness: 0.92 }),
    accentCardinal: std({ color: '#8c1515', roughness: 0.75 }),
    ceilingTile: std({ map: noiseTexture('#e9e7e1', 6, 6, 41), roughness: 0.95 }),
    rubberFloor: std({ map: noiseTexture('#2b2b2c', 30, 6, 33), roughness: 0.95 }),
    woodFloor: std({ map: planksTexture('#9a7350', 21), roughness: 0.55 }),
    carpet: std({ map: noiseTexture('#4a4c52', 26, 5, 35), roughness: 1 }),
    tile: std({ map: noiseTexture('#c9c6bd', 8, 8, 37), roughness: 0.5 }),
    glulam: std({ color: '#b98a58', roughness: 0.7 }),
    // metals / plastics
    rackSteel: std({ color: '#5d6166', roughness: 0.55, metalness: 0.6 }),
    galv: std({ color: '#a9adb0', roughness: 0.45, metalness: 0.75 }),
    chrome: std({ color: '#e4e6e8', roughness: 0.15, metalness: 1 }),
    blackPlastic: std({ color: '#1d1e20', roughness: 0.55 }),
    greyPlastic: std({ color: '#6f7377', roughness: 0.6 }),
    foam: std({ color: '#2a2b2d', roughness: 0.95 }),
    rubber: std({ color: '#141414', roughness: 0.9 }),
    strap: std({ color: '#1f2f5a', roughness: 0.85 }),
    yellow: std({ color: '#e8b923', roughness: 0.5 }),
    orange: std({ color: '#e5641e', roughness: 0.6 }),
    red: std({ color: '#b3261e', roughness: 0.55 }),
    green: std({ color: '#2f6b3f', roughness: 0.6 }),
    // erg (Concept2-style): black frame, aluminium rail
    ergBlack: std({ color: '#202124', roughness: 0.45, metalness: 0.3 }),
    ergRail: std({ color: '#c3c6c9', roughness: 0.3, metalness: 0.85 }),
    screen: std({ color: '#9fb39a', emissive: '#56634f', emissiveIntensity: 0.35, roughness: 0.3 }),
    // furniture
    lockerBlue: std({ color: '#5a6170', roughness: 0.5, metalness: 0.35 }),
    lockerWood: std({ color: '#8a6040', roughness: 0.6 }),
    bench: std({ color: '#a77c52', roughness: 0.6 }),
    tablecloth: std({ color: '#f4f2ec', roughness: 0.9 }),
    chairFrame: std({ color: '#3a3a3c', roughness: 0.5, metalness: 0.5 }),
    chairSeat: std({ color: '#2e2d29', roughness: 0.8 }),
    counter: std({ color: '#d8d4cc', roughness: 0.3 }),
    cabinet: std({ color: '#f1efe9', roughness: 0.55 }),
    stainless: std({ color: '#c9ccce', roughness: 0.28, metalness: 0.9 }),
    appliance: std({ color: '#efefec', roughness: 0.35, metalness: 0.1 }),
    darkWood: std({ color: '#4b3020', roughness: 0.55 }),
    brass: std({ color: '#c8a24a', roughness: 0.3, metalness: 1 }),
    silver: std({ color: '#d6d8db', roughness: 0.18, metalness: 1 }),
    glass: std({ color: '#cfe2ea', roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false }),
    mirror: std({ color: '#c9d2d6', roughness: 0.02, metalness: 1, envMapIntensity: 1.4 }),
    towel: std({ color: '#f1efe8', roughness: 1 }),
    fabricCardinal: std({ color: '#8c1515', roughness: 0.9 }),
    fabricDark: std({ color: '#2e2d29', roughness: 0.95 }),
    lightPanel: std({ color: '#ffffff', emissive: '#fff8ea', emissiveIntensity: 1.6 }),
    // boats on racks: vertex coloured gloss composite
    hull: new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.15, side: THREE.DoubleSide }),
  };
}

export type IMats = ReturnType<typeof create>;
let cached: IMats | null = null;
export function imats(): IMats {
  return (cached ??= create());
}
