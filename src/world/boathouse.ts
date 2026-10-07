import * as THREE from 'three';
import { boxMeters, textTexture } from '../textures';
import { addWall } from './collide';
import { archPoints, archTop, mesh, Opening, rectWallGeo, shapeWallGeo, wallFrame, windowParts } from './build';
import { mats } from './materials';
import { BAYS, BAY_W, BALCONY_Y, CMU_H, EAVE, EAVE_OVER, RIDGE_Y, RIDGE_Z, SLOPE, UP_H, X0, X1, Y0, ZF, ZW } from './boathouseDims';
import { buildBalcony } from './exterior/balcony';
import { buildExteriorDetails } from './exterior/details';
import { buildBayDoors } from './exterior/doors';
import { extMats } from './exterior/extMats';
import { buildFlagpole } from './exterior/flag';
import { addSeams, buildRoofTrim } from './exterior/roofing';
import { buildInterior } from './interior';
import { mergeStaticMeshes } from './mergeStatic';

export { BALCONY_Y, BAYS };

function addWall2(group: THREE.Group, geo: THREE.BufferGeometry, outside: THREE.Material, inside?: THREE.Material) {
  const m = mesh(geo, outside);
  group.add(m);
  if (inside) group.add(mesh(geo, inside, false, true));
}

function curvedText(text: string, w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 1024;
  const g = c.getContext('2d')!;
  g.font = `bold 150px Georgia, 'Times New Roman', serif`;
  g.fillStyle = '#efe6d6';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const cx = 1024;
  const cy = 1180;
  const R = 920;
  const span = 1.45;
  const letters = [...text];
  for (let i = 0; i < letters.length; i++) {
    const a = -Math.PI / 2 - span / 2 + (span * (i + 0.5)) / letters.length;
    g.save();
    g.translate(cx + Math.cos(a) * R, cy + Math.sin(a) * R);
    g.rotate(a + Math.PI / 2);
    g.fillText(letters[i], 0, 0);
    g.restore();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, metalness: 0.5 }),
  );
  return m;
}

function sign(text: string, w: number, h: number, bg: string, color: string, font?: string) {
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshStandardMaterial({
      map: textTexture(text, { bg, color, w: 1024, h: Math.round((1024 * h) / w), font }),
      roughness: 0.6,
    }),
  );
}

