import * as THREE from 'three';
import { rand } from './geo';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function tex(c: HTMLCanvasElement, tileW: number, tileH: number, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.anisotropy = 8;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function rgb(hex: string) {
  const c = new THREE.Color(hex);
  return [c.r * 255, c.g * 255, c.b * 255];
}

/**
 * Split-face CMU, one tile = 4 m x 5.6 m (28 courses of 8x16 in block).
 * Banding per the Commons photos: ~5 rose courses at the base and four maroon accent courses in the upper half.
 */
function cmuTex() {
  const courses = 28;
  const ch = 40;
  const W = 800;
  const H = courses * ch;
  const bw = W / 10;
  const col = canvas(W, H);
  const bump = canvas(W, H);
  const rough = canvas(W, H);
  const cdI = col.g.createImageData(W, H);
  const bdI = bump.g.createImageData(W, H);
  const rdI = rough.g.createImageData(W, H);
  const cd = cdI.data;
  const bd = bdI.data;
  const rd = rdI.data;
  const r = rand(41);
  const tan = rgb('#b8b1a7');
  const rose = rgb('#8c7b78');
  const stripe = rgb('#74605d');
  const mortar = rgb('#9c968d');
  const stripes = [12, 15, 18, 21];
  // per-block tint + per-block face tilt for the split-face look
  const tint: number[] = [];
  const tiltX: number[] = [];
  const tiltY: number[] = [];
  for (let i = 0; i < courses * 12; i++) {
    tint.push(0.9 + r() * 0.16);
    tiltX.push((r() - 0.5) * 0.6);
    tiltY.push((r() - 0.5) * 0.6);
  }
  // low-frequency grain field (aggregate clusters)
  const GN = 64;
  const grain: number[] = [];
  for (let i = 0; i < GN * GN; i++) grain.push(r());
  const gAt = (x: number, y: number) => {
    const gx = (x / W) * GN * 3;
    const gy = (y / H) * GN * 3;
    const ix = Math.floor(gx) % GN;
    const iy = Math.floor(gy) % GN;
    const fx = gx - Math.floor(gx);
    const fy = gy - Math.floor(gy);
    const a = grain[iy * GN + ix];
    const b = grain[iy * GN + ((ix + 1) % GN)];
    const c = grain[((iy + 1) % GN) * GN + ix];
    const d = grain[((iy + 1) % GN) * GN + ((ix + 1) % GN)];
    return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
  };
  for (let y = 0; y < H; y++) {
    const k = courses - 1 - Math.floor(y / ch);
    const fyc = (y % ch) / ch;
    const base = k < 5 ? rose : stripes.includes(k) ? stripe : tan;
    const off = k % 2 ? bw / 2 : 0;
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const xb = x - off + W;
      const bi = Math.floor(xb / bw) % 10;
      const fx = (xb % bw) / bw;
      const jointY = fyc < 0.05 || fyc > 0.95;
      const jointX = fx < 0.025 || fx > 0.975;
      const n = r();
      if (jointY || jointX) {
        const m = 0.9 + n * 0.12;
        cd[i] = mortar[0] * m;
        cd[i + 1] = mortar[1] * m;
        cd[i + 2] = mortar[2] * m;
        bd[i] = bd[i + 1] = bd[i + 2] = 40 + n * 30;
        rd[i] = rd[i + 1] = rd[i + 2] = 235;
      } else {
        const bIdx = k * 12 + bi;
        const g = gAt(x, y);
        const t = tint[bIdx] * (0.9 + g * 0.16) * (n < 0.04 ? 0.78 : n > 0.97 ? 1.14 : 1) + (n - 0.5) * 0.08;
        cd[i] = Math.min(255, base[0] * t);
        cd[i + 1] = Math.min(255, base[1] * t);
        cd[i + 2] = Math.min(255, base[2] * t);
        const face = 170 + tiltX[bIdx] * (fx - 0.5) * 120 + tiltY[bIdx] * (fyc - 0.5) * 120 + g * 50 + (n - 0.5) * 70;
        bd[i] = bd[i + 1] = bd[i + 2] = Math.max(80, Math.min(255, face));
        rd[i] = rd[i + 1] = rd[i + 2] = 215 + g * 30 + (n - 0.5) * 20;
      }
      cd[i + 3] = bd[i + 3] = rd[i + 3] = 255;
    }
  }
  col.g.putImageData(cdI, 0, 0);
  bump.g.putImageData(bdI, 0, 0);
  rough.g.putImageData(rdI, 0, 0);
  return { map: tex(col.c, 4, 5.6), bump: tex(bump.c, 4, 5.6, false), rough: tex(rough.c, 4, 5.6, false) };
}

/** Generic fine grain used as bump/roughness variation on metals and concrete. */
function grainTex(seed: number, tile: number, lo = 150, hi = 255, streak = 0) {
  const N = 256;
  const { c, g } = canvas(N, N);
  const img = g.createImageData(N, N);
  const r = rand(seed);
  const row: number[] = [];
  for (let x = 0; x < N; x++) row.push(r());
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4;
      const v = lo + (hi - lo) * ((1 - streak) * r() + streak * row[x]);
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return tex(c, tile, tile, false);
}

