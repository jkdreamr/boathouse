import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { centerline, fbm, northBank, southBank, terrainHeight } from './terrain';
import { conditions } from '../sim/conditions';
import { addSystem } from '../sim/systems';

// [realism:water]
const swayUniforms = {
  uTime: { value: 0 },
  uWind: { value: new THREE.Vector2() },
  uGust: { value: 0 },
};

addSystem({
  update: (dt) => {
    swayUniforms.uTime.value += dt;
    swayUniforms.uWind.value.copy(conditions.wind);
    swayUniforms.uGust.value = conditions.gust;
  },
});

export function applyWindSway(material: THREE.Material, options: { stiffness?: number; minY?: number } = {}) {
  const stiffness = options.stiffness ?? 0.0009;
  const minY = options.minY ?? 0;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, swayUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
uniform float uTime;
uniform vec2 uWind;
uniform float uGust;`,
      )
      .replace(
        '#include <project_vertex>',
        `vec4 realismLocalPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
realismLocalPosition = instanceMatrix * realismLocalPosition;
#endif
vec4 realismWorldPosition = modelMatrix * realismLocalPosition;
float realismHeight = max(transformed.y - ${minY.toFixed(3)}, 0.0);
float realismWindSpeed = length(uWind);
float realismFlutter = sin(uTime * 5.0 + realismWorldPosition.x * 0.3 + realismWorldPosition.z * 0.2) *
  0.002 * realismHeight * realismWindSpeed * (0.5 + uGust);
vec2 realismFlutterDirection = realismWindSpeed > 0.0001 ? normalize(vec2(-uWind.y, uWind.x)) : vec2(1.0, 0.0);
realismWorldPosition.xz += uWind * (${stiffness.toFixed(6)} * realismHeight * realismHeight) +
  realismFlutterDirection * realismFlutter;
vec4 mvPosition = viewMatrix * realismWorldPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}-water-sway-${stiffness}-${minY}`;
}

// [realism:water]
function cordgrassClusterGeometry() {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let blade = 0; blade < 6; blade++) {
    const a = (blade / 6) * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const height = 0.8 + (blade % 4) * 0.11;
    const baseX = dx * 0.05;
    const baseZ = dz * 0.05;
    const widthX = -dz * 0.045;
    const widthZ = dx * 0.045;
    const offset = positions.length / 3;
    positions.push(
      baseX - widthX,
      0,
      baseZ - widthZ,
      baseX + dx * height * 0.45 - widthX * 0.5,
      height * 0.55,
      baseZ + dz * height * 0.45 - widthZ * 0.5,
      baseX + dx * height * 0.45 + widthX * 0.5,
      height * 0.55,
      baseZ + dz * height * 0.45 + widthZ * 0.5,
      baseX + dx * height * 0.28,
      height,
      baseZ + dz * height * 0.28,
    );
    indices.push(offset, offset + 1, offset + 2, offset + 1, offset + 3, offset + 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// [realism:water]
function addMarshPlants(root: THREE.Group, rnd: () => number, matrix: THREE.Matrix4, color: THREE.Color) {
  const cordgrassMaterial = new THREE.MeshStandardMaterial({ color: '#ffffff', side: THREE.DoubleSide, roughness: 0.9 });
  applyWindSway(cordgrassMaterial, { stiffness: 0.012, minY: 0 });
  const cordgrass = new THREE.InstancedMesh(cordgrassClusterGeometry(), cordgrassMaterial, 4000);
  cordgrass.castShadow = false;
  cordgrass.receiveShadow = false;
  let cordCount = 0;
  for (let attempt = 0; cordCount < cordgrass.count && attempt < 24000; attempt++) {
    const x = -900 + rnd() * 2700;
    const southSide = rnd() < 0.5;
    if (southSide && x >= -152 && x <= 172) continue;
    const distance = rnd() * 9;
    const z = southSide ? southBank(x) - distance : northBank(x) + distance;
    const h = terrainHeight(x, z);
    if (h < -0.9 || h > 0.25) continue;
    matrix.compose(
      new THREE.Vector3(x, h, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
      new THREE.Vector3(0.8 + rnd() * 0.45, 0.8 + rnd() * 0.45, 0.8 + rnd() * 0.45),
    );
    cordgrass.setMatrixAt(cordCount, matrix);
    cordgrass.setColorAt(cordCount, color.setHSL(0.13 + rnd() * 0.07, 0.3 + rnd() * 0.18, 0.28 + rnd() * 0.22));
    cordCount++;
  }
  cordgrass.count = cordCount;
  cordgrass.instanceMatrix.needsUpdate = true;
  if (cordgrass.instanceColor) cordgrass.instanceColor.needsUpdate = true;
  root.add(cordgrass);

  const pickleweed = new THREE.InstancedMesh(
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.9 }),
    2500,
  );
  pickleweed.castShadow = false;
  pickleweed.receiveShadow = false;
  let pickleCount = 0;
  for (let attempt = 0; pickleCount < pickleweed.count && attempt < 18000; attempt++) {
    const x = -900 + rnd() * 2700;
    const southSide = rnd() < 0.5;
    if (southSide && x >= -152 && x <= 172) continue;
    const distance = 0.5 + rnd() * 7;
    const z = southSide ? southBank(x) + distance : northBank(x) - distance;
    const h = terrainHeight(x, z);
    if (h < 0.25 || h > 0.6) continue;
    matrix.compose(
      new THREE.Vector3(x, h + 0.06, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2),
      new THREE.Vector3(0.32 + rnd() * 0.42, 0.06 + rnd() * 0.08, 0.22 + rnd() * 0.38),
    );
    pickleweed.setMatrixAt(pickleCount, matrix);
    pickleweed.setColorAt(pickleCount, color.setHSL(0.06 + rnd() * 0.18, 0.4 + rnd() * 0.35, 0.27 + rnd() * 0.18));
    pickleCount++;
  }
  pickleweed.count = pickleCount;
  pickleweed.instanceMatrix.needsUpdate = true;
  if (pickleweed.instanceColor) pickleweed.instanceColor.needsUpdate = true;
  root.add(pickleweed);
}

function hillStrip(zNear: number, depth: number, x0: number, x1: number, amp: number, color: string, seed: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const step = 160;
  let n = 0;
  for (let x = x0; x <= x1; x += step) {
    const h = amp * (0.25 + 0.75 * fbm(x * 0.0007 + seed, seed * 3.1, 5));
    pos.push(x, -20, zNear, x, h, zNear + depth);
    n++;
  }
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, side: THREE.DoubleSide }));
  m.name = 'hills';
  return m;
}

function towerGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const H = 42;
  const leg = (sx: number, sz: number) => {
    const g = new THREE.BoxGeometry(0.35, H, 0.35);
    const top = new THREE.Vector3(sx * 0.9, H, sz * 0.9);
    const bot = new THREE.Vector3(sx * 4, 0, sz * 4);
    const dir = top.clone().sub(bot);
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        bot.clone().add(top).multiplyScalar(0.5),
        new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize()),
        new THREE.Vector3(1, dir.length() / H, 1),
      ),
    );
    return g;
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(leg(sx, sz));
  for (const [y, w] of [
    [30, 16],
    [36, 12],
    [41.5, 7],
  ]) {
    const arm = new THREE.BoxGeometry(w, 0.6, 0.6);
    arm.translate(0, y, 0);
    parts.push(arm);
  }
  for (let y = 4; y < 38; y += 6) {
    const k = 4 - (3.1 * y) / H;
    for (const sz of [-1, 1]) {
      const b = new THREE.BoxGeometry(k * 2.8, 0.18, 0.18);
      b.rotateZ(0.6);
      b.translate(0, y + 2, sz * k);
      parts.push(b);
      const c = new THREE.BoxGeometry(k * 2.8, 0.18, 0.18);
      c.rotateZ(-0.6);
      c.translate(0, y + 2, sz * k);
      parts.push(c);
    }
  }
  return mergeGeometries(parts)!;
}

export function buildBackdrop(scene: THREE.Scene) {
  const root = new THREE.Group();
  root.name = 'backdrop';
  scene.add(root);
  // [realism:water]
  const tidalProps = new THREE.Group();
  tidalProps.position.y = conditions.level;
  root.add(tidalProps);
  addSystem({ update: () => (tidalProps.position.y = conditions.level) });

  // Santa Cruz Mountains to the south/west, East Bay hills across the Bay
  root.add(hillStrip(3600, 1800, -14000, 14000, 620, '#7d8a86', 1.7));
  root.add(hillStrip(-6800, -1600, -16000, 16000, 380, '#97a1ad', 4.2));

  // transmission line across Bair Island
  const tGeo = towerGeometry();
  const tMat = new THREE.MeshLambertMaterial({ color: '#8f9396' });
  const xs: number[] = [];
  for (let x = -1800; x <= 2200; x += 260) xs.push(x);
  const towers = new THREE.InstancedMesh(tGeo, tMat, xs.length);
  const m = new THREE.Matrix4();
  const tz = (x: number) => -340 + 40 * Math.sin(x / 900);
  xs.forEach((x, i) => {
    m.makeTranslation(x, terrainHeight(x, tz(x)), tz(x));
    towers.setMatrixAt(i, m);
  });
  root.add(towers);
  const wirePts: number[] = [];
  for (const [dy, dz] of [
    [30, -7.5],
    [30, 7.5],
    [36, -5.5],
    [36, 5.5],
    [41.5, -3],
    [41.5, 3],
  ]) {
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i];
      const b = xs[i + 1];
      for (let k = 0; k < 12; k++) {
        const t0 = k / 12;
        const t1 = (k + 1) / 12;
        const p = (t: number) => {
          const x = a + (b - a) * t;
          const sag = 7 * 4 * t * (1 - t);
          const z = tz(a) + (tz(b) - tz(a)) * t;
          const g = terrainHeight(a, tz(a)) * (1 - t) + terrainHeight(b, tz(b)) * t;
          return [x, g + dy - sag, z + dz * 0 + dz];
        };
        wirePts.push(...p(t0), ...p(t1));
      }
    }
  }
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(wirePts, 3));
  root.add(new THREE.LineSegments(wg, new THREE.LineBasicMaterial({ color: '#3c3f42', transparent: true, opacity: 0.7 })));

  // marsh grass tufts along Bair Island's edge
  const tuft = new THREE.ConeGeometry(0.6, 1.3, 5);
  tuft.translate(0, 0.55, 0);
  // [realism:water]
  const tuftMaterial = new THREE.MeshLambertMaterial({ color: '#6f7440' });
  applyWindSway(tuftMaterial, { stiffness: 0.012, minY: 0 });
  const tufts = new THREE.InstancedMesh(tuft, tuftMaterial, 1800);
  const col = new THREE.Color();
  let seed = 11;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < tufts.count; i++) {
    const x = -700 + rnd() * 1800;
    const z = northBank(x) - 4 - rnd() * rnd() * 70;
    const s = 0.6 + rnd() * 1.3;
    m.compose(
      new THREE.Vector3(x, terrainHeight(x, z) - 0.1, z),
      new THREE.Quaternion(),
      new THREE.Vector3(s * (1 + rnd()), s, s * (1 + rnd())),
    );
    tufts.setMatrixAt(i, m);
    tufts.setColorAt(i, col.setHSL(0.17 + rnd() * 0.06, 0.3, 0.27 + rnd() * 0.1));
  }
  root.add(tufts);
  addMarshPlants(root, rnd, m, col);

  // marina masts downstream on the south bank
  const mastGeo = new THREE.CylinderGeometry(0.06, 0.09, 1, 6);
  mastGeo.translate(0, 0.5, 0);
  const masts = new THREE.InstancedMesh(mastGeo, new THREE.MeshLambertMaterial({ color: '#e1e3e4' }), 46);
  const hullGeo = new THREE.BoxGeometry(9, 1.4, 3);
  const hulls = new THREE.InstancedMesh(hullGeo, new THREE.MeshLambertMaterial({ color: '#f1f1ef' }), 46);
  for (let i = 0; i < 46; i++) {
    const x = 640 + (i % 23) * 12 + rnd() * 3;
    const z = southBank(x) - 6 - Math.floor(i / 23) * 14;
    const h = 9 + rnd() * 6;
    m.compose(new THREE.Vector3(x, 0.6, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1));
    masts.setMatrixAt(i, m);
    m.makeTranslation(x, 0.2, z);
    hulls.setMatrixAt(i, m);
  }
  // [realism:water]
  tidalProps.add(masts, hulls);

  // Port of Redwood City: warehouses, cranes, salt pile
  const ware = new THREE.MeshLambertMaterial({ color: '#b9b4aa' });
  for (let i = 0; i < 7; i++) {
    const x = 1500 + i * 85;
    const z = southBank(x) + 60 + (i % 3) * 50;
    const b = new THREE.Mesh(new THREE.BoxGeometry(60, 12 + (i % 2) * 6, 34), ware);
    b.position.set(x, terrainHeight(x, z) + 6, z);
    root.add(b);
  }
  const salt = new THREE.Mesh(new THREE.ConeGeometry(70, 26, 24), new THREE.MeshLambertMaterial({ color: '#f3f1ec' }));
  salt.position.set(2050, 13, southBank(2050) + 120);
  root.add(salt);
  const craneMat = new THREE.MeshLambertMaterial({ color: '#c0392b' });
  for (const x of [1720, 1820]) {
    const z = southBank(x) + 14;
    const c = new THREE.Group();
    for (const dz of [-6, 6]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(1.4, 34, 1.4), craneMat);
      leg.position.set(0, 17, dz);
      c.add(leg);
    }
    const boom = new THREE.Mesh(new THREE.BoxGeometry(2, 2.4, 60), craneMat);
    boom.position.set(0, 35, -14);
    c.add(boom);
    c.position.set(x, 1, z);
    root.add(c);
  }

  // course buoys down the middle of the creek
  const buoyX: number[] = [];
  for (let x = 120; x <= 3000; x += 125) buoyX.push(x);
  const buoys = new THREE.InstancedMesh(new THREE.SphereGeometry(0.38, 12, 8), new THREE.MeshStandardMaterial({ color: '#ff7a1a', roughness: 0.5 }), buoyX.length * 2);
  buoyX.forEach((x, i) => {
    for (const s of [0, 1]) {
      m.makeTranslation(x, 0.12, centerline(x) + (s ? 34 : -34));
      buoys.setMatrixAt(i * 2 + s, m);
    }
  });
  // [realism:water]
  tidalProps.add(buoys);
  return root;
}