export function buildBoathouse(scene: THREE.Scene) {
  const M = mats();
  const E = extMats();
  const root = new THREE.Group();
  root.name = 'boathouse';
  scene.add(root);

  // ---------- water facade (faces the creek, -z) ----------
  {
    const f = wallFrame(X1, ZW, X0, ZW, Y0);
    const u = (x: number) => X1 - x;
    // bay doors, reveals and hardware are built in exterior/doors.ts; the east (sailing) bay opening runs full height
    const cmuOpen: Opening[] = BAYS.map((b) => ({
      u0: u(b.x) - BAY_W / 2,
      u1: u(b.x) + BAY_W / 2,
      v0: 0,
      v1: b.x > 15 ? CMU_H : 3.6,
      open: b.open,
    }));
    addWall2(f, rectWallGeo(48, CMU_H, cmuOpen), E.cmu, M.paint);
    root.add(f);

    const up = wallFrame(X1, ZW, X0, ZW, Y0 + CMU_H);
    const sail: Opening = { u0: u(19.2) - BAY_W / 2, u1: u(19.2) + BAY_W / 2, v0: 0, v1: 2.85 };
    const upOpen: Opening[] = [
      { u0: 12.05, u1: 13.95, v0: 0, v1: 2.4, cols: 2, rows: 1 },
      { u0: 38.05, u1: 39.95, v0: 0, v1: 2.4, cols: 2, rows: 1 },
      { u0: 21.6, u1: 24.4, v0: 0.7, v1: 2.6, cols: 3, rows: 2 },
      { u0: 30.5, u1: 32.5, v0: 0.7, v1: 2.6, cols: 2, rows: 2 },
      { u0: 44.0, u1: 46.0, v0: 0.7, v1: 2.6, cols: 2, rows: 2 },
    ];
    addWall2(up, rectWallGeo(48, UP_H, [sail, ...upOpen]), M.siding);
    for (const o of upOpen) up.add(windowParts(o, M.frame, M.glassDark));
    root.add(up);

    // dormer gable with half-round window
    const dorm = wallFrame(X1, ZW, X0, ZW, EAVE);
    const dc = u(1);
    const half = 4.5;
    const rise = half * 0.7;
    const semi: Opening = { u0: dc - 2.2, u1: dc + 2.2, v0: 0.25, v1: 0.25, arch: 2.2, cols: 4, rows: 1 };
    const outline = [new THREE.Vector2(dc - half, 0), new THREE.Vector2(dc + half, 0), new THREE.Vector2(dc, rise)];
    addWall2(dorm, shapeWallGeo(outline, [archPoints(semi)]), M.siding);
    dorm.add(windowParts(semi, M.frame, M.glassDark));
    root.add(dorm);
    const dLen = Math.hypot(half + 0.4, (half + 0.4) * 0.7);
    for (const s of [-1, 1]) {
      const r = mesh(boxMeters(dLen, 0.14, 8.6), M.roof);
      r.rotation.order = 'YXZ';
      r.position.set(1 + (s * (half + 0.4)) / 2, EAVE + rise - ((half + 0.4) * 0.7) / 2 + 0.05, ZW - 0.45 + 4.3);
      r.rotation.z = s * -Math.atan(0.7);
      addSeams(r, dLen, 8.6, 0.14, false);
      root.add(r);
    }
  }

  // ---------- gable ends ----------
  for (const side of [-1, 1] as const) {
    const x = side < 0 ? X0 : X1;
    const f = side < 0 ? wallFrame(x, ZW, x, ZF, Y0) : wallFrame(x, ZF, x, ZW, Y0);
    const len = ZF - ZW;
    const cmuOpen: Opening[] =
      side < 0
        ? [
            { u0: 17, u1: 19.2, v0: 0.9, v1: 3.6, cols: 2, rows: 3 },
            { u0: 13, u1: 15.2, v0: 0.9, v1: 3.6, cols: 2, rows: 3 },
          ]
        : [
            { u0: 3, u1: 5.2, v0: 0.9, v1: 3.6, cols: 2, rows: 3 },
            { u0: 7, u1: 9.2, v0: 0.9, v1: 3.6, cols: 2, rows: 3 },
          ];
    addWall2(f, rectWallGeo(len, CMU_H, cmuOpen), E.cmu, M.paint);
    for (const o of cmuOpen) f.add(windowParts(o, M.frame, M.glassDark));
    root.add(f);

    const g = side < 0 ? wallFrame(x, ZW, x, ZF, Y0 + CMU_H) : wallFrame(x, ZF, x, ZW, Y0 + CMU_H);
    const ridgeV = UP_H + (len / 2) * SLOPE;
    const outline = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(len, 0),
      new THREE.Vector2(len, UP_H),
      new THREE.Vector2(len / 2, ridgeV),
      new THREE.Vector2(0, UP_H),
    ];
    const big: Opening = { u0: 3, u1: 19, v0: 0.6, v1: 0.9, arch: 2.8 };
    const holes: THREE.Vector2[][] = [];
    const n = 6;
    for (let k = 0; k < n; k++) {
      const a = 3 + (k * 16) / n + 0.22;
      const b = 3 + ((k + 1) * 16) / n - 0.22;
      const m = (a + b) / 2;
      const poly = [
        new THREE.Vector2(a, 0.6),
        new THREE.Vector2(b, 0.6),
        new THREE.Vector2(b, archTop(big, b)),
        new THREE.Vector2(m, archTop(big, m)),
        new THREE.Vector2(a, archTop(big, a)),
      ];
      holes.push(poly);
      const glass = mesh(new THREE.ShapeGeometry(new THREE.Shape(poly)), M.glassDark, false, false);
      glass.position.z = -0.08;
      g.add(glass);
      const fr = new THREE.Group();
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i];
        const q = poly[(i + 1) % poly.length];
        const bm = mesh(new THREE.BoxGeometry(p.distanceTo(q) + 0.06, 0.08, 0.2), M.frame, false);
        bm.position.set((p.x + q.x) / 2, (p.y + q.y) / 2, -0.05);
        bm.rotation.z = Math.atan2(q.y - p.y, q.x - p.x);
        fr.add(bm);
      }
      const mid = mesh(new THREE.BoxGeometry(0.06, archTop(big, m) - 0.6, 0.06), M.frame, false);
      mid.position.set(m, (0.6 + archTop(big, m)) / 2, -0.06);
      fr.add(mid);
      const hz = mesh(new THREE.BoxGeometry(b - a, 0.06, 0.06), M.frame, false);
      hz.position.set(m, 1.6, -0.06);
      fr.add(hz);
      g.add(fr);
    }
    addWall2(g, shapeWallGeo(outline, holes), M.siding);
    const vent = mesh(new THREE.BoxGeometry(0.6, 1.0, 0.05), M.trim, false);
    vent.position.set(len / 2 + 2.6, ridgeV - 1.8, 0.03);
    g.add(vent);
    root.add(g);
  }

  // ---------- street facade with entry gable ----------
  {
    const f = wallFrame(X0, ZF, X1, ZF, Y0);
    const cmuOpen: Opening[] = [5, 10, 38, 43].map((c) => ({ u0: c - 1.1, u1: c + 1.1, v0: 0.9, v1: 3.6, cols: 2, rows: 3 }));
    addWall2(f, rectWallGeo(48, CMU_H, cmuOpen), E.cmu, M.paint);
    for (const o of cmuOpen) f.add(windowParts(o, M.frame, M.glassDark));
    const camp = sign('Stanford Rowing Day Camps', 4.2, 0.9, '#6e3a35', '#f1e7dc', `bold 92px Georgia, serif`);
    camp.position.set(4.6, 4.5, 0.03);
    f.add(camp);
    root.add(f);
    const up = wallFrame(X0, ZF, X1, ZF, Y0 + CMU_H);
    const upOpen: Opening[] = [5, 10, 38, 43].map((c) => ({ u0: c - 0.9, u1: c + 0.9, v0: 0.8, v1: 2.6, cols: 2, rows: 2 }));
    addWall2(up, rectWallGeo(48, UP_H, upOpen), M.siding);
    for (const o of upOpen) up.add(windowParts(o, M.frame, M.glassDark));
    root.add(up);

    // entry bay x -6..6, projecting to z = 36.5
    const EZ = 36.5;
    const eSlope = 0.75;
    const ef = wallFrame(-6, EZ, 6, EZ, Y0);
    const entrance: Opening = { u0: 3, u1: 9, v0: 0, v1: 3.0, cols: 4, rows: 3 };
    const arch: Opening = { u0: 3.3, u1: 8.7, v0: 3.45, v1: CMU_H + 4.7, arch: 1.5, cols: 4, rows: 9 };
    addWall2(ef, rectWallGeo(12, CMU_H, [entrance, { ...arch, v1: CMU_H }]), E.cmu);
    ef.add(windowParts(entrance, M.frame, M.glass));
    ef.add(windowParts(arch, M.frame, M.glassDark));
    const addr = sign('300  CARDINAL WAY', 1.3, 0.32, '#ffffff00', '#f8f8f8', `bold 70px Arial, sans-serif`);
    (addr.material as THREE.MeshStandardMaterial).transparent = true;
    addr.position.set(3.9, 2.5, -0.06);
    ef.add(addr);
    const canopy = mesh(boxMeters(6.8, 0.16, 1.6), M.frame);
    canopy.position.set(6, 3.2, 0.8);
    ef.add(canopy);
    root.add(ef);

    const es = wallFrame(-6, EZ, 6, EZ, Y0 + CMU_H);
    const archLocal = archPoints({ ...arch, v0: 0, v1: 4.7 }, 18);
    const arc = archLocal.slice(2).reverse();
    const outline = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(3.3, 0),
      ...arc,
      new THREE.Vector2(8.7, 0),
      new THREE.Vector2(12, 0),
      new THREE.Vector2(12, UP_H),
      new THREE.Vector2(6, UP_H + 6 * eSlope),
      new THREE.Vector2(0, UP_H),
    ];
    addWall2(es, shapeWallGeo(outline), M.siding);
    const letters = curvedText('STANFORD UNIVERSITY', 9.2, 4.6);
    letters.position.set(6, 5.15, 0.05);
    es.add(letters);
    root.add(es);

    for (const s of [-1, 1]) {
      const x = 6 * s;
      const w = s < 0 ? wallFrame(x, ZF, x, EZ, Y0) : wallFrame(x, EZ, x, ZF, Y0);
      addWall2(w, rectWallGeo(EZ - ZF, CMU_H, []), E.cmu);
      root.add(w);
      const w2 = s < 0 ? wallFrame(x, ZF, x, EZ, Y0 + CMU_H) : wallFrame(x, EZ, x, ZF, Y0 + CMU_H);
      addWall2(w2, rectWallGeo(EZ - ZF, UP_H, []), M.siding);
      root.add(w2);
    }
    const run = 6.35;
    const len = Math.hypot(run, run * eSlope);
    const zLen = EZ + 0.4 - 24.5;
    for (const s of [-1, 1]) {
      const r = mesh(boxMeters(len, 0.15, zLen), M.roof);
      r.position.set((s * run) / 2, EAVE + UP_H * 0 + 6 * eSlope - (run * eSlope) / 2 + 0.07, 24.5 + zLen / 2);
      r.rotation.z = -s * Math.atan(eSlope);
      addSeams(r, len, zLen, 0.15, false);
      root.add(r);
    }
  }

  // ---------- main roof ----------
  {
    const over = EAVE_OVER;
    const run = RIDGE_Z - ZW + over;
    const len = Math.hypot(run, run * SLOPE);
    const w = X1 - X0 + 1.4;
    for (const s of [-1, 1]) {
      const r = mesh(boxMeters(w, 0.16, len), M.roof);
      r.rotation.x = s * -Math.atan(SLOPE);
      const zc = RIDGE_Z + (s * -run) / 2;
      r.position.set(0, RIDGE_Y - (run * SLOPE) / 2 + 0.08, zc);
      addSeams(r, w, len, 0.16, true);
      root.add(r);
    }
    const cap = mesh(boxMeters(w, 0.18, 0.5), M.trim);
    cap.position.set(0, RIDGE_Y + 0.2, RIDGE_Z);
    root.add(cap);
    for (const p of [
      [-8, 0.9],
      [9, 0.6],
    ]) {
      const vent = mesh(new THREE.CylinderGeometry(0.25, 0.25, p[1], 12), M.darkSteel);
      vent.position.set(p[0], RIDGE_Y - 2.4 * SLOPE + p[1] / 2, RIDGE_Z + 2.4);
      root.add(vent);
    }
  }

  // ---------- balcony + stairs, door hardware, roof trim, site details ----------
  buildBalcony(root);
  buildBayDoors(root);
  buildRoofTrim(root);
  buildExteriorDetails(root);
  buildFlagpole(root, 28, Y0, 9.5);

  buildInterior(scene);

  // ---------- collision ----------
  const t = 0.18;
  let x = X0;
  const gaps = BAYS.filter((b) => b.open).map((b) => [b.x - BAY_W / 2, b.x + BAY_W / 2]);
  for (const [g0, g1] of gaps) {
    addWall(x, g0, ZW - t, ZW + t);
    x = g1;
  }
  addWall(x, X1, ZW - t, ZW + t);
  addWall(X0, X1, ZF - t, ZF + t);
  addWall(-6, 6, ZF, 36.6);
  addWall(X0 - t, X0 + t, ZW, ZF);
  addWall(X1 - t, X1 + t, ZW, ZF);

  root.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !(o as THREE.InstancedMesh).isInstancedMesh) o.matrixAutoUpdate = true;
  });
  mergeStaticMeshes(root);
  return root;
}