/** Corrugated steel deck (balcony soffit), ribs along u every 0.15 m. */
function deckTex() {
  const W = 128;
  const { c, g } = canvas(W, 16);
  const grd = g.createLinearGradient(0, 0, W, 0);
  for (let k = 0; k <= 4; k++) {
    grd.addColorStop(k / 4, '#bdbab2');
    if (k < 4) grd.addColorStop((k + 0.5) / 4, '#e6e3db');
  }
  g.fillStyle = grd;
  g.fillRect(0, 0, W, 16);
  return tex(c, 0.6, 0.6);
}

function flagTex() {
  // Executive Order 10834 proportions: hoist A = 1, fly B = 1.9, union C = 7/13, D = 0.76,
  // star rows E = F = 0.054, columns G = H = 0.063, star diameter K = 0.0616.
  const Hh = 520;
  const Ww = Math.round(Hh * 1.9);
  const { c, g } = canvas(Ww, Hh);
  const sh = Hh / 13;
  for (let i = 0; i < 13; i++) {
    g.fillStyle = i % 2 ? '#ffffff' : '#b31942';
    g.fillRect(0, i * sh, Ww, sh + 1);
  }
  g.fillStyle = '#0a3161';
  g.fillRect(0, 0, 0.76 * Hh, 7 * sh);
  g.fillStyle = '#ffffff';
  const R = (0.0616 * Hh) / 2;
  const star = (cx: number, cy: number) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      const rr = k % 2 ? R * 0.382 : R;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
    g.fill();
  };
  for (let row = 1; row <= 9; row++) {
    const y = row * 0.054 * Hh;
    if (row % 2) for (let k = 0; k < 6; k++) star((2 * k + 1) * 0.063 * Hh, y);
    else for (let k = 1; k <= 5; k++) star(2 * k * 0.063 * Hh, y);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function create() {
  const cmu = cmuTex();
  const metalGrain = grainTex(5, 1.2, 190, 255, 0.6);
  const concreteRough = grainTex(9, 2.0, 200, 255);
  const std = (p: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial(p);
  return {
    cmu: std({ map: cmu.map, bumpMap: cmu.bump, bumpScale: 2.2, roughnessMap: cmu.rough, roughness: 1 }),
    /** clear-anodized aluminium for door sections / storefront */
    anod: std({ color: '#d4d6d6', roughness: 0.32, metalness: 0.75, roughnessMap: metalGrain }),
    doorGlass: std({
      color: '#8fb0c9',
      metalness: 0.9,
      roughness: 0.04,
      transparent: true,
      opacity: 0.42,
      envMapIntensity: 1.8,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
    seal: std({ color: '#161616', roughness: 0.85 }),
    /** dark bronze sheet metal: gutters, downspouts, fascia, flashing, coping */
    bronze: std({ color: '#3b2c25', roughness: 0.5, metalness: 0.35, roughnessMap: metalGrain }),
    /** painted structural steel (balcony, braces, stair) */
    paintSteel: std({ color: '#e4e1d8', roughness: 0.55, metalness: 0.15 }),
    galv: std({ color: '#a8acae', roughness: 0.42, metalness: 0.85, roughnessMap: metalGrain }),
    stainless: std({ color: '#d3d5d6', roughness: 0.22, metalness: 1 }),
    track: std({ color: '#9fa3a6', roughness: 0.4, metalness: 0.8 }),
    spring: std({ color: '#2a2b2d', roughness: 0.5, metalness: 0.6 }),
    soffit: std({ map: deckTex(), roughness: 0.6, metalness: 0.3 }),
    concrete: std({ color: '#b3ada3', roughness: 1, roughnessMap: concreteRough, bumpMap: concreteRough, bumpScale: 0.4 }),
    washPad: std({ color: '#9c978e', roughness: 0.75, roughnessMap: concreteRough }),
    curbRed: std({ color: '#a8352c', roughness: 0.7 }),
    domes: std({ color: '#d9a514', roughness: 0.6 }),
    brass: std({ color: '#b28d4f', roughness: 0.35, metalness: 0.9 }),
    hose: std({ color: '#2f5a2f', roughness: 0.6 }),
    rubber: std({ color: '#1c1c1c', roughness: 0.9 }),
    lens: std({ color: '#fffaf0', emissive: '#ffe9c4', emissiveIntensity: 0.9, roughness: 0.2 }),
    globe: std({ color: '#ffffff', emissive: '#fff1d6', emissiveIntensity: 0.7, roughness: 0.25 }),
    letters: std({ color: '#2b211c', roughness: 0.45, metalness: 0.55 }),
    grate: std({ color: '#2e2f30', roughness: 0.7, metalness: 0.5 }),
    gold: std({ color: '#c9a646', roughness: 0.3, metalness: 1 }),
    flag: std({ map: flagTex(), roughness: 0.85, side: THREE.DoubleSide }),
    strap: std({ color: '#1f2a44', roughness: 0.8 }),
    pad: std({ color: '#2b5a8c', roughness: 0.8 }),
    seam: std({ color: '#5a534e', roughness: 0.38, metalness: 0.6 }),
    bikeRed: std({ color: '#7d1d1d', roughness: 0.45, metalness: 0.4 }),
    bikeTeal: std({ color: '#2f5f6a', roughness: 0.45, metalness: 0.4 }),
  };
}

export type ExtMats = ReturnType<typeof create>;
let cached: ExtMats | null = null;
export function extMats(): ExtMats {
  if (!cached) cached = create();
  return cached;
}
