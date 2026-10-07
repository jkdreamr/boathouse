import * as THREE from 'three';
import { conditions } from '../../sim/conditions';
import { centerline, channelDepthDist, channelWidth } from '../terrain';
import type { PeopleBatch } from './people';
import type { WakeField } from './wake';

export const SKIN_TONES = ['#f1c7a5', '#e0ac87', '#c68863', '#a86b47', '#7d4a2d', '#5a3420'];
export const CARDINAL = '#8c1515';
export const WHITE = '#f4f2ec';
export const DARK = '#2e2d29';

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (t: number) => {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
};
export function wrap(a: number) {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}
/** World heading convention shared with CrewBoat: heading 0 = +x, forward = (cos h, -sin h). */
export const headingTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tz - z), tx - x);

/** Deterministic PRNG so every load gets the same traffic plan. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const DOCK_HALF_X = 58;
const DOCK_EDGE_Z = -32;

/** Metres to the nearest unnavigable water: banks, the boathouse dock/moorings, and mudflats exposed at low tide. */
export function navDist(x: number, z: number) {
  let d = channelDepthDist(x, z);
  const ax = Math.abs(x);
  const dock = ax <= DOCK_HALF_X ? DOCK_EDGE_Z - z : Math.hypot(ax - DOCK_HALF_X, Math.max(0, z - DOCK_EDGE_Z));
  if (dock < d) d = dock;
  return d - Math.max(0, -conditions.level) * 8;
}

/** Keep-right lane: starboard side of the channel for the direction of travel (dir +1 = downstream/+x). */
export function laneZ(x: number, dir: number, frac: number) {
  return centerline(x) + dir * frac * channelWidth(x) * 0.5;
}

/** Bend a desired heading back toward mid-channel if the look-ahead point is too close to shoal water. */
export function bankSafe(x: number, z: number, hd: number, look: number, margin: number) {
  const px = x + Math.cos(hd) * look;
  const pz = z - Math.sin(hd) * look;
  const nd = Math.min(navDist(px, pz), navDist(x, z) + 4);
  if (nd >= margin) return hd;
  const hc = headingTo(x, z, px, centerline(px));
  return hd + wrap(hc - hd) * clamp((margin - nd) / margin, 0, 1);
}

export interface Body {
  readonly x: number;
  readonly z: number;
  readonly heading: number;
  readonly speed: number;
  readonly halfLen: number;
  readonly halfBeam: number;
}

export interface Ctx {
  bodies: Body[];
  cam: THREE.Vector3;
  wake: WakeField;
  people: PeopleBatch;
}

export interface Agent extends Body {
  active: boolean;
  /** Camera distance, refreshed by the manager each frame. */
  camDist: number;
  update(dt: number, time: number, ctx: Ctx): void;
  nudge(dx: number, dz: number): void;
  setVisible(v: boolean, detail: boolean): void;
  draw(pb: PeopleBatch, time: number): void;
}

export interface Avoid {
  turn: number;
  slow: number;
}

/**
 * Closest-point-of-approach collision avoidance. Turn away from the predicted pass side
 * (default to starboard when head-on, as in COLREG rule 14) and ease off when following too close.
 */
export function avoid(self: Body, bodies: Body[], out: Avoid, horizon = 30, skip?: Body) {
  out.turn = 0;
  out.slow = 1;
  const fx = Math.cos(self.heading);
  const fz = -Math.sin(self.heading);
  const svx = fx * self.speed;
  const svz = fz * self.speed;
  for (const o of bodies) {
    if (o === self || o === skip) continue;
    const dx = o.x - self.x;
    const dz = o.z - self.z;
    const d2 = dx * dx + dz * dz;
    if (d2 > 200 * 200) continue;
    const safe = (self.halfLen + o.halfLen) * 0.55 + self.halfBeam + o.halfBeam + 5;
    const ovx = Math.cos(o.heading) * o.speed - svx;
    const ovz = -Math.sin(o.heading) * o.speed - svz;
    const rv2 = ovx * ovx + ovz * ovz;
    const tc = rv2 > 1e-4 ? clamp(-(dx * ovx + dz * ovz) / rv2, 0, horizon) : 0;
    const cx = dx + ovx * tc;
    const cz = dz + ovz * tc;
    const cpa = Math.hypot(cx, cz);
    if (cpa < safe) {
      const urg = (1 - cpa / safe) * (1 - tc / horizon);
      const lateral = cx * -fz + cz * fx; // + = CPA on our port side
      // Head-on: both alter to starboard (pass port-to-port); otherwise open the CPA away from them.
      const headOn = o.speed > 0.3 && Math.abs(wrap(o.heading - self.heading)) > 2.5;
      const side = headOn || lateral > 1.5 ? -1 : lateral < -1.5 ? 1 : -1;
      out.turn += side * urg * 1.1;
    }
    const ahead = dx * fx + dz * fz;
    const across = Math.abs(dx * -fz + dz * fx);
    if (ahead > 0 && across < safe * 0.8) out.slow = Math.min(out.slow, clamp((ahead - safe * 0.7) / (safe * 1.6), 0, 1));
  }
  out.turn = clamp(out.turn, -1.2, 1.2);
}
