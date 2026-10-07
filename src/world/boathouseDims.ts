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

/** Five boat bays on the water facade (centre x). Doors are full-view aluminium sectional doors. */
export const BAYS = [
  { x: -19.2, open: false },
  { x: -9.6, open: true },
  { x: 0, open: true },
  { x: 9.6, open: true },
  { x: 19.2, open: false },
];
/** Clear opening of each bay door (m). */
export const BAY_W = 4.0;
export const BAY_H = 3.6;
/** Main-roof eave overhang beyond the long walls (m). */
export const EAVE_OVER = 0.7;
/** Street-side entry gable: projects to z = ENTRY.z, roof slope ENTRY.slope, roof planes from z = ENTRY.zBack. */
export const ENTRY = { x0: -6, x1: 6, z: 36.5, slope: 0.75, run: 6.35, zBack: 24.5, zFront: 36.9 };
/** Water-side dormer over the centre bay. */
export const DORMER = { x: 1, half: 4.5, slope: 0.7, over: 0.4, z0: ZW - 0.45, len: 8.6 };
