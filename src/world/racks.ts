import * as THREE from 'three';
import type { BoatClass } from '../rowing/crewboat';
export interface RackSlot { id: string; cls: BoatClass; name: string; pos: THREE.Vector3; heading: number; tier: number; mesh: THREE.Object3D | null }
export const rackSlots: RackSlot[] = [];
