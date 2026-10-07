import * as THREE from 'three';

/**
 * Tide, tidal current and wind for Redwood Creek.
 *
 * Tide: harmonic constituents and datums for NOAA station 9414523 (Redwood City, CA), heights in meters above MLLW.
 * Scene water level = h_MLLW - 2.2, so MHHW (2.50) sits at +0.3 and MLLW at -2.2.
 * Game time is compressed so one M2 cycle (12.42 h) lasts 8 minutes.
 *
 * World frame: +x is downstream (bearing ~51° true), +z points from the creek toward the boathouse (~141° true).
 * Vector2 fields are world XZ: v.x = world x, v.y = world z.
 */

export const KT = 0.514444;
export const MLLW_OFFSET = -2.2;
export const DATUMS = { MLLW: 0, MLW: 0.365, MSL: 1.342, MHW: 2.307, MHHW: 2.5, HIGHEST: 3.289 } as const;
const M2_HOURS = 12.4206012;
/** Real seconds per game second. */
export const TIDE_COMPRESSION = (M2_HOURS * 3600) / 480;

/** [amplitude m, speed deg/h, phase deg (GMT)] from NOAA CO-OPS harmonic constituents for 9414523. */
const CONSTITUENTS: [number, number, number][] = [
  [0.885, 28.984104, 237.2], // M2
  [0.201, 30.0, 254.8], // S2
  [0.179, 28.43973, 216.8], // N2
  [0.404, 15.041069, 240.0], // K1
  [0.238, 13.943035, 224.5], // O1
  [0.02, 57.96821, 316.8], // M4
  [0.019, 44.025173, 73.1], // MK3
];
const DEG = Math.PI / 180;
const HC = CONSTITUENTS.map(([a, speed, phase]) => ({ a, w: (speed * DEG) / 3600, p: phase * DEG }));

/** Tide height in meters above MLLW at real-world seconds `t` from the model epoch. */
export function tideHeight(t: number) {
  let h = DATUMS.MSL;
  for (const c of HC) h += c.a * Math.cos(c.w * t - c.p);
  return h;
}

/** dh/dt in meters per real second. */
export function tideRate(t: number) {
  let r = 0;
  for (const c of HC) r -= c.a * c.w * Math.sin(c.w * t - c.p);
  return r;
}

/** Real-time tidal rate (m/s) that maps to a 1 kt current; typical peak flood/ebb rate for this station. */
const PEAK_RATE = 1.35e-4;
const PEAK_CURRENT = 1.0 * KT;
/** Model epoch picked so the session opens on a mid-flood rising toward the higher high water. */
const START_T = 16.75 * 3600;

export type WindPreset = 'dawn' | 'midday' | 'afternoon';
/** South Bay sea-breeze climatology: mean speed (kt), direction the wind blows FROM (deg true), gust and veer amplitude. */
export const WIND_CLIMATE: Record<WindPreset, { kt: number; from: number; gust: number; veer: number }> = {
  dawn: { kt: 1.6, from: 245, gust: 0.6, veer: 40 },
  midday: { kt: 8, from: 300, gust: 0.28, veer: 12 },
  afternoon: { kt: 15, from: 310, gust: 0.24, veer: 8 },
};

export const conditions = {
  /** Water surface Y in scene meters (0 = the scene's design level). */
  level: 0,
  /** d(level)/dt in meters per game second. */
  levelRate: 0,
  /** Wind at the boathouse reach, m/s, the direction the air moves TOWARD; includes the current gust. */
  wind: new THREE.Vector2(),
  /** Gust intensity at the boathouse reach, 0 = lull, 1 = peak gust. */
  gust: 0,
  /** Tidal current in mid-channel off the dock, m/s (flood runs -x, ebb +x). Use currentAt() for local values. */
  current: new THREE.Vector2(),
  /** Game seconds since start. */
  clock: 0,
  /** Real-world seconds on the tide model clock. */
  tideTime: START_T,
  /** Tide height above MLLW, meters. */
  tideHeight: 0,
  /** Mean (gust-free) wind speed, m/s, eased toward the active climate. */
  windMean: 0,
  /** Direction the mean wind blows FROM, degrees true. */
  windFrom: WIND_CLIMATE.afternoon.from,
  /** Fractional gust amplitude of the active climate. */
  gustiness: WIND_CLIMATE.afternoon.gust,
  /** Accumulated downwind drift (m) of the cat's-paw gust pattern; the water shader uses the same value. */
  pawOffset: new THREE.Vector2(),
};

const target = { ...WIND_CLIMATE.afternoon };
conditions.windMean = target.kt * KT;

export function setWindClimate(preset: WindPreset) {
  Object.assign(target, WIND_CLIMATE[preset]);
}

/** Unit world-XZ vector pointing along compass bearing `deg` (true). */
export function bearingToWorld(deg: number, out = new THREE.Vector2()) {
  const a = (deg - 51) * DEG;
  return out.set(Math.cos(a), Math.sin(a));
}

