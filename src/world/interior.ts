import * as THREE from 'three';
import { textTexture } from '../textures';
import { EIGHT, FOUR, PAIR, HullSpec, storedHullGeometry } from '../rowing/hull';
import { makeOarMesh } from '../rowing/oar';
import { addWall } from './collide';
import { mesh } from './build';
import { mats } from './materials';
import { CMU_H, X0, X1, Y0, ZF, ZW } from './boathouseDims';

function sign(text: string, w: number, h: number, bg: string, color: string, font?: string) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: textTexture(text, { bg, color, w: 1024, h: Math.round((1024 * h) / w), font }),
      roughness: 0.6,
    }),
  );
}

export function buildInterior(scene: THREE.Scene) {
  const M = mats();
  const root = new THREE.Group();
  root.name = 'boathouse-interior';
  scene.add(root);
  {
    const floor = mesh(new THREE.PlaneGeometry(X1 - X0, ZF - ZW), M.floor, false);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, Y0 + 0.012, (ZW + ZF) / 2);
    root.add(floor);
    const ceil = mesh(new THREE.PlaneGeometry(X1 - X0, ZF - ZW), M.ceiling, false);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, Y0 + CMU_H - 0.02, (ZW + ZF) / 2);
    root.add(ceil);
    const beamGeo = new THREE.BoxGeometry(0.35, 0.55, ZF - ZW);
    for (let x = -20; x <= 20; x += 4.5) {
      const b = mesh(beamGeo, M.ceiling);
      b.position.set(x, Y0 + CMU_H - 0.3, (ZW + ZF) / 2);
      root.add(b);
    }
    const lightGeo = new THREE.BoxGeometry(0.25, 0.06, 2.4);
    for (const x of [-17, -8, 1, 10, 19.5]) {
      for (const z of [16, 22, 28]) {
        const l = mesh(lightGeo, M.light, false, false);
        l.position.set(x, Y0 + CMU_H - 0.08, z);
        root.add(l);
      }
      const pl = new THREE.PointLight('#fff2dc', 60, 22, 1.5);
      pl.position.set(x, Y0 + CMU_H - 0.6, 22);
      root.add(pl);
    }

    const rackXs = [-21.6, -12.5, -3.5, 5.5, 14.8];
    const levels = [0.95, 1.8, 2.65, 3.5, 4.35];
    const postGeo = new THREE.BoxGeometry(0.14, CMU_H - 0.3, 0.14);
    const armGeo = new THREE.BoxGeometry(2.7, 0.07, 0.09);
    const postM: THREE.Matrix4[] = [];
    const armM: THREE.Matrix4[] = [];
    const zPosts = [14.4, 17.9, 21.4, 24.9, 28.4, 31.9];
    for (const rx of rackXs) {
      for (const z of zPosts) {
        postM.push(new THREE.Matrix4().makeTranslation(rx, Y0 + (CMU_H - 0.3) / 2, z));
        for (const l of levels) armM.push(new THREE.Matrix4().makeTranslation(rx, Y0 + l, z));
      }
      addWall(rx - 1.45, rx + 1.45, 13.9, 32.4);
    }
    const posts = new THREE.InstancedMesh(postGeo, M.rack, postM.length);
    postM.forEach((m, i) => posts.setMatrixAt(i, m));
    const arms = new THREE.InstancedMesh(armGeo, M.rack, armM.length);
    armM.forEach((m, i) => arms.setMatrixAt(i, m));
    posts.castShadow = arms.castShadow = true;
    root.add(posts, arms);

    const shellColors = ['#f0cf2e', '#f3f1ea', '#8c1515', '#1d1f22', '#f0cf2e', '#e9e7e0'];
    const types: { spec: HullSpec; w: number }[] = [
      { spec: EIGHT, w: 6 },
      { spec: FOUR, w: 2 },
      { spec: PAIR, w: 1 },
    ];
    const placements = new Map<string, THREE.Matrix4[]>();
    let seed = 3;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI, Math.PI / 2, 0, 'YXZ'));
    for (const rx of rackXs) {
      for (const s of [-1, 1]) {
        for (let li = 0; li < levels.length; li++) {
          if (rnd() < 0.12) continue;
          const pick = rnd() * 9;
          const t = pick < types[0].w ? types[0] : pick < types[0].w + types[1].w ? types[1] : types[2];
          const color = shellColors[Math.floor(rnd() * shellColors.length)];
          const key = `${t.spec.length}|${color}`;
          const zc = 23.1 + (rnd() - 0.5) * (17.6 - t.spec.length);
          const m = new THREE.Matrix4().compose(
            new THREE.Vector3(rx + s * 0.95, Y0 + levels[li] + 0.04 + t.spec.freeboard, zc),
            q,
            new THREE.Vector3(1, 1, 1),
          );
          if (!placements.has(key)) placements.set(key, []);
          placements.get(key)!.push(m);
        }
      }
    }
    const geoCache = new Map<number, THREE.BufferGeometry>();
    const matCache = new Map<string, THREE.Material>();
    for (const [key, list] of placements) {
      const [lenS, color] = key.split('|');
      const spec = types.find((t) => t.spec.length === Number(lenS))!.spec;
      if (!geoCache.has(spec.length)) geoCache.set(spec.length, storedHullGeometry(spec));
      if (!matCache.has(color))
        matCache.set(
          color,
          new THREE.MeshPhysicalMaterial({ color, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, side: THREE.DoubleSide }),
        );
      const im = new THREE.InstancedMesh(geoCache.get(spec.length)!, matCache.get(color)!, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.castShadow = true;
      im.receiveShadow = true;
      root.add(im);
    }

    const slingGeo = new THREE.BoxGeometry(0.06, 0.85, 0.06);
    const four = mesh(storedHullGeometry(FOUR), matCache.get('#f3f1ea') ?? M.white);
    four.rotation.y = Math.PI / 2;
    four.position.set(-17, Y0 + 0.9, 22.5);
    root.add(four);
    for (const z of [17.5, 27.5]) {
      for (const dx of [-0.45, 0.45]) {
        const s = mesh(slingGeo, M.darkSteel);
        s.position.set(-17 + dx, Y0 + 0.43, z);
        root.add(s);
      }
      const strap = mesh(new THREE.BoxGeometry(0.95, 0.05, 0.12), M.darkSteel);
      strap.position.set(-17, Y0 + 0.82, z);
      root.add(strap);
    }
    addWall(-17.6, -16.4, 15.6, 29.4);

    const oar = makeOarMesh();
    const oarSpots: number[] = [];
    for (let x = -11; x <= -5; x += 0.42) oarSpots.push(x);
    for (let x = -1.8; x <= 3.8; x += 0.42) oarSpots.push(x);
    for (const x of oarSpots) {
      const o = oar.clone();
      o.rotation.z = Math.PI / 2 - 0.07;
      o.rotation.x = 0;
      o.rotation.y = Math.PI / 2;
      o.position.set(x, Y0 + 1.25, ZF - 0.35);
      root.add(o);
    }
    addWall(-11.4, -4.6, ZF - 0.7, ZF);
    addWall(-2.2, 4.2, ZF - 0.7, ZF);

    for (let i = 0; i < 5; i++) {
      const erg = makeErg();
      erg.position.set(8.2 + (i % 5) * 1.25, Y0, 16 + Math.floor(i / 5) * 3);
      erg.rotation.y = -Math.PI / 2;
      root.add(erg);
    }
    addWall(7.4, 13.6, 14.6, 17.8);

    for (let i = 0; i < 3; i++) {
      const d = makeDinghy();
      d.position.set(19.5 + (i - 1) * 1.6, Y0, 24);
      root.add(d);
    }
    addWall(17.2, 22, 20.5, 27.5);

    const banner = sign('STANFORD ROWING', 7, 1.1, '#8c1515', '#ffffff', `bold 120px Georgia, serif`);
    banner.position.set(-0.2, Y0 + 4.4, ZF - 0.05);
    banner.rotation.y = Math.PI;
    root.add(banner);
    const champs = sign('NCAA CHAMPIONS  2009 · 2023 · 2025', 7, 0.6, '#f4efe6', '#8c1515', `bold 64px Georgia, serif`);
    champs.position.set(-0.2, Y0 + 3.55, ZF - 0.05);
    champs.rotation.y = Math.PI;
    root.add(champs);
  }
  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) o.matrixAutoUpdate = true;
  });
  return root;
}

