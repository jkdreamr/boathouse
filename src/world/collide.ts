/** Simple walkable world: axis-aligned wall boxes plus floor regions (flat or ramped). */
export interface Wall {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  minY: number;
  maxY: number;
}

export interface Floor {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  /** height at (x, z) */
  y: (x: number, z: number) => number;
}

export const walls: Wall[] = [];
export const floors: Floor[] = [];

export function addWall(minX: number, maxX: number, minZ: number, maxZ: number, minY = -10, maxY = 100) {
  walls.push({
    minX: Math.min(minX, maxX),
    maxX: Math.max(minX, maxX),
    minZ: Math.min(minZ, maxZ),
    maxZ: Math.max(minZ, maxZ),
    minY,
    maxY,
  });
}

export function addFlatFloor(minX: number, maxX: number, minZ: number, maxZ: number, y: number) {
  floors.push({ minX, maxX, minZ, maxZ, y: () => y });
}

/** Ramp rising linearly along an axis from y0 at the low edge to y1 at the high edge. */
export function addRamp(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  axis: 'x' | 'z',
  y0: number,
  y1: number,
  reverse = false,
) {
  floors.push({
    minX,
    maxX,
    minZ,
    maxZ,
    y: (x, z) => {
      let t = axis === 'x' ? (x - minX) / (maxX - minX) : (z - minZ) / (maxZ - minZ);
      if (reverse) t = 1 - t;
      return y0 + (y1 - y0) * Math.min(1, Math.max(0, t));
    },
  });
}

/** Highest floor at (x, z) that is not above `maxY`; null when no floor is there. */
export function floorAt(x: number, z: number, maxY: number): number | null {
  let best: number | null = null;
  for (const f of floors) {
    if (x < f.minX || x > f.maxX || z < f.minZ || z > f.maxZ) continue;
    const y = f.y(x, z);
    if (y <= maxY && (best === null || y > best)) best = y;
  }
  return best;
}

export function hitsWall(x: number, z: number, r: number, feetY: number, headY: number) {
  for (const w of walls) {
    if (headY < w.minY || feetY + 0.35 > w.maxY) continue;
    if (x + r > w.minX && x - r < w.maxX && z + r > w.minZ && z - r < w.maxZ) return true;
  }
  return false;
}
