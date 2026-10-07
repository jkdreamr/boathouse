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

const EYE_COLORS = ['#3b2414', '#4a2e1a', '#2a1a10', '#5b4026', '#5d6b3a', '#4f6f86', '#6b8aa3', '#3e5468'];
const LENS_TINTS = ['#1f3f8f', '#9b4a1f', '#1c2024', '#2f6b4a', '#7a2a6a'];
const FRAME_COLORS = ['#141416', '#f1f1ee', '#2b2d31', '#8c1515'];

/** Facial proportions as multipliers of an average adult face (1 = average). */
export interface Face {
  nose: number;
  noseW: number;
  jaw: number;
  lips: number;
  brow: number;
  cheek: number;
  chin: number;
  ear: number;
}

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
  face: Face;
  eyes: string;
  /** Male hairline recession (head-unit metres) and stubble density 0..1. */
  recession: number;
  stubble: number;
  lens: string;
  frame: string;
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

export function makeAnthro(seed: number, crew?: 'men' | 'women', options: { counterFree?: boolean } = {}): Anthro {
  if (!options.counterFree && (seed === 1 || crewIndex < 0)) crewIndex++;
  const generation = options.counterFree ? 0 : crewIndex;
  const female = crew ? crew === 'women' : generation % 2 === 1;
  const r = rng(seed * 7919 + generation * 104729 + 17);
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
  // Face details come from their own stream so the body/kit draws above stay unchanged.
  const q = rng(seed * 31337 + generation * 7177 + 5);
  const v = (spread: number) => 1 + spread * (q() + q() - 1);
  const face: Face = {
    nose: v(0.14) * (female ? 0.86 : 1),
    noseW: v(0.12) * (female ? 0.9 : 1) * (darkSkin ? 1.12 : 1),
    jaw: v(0.06) * (female ? 0.92 : 1),
    lips: v(0.2) * (female ? 1.18 : 1) * (darkSkin ? 1.15 : 1),
    brow: v(0.25) * (female ? 0.35 : 1),
    cheek: v(0.25) * (female ? 1.1 : 1),
    chin: v(0.3) * (female ? 0.7 : 1),
    ear: v(0.08) * (female ? 0.93 : 1),
  };
  const lightEyes = SKIN_TONES.indexOf(skin) <= 1 && q() < 0.55;
  const eyes = lightEyes ? EYE_COLORS[4 + Math.floor(q() * 4)] : EYE_COLORS[Math.floor(q() * 4)];
  const recession = female ? 0 : q() * q() * 0.014;
  const stubble = female ? 0 : q() < 0.45 ? 0.35 + 0.5 * q() : 0;
  const lens = LENS_TINTS[Math.floor(q() * LENS_TINTS.length)];
  const frame = FRAME_COLORS[Math.floor(q() * FRAME_COLORS.length)];
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
    shoe: generation % 2 === 0 ? '#e8e8e4' : '#202022',
    face,
    eyes,
    recession,
    stubble,
    lens,
    frame,
  };
}
