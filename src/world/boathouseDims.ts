import * as THREE from 'three';
import { CMU_WALL_H } from '../textures';
import { PAD_Y } from './terrain';

export const Y0 = PAD_Y;
export const CMU_H = CMU_WALL_H;
export const UP_H = 3.4;
export const EAVE = Y0 + CMU_H + UP_H;
export const SLOPE = Math.tan(THREE.MathUtils.degToRad(26));
export const X0 = -24;
export const X1 = 24;
export const ZW = 12;
export const ZF = 34;
export const RIDGE_Z = (ZW + ZF) / 2;
export const RIDGE_Y = EAVE + (RIDGE_Z - ZW) * SLOPE;
export const BALCONY_Y = Y0 + CMU_H;

// [realism:interior] five 4.0 m bay doors (matches the exterior engineer's layout)
export const BAYS = [
  { x: -19.2, open: true },
  { x: -9.6, open: true },
  { x: 0, open: true },
  { x: 9.6, open: true },
  { x: 19.2, open: true },
];
