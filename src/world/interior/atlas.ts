import * as THREE from 'three';
import { Batch, xform } from './batch';

export interface Cell {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

/** Shelf-packed canvas atlas so every sign, photo, plaque and name plate shares one material. */
export class Atlas {
  private pages: { c: HTMLCanvasElement; g: CanvasRenderingContext2D; mat: THREE.MeshStandardMaterial; x: number; y: number; rowH: number }[] = [];
  constructor(private size = 2048) {}

  private page() {
    const c = document.createElement('canvas');
    c.width = c.height = this.size;
    const g = c.getContext('2d')!;
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.55 });
    const p = { c, g, mat, x: 0, y: 0, rowH: 0 };
    this.pages.push(p);
    return p;
  }

  cell(w: number, h: number, draw: Draw): { cell: Cell; mat: THREE.Material } {
    let p = this.pages[this.pages.length - 1] ?? this.page();
    if (p.x + w > this.size) {
      p.x = 0;
      p.y += p.rowH + 2;
      p.rowH = 0;
    }
    if (p.y + h > this.size) p = this.page();
    const x = p.x;
    const y = p.y;
    p.g.save();
    p.g.translate(x, y);
    p.g.beginPath();
    p.g.rect(0, 0, w, h);
    p.g.clip();
    draw(p.g, w, h);
    p.g.restore();
    p.x += w + 2;
    p.rowH = Math.max(p.rowH, h);
    const S = this.size;
    // half-texel inset avoids bleeding between neighbours
    return { cell: { u0: (x + 0.5) / S, u1: (x + w - 0.5) / S, v0: 1 - (y + h - 0.5) / S, v1: 1 - (y + 0.5) / S }, mat: p.mat };
  }

  /** Quad of size w×h facing +z in the batch's current frame. */
  quad(b: Batch, w: number, h: number, draw: Draw, px: number, x: number, y: number, z: number, ry = 0, rx = 0) {
    const { cell, mat } = this.cell(Math.max(8, Math.round(w * px)), Math.max(8, Math.round(h * px)), draw);
    const geo = new THREE.PlaneGeometry(1, 1);
    const uv = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, cell.u0 + uv.getX(i) * (cell.u1 - cell.u0), cell.v0 + uv.getY(i) * (cell.v1 - cell.v0));
    geo.userData.batchTemp = true;
    b.add(geo, mat, xform(x, y, z, ry, w, h, 1, rx, 0));
  }

  finish() {
    for (const p of this.pages) (p.mat.map as THREE.CanvasTexture).needsUpdate = true;
  }
}

export function rand(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
