import * as THREE from 'three';

let maxAniso = 8;
export function setMaxAnisotropy(n: number) {
  maxAniso = n;
}

function rand(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return { c, g: c.getContext('2d')! };
}

function speckle(g: CanvasRenderingContext2D, w: number, h: number, amount: number, seed: number) {
  const r = rand(seed);
  const img = g.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amount;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  g.putImageData(img, 0, 0);
}

/** Texture whose repeat maps one tile to `tileW` x `tileH` meters (geometry UVs are in meters). */
function tex(c: HTMLCanvasElement, tileW: number, tileH: number, color = true) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / tileW, 1 / tileH);
  t.anisotropy = maxAniso;
  if (color) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function shade(hex: string, f: number) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(f);
  return `#${c.getHexString()}`;
}

export const COURSE_H = 0.2;
export const CMU_WALL_H = 5.6;

/** Split-face CMU: 4 m wide by 5.6 m tall, rose base band and maroon accent courses like the boathouse. */
export function cmuTexture() {
  const courses = Math.round(CMU_WALL_H / COURSE_H);
  const ch = 28;
  const W = 512;
  const H = courses * ch;
  const { c, g } = canvas(W, H);
  const b = canvas(W, H);
  const r = rand(11);
  const blockW = W / 10;
  const tan = '#cfc3b1';
  const rose = '#a3857d';
  const stripe = '#8e6a64';
  g.fillStyle = '#9d9385';
  g.fillRect(0, 0, W, H);
  b.g.fillStyle = '#000';
  b.g.fillRect(0, 0, W, H);
  for (let k = 0; k < courses; k++) {
    const y = H - (k + 1) * ch;
    const base = k < 3 ? rose : [6, 9, 12, 15].includes(k) ? stripe : tan;
    const off = k % 2 ? blockW / 2 : 0;
    for (let i = -1; i < 11; i++) {
      const x = i * blockW + off;
      g.fillStyle = shade(base, 0.92 + r() * 0.14);
      g.fillRect(x + 1.5, y + 1.5, blockW - 3, ch - 3);
      b.g.fillStyle = '#ddd';
      b.g.fillRect(x + 1.5, y + 1.5, blockW - 3, ch - 3);
    }
  }
  speckle(g, W, H, 46, 3);
  speckle(b.g, W, H, 120, 4);
  return { map: tex(c, 4, CMU_WALL_H), bump: tex(b.c, 4, CMU_WALL_H, false) };
}

/** Dark board-and-batten siding, 1.6 m tile. */
export function sidingTexture() {
  const W = 256;
  const { c, g } = canvas(W, W);
  const b = canvas(W, W);
  g.fillStyle = '#563630';
  g.fillRect(0, 0, W, W);
  b.g.fillStyle = '#555';
  b.g.fillRect(0, 0, W, W);
  const step = W / 5;
  for (let i = 0; i < 5; i++) {
    const x = i * step;
    g.fillStyle = '#3c2420';
    g.fillRect(x, 0, 3, W);
    g.fillStyle = '#62403a';
    g.fillRect(x + 3, 0, 9, W);
    g.fillStyle = '#6e4a43';
    g.fillRect(x + 4, 0, 2, W);
    b.g.fillStyle = '#fff';
    b.g.fillRect(x + 2, 0, 10, W);
  }
  speckle(g, W, W, 14, 5);
  return { map: tex(c, 1.6, 1.6), bump: tex(b.c, 1.6, 1.6, false) };
}

/** Standing-seam metal roof, 1.8 m tile. */
export function roofTexture() {
  const W = 256;
  const { c, g } = canvas(W, W);
  g.fillStyle = '#4c4642';
  g.fillRect(0, 0, W, W);
  const step = W / 4;
  for (let i = 0; i < 4; i++) {
    g.fillStyle = '#5c5550';
    g.fillRect(i * step, 0, 4, W);
    g.fillStyle = '#35302d';
    g.fillRect(i * step + 4, 0, 3, W);
  }
  speckle(g, W, W, 10, 6);
  return tex(c, 1.8, 1.8);
}

