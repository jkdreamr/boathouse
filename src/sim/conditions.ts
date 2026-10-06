import * as THREE from 'three';

export const conditions = {
  level: 0,
  levelRate: 0,
  wind: new THREE.Vector2(),
  gust: 0,
  current: new THREE.Vector2(),
  clock: 0,
};

export function updateConditions(dt: number) {
  conditions.clock += dt;
}
