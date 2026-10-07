import * as THREE from 'three';
import { conditions } from '../../sim/conditions';
import { addSystem } from '../../sim/systems';
import { addWall } from '../collide';
import { extMats } from './extMats';
import { Batch, v3 } from './geo';

// 25 ft ground-set tapered aluminium pole with a flag in the Executive Order 10834 1 : 1.9 proportion.
const POLE_H = 7.62;
const HOIST = 1.22;
const FLY = HOIST * 1.9;
const NU = 28;
const NV = 14;

export function buildFlagpole(root: THREE.Group, x: number, y0: number, z: number) {
  const E = extMats();
  const pole = new Batch();
  pole.add(new THREE.CylinderGeometry(0.045, 0.064, POLE_H, 16), x, y0 + POLE_H / 2, z);
  pole.add(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 14), x, y0 + POLE_H + 0.04, z);
  pole.box(0.05, 0.16, 0.03, x + 0.065, y0 + 1.3, z);
  pole.rod(v3(x + 0.05, y0 + POLE_H, z), v3(x + 0.055, y0 + 1.36, z), 0.003, 3);
  pole.rod(v3(x + 0.06, y0 + POLE_H, z + 0.01), v3(x + 0.065, y0 + 1.24, z + 0.01), 0.003, 3);
  const pm = pole.mesh(E.galv, true, false);
  root.add(pm);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), E.gold);
  ball.position.set(x, y0 + POLE_H + 0.15, z);
  root.add(ball);
  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 0.14, 16), E.bronze);
  collar.position.set(x, y0 + 0.07, z);
  root.add(collar);
  addWall(x - 0.16, x + 0.16, z - 0.16, z + 0.16);

  const geo = new THREE.PlaneGeometry(FLY, HOIST, NU, NV);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const U = new Float32Array(n);
  const V = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    U[i] = Math.min(1, Math.max(0, pos.getX(i) / FLY + 0.5));
    V[i] = Math.min(1, Math.max(0, 0.5 - pos.getY(i) / HOIST));
  }
  const flag = new THREE.Mesh(geo, E.flag);
  flag.userData.staticMergeExclude = true;
  flag.castShadow = true;
  flag.frustumCulled = false;
  const holder = new THREE.Group();
  holder.position.set(x, y0 + POLE_H - 0.08, z);
  holder.add(flag);
  root.add(holder);

  const arr = pos.array as Float32Array;
  let yaw = 0.6;
  let stream = 0;
  let phase = 0;
  addSystem({
    update(dt) {
      const w = conditions.wind;
      const t = conditions.clock;
      const base = Math.hypot(w.x, w.y) + Math.max(0, conditions.gust);
      const speed = base * (1 + 0.14 * Math.sin(t * 0.73) + 0.09 * Math.sin(t * 2.3 + 1.1));
      if (base > 0.25) {
        const target = Math.atan2(-w.y, w.x);
        let d = target - yaw;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        yaw += d * Math.min(1, dt * 1.2);
      }
      holder.rotation.y = yaw;
      const sTarget = THREE.MathUtils.smoothstep(speed, 0.3, 7.5);
      stream += (sTarget - stream) * Math.min(1, dt * 1.8);
      phase += dt * (0.7 + speed * 1.25);
      const droop = (1 - stream) * 1.1 + 0.03;
      const cd = Math.cos(droop);
      const sd = Math.sin(droop);
      const k = (Math.PI * 2) / (1.0 + 0.06 * speed);
      const ampBase = 0.05 + 0.2 * stream * (1 - 0.4 * stream);
      for (let i = 0; i < n; i++) {
        const u = U[i];
        const v = V[i];
        const along = u * FLY;
        const fall = Math.pow(u, 1.25);
        const wave = Math.sin(along * k - phase + v * 0.8);
        const ripple = Math.sin(along * k * 2.3 - phase * 1.6 + v * 2.1);
        const amp = ampBase * fall + (1 - stream) * 0.08 * u;
        const ax = along * (1 - 0.05 * Math.abs(wave) * u - (1 - stream) * 0.18 * u);
        arr[i * 3] = ax * cd + 0.07;
        arr[i * 3 + 1] = -v * HOIST - ax * sd * (1 - 0.45 * v);
        arr[i * 3 + 2] = amp * (wave + 0.35 * ripple);
      }
      pos.needsUpdate = true;
      geo.computeVertexNormals();
    },
  });
}
