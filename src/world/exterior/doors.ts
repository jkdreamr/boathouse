import * as THREE from 'three';
import { boxMeters, textTexture } from '../../textures';
import { BAYS, BAY_H, BAY_W, CMU_H, Y0, ZW } from '../boathouseDims';
import { mats } from '../materials';
import { extMats } from './extMats';
import { Batch, v3 } from './geo';

// Full-view aluminium sectional door (e.g. CHI 3295 / Global full-view spec sheets):
// 2 in sections, 4-5/8 in top/bottom rails, 4-1/4 in combined intermediate rails,
// 4-5/8 in end stiles, 2-7/8 in centre stiles, glass in removable retainers, 15 in radius track.
const T = 0.05;
const END = 0.117;
const MID = 0.054;
const CEN = 0.073;
const ROWS = 5;
const COLS = 4;
const TRACK_R = 0.38;
/** Door leaf sits against the inside face of the 0.3 m CMU wall. */
const DOOR_Z = ZW + 0.3;
const TRACK_Z = DOOR_Z + T + 0.045;
const H_TRACK_Y = Y0 + BAY_H + 0.24;

/** Glazed sections in local coords: x centred, y up from oy, exterior face at z = oz. */
function sections(
  w: number,
  h: number,
  rows: number,
  frame: Batch,
  glass: Batch,
  seal: Batch,
  oy = 0,
  oz = 0,
  topRail = END,
  botRail = END,
) {
  const sh = h / rows;
  const inner = w - 2 * END;
  const lw = (inner - (COLS - 1) * CEN) / COLS;
  for (let r = 0; r < rows; r++) {
    const y0 = oy + r * sh;
    const y1 = y0 + sh;
    const rb = r === 0 ? botRail : MID;
    const rt = r === rows - 1 ? topRail : MID;
    frame.box(w, rb, T, 0, y0 + rb / 2, oz + T / 2);
    frame.box(w, rt, T, 0, y1 - rt / 2, oz + T / 2);
    const gy0 = y0 + rb;
    const gy1 = y1 - rt;
    const gh = gy1 - gy0;
    const gc = (gy0 + gy1) / 2;
    frame.box(END, gh, T, -w / 2 + END / 2, gc, oz + T / 2);
    frame.box(END, gh, T, w / 2 - END / 2, gc, oz + T / 2);
    for (let c = 0; c < COLS; c++) {
      const lx0 = -w / 2 + END + c * (lw + CEN);
      if (c > 0) frame.box(CEN, gh, T, lx0 - CEN / 2, gc, oz + T / 2);
      glass.add(new THREE.PlaneGeometry(lw + 0.01, gh + 0.01), lx0 + lw / 2, gc, oz + T * 0.55);
      // snap-in glazing retainers stand proud of the glass on the exterior face
      const b = 0.016;
      frame.box(lw, b, 0.012, lx0 + lw / 2, gy0 + b / 2, oz + 0.012);
      frame.box(lw, b, 0.012, lx0 + lw / 2, gy1 - b / 2, oz + 0.012);
      frame.box(b, gh - 2 * b, 0.012, lx0 + b / 2, gc, oz + 0.012);
      frame.box(b, gh - 2 * b, 0.012, lx0 + lw - b / 2, gc, oz + 0.012);
    }
    if (r > 0) seal.box(w, 0.01, 0.012, 0, y0, oz - 0.003);
  }
}

