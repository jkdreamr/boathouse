export interface System {
  update(dt: number, time: number): void;
}

export const systems: System[] = [];

export function addSystem(s: System) {
  systems.push(s);
}