export function noiseTexture(base: string, amount: number, tile: number, seed = 1, size = 256) {
  const { c, g } = canvas(size, size);
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const r = rand(seed);
  for (let i = 0; i < size * 2; i++) {
    g.fillStyle = shade(base, 0.85 + r() * 0.3);
    g.globalAlpha = 0.25;
    const s = 2 + r() * 10;
    g.fillRect(r() * size, r() * size, s, s);
  }
  g.globalAlpha = 1;
  speckle(g, size, size, amount, seed + 7);
  return tex(c, tile, tile);
}

/** Deck planks along u, 2 m tile. */
export function planksTexture(base: string, seed = 9) {
  const W = 256;
  const { c, g } = canvas(W, W);
  const r = rand(seed);
  const rows = 14;
  const ph = W / rows;
  for (let j = 0; j < rows; j++) {
    g.fillStyle = shade(base, 0.85 + r() * 0.25);
    g.fillRect(0, j * ph, W, ph - 2);
    g.fillStyle = shade(base, 0.45);
    g.fillRect(0, j * ph + ph - 2, W, 2);
    const cut = r() * W;
    g.fillRect(cut, j * ph, 2, ph);
  }
  speckle(g, W, W, 22, seed);
  return tex(c, 2, 2);
}

export function textTexture(
  text: string,
  opts: { font?: string; color?: string; bg?: string; w?: number; h?: number; stroke?: string } = {},
) {
  const w = opts.w ?? 1024;
  const h = opts.h ?? 128;
  const { c, g } = canvas(w, h);
  if (opts.bg) {
    g.fillStyle = opts.bg;
    g.fillRect(0, 0, w, h);
  }
  g.font = opts.font ?? `bold ${Math.floor(h * 0.7)}px Georgia, 'Times New Roman', serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (opts.stroke) {
    g.strokeStyle = opts.stroke;
    g.lineWidth = h * 0.06;
    g.strokeText(text, w / 2, h / 2);
  }
  g.fillStyle = opts.color ?? '#222';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = maxAniso;
  return t;
}

/** Tileable normal map from integer-frequency sine waves, for the water shader. */
export function waterNormalTexture() {
  const N = 256;
  const { c, g } = canvas(N, N);
  const r = rand(21);
  const waves: { kx: number; ky: number; a: number; p: number }[] = [];
  for (let i = 0; i < 28; i++) {
    const kx = Math.round((r() - 0.5) * 2 * (2 + i));
    const ky = Math.round((r() - 0.5) * 2 * (2 + i));
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, a: 1 / (1 + Math.hypot(kx, ky) * 0.6), p: r() * Math.PI * 2 });
  }
  const img = g.createImageData(N, N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const ph = ((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.p;
        const cs = Math.cos(ph) * w.a;
        dx += cs * w.kx;
        dy += cs * w.ky;
      }
      const s = 0.045;
      const nx = -dx * s;
      const ny = -dy * s;
      const l = Math.hypot(nx, ny, 1);
      const i = (y * N + x) * 4;
      img.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / l) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Soft radial sprite used for puddles and wake foam. */
export function ringTexture() {
  const N = 128;
  const { c, g } = canvas(N, N);
  const grd = g.createRadialGradient(N / 2, N / 2, N * 0.18, N / 2, N / 2, N / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0)');
  grd.addColorStop(0.55, 'rgba(255,255,255,0.15)');
  grd.addColorStop(0.8, 'rgba(255,255,255,0.75)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(c);
}

export function blobTexture() {
  const N = 64;
  const { c, g } = canvas(N, N);
  const grd = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, N, N);
  return new THREE.CanvasTexture(c);
}

/** Scale a geometry's UVs so 1 UV unit equals 1 meter for a w x h face. */
export function meterUV(geo: THREE.BufferGeometry, w: number, h: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w, uv.getY(i) * h);
  uv.needsUpdate = true;
  return geo;
}

/** BoxGeometry with per-face UVs in meters. */
export function boxMeters(w: number, h: number, d: number) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
    }
  }
  return geo;
}