function hardware(cx: number, open: boolean, track: Batch, spring: Batch, dark: Batch) {
  const zEnd = DOOR_Z + BAY_H + 0.65;
  for (const s of [-1, 1]) {
    const x = cx + s * (BAY_W / 2 + 0.035);
    const yv = H_TRACK_Y - TRACK_R;
    track.box(0.035, yv - Y0, 0.075, x, Y0 + (yv - Y0) / 2, TRACK_Z);
    let prev = v3(x, yv, TRACK_Z);
    for (let k = 1; k <= 6; k++) {
      const a = (k / 6) * (Math.PI / 2);
      const p = v3(x, yv + Math.sin(a) * TRACK_R, TRACK_Z + (1 - Math.cos(a)) * TRACK_R);
      track.beam(prev, p, 0.035, 0.075);
      prev = p;
    }
    track.beam(prev, v3(x, H_TRACK_Y, zEnd), 0.035, 0.075);
    // jamb brackets on the vertical track, rear and centre hangers from the roof framing
    for (const y of [0.6, 1.7, 2.8]) track.box(0.12, 0.05, 0.04, x - s * 0.06, Y0 + y, TRACK_Z - 0.04);
    const yc = Y0 + CMU_H - 0.08;
    for (const z of [zEnd - 0.06, (TRACK_Z + zEnd) / 2]) {
      track.box(0.04, yc - H_TRACK_Y, 0.04, x + s * 0.03, (yc + H_TRACK_Y) / 2, z);
      track.beam(v3(x + s * 0.03, H_TRACK_Y + 0.05, z), v3(x + s * 0.03, yc, z - 0.6), 0.03, 0.03);
    }
    // cable drum + end bearing plate
    const ys = H_TRACK_Y + 0.3;
    const zs = DOOR_Z + 0.14;
    spring.rod(v3(x - 0.05, ys, zs), v3(x + 0.05, ys, zs), 0.075, 14);
    track.box(0.01, 0.26, 0.24, x + s * 0.07, ys, zs - 0.03);
    // photo-eye safety sensors
    dark.box(0.05, 0.07, 0.08, x - s * 0.06, Y0 + 0.15, DOOR_Z + 0.02);
    if (!open) {
      // lift cables run from the drums down to the bottom brackets
      spring.rod(v3(x - s * 0.02, ys - 0.07, zs), v3(x - s * 0.02, Y0 + 0.08, DOOR_Z + T + 0.01), 0.003, 3);
    }
  }
  const ys = H_TRACK_Y + 0.3;
  const zs = DOOR_Z + 0.14;
  spring.rod(v3(cx - BAY_W / 2 - 0.12, ys, zs), v3(cx + BAY_W / 2 + 0.12, ys, zs), 0.0127, 8);
  for (const s of [-1, 1]) spring.rod(v3(cx + s * 0.12, ys, zs), v3(cx + s * 1.05, ys, zs), 0.05, 12);
  track.box(0.16, 0.22, 0.02, cx, ys, DOOR_Z + 0.01);
  // jackshaft operator beside the right-hand track, with its disconnect box
  dark.box(0.3, 0.36, 0.22, cx + BAY_W / 2 + 0.36, ys - 0.05, DOOR_Z + 0.12);
  dark.box(0.14, 0.2, 0.08, cx + BAY_W / 2 + 0.36, Y0 + 1.4, DOOR_Z + 0.04);
}

