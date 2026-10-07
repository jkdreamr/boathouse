/**
 * Per-athlete body description. Segment lengths follow the Drillis & Contini
 * proportions of stature (as tabulated in Winter, "Biomechanics and Motor
 * Control of Human Movement"): thigh 0.245H, shank 0.246H, upper arm 0.186H,
 * forearm 0.146H, hand 0.108H, foot 0.152H, ankle height 0.039H, hip joint
 * height 0.530H, shoulder height 0.818H.
 */
export const SKIN_TONES = ['#f1c7a5', '#e0ac87', '#c68863', '#a86b47', '#7d4a2d', '#5a3420'];
export const CARDINAL = '#8c1515';
export const WHITE = '#f4f2ec';
export const DARK = '#2e2d29';

const HAIR_COLORS = ['#1b1410', '#2a1d16', '#3b2a1e', '#5a3f2a', '#7a5a3a', '#a07c52', '#c9a66b', '#2b2622'];

export type HairStyle = 'buzz' | 'crop' | 'swept' | 'pony' | 'bun';
export type Headwear = 'none' | 'cap' | 'visor';

export interface Anthro {
  female: boolean;
  H: number;
  girth: number;
  thigh: number;
  shin: number;
  upperArm: number;
  foreArm: number;
  hand: number;
  foot: number;
  ankleH: number;
  trunk: number;
  hipAboveSeat: number;
  hipHalf: number;
  shoulderHalf: number;
  neck: number;
  head: number;
  skin: string;
  hair: string;
  hairStyle: HairStyle;
  headwear: Headwear;
  headwearColor: string;
  glasses: boolean;
  shoe: string;
}

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// CrewBoat builds its seats in order starting at seed 1, so a seed of 1 marks a
// new crew. Crews alternate men's / women's so a boat is never mixed and two
// boats in the scene never share a lineup.
let crewIndex = -1;

export function makeAnthro(seed: number, crew?: 'men' | 'women'): Anthro {
  if (seed === 1 || crewIndex < 0) crewIndex++;
  const female = crew ? crew === 'women' : crewIndex % 2 === 1;
  const r = rng(seed * 7919 + crewIndex * 104729 + 17);
  const H = female ? 1.7 + 0.16 * r() : 1.83 + 0.17 * r();
  const girth = (female ? 0.9 : 1) * (0.93 + 0.14 * r());
  const skin = SKIN_TONES[Math.floor(r() * SKIN_TONES.length) % SKIN_TONES.length];
  const darkSkin = SKIN_TONES.indexOf(skin) >= 3;
  const hair = darkSkin ? HAIR_COLORS[Math.floor(r() * 2)] : HAIR_COLORS[Math.floor(r() * HAIR_COLORS.length)];
  const hs = female ? (r() < 0.6 ? 'pony' : 'bun') : (['buzz', 'crop', 'crop', 'swept'] as const)[Math.floor(r() * 4)];
  const hw = r();
  const headwear: Headwear = female ? (hw < 0.35 ? 'visor' : hw < 0.6 ? 'cap' : 'none') : hw < 0.3 ? 'cap' : hw < 0.38 ? 'visor' : 'none';
  const headwearColor = r() < 0.6 ? WHITE : r() < 0.5 ? CARDINAL : DARK;
  const glasses = r() < 0.3;
  return {
    female,
    H,
    girth,
    thigh: 0.245 * H,
    shin: 0.246 * H,
    upperArm: 0.186 * H,
    foreArm: 0.146 * H,
    hand: 0.108 * H,
    foot: 0.152 * H,
    ankleH: 0.039 * H,
    trunk: 0.288 * H,
    hipAboveSeat: 0.048 * H,
    hipHalf: (female ? 0.05 : 0.047) * H,
    shoulderHalf: (female ? 0.097 : 0.105) * H * (0.96 + 0.08 * (girth - 0.86)),
    neck: 0.052 * H,
    head: Math.sqrt(H / 1.88) * (female ? 0.95 : 1),
    skin,
    hair,
    hairStyle: hs,
    headwear,
    headwearColor,
    glasses,
    shoe: crewIndex % 2 === 0 ? '#e8e8e4' : '#202022',
  };
}