function makeErg() {
  const M = mats();
  const g = new THREE.Group();
  const black = new THREE.MeshStandardMaterial({ color: '#1c1c1e', roughness: 0.5, metalness: 0.3 });
  const rail = mesh(new THREE.BoxGeometry(0.1, 0.07, 2.35), M.alu);
  rail.position.set(0, 0.36, 0.25);
  rail.rotation.x = 0.03;
  g.add(rail);
  const housing = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.22, 24), black);
  housing.rotation.z = Math.PI / 2;
  housing.position.set(0, 0.55, -0.95);
  g.add(housing);
  const leg = mesh(new THREE.BoxGeometry(0.5, 0.06, 0.08), black);
  leg.position.set(0, 0.03, -1.05);
  g.add(leg);
  const legB = mesh(new THREE.BoxGeometry(0.06, 0.36, 0.06), black);
  legB.position.set(0, 0.18, 1.35);
  g.add(legB);
  const seat = mesh(new THREE.BoxGeometry(0.3, 0.06, 0.3), black);
  seat.position.set(0, 0.45, 0.45);
  g.add(seat);
  const feet = mesh(new THREE.BoxGeometry(0.36, 0.25, 0.06), black);
  feet.position.set(0, 0.48, -0.55);
  feet.rotation.x = 0.7;
  g.add(feet);
  const arm = mesh(new THREE.BoxGeometry(0.03, 0.55, 0.03), black);
  arm.position.set(0, 0.95, -0.75);
  arm.rotation.x = -0.5;
  g.add(arm);
  const mon = mesh(new THREE.BoxGeometry(0.2, 0.16, 0.05), new THREE.MeshStandardMaterial({ color: '#2b2f2a', emissive: '#203018', emissiveIntensity: 0.4 }));
  mon.position.set(0, 1.18, -0.62);
  g.add(mon);
  const handle = mesh(new THREE.BoxGeometry(0.5, 0.03, 0.03), black);
  handle.position.set(0, 0.6, -0.72);
  g.add(handle);
  return g;
}

function makeDinghy() {
  const M = mats();
  const g = new THREE.Group();
  const hull = mesh(storedHullGeometry({ length: 4.2, beam: 1.4, draft: 0.3, freeboard: 0.25 }), M.white);
  hull.rotation.y = Math.PI / 2;
  hull.position.y = 0.75;
  g.add(hull);
  const cover = mesh(new THREE.BoxGeometry(1.3, 0.06, 3.6), new THREE.MeshStandardMaterial({ color: '#3d64b0', roughness: 0.8 }));
  cover.position.y = 1.0;
  g.add(cover);
  const dolly = mesh(new THREE.BoxGeometry(1.2, 0.5, 0.1), M.darkSteel);
  dolly.position.set(0, 0.25, 0.8);
  g.add(dolly);
  const dolly2 = dolly.clone();
  dolly2.position.z = -0.8;
  g.add(dolly2);
  return g;
}