/** Compass bearing (deg true) of a world-XZ direction. */
export function worldToBearing(x: number, z: number) {
  return (((Math.atan2(z, x) / DEG + 51) % 360) + 360) % 360;
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
export const compassPoint = (deg: number) => COMPASS[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];

// --- cat's paws: an advected value-noise field, mirrored in the water shader (env.ts) ---
function hash12(x: number, y: number) {
  let a = (x * 0.1031) % 1;
  let b = (y * 0.1031) % 1;
  let c = (x * 0.1031) % 1;
  if (a < 0) a += 1;
  if (b < 0) b += 1;
  if (c < 0) c += 1;
  const d = a * (b + 33.33) + b * (c + 33.33) + c * (a + 33.33);
  a += d;
  b += d;
  c += d;
  const r = ((a + b) * c) % 1;
  return r < 0 ? r + 1 : r;
}

function vnoise(x: number, y: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash12(xi, yi);
  const b = hash12(xi + 1, yi);
  const c = hash12(xi, yi + 1);
  const d = hash12(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Cat's-paw gust field in [0, 1] (0.5 average). Must match `pawField` in env.ts. */
export function pawField(x: number, z: number) {
  const px = (x - conditions.pawOffset.x) / 46;
  const pz = (z - conditions.pawOffset.y) / 46;
  return 0.65 * vnoise(px, pz) + 0.35 * vnoise(px * 2.3 + 17.1, pz * 2.3 + 5.3);
}

/** Temporal gust signal in [-1, 1]: incommensurate periods of tens of seconds, like real puffs. */
function gustSignal(t: number) {
  return (
    0.45 * Math.sin(t * 0.27 + 1.1) +
    0.3 * Math.sin(t * 0.153 + 4.0) +
    0.17 * Math.sin(t * 0.61 + 2.3) +
    0.08 * Math.sin(t * 1.37 + 0.4)
  );
}

const REF = { x: 0, z: -70 };
const tmpDir = new THREE.Vector2();

/** Instantaneous wind (m/s, blowing toward) at a world point, including cat's paws and gusts. */
export function windAt(x: number, z: number, out = new THREE.Vector2()) {
  const t = conditions.clock;
  const g = 0.55 * gustSignal(t) + 0.9 * (pawField(x, z) - 0.5);
  const speed = Math.max(0, conditions.windMean * (1 + conditions.gustiness * 1.6 * g));
  const veer = target.veer * (0.6 * Math.sin(t * 0.071 + 0.7) + 0.4 * Math.sin(t * 0.193 + 2.1));
  bearingToWorld(conditions.windFrom + 180 + veer, tmpDir);
  return out.copy(tmpDir).multiplyScalar(speed);
}

/** Gust intensity 0..1 at a point. */
export function gustAt(x: number, z: number) {
  const g = 0.55 * gustSignal(conditions.clock) + 0.9 * (pawField(x, z) - 0.5);
  return THREE.MathUtils.clamp(0.5 + g, 0, 1);
}

// --- tidal current ---
let channel: { depthDist: (x: number, z: number) => number; centerline: (x: number) => number } | null = null;
/** terrain.ts registers its channel geometry so currentAt() can taper the flow toward the banks. */
export function setChannel(c: typeof channel) {
  channel = c;
}

/** Along-channel current speed at mid-channel, m/s; positive = ebb (downstream, +x). */
function channelCurrent() {
  const r = tideRate(conditions.tideTime);
  return THREE.MathUtils.clamp(-r / PEAK_RATE, -1.35, 1.35) * PEAK_CURRENT;
}

/** Tidal current (m/s) at a world point; strongest over the thalweg, near zero at the banks and on the mudflats. */
export function currentAt(x: number, z: number, out = new THREE.Vector2()) {
  const u = channelCurrent();
  if (!channel) return out.set(u, 0);
  const d = channel.depthDist(x, z);
  if (d <= 0) return out.set(0, 0);
  const s = THREE.MathUtils.smoothstep(d, 4, 60);
  const dz = channel.centerline(x + 5) - channel.centerline(x - 5);
  out.set(10, dz).normalize().multiplyScalar(u * (0.15 + 0.85 * s) * Math.min(1, d / 4));
  return out;
}

// --- wind chop: a few short downwind wave trains for boat roll/pitch ---
const WAVES = [
  { dir: 0, k: 1.0, a: 1.0, ph: 0 },
  { dir: 0.42, k: 1.31, a: 0.6, ph: 1.7 },
  { dir: -0.5, k: 0.83, a: 0.55, ph: 4.1 },
  { dir: 0.15, k: 2.1, a: 0.3, ph: 2.6 },
];
const waveDir = new THREE.Vector2();

/** Significant chop amplitude (m) for the current wind: fetch-limited creek chop, ~0.08 m at 15 kt. */
export function chopAmplitude() {
  const u = conditions.windMean;
  return 0.004 + 0.0037 * u * u;
}

/** Peak chop wavelength (m): ~1 m in light air, ~3 m at 15 kt. */
export function chopWavelength() {
  return 0.9 + 0.27 * conditions.windMean;
}

function sumWaves(x: number, z: number, time: number, out: THREE.Vector2 | null) {
  const A = chopAmplitude();
  const L = chopWavelength();
  const base = Math.atan2(conditions.wind.y, conditions.wind.x);
  let h = 0;
  let sx = 0;
  let sz = 0;
  for (const w of WAVES) {
    const k = ((2 * Math.PI) / L) * w.k;
    const omega = Math.sqrt(9.81 * k);
    const a = A * w.a * 0.55;
    waveDir.set(Math.cos(base + w.dir), Math.sin(base + w.dir));
    const ph = k * (waveDir.x * x + waveDir.y * z) - omega * time + w.ph;
    h += a * Math.sin(ph);
    const c = a * k * Math.cos(ph);
    sx += c * waveDir.x;
    sz += c * waveDir.y;
  }
  // long, low wash from distant traffic so the water is never perfectly dead
  const kw = (2 * Math.PI) / 14;
  const pw = kw * (0.8 * x + 0.6 * z) - Math.sqrt(9.81 * kw) * time;
  h += 0.012 * Math.sin(pw);
  sx += 0.012 * kw * Math.cos(pw) * 0.8;
  sz += 0.012 * kw * Math.cos(pw) * 0.6;
  if (out) out.set(sx, sz);
  return h;
}

/** Surface slope (dh/dx, dh/dz) of the wind chop at a point, for boat roll/pitch. */
export function waveSlope(x: number, z: number, time: number, out = new THREE.Vector2()) {
  sumWaves(x, z, time, out);
  return out;
}

/** Chop surface height (m) relative to conditions.level. */
export function waveHeight(x: number, z: number, time: number) {
  return sumWaves(x, z, time, null);
}

// --- tide fast-forward ---
let seekTo: number | null = null;
let seekSpeed = 0;

/** Find the next low or high water after the current tide time (real seconds). */
export function nextExtreme(kind: 'low' | 'high', from = conditions.tideTime) {
  const step = 120;
  let prev = tideRate(from);
  for (let t = from + step; t < from + 30 * 3600; t += step) {
    const r = tideRate(t);
    const hit = kind === 'high' ? prev > 0 && r <= 0 : prev < 0 && r >= 0;
    if (hit) {
      let a = t - step;
      let b = t;
      for (let i = 0; i < 20; i++) {
        const m = (a + b) / 2;
        const rm = tideRate(m);
        if (kind === 'high' ? rm > 0 : rm < 0) a = m;
        else b = m;
      }
      return (a + b) / 2;
    }
    prev = r;
  }
  return from;
}

/** Fast-forward the tide to the next low or high water over a few seconds. */
export function seekTide(kind: 'low' | 'high', seconds = 4) {
  const t = nextExtreme(kind);
  seekTo = t;
  seekSpeed = Math.max(TIDE_COMPRESSION, (t - conditions.tideTime) / seconds);
}

export const isSeekingTide = () => seekTo !== null;

export type TidePhase = 'Flood' | 'Ebb' | 'High slack' | 'Low slack';

export function tidePhase(): TidePhase {
  const r = tideRate(conditions.tideTime);
  if (Math.abs(r) < PEAK_RATE * 0.12) return conditions.tideHeight > DATUMS.MSL ? 'High slack' : 'Low slack';
  return r > 0 ? 'Flood' : 'Ebb';
}

function syncTide() {
  conditions.tideHeight = tideHeight(conditions.tideTime);
  conditions.level = conditions.tideHeight + MLLW_OFFSET;
}
syncTide();

export function updateConditions(dt: number) {
  conditions.clock += dt;

  const before = conditions.level;
  if (seekTo !== null) {
    conditions.tideTime = Math.min(seekTo, conditions.tideTime + seekSpeed * dt);
    if (conditions.tideTime >= seekTo) seekTo = null;
  } else conditions.tideTime += dt * TIDE_COMPRESSION;
  syncTide();
  conditions.levelRate = dt > 0 ? (conditions.level - before) / dt : 0;

  const k = 1 - Math.exp(-dt / 3);
  conditions.windMean += (target.kt * KT - conditions.windMean) * k;
  let dFrom = target.from - conditions.windFrom;
  dFrom -= 360 * Math.round(dFrom / 360);
  conditions.windFrom += dFrom * k;
  conditions.gustiness += (target.gust - conditions.gustiness) * k;

  bearingToWorld(conditions.windFrom + 180, tmpDir);
  conditions.pawOffset.addScaledVector(tmpDir, conditions.windMean * 0.85 * dt);
  windAt(REF.x, REF.z, conditions.wind);
  conditions.gust = gustAt(REF.x, REF.z);
  currentAt(REF.x, REF.z, conditions.current);
}