/** The five full-view sectional bay doors: reveals, leaves, tracks, springs, operators and the tall sailing-bay glazing. */
export function buildBayDoors(root: THREE.Group) {
  const M = mats();
  const E = extMats();
  const leafW = BAY_W + 0.1;
  const fr = new Batch();
  const gl = new Batch();
  const se = new Batch();
  sections(leafW, BAY_H, ROWS, fr, gl, se);
  se.box(leafW, 0.03, 0.045, 0, -0.012, T / 2);
  fr.box(0.18, 0.03, 0.035, 0, 0.36, -0.017);
  const leafFrame = fr.geometry();
  const leafGlass = gl.geometry();
  const leafSeal = se.geometry();

  const track = new Batch();
  const spring = new Batch();
  const dark = new Batch();
  const reveal = new Batch();
  const trim = new Batch();
  for (const b of BAYS) {
    const tall = b.x > 15;
    const x0 = b.x - BAY_W / 2;
    const x1 = b.x + BAY_W / 2;
    const top = tall ? CMU_H : BAY_H;
    // 0.3 m CMU reveals (the facade is a single plane, so the returns give it real thickness)
    reveal.add(boxMeters(0.04, top, 0.3), x0 - 0.02, Y0 + top / 2, ZW + 0.15);
    reveal.add(boxMeters(0.04, top, 0.3), x1 + 0.02, Y0 + top / 2, ZW + 0.15);
    if (!tall) reveal.add(boxMeters(BAY_W + 0.08, 0.04, 0.3), b.x, Y0 + BAY_H + 0.02, ZW + 0.15);
    // painted steel jamb/head angles
    trim.box(0.05, top, 0.02, x0 + 0.025, Y0 + top / 2, ZW - 0.01);
    trim.box(0.05, top, 0.02, x1 - 0.025, Y0 + top / 2, ZW - 0.01);
    if (!tall) trim.box(BAY_W, 0.05, 0.02, b.x, Y0 + BAY_H - 0.025, ZW - 0.01);
    // concrete threshold
    reveal.add(boxMeters(BAY_W, 0.02, 0.3), b.x, Y0 + 0.01, ZW + 0.15);

    const g = new THREE.Group();
    if (b.open) {
      g.position.set(b.x, H_TRACK_Y + 0.025, TRACK_Z + 0.12);
      g.rotation.x = Math.PI / 2;
    } else {
      g.position.set(b.x, Y0, DOOR_Z);
    }
    const lf = new THREE.Mesh(leafFrame, E.anod);
    lf.castShadow = lf.receiveShadow = true;
    g.add(lf, new THREE.Mesh(leafGlass, E.doorGlass), new THREE.Mesh(leafSeal, E.seal));
    root.add(g);
    hardware(b.x, b.open, track, spring, dark);

    if (tall) {
      // San Diego Sailing Bay: the door is topped by fixed full-view glazing that runs up into the second floor
      const tf = new Batch();
      const tg = new Batch();
      const ts = new Batch();
      sections(leafW, CMU_H - BAY_H, 3, tf, tg, ts, 0, 0, END, MID);
      const tg2 = new Batch();
      const UP = 2.6;
      sections(BAY_W, UP, 4, tf, tg2, ts, CMU_H - BAY_H + 0.25, -0.18, END, END);
      for (const [bt, mat] of [
        [tf, E.anod],
        [tg, E.doorGlass],
        [ts, E.seal],
        [tg2, M.glassDark],
      ] as const) {
        const m = bt.mesh(mat, bt === tf, false);
        m.position.set(b.x, Y0 + BAY_H, DOOR_Z);
        root.add(m);
      }
      // floor-line spandrel and second-floor reveals in the siding
      trim.box(BAY_W, 0.25, 0.04, b.x, Y0 + CMU_H + 0.125, ZW + 0.1);
      for (const x of [x0 - 0.02, x1 + 0.02]) reveal.add(boxMeters(0.04, UP + 0.25, 0.12), x, Y0 + CMU_H + (UP + 0.25) / 2, ZW + 0.06);
      trim.box(BAY_W + 0.08, 0.05, 0.14, b.x, Y0 + CMU_H + UP + 0.27, ZW + 0.06);
      const name = new THREE.Mesh(
        new THREE.PlaneGeometry(2.7, 0.3),
        new THREE.MeshStandardMaterial({
          map: textTexture('SAN DIEGO SAILING BAY', { color: '#f6f6f2', w: 1024, h: 114, font: `600 64px Arial, sans-serif` }),
          transparent: true,
          roughness: 0.5,
        }),
      );
      name.rotation.y = Math.PI;
      name.position.set(b.x, Y0 + 4.32, DOOR_Z - 0.01);
      root.add(name);
    }
  }
  root.add(reveal.mesh(E.cmu, false, true));
  root.add(trim.mesh(E.bronze, false, true));
  root.add(track.mesh(E.track, false, false));
  root.add(spring.mesh(E.spring, false, false));
  root.add(dark.mesh(M.darkSteel, false, false));
}
